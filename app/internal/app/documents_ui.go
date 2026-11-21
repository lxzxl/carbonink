package app

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

func (s *Session) documentsScreen(cx *core.Scope, dataRev *core.Signal[int]) core.Node {
	status := core.NewSignal(cx, "")
	statusFailed := core.NewSignal(cx, false)
	return core.Scroll{
		Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0)},
		Children: []core.Node{core.View{
			Style: core.Style{Padding: core.All(16), Gap: 12, MaxWidth: core.Pt(980), AlignSelf: core.AlignStretch},
			Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
				_ = dataRev.Get()
				return s.documentsBody(cx, dataRev, status, statusFailed)
			})},
		}},
	}
}

func (s *Session) documentsBody(cx *core.Scope, dataRev *core.Signal[int],
	status *core.Signal[string], statusFailed *core.Signal[bool]) core.Node {
	rows := make([]core.Node, 0, len(s.documents))
	for i := range s.documents {
		rows = append(rows, s.documentRow(cx, s.documents[i], status, statusFailed))
	}
	if len(rows) == 0 {
		rows = append(rows, core.View{
			Style: core.Style{Padding: core.All(24), Gap: 6, AlignItems: core.AlignCenter},
			Children: []core.Node{
				core.Text{ContentFunc: func() string { return locales.DocumentsEmptyTitle(cx) },
					Style: core.Style{FontSize: 15, FontWeight: ui.Semibold}},
				core.Text{ContentFunc: func() string { return locales.DocumentsEmptyBody(cx) },
					Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
			},
		})
	}

	children := []core.Node{
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8}, Children: []core.Node{
			dataHeading(cx, locales.NavDocuments(cx),
				locales.DocumentsCount(cx, strconv.Itoa(s.documentTotal))),
			core.View{Style: core.Style{FlexGrow: 1}},
			ui.Button{Text: locales.DocumentsUploadButton(cx), Variant: ui.ButtonPrimary,
				OnPress: func() { s.uploadDocuments(cx, dataRev, status, statusFailed) },
				TestID:  "documents-upload"},
		}},
		core.Text{ContentFunc: func() string { return locales.DocumentsUploadTypesHint(cx) },
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 2},
		core.Show{When: func() bool { return status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return status.Get() },
					Style: core.Style{FontSize: 12},
					StyleFunc: func() core.Style {
						if statusFailed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		core.View{Style: core.Style{Gap: 0}, Children: rows},
	}
	if s.documentTotal > len(s.documents) {
		children = append(children, core.Text{
			ContentFunc: func() string {
				return locales.DocumentsShowingLatest(cx, strconv.Itoa(len(s.documents)),
					strconv.Itoa(s.documentTotal))
			},
			Style: core.Style{FontSize: 11}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted),
		})
	}
	return dataCard(cx, children...)
}

func (s *Session) documentRow(cx *core.Scope, document store.Document,
	status *core.Signal[string], statusFailed *core.Signal[bool]) core.Node {
	meta := documentKind(document.MIMEType) + " · " + documentSize(document.SizeBytes)
	if date := documentDate(document.UploadedAt); date != "" {
		meta += " · " + locales.DocumentsReviewUploadedOn(cx, date)
	}
	return core.View{
		TestID: "documents-row-" + document.ID,
		Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 10,
			Padding: core.Symmetric(9, 0), Borders: core.Edges{Bottom: 1}},
		StyleFunc: func() core.Style { return core.Style{BorderColor: ui.ColorsOf(cx).Line()} },
		Children: []core.Node{
			ui.Icon(documentIcon(document.MIMEType), 15, ui.ColorsOf(cx).Muted),
			core.View{Style: core.Style{Gap: 2, FlexGrow: 1, FlexShrink: 1, MinWidth: core.Pt(0)},
				Children: []core.Node{
					core.Text{Content: document.Filename,
						Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}, MaxLines: 1},
					core.Text{Content: meta, Style: core.Style{FontSize: 11},
						StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 1},
				}},
			ui.Button{Text: locales.DocumentsOpenRow(cx), Variant: ui.ButtonGhost,
				OnPress: func() { s.openDocument(cx, document, status, statusFailed) },
				TestID:  "documents-open-" + document.ID},
		},
	}
}

