package spike

import (
	"fmt"
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
	pdfiumInit time.Duration
)

// pdfiumBackend starts the PDFium WebAssembly pool once. PDFium is BSD-3,
// runs through wazero (no cgo), and is the same engine Chrome uses for PDFs.
func pdfiumBackend() (pdfium.Pdfium, error) {
	pdfiumOnce.Do(func() {
		start := time.Now()
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
		pdfiumInit = time.Since(start)
	})
	return pdfiumInst, pdfiumErr
}

// extractPDFiumText reads every page with PDFium, the reference implementation
// for Chinese PDF text layers.
func extractPDFiumText(data []byte) (text string, pages int, err error) {
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
	var b strings.Builder
	for i := 0; i < count.PageCount; i++ {
		page, err := inst.GetPageText(&requests.GetPageText{Page: requests.Page{ByIndex: &requests.PageByIndex{
			Document: doc.Document, Index: i}}})
		if err != nil {
			return b.String(), count.PageCount, fmt.Errorf("page %d: %w", i+1, err)
		}
		b.WriteString(page.Text)
		b.WriteString("\n")
	}
	return b.String(), count.PageCount, nil
}
