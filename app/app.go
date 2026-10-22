// SubGrid – desktop shell, portable part: local HTTP server, API, logging, browser mode.
//
// The embedded web app is served on 127.0.0.1 (random port + secret path token). The page talks
// to this process only through a small HTTP API (state, native file dialogs, heartbeat), so the
// very same page works in the WebView2 window and – as fallback – in the normal browser.
//
// Everything is logged to %LOCALAPPDATA%\SubGrid\subgrid.log (including Go runtime crashes).
package main

import (
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

//go:embed web
var webFS embed.FS

// set at build time: -ldflags "-X main.edition=lite -X main.version=2.2.0"
var (
	edition = "studio"
	version = "dev"
)

var errCanceled = errors.New("canceled")

type fileResult struct {
	Path  string `json:"path,omitempty"`
	Name  string `json:"name,omitempty"`
	Text  string `json:"text,omitempty"`
	Error string `json:"error,omitempty"`
}

type app struct {
	dir       string
	logPath   string
	logMu     sync.Mutex
	logf      *os.File
	tok       string
	host      string
	base      string
	mode      string // "webview" | "browser"
	selftest  bool
	startFile *fileResult
	startPath string
	pinged    atomic.Bool
	lastPing  atomic.Int64
	byeAt     atomic.Int64
	ready     chan struct{}
	readyOnce sync.Once
	fatalOnce sync.Once

	// platform hooks (native dialogs)
	saveDialog func(name, ext string) (string, error)
	openDialog func(exts []string) (string, error)
}

var A = &app{ready: make(chan struct{})}

func title() string {
	if edition == "lite" {
		return "SubGrid Lite"
	}
	return "SubGrid Studio"
}

/* ------------------------------------------------------------------ logging */

type logWriter struct{}

func (logWriter) Write(p []byte) (int, error) {
	A.logMu.Lock()
	if A.logf != nil {
		_, _ = A.logf.Write(p)
	}
	A.logMu.Unlock()
	if calledFromFatal() {
		A.fatal(strings.TrimSpace(string(p)))
	}
	return len(p), nil
}

// go-webview2 reports startup problems with log.Fatal (= silent exit in a GUI program).
// We catch that here, before os.Exit runs, and fall back to the browser instead.
func calledFromFatal() bool {
	pcs := make([]uintptr, 24)
	n := runtime.Callers(3, pcs)
	frames := runtime.CallersFrames(pcs[:n])
	for {
		f, more := frames.Next()
		if strings.HasPrefix(f.Function, "log.Fatal") || strings.HasPrefix(f.Function, "log.(*Logger).Fatal") {
			return true
		}
		if !more {
			return false
		}
	}
}

func (a *app) setupLogging() {
	a.logPath = filepath.Join(a.dir, "subgrid.log")
	if st, err := os.Stat(a.logPath); err == nil && st.Size() > 2<<20 {
		_ = os.Rename(a.logPath, a.logPath+".old")
	}
	f, err := os.OpenFile(a.logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		a.logf = f
		_ = debug.SetCrashOutput(f, debug.CrashOptions{})
		redirectStderr(f)
	}
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.SetOutput(logWriter{})
	log.Printf("==== %s %s (%s) start, args=%q, %s", title(), version, runtime.Version(), os.Args[1:], osVersion())
}

func (a *app) logRaw(s string) {
	a.logMu.Lock()
	defer a.logMu.Unlock()
	if a.logf != nil {
		_, _ = a.logf.WriteString(time.Now().Format("2006/01/02 15:04:05.000000 ") + s + "\n")
		_ = a.logf.Sync()
	}
}

func explainHRESULT(msg string) string {
	m := strings.ToLower(msg)
	switch {
	case strings.Contains(m, "80070002"):
		return "Die WebView2-Runtime wurde nicht gefunden."
	case strings.Contains(m, "80070005"):
		return "Zugriff verweigert – vermutlich blockiert ein Virenscanner oder der Datenordner ist schreibgeschützt."
	case strings.Contains(m, "8007139f"):
		return "Der WebView2-Datenordner wird gerade von einem anderen Prozess benutzt."
	case strings.Contains(m, "80070032"), strings.Contains(m, "80004002"):
		return "Die installierte WebView2-Version ist zu alt oder beschädigt."
	}
	return ""
}

/* ------------------------------------------------------------------ browser mode */

// open the page in the default browser and live as long as a tab pings us
func (a *app) runBrowser() {
	a.mode = "browser"
	log.Printf("browser mode: %s", a.base)
	openURL(a.base + "index.html")
	start := time.Now()
	for {
		time.Sleep(2 * time.Second)
		now := time.Now().Unix()
		if !a.pinged.Load() {
			if time.Since(start) > 3*time.Minute {
				log.Printf("browser mode: no page connected – exit")
				return
			}
			continue
		}
		if bye := a.byeAt.Load(); bye > 0 && bye >= a.lastPing.Load() && now-bye > 10 {
			log.Printf("browser mode: page closed – exit")
			return
		}
		// background tabs are throttled to ~1 timer/min – be generous
		if idle := now - a.lastPing.Load(); idle > 200 {
			log.Printf("browser mode: no heartbeat for %ds – exit", idle)
			return
		}
	}
}

/* ------------------------------------------------------------------ data */

func dataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base, _ = os.UserConfigDir()
	}
	if base == "" {
		base = os.TempDir()
	}
	d := filepath.Join(base, "SubGrid")
	_ = os.MkdirAll(d, 0o755)
	// migrate the state of version 2.1 (stored in %APPDATA%\SubGrid2)
	if old := os.Getenv("APPDATA"); old != "" {
		src, dst := filepath.Join(old, "SubGrid2", "state.json"), filepath.Join(d, "state.json")
		if _, err := os.Stat(dst); err != nil {
			if b, err := os.ReadFile(src); err == nil {
				_ = os.WriteFile(dst, b, 0o644)
			}
		}
	}
	return d
}

