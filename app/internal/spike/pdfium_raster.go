package spike

import (
	"bytes"
	"fmt"
	"image/png"
	"time"

	"github.com/klippa-app/go-pdfium/requests"
)

// rasterPage renders one page at dpi and returns its PNG, the vision-model
// input the Electron app builds with pdfjs-dist + @napi-rs/canvas.
func rasterPage(data []byte, page int, dpi int) (pngBytes []byte, width, height int, elapsed time.Duration, err error) {
	inst, err := pdfiumBackend()
	if err != nil {
		return nil, 0, 0, 0, err
	}
	doc, err := inst.OpenDocument(&requests.OpenDocument{File: &data})
	if err != nil {
		return nil, 0, 0, 0, err
	}
	defer func() { _, _ = inst.FPDF_CloseDocument(&requests.FPDF_CloseDocument{Document: doc.Document}) }()

	start := time.Now()
	render, err := inst.RenderPageInDPI(&requests.RenderPageInDPI{
		Page: requests.Page{ByIndex: &requests.PageByIndex{Document: doc.Document, Index: page}},
		DPI:  dpi,
	})
	if err != nil {
		return nil, 0, 0, 0, err
	}
	defer render.Cleanup()
	var buf bytes.Buffer
	if err := png.Encode(&buf, render.Result.Image); err != nil {
		return nil, 0, 0, 0, fmt.Errorf("encode: %w", err)
	}
	b := render.Result.Image.Bounds()
	return buf.Bytes(), b.Dx(), b.Dy(), time.Since(start), nil
}
