package spike

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// TestPDFiumFixtures is the second half of the extraction measurement: PDFium
// through wazero, no cgo, no Chromium.
func TestPDFiumFixtures(t *testing.T) {
	files := pdfFixtures()
	for _, f := range files {
		data, err := fixtureBytes(f)
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		start := time.Now()
		text, pages, err := extractPDFiumText(data)
		if err != nil {
			t.Errorf("%s: %v", f, err)
			continue
		}
		runes := utf8.RuneCountInString(text)
		sample := strings.Join(strings.Fields(text), " ")
		if len([]rune(sample)) > 200 {
			sample = string([]rune(sample)[:200])
		}
		t.Logf("%-28s pages=%-3d runes=%-6d %-8s %q", f, pages, runes, time.Since(start).Round(time.Millisecond), sample)
		if runes == 0 {
			t.Errorf("%s: extracted no text", f)
		}
	}
	t.Logf("PDFium WASM pool init: %s", pdfiumInit.Round(time.Millisecond))
}

// TestPDFiumRaster is the vision path: one scanned-page equivalent at 200 DPI,
// encoded to PNG, with the size and time a vision call would pay.
func TestPDFiumRaster(t *testing.T) {
	data, err := fixtureBytes("fixtures/pdf/01-utility-sample.pdf")
	if err != nil {
		t.Fatal(err)
	}
	pngBytes, w, h, elapsed, err := rasterPage(data, 0, 200)
	if err != nil {
		t.Fatal(err)
	}
	if w < 1000 || h < 1000 {
		t.Errorf("rendered %dx%d, expected an A4 page at 200 DPI", w, h)
	}
	if err := os.WriteFile("/tmp/carbonink-spike-page.png", pngBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("200 DPI: %dx%d px, %d KB PNG, %s", w, h, len(pngBytes)/1024, elapsed.Round(time.Millisecond))
}

// TestRenderReportPages rasterizes the generated CJK report so layout, tables
// and page breaks can be checked page by page. The font is not committed.
func TestRenderReportPages(t *testing.T) {
	font, _, err := fontBytes()
	if err != nil {
		t.Skip(err)
	}
	pdf, err := buildReport(font, sampleReport())
	if err != nil {
		t.Fatal(err)
	}
	for page := 0; page < 3; page++ {
		pngBytes, w, h, elapsed, err := rasterPage(pdf, page, 120)
		if err != nil {
			t.Fatalf("page %d: %v", page+1, err)
		}
		path := fmt.Sprintf("/tmp/carbonink-spike-report-p%d.png", page+1)
		if err := os.WriteFile(path, pngBytes, 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("page %d: %dx%d px, %d KB, %s → %s", page+1, w, h, len(pngBytes)/1024, elapsed.Round(time.Millisecond), path)
	}
}