func (s *Session) uploadDocuments(cx *core.Scope, dataRev *core.Signal[int],
	status *core.Signal[string], statusFailed *core.Signal[bool]) {
	status.Set("")
	statusFailed.Set(false)
	cx.PickFiles(core.PickFilesOptions{
		Multiple: true,
		Types:    []string{".pdf", ".xlsx", ".png", ".jpg", ".jpeg", ".webp"},
		Title:    locales.NavDocuments(cx),
		Button:   locales.DocumentsUploadButton(cx),
	}, func(files []core.File, err error) {
		if err != nil {
			status.Set(locales.DocumentsUploadFailed(cx) + ": " + err.Error())
			statusFailed.Set(true)
			return
		}
		if len(files) == 0 {
			return
		}
		ok, failed := 0, 0
		for _, file := range files {
			if err := s.saveUploadedDocument(file); err != nil {
				failed++
				s.log.Warn("document upload failed", "file", file.Name, "err", err)
				continue
			}
			ok++
		}
		if err := dataRefresh(s, dataRev); err != nil {
			status.Set(locales.DocumentsUploadFailed(cx) + ": " + err.Error())
			statusFailed.Set(true)
			return
		}
		status.Set(locales.DocumentsUploadSummary(cx, strconv.Itoa(ok), strconv.Itoa(failed)))
		statusFailed.Set(failed > 0)
	})
}

func (s *Session) saveUploadedDocument(file core.File) error {
	if file.Size > store.MaxDocumentBytes {
		return fmt.Errorf("document exceeds %d bytes", store.MaxDocumentBytes)
	}
	reader, err := file.Open()
	if err != nil {
		return err
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, store.MaxDocumentBytes+1))
	if err != nil {
		return err
	}
	mimeType := uploadedDocumentMIME(file)
	if mimeType == "" {
		return fmt.Errorf("unsupported document type")
	}
	_, _, err = s.db.SaveDocument(context.Background(), store.DocumentInput{
		Filename: file.Name,
		MIMEType: mimeType,
		Data:     data,
	}, s.dataDir)
	return err
}

func (s *Session) openDocument(cx *core.Scope, document store.Document,
	status *core.Signal[string], statusFailed *core.Signal[bool]) {
	path := store.ResolveDocumentPath(document.StoragePath, s.dataDir)
	if path == "" {
		status.Set(locales.DocumentsOpenFailed(cx))
		statusFailed.Set(true)
		return
	}
	cx.OpenFile(core.SharedFile{Path: path, Name: document.Filename, MIME: document.MIMEType},
		func(opened bool, err error) {
			if err != nil {
				status.Set(locales.DocumentsOpenFailed(cx) + ": " + err.Error())
				statusFailed.Set(true)
				return
			}
			if !opened {
				status.Set(locales.DocumentsOpenFailed(cx))
				statusFailed.Set(true)
			}
		})
}

func uploadedDocumentMIME(file core.File) string {
	switch strings.ToLower(filepath.Ext(file.Name)) {
	case ".pdf":
		return "application/pdf"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	}
	mimeType := strings.ToLower(strings.TrimSpace(file.MIME))
	if mimeType == "" || mimeType == "application/octet-stream" {
		return ""
	}
	return mimeType
}

func documentKind(mimeType string) string {
	switch mimeType {
	case "application/pdf":
		return "PDF"
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return "XLSX"
	case "image/png":
		return "PNG"
	case "image/jpeg":
		return "JPEG"
	case "image/webp":
		return "WebP"
	default:
		return "File"
	}
}

func documentIcon(mimeType string) func() *core.SVG {
	switch mimeType {
	case "application/pdf":
		return lucide.FileText
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return lucide.FileSpreadsheet
	default:
		return lucide.FileImage
	}
}

func documentSize(bytes int64) string {
	switch {
	case bytes >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1<<20))
	case bytes >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(bytes)/(1<<10))
	default:
		return strconv.FormatInt(bytes, 10) + " B"
	}
}

func documentDate(uploadedAt string) string {
	if len(uploadedAt) >= 10 {
		return uploadedAt[:10]
	}
	return uploadedAt
}
