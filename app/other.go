//go:build !windows

// Test harness for Linux/CI: the real HTTP server and API without a window. Native dialogs are
// replaced by SG_SAVE_DIR (save target folder) and SG_OPEN_FILE (file returned by "open").
// Prints the page URL on stdout and runs until killed.
package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
)

func osVersion() string { return runtime.GOOS }

func redirectStderr(f *os.File) {}

func openURL(u string) { log.Printf("openURL %s", u) }

func (a *app) fatal(msg string) {
	a.fatalOnce.Do(func() { a.logRaw("FATAL: " + msg) })
}

func main() {
	if d := os.Getenv("SG_DATA_DIR"); d != "" {
		_ = os.MkdirAll(d, 0o755)
		A.dir = d
	} else {
		A.dir = dataDir()
	}
	A.setupLogging()
	A.saveDialog = func(name, ext string) (string, error) {
		d := os.Getenv("SG_SAVE_DIR")
		if d == "" {
			return "", errCanceled
		}
		return filepath.Join(d, name), nil
	}
	A.openDialog = func(exts []string) (string, error) {
		f := os.Getenv("SG_OPEN_FILE")
		if f == "" {
			return "", errCanceled
		}
		return f, nil
	}
	A.parseArgs(os.Args[1:])
	A.mode = "webview"
	if err := A.serve(); err != nil {
		fmt.Println("ERR", err)
		os.Exit(1)
	}
	fmt.Println(A.base + "index.html")
	select {}
}
