package spike

import (
	"embed"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/nsgo-dev/nsgo/core"
)

//go:embed fixtures/pdf/*.pdf
var fixtureFS embed.FS

// pdfFixtures lists the fixture corpus, stable and path-sorted.
func pdfFixtures() []string {
	entries, err := fs.Glob(fixtureFS, "fixtures/pdf/*.pdf")
	if err != nil {
		return nil
	}
	sort.Strings(entries)
	return entries
}

// fixtureBytes reads one fixture by its embedded path.
func fixtureBytes(name string) ([]byte, error) {
	return fixtureFS.ReadFile(name)
}

// fontBytes reads the Noto Sans SC font the report experiment needs. It is
// 17 MB, so it is not embedded: fetch it with scripts/fetch-fonts.sh, or point
// CARBONINK_SPIKE_FONT at a static CJK TTF.
func fontBytes() ([]byte, string, error) {
	candidates := []string{os.Getenv("CARBONINK_SPIKE_FONT"),
		"internal/spike/fixtures/fonts/NotoSansSC.ttf",
		"fixtures/fonts/NotoSansSC.ttf",
	}
	for _, p := range candidates {
		if p == "" {
			continue
		}
		data, err := os.ReadFile(p)
		if err == nil {
			return data, p, nil
		}
	}
	return nil, "", fmt.Errorf("no CJK TTF: run scripts/fetch-fonts.sh or set CARBONINK_SPIKE_FONT")
}

var (
	pdfServerOnce sync.Once
	pdfServerBase string
	pdfServerErr  error
)

// pdfServer serves the fixture corpus over loopback so a WebView can show a
// PDF with the platform's own viewer. A real build would mint a per-document
// URL with an unguessable token.
func pdfServer() (string, error) {
	pdfServerOnce.Do(func() {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			pdfServerErr = err
			return
		}
		mux := http.NewServeMux()
		mux.HandleFunc("/pdf/", func(w http.ResponseWriter, r *http.Request) {
			name := path.Clean(strings.TrimPrefix(r.URL.Path, "/pdf/"))
			if strings.Contains(name, "..") {
				http.NotFound(w, r)
				return
			}
			data, err := fixtureBytes("fixtures/pdf/" + name)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("Content-Disposition", "inline; filename=\""+filepath.Base(name)+"\"")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(data)
		})
		go func() { _ = http.Serve(ln, mux) }()
		pdfServerBase = "http://" + ln.Addr().String()
	})
	return pdfServerBase, pdfServerErr
}

// openPDF hands a file to the system's viewer, the fallback when a WebView is
// unavailable on a target.
func openPDF(cx *core.Scope, p string) {
	cx.OpenFile(core.SharedFile{Path: p}, nil)
}
