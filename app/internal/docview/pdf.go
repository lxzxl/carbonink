package docview

import (
	"fmt"
	"image"
	"strings"
	"sync"
	"time"

	"github.com/klippa-app/go-pdfium"
	"github.com/klippa-app/go-pdfium/requests"
	"github.com/klippa-app/go-pdfium/webassembly"
)

var (
	pdfiumOnce sync.Once
	pdfiumPool pdfium.Pool
	pdfiumInst pdfium.Pdfium
	pdfiumErr  error
	// pdfiumMu serializes calls into the shared WebAssembly instance.
	pdfiumMu sync.Mutex
)

func pdfiumBackend() (pdfium.Pdfium, error) {
	pdfiumOnce.Do(func() {
		pool, err := webassembly.Init(webassembly.Config{MinIdle: 1, MaxIdle: 1, MaxTotal: 2})
		if err != nil {
			pdfiumErr = err
			return
		}
		inst, err := pool.GetInstance(60 * time.Second)
		if err != nil {
			_ = pool.Close()
			pdfiumErr = err
			return
		}
		pdfiumPool, pdfiumInst = pool, inst
	})
	return pdfiumInst, pdfiumErr
}

// PDFPageCount opens data and returns its page count.
func PDFPageCount(data []byte) (int, error) {
	pdfiumMu.Lock()
	defer pdfiumMu.Unlock()
	inst, err := pdfiumBackend()
	if err != nil {
		return 0, err
	}
	doc, err := inst.OpenDocument(&requests.OpenDocument{File: &data})
	if err != nil {
		return 0, err
	}
	defer func() { _, _ = inst.FPDF_CloseDocument(&requests.FPDF_CloseDocument{Document: doc.Document}) }()
	count, err := inst.FPDF_GetPageCount(&requests.FPDF_GetPageCount{Document: doc.Document})
	if err != nil {
		return 0, err
	}
	return count.PageCount, nil
}

// RenderPDFPage rasterizes a zero-based page at dpi.
func RenderPDFPage(data []byte, page int, dpi int) (*image.RGBA, error) {
	if page < 0 {
		return nil, fmt.Errorf("page index must not be negative")
	}
	pdfiumMu.Lock()
	defer pdfiumMu.Unlock()
	inst, err := pdfiumBackend()
	if err != nil {
		return nil, err
	}
	doc, err := inst.OpenDocument(&requests.OpenDocument{File: &data})
	if err != nil {
		return nil, err
	}
	defer func() { _, _ = inst.FPDF_CloseDocument(&requests.FPDF_CloseDocument{Document: doc.Document}) }()
	count, err := inst.FPDF_GetPageCount(&requests.FPDF_GetPageCount{Document: doc.Document})
	if err != nil {
		return nil, err
	}
	if page >= count.PageCount {
		return nil, fmt.Errorf("page %d is past the document's %d pages", page+1, count.PageCount)
	}
	render, err := inst.RenderPageInDPI(&requests.RenderPageInDPI{
		Page: requests.Page{ByIndex: &requests.PageByIndex{Document: doc.Document, Index: page}},
		DPI:  dpi,
	})
	if err != nil {
		return nil, err
	}
	defer render.Cleanup()
	return copyRGBA(render.Result.Image), nil
}

// PDFText returns every page's text layer, joined with newlines.
func PDFText(data []byte) (string, int, error) {
	pdfiumMu.Lock()
	defer pdfiumMu.Unlock()
	inst, err := pdfiumBackend()
	if err != nil {
		return "", 0, err
	}
	doc, err := inst.OpenDocument(&requests.OpenDocument{File: &data})
	if err != nil {
		return "", 0, err
	}
	defer func() { _, _ = inst.FPDF_CloseDocument(&requests.FPDF_CloseDocument{Document: doc.Document}) }()
	count, err := inst.FPDF_GetPageCount(&requests.FPDF_GetPageCount{Document: doc.Document})
	if err != nil {
		return "", 0, err
	}
	var text strings.Builder
	for i := 0; i < count.PageCount; i++ {
		page, err := inst.GetPageText(&requests.GetPageText{
			Page: requests.Page{ByIndex: &requests.PageByIndex{Document: doc.Document, Index: i}},
		})
		if err != nil {
			return text.String(), count.PageCount, fmt.Errorf("page %d: %w", i+1, err)
		}
		text.WriteString(page.Text)
		text.WriteString("\n")
	}
	return text.String(), count.PageCount, nil
}
