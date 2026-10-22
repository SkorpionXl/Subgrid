//go:build windows

// SubGrid – Windows part: WebView2 window, native dialogs, crash fallback.
//
// Flags:  --browser   open in the default browser instead of the app window
//
//	--selftest  start, wait until the page reports "ready", exit 0 (CI smoke test)
//	<file>      open a .subgrid / .json project on start
package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"time"

	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"github.com/ncruces/zenity"
	"golang.org/x/sys/windows"
)

const webview2URL = "https://developer.microsoft.com/microsoft-edge/webview2/"

var owner zenity.Option

func osVersion() string {
	maj, min, build := windows.RtlGetNtVersionNumbers()
	return fmt.Sprintf("windows %d.%d.%d", maj, min, build)
}

func redirectStderr(f *os.File) {
	_ = windows.SetStdHandle(windows.STD_ERROR_HANDLE, windows.Handle(f.Fd()))
	os.Stderr = f
}

func openURL(u string) {
	if err := exec.Command("rundll32", "url.dll,FileProtocolHandler", u).Start(); err != nil {
		log.Printf("openURL: %v", err)
	}
}

func dialogOpts(o ...zenity.Option) []zenity.Option {
	if owner != nil {
		o = append(o, owner)
	}
	return o
}

func nativeSave(name, ext string) (string, error) {
	opts := dialogOpts(zenity.Title("Speichern"), zenity.Filename(name), zenity.ConfirmOverwrite())
	if ext != "" {
		opts = append(opts, zenity.FileFilters{{Name: "Datei (*" + ext + ")", Patterns: []string{"*" + ext}, CaseFold: true}})
	}
	p, err := zenity.SelectFileSave(opts...)
	if errors.Is(err, zenity.ErrCanceled) {
		return "", errCanceled
	}
	return p, err
}

func nativeOpen(exts []string) (string, error) {
	pats := []string{}
	for _, e := range exts {
		pats = append(pats, "*"+e)
	}
	p, err := zenity.SelectFile(dialogOpts(zenity.Title("Öffnen"),
		zenity.FileFilters{{Name: "SubGrid / Subarray (" + strings.Join(pats, ", ") + ")", Patterns: pats, CaseFold: true}})...)
	if errors.Is(err, zenity.ErrCanceled) {
		return "", errCanceled
	}
	return p, err
}

// Called while the log package holds its output lock, so nothing here may log or block:
// we relaunch ourselves in browser mode (that process explains what happened) and exit.
func (a *app) fatal(msg string) {
	a.fatalOnce.Do(func() {
		a.logRaw("FATAL: " + msg + "\n" + string(debug.Stack()))
		if a.selftest {
			os.Exit(2)
		}
		if a.mode == "browser" {
			return
		}
		args := []string{"--browser", "--reason=" + msg}
		if a.startPath != "" {
			args = append(args, a.startPath)
		}
		exe, err := os.Executable()
		if err == nil {
			err = exec.Command(exe, args...).Start()
		}
		if err != nil {
			a.logRaw("relaunch failed: " + err.Error())
			_ = zenity.Error("SubGrid konnte nicht starten:\n"+msg+"\n\nProtokoll: "+a.logPath, zenity.Title(title()), zenity.ErrorIcon)
		}
		os.Exit(1)
	})
}

func (a *app) explainFallback(reason string) {
	why := explainHRESULT(reason)
	text := "Das Programmfenster (Microsoft Edge WebView2) konnte nicht starten."
	if why != "" {
		text += "\n" + why
	}
	text += "\n\nTechnisch: " + reason +
		"\n\nKein Problem: SubGrid öffnet sich jetzt in deinem Standard-Browser – alles funktioniert dort genauso." +
		"\n\nProtokoll: " + a.logPath
	_ = zenity.Info(text, zenity.Title(title()), zenity.WarningIcon, zenity.OKLabel("Im Browser öffnen"))
}