func readProject(path string, err error) fileResult {
	if err != nil {
		return fileResult{Error: err.Error()}
	}
	st, err := os.Stat(path)
	if err != nil {
		return fileResult{Error: err.Error()}
	}
	if st.Size() > 64<<20 {
		return fileResult{Error: "Datei ist zu groß"}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return fileResult{Error: err.Error()}
	}
	return fileResult{Path: path, Name: filepath.Base(path), Text: string(b)}
}

/* ------------------------------------------------------------------ HTTP */

func newToken() string {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

func (a *app) api(w http.ResponseWriter, r *http.Request, name string) {
	state := filepath.Join(a.dir, "state.json")
	switch name {
	case "info":
		info := map[string]any{"edition": edition, "version": version, "mode": a.mode, "os": osVersion(), "log": a.logPath}
		if a.startFile != nil {
			info["file"] = a.startFile
			a.startFile = nil
		}
		writeJSON(w, info)
	case "ping":
		a.pinged.Store(true)
		a.lastPing.Store(time.Now().Unix())
		writeJSON(w, map[string]any{"ok": true})
	case "bye":
		a.byeAt.Store(time.Now().Unix())
		w.WriteHeader(204)
	case "ready":
		a.pinged.Store(true)
		a.lastPing.Store(time.Now().Unix())
		a.readyOnce.Do(func() { log.Printf("page ready (%s)", a.mode); close(a.ready) })
		writeJSON(w, map[string]any{"ok": true})
	case "log":
		b, _ := io.ReadAll(io.LimitReader(r.Body, 8<<10))
		log.Printf("page: %s", strings.TrimSpace(string(b)))
		w.WriteHeader(204)
	case "state":
		if r.Method == http.MethodPut || r.Method == http.MethodPost {
			b, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
			if err == nil {
				tmp := state + ".tmp"
				if err = os.WriteFile(tmp, b, 0o644); err == nil {
					err = os.Rename(tmp, state)
				}
			}
			if err != nil {
				writeJSON(w, fileResult{Error: err.Error()})
				return
			}
			writeJSON(w, map[string]any{"ok": true})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		b, err := os.ReadFile(state)
		if err != nil || !json.Valid(b) {
			_, _ = w.Write([]byte("null"))
			return
		}
		_, _ = w.Write(b)
	case "save":
		var req struct{ Name, B64 string }
		if err := json.NewDecoder(io.LimitReader(r.Body, 128<<20)).Decode(&req); err != nil {
			writeJSON(w, fileResult{Error: err.Error()})
			return
		}
		ext := filepath.Ext(req.Name)
		path, err := a.saveDialog(req.Name, ext)
		if errors.Is(err, errCanceled) {
			writeJSON(w, fileResult{})
			return
		}
		if err == nil && ext != "" && !strings.EqualFold(filepath.Ext(path), ext) {
			path += ext
		}
		var data []byte
		if err == nil {
			data, err = base64.StdEncoding.DecodeString(req.B64)
		}
		if err == nil {
			err = os.WriteFile(path, data, 0o644)
		}
		if err != nil {
			writeJSON(w, fileResult{Error: err.Error()})
			return
		}
		log.Printf("saved %s (%d bytes)", path, len(data))
		writeJSON(w, fileResult{Path: path, Name: filepath.Base(path)})
	case "open":
		var req struct{ Exts []string }
		_ = json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req)
		if len(req.Exts) == 0 {
			req.Exts = []string{".subgrid", ".json"}
		}
		path, err := a.openDialog(req.Exts)
		if errors.Is(err, errCanceled) {
			writeJSON(w, fileResult{})
			return
		}
		writeJSON(w, readProject(path, err))
	case "openurl":
		var req struct{ URL string }
		_ = json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&req)
		if strings.HasPrefix(req.URL, "https://") {
			openURL(req.URL)
		}
		w.WriteHeader(204)
	default:
		http.NotFound(w, r)
	}
}

func (a *app) handler() http.Handler {
	prefix := "/s/" + a.tok + "/"
	sub, _ := fs.Sub(webFS, "web")
	files := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// only our own page: exact host (no DNS rebinding) and the secret path token
		if r.Host != a.host || !strings.HasPrefix(r.URL.Path, prefix) {
			http.NotFound(w, r)
			return
		}
		rest := strings.TrimPrefix(r.URL.Path, prefix)
		if strings.HasPrefix(rest, "api/") {
			a.api(w, r, strings.TrimPrefix(rest, "api/"))
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/" + rest
		files.ServeHTTP(w, r2)
	})
}

func (a *app) serve() error {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	a.tok = newToken()
	a.host = ln.Addr().String()
	a.base = "http://" + a.host + "/s/" + a.tok + "/"
	h := a.handler()
	go func() {
		srv := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second}
		if err := srv.Serve(ln); err != nil {
			log.Printf("http: %v", err)
		}
	}()
	return nil
}

// parse command line: flags + optional project file
func (a *app) parseArgs(args []string) (browser bool, reason string) {
	for _, arg := range args {
		low := strings.ToLower(arg)
		switch {
		case low == "--browser" || low == "/browser":
			browser = true
		case low == "--selftest" || low == "/selftest":
			a.selftest = true
		case strings.HasPrefix(low, "--reason="):
			reason = arg[len("--reason="):]
		case !strings.HasPrefix(arg, "-"):
			p, _ := filepath.Abs(arg)
			fr := readProject(p, nil)
			a.startFile, a.startPath = &fr, p
			log.Printf("open on start: %s (%v)", p, fr.Error)
		}
	}
	return
}
