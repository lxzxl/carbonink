package spike

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// TestExtractFixtures is the Phase 0 text-extraction measurement. Run with
// -v to see pages, runes, time and the first characters of each file.
func TestExtractFixtures(t *testing.T) {
	files := pdfFixtures()
	if len(files) == 0 {
		t.Fatal("no fixtures")
	}
	for _, f := range files {
		data, err := fixtureBytes(f)
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		start := time.Now()
		text, pages, err := extractPDFText(data)
		elapsed := time.Since(start)
		if err != nil {
			t.Errorf("%s: %v", f, err)
		}
		runes := utf8.RuneCountInString(text)
		sample := strings.Join(strings.Fields(text), " ")
		if len([]rune(sample)) > 160 {
			sample = string([]rune(sample)[:160])
		}
		t.Logf("%-28s pages=%-3d runes=%-6d %-8s %q", f, pages, runes, elapsed.Round(time.Millisecond), sample)
		if runes == 0 {
			t.Errorf("%s: extracted no text", f)
		}
	}
}

// TestBuildCJKReport proves the Go PDF layout works with a CJK font. The font
// is not committed; fetch it with scripts/fetch-fonts.sh.
func TestBuildCJKReport(t *testing.T) {
	font, path, err := fontBytes()
	if err != nil {
		t.Skip(err)
	}
	start := time.Now()
	pdf, err := buildReport(font, sampleReport())
	if err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		t.Fatalf("not a PDF: %q", pdf[:min(len(pdf), 8)])
	}
	if len(pdf) < 20<<10 {
		t.Errorf("suspiciously small PDF: %d bytes", len(pdf))
	}
	if err := os.WriteFile("/tmp/carbonink-spike-report.pdf", pdf, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("font=%s size=%dKB built=%s", path, len(pdf)/1024, time.Since(start).Round(time.Millisecond))
}
