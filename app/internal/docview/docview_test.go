package docview

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPDFPageCountAndRender(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "spike", "fixtures", "pdf", "two-page-text.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	count, err := PDFPageCount(data)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("pages = %d, want 2", count)
	}
	frame, err := RenderPDFPage(data, 1, 72)
	if err != nil {
		t.Fatal(err)
	}
	if frame.Bounds().Dx() == 0 || frame.Bounds().Dy() == 0 {
		t.Fatalf("rendered bounds = %v", frame.Bounds())
	}
	var ink int
	for _, pixel := range frame.Pix {
		ink += int(pixel)
	}
	if ink == 0 {
		t.Fatal("rendered page is blank")
	}
	if _, err := RenderPDFPage(data, 2, 72); err == nil {
		t.Error("out-of-range page was rendered")
	}
}

func TestPDFText(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "spike", "fixtures", "pdf", "two-page-text.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	text, pages, err := PDFText(data)
	if err != nil {
		t.Fatal(err)
	}
	if pages != 2 || strings.TrimSpace(text) == "" {
		t.Fatalf("pages = %d, text = %q", pages, text)
	}
}

func TestRenderPDFPages(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "spike", "fixtures", "pdf", "two-page-text.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	pages, err := RenderPDFPages(data, 72, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 2 {
		t.Fatalf("pages = %d, want 2", len(pages))
	}
	for i, page := range pages {
		if _, err := DecodeImage(page); err != nil {
			t.Fatalf("page %d: %v", i+1, err)
		}
	}
	limited, err := RenderPDFPages(data, 72, 1)
	if err != nil || len(limited) != 1 {
		t.Fatalf("limited = %d, %v", len(limited), err)
	}
}

func TestDecodeImage(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 3, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 3; x++ {
			src.Set(x, y, color.RGBA{R: 200, G: 30, B: 10, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, src); err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeImage(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if got := decoded.Bounds().Size(); got.X != 3 || got.Y != 2 {
		t.Fatalf("decoded size = %v", got)
	}
	if _, err := DecodeImage([]byte("not an image")); err == nil {
		t.Error("invalid image decoded")
	}
}