// load the WebView2 loader from disk (more robust than the in-memory loader, which some
// virus scanners block); go-webview2 then picks up the already loaded module by name
func (a *app) preloadLoader() {
	p := filepath.Join(a.dir, "WebView2Loader.dll")
	if st, err := os.Stat(p); err != nil || st.Size() != int64(len(webviewloader.WebView2Loader)) {
		if err := os.WriteFile(p, webviewloader.WebView2Loader, 0o644); err != nil {
			log.Printf("write loader: %v", err)
			return
		}
	}
	if _, err := windows.LoadLibraryEx(p, 0, windows.LOAD_WITH_ALTERED_SEARCH_PATH); err != nil {
		log.Printf("native WebView2Loader: %v (falls back to in-memory loader)", err)
	}
}

func (a *app) runWebview() {
	a.preloadLoader()
	ver, err := webviewloader.GetInstalledVersion()
	log.Printf("WebView2 runtime: %q (err=%v)", ver, err)
	if ver == "" && !a.selftest {
		const missing = "Für das Programmfenster fehlt die „Microsoft Edge WebView2 Runtime“ (bei Windows 11 normalerweise schon dabei).\n\nSubGrid kann trotzdem sofort im Browser laufen. Für das eigene Fenster die Runtime installieren (kostenlos, von Microsoft) und SubGrid neu starten."
		err := zenity.Question(missing, zenity.Title(title()), zenity.WarningIcon,
			zenity.OKLabel("Im Browser öffnen"), zenity.ExtraButton("WebView2 herunterladen"), zenity.CancelLabel("Beenden"))
		if errors.Is(err, zenity.ErrExtraButton) {
			openURL(webview2URL)
		} else if errors.Is(err, zenity.ErrCanceled) {
			return
		}
		a.runBrowser()
		return
	}
	// a previous start that crashed before the page was ready leaves this marker behind
	marker := filepath.Join(a.dir, "starting.flag")
	if _, err := os.Stat(marker); err == nil && !a.selftest {
		_ = os.Remove(marker)
		err := zenity.Question("Der letzte Start von SubGrid ist abgebrochen, bevor das Fenster fertig war.\n\nIm Browser öffnen oder das Programmfenster nochmal versuchen?\n\nProtokoll: "+a.logPath,
			zenity.Title(title()), zenity.WarningIcon, zenity.OKLabel("Im Browser öffnen"), zenity.CancelLabel("Fenster nochmal versuchen"))
		if err == nil {
			a.runBrowser()
			return
		}
	}
	_ = os.WriteFile(marker, []byte(time.Now().Format(time.RFC3339)), 0o644)
	go func() { <-a.ready; _ = os.Remove(marker) }()

	a.mode = "webview"
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  filepath.Join(a.dir, "webview"),
		WindowOptions: webview2.WindowOptions{
			Title:  title(),
			Width:  1600,
			Height: 1000,
			IconId: 1,
			Center: true,
		},
	})
	if w == nil {
		a.fatal("WebView2 konnte nicht initialisiert werden (CreateCoreWebView2Environment)")
		return
	}
	log.Printf("window created")
	w.SetSize(1100, 700, webview2.HintMin)
	// zenity wants the HWND as uintptr – unsafe.Pointer made v2.1 panic right after the window appeared
	owner = zenity.Attach(uintptr(w.Window()))
	if a.selftest {
		go func() {
			select {
			case <-a.ready:
				log.Printf("selftest ok")
				os.Exit(0)
			case <-time.After(60 * time.Second):
				log.Printf("selftest: page did not report ready within 60 s")
				os.Exit(3)
			}
		}()
	}
	w.Navigate(a.base + "index.html")
	w.Run()
	log.Printf("window closed")
	w.Destroy()
}

// WebView2 and the Win32 message loop must stay on the main OS thread
func init() { runtime.LockOSThread() }

func main() {
	A.dir = dataDir()
	A.setupLogging()
	A.saveDialog, A.openDialog = nativeSave, nativeOpen
	defer func() {
		if r := recover(); r != nil {
			A.fatal(fmt.Sprintf("panic: %v", r))
		}
	}()
	browser, reason := A.parseArgs(os.Args[1:])
	if err := A.serve(); err != nil {
		log.Printf("server: %v", err)
		_ = zenity.Error("Interner Server konnte nicht starten: "+err.Error()+"\n\nProtokoll: "+A.logPath, zenity.Title(title()))
		os.Exit(1)
	}
	if browser {
		if reason != "" {
			A.explainFallback(reason)
		}
		A.runBrowser()
		return
	}
	A.runWebview()
}
