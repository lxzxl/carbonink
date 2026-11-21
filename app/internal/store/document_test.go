package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveAndListDocuments(t *testing.T) {
	s, ctx := openFixture(t)
	dir := t.TempDir()
	pdf := []byte("%PDF-1.7\nfirst bill\n")
	document, reused, err := s.SaveDocument(ctx, DocumentInput{
		Filename: "bill.PDF", MIMEType: "application/pdf", Data: pdf, UploadedBy: "tester",
	}, dir)
	if err != nil {
		t.Fatal(err)
	}
	if reused || document.SizeBytes != int64(len(pdf)) || document.UploadedBy != "tester" {
		t.Fatalf("document = %+v, reused = %v", document, reused)
	}
	if !strings.HasPrefix(document.StoragePath, filepath.Join("documents", document.SHA256[:2])) {
		t.Errorf("storage path = %q", document.StoragePath)
	}
	full := ResolveDocumentPath(document.StoragePath, dir)
	stored, err := os.ReadFile(full)
	if err != nil || string(stored) != string(pdf) {
		t.Fatalf("stored = %q, %v", stored, err)
	}
	if !strings.HasSuffix(full, ".pdf") {
		t.Errorf("extension = %q", full)
	}

	same, reused, err := s.SaveDocument(ctx, DocumentInput{
		Filename: "renamed.pdf", MIMEType: "application/pdf", Data: pdf,
	}, dir)
	if err != nil || !reused || same.ID != document.ID {
		t.Fatalf("reuse = %+v, %v, %v", same, reused, err)
	}
	other, reused, err := s.SaveDocument(ctx, DocumentInput{
		Filename: "meter.png", MIMEType: "image/png", Data: []byte("png bytes"),
	}, dir)
	if err != nil || reused || other.ID == document.ID {
		t.Fatalf("second = %+v, %v, %v", other, reused, err)
	}

	page, total, err := s.ListDocuments(ctx, 1, 0)
	if err != nil || total != 2 || len(page) != 1 {
		t.Fatalf("list = %d/%d, %v", len(page), total, err)
	}
	page, total, err = s.ListDocuments(ctx, 10, 1)
	if err != nil || total != 2 || len(page) != 1 {
		t.Fatalf("page 2 = %d/%d, %v", len(page), total, err)
	}
}

func TestSaveDocumentRejectsBadInput(t *testing.T) {
	s, ctx := openFixture(t)
	dir := t.TempDir()
	cases := []DocumentInput{
		{Filename: "", MIMEType: "application/pdf", Data: []byte("x")},
		{Filename: "empty.pdf", MIMEType: "application/pdf"},
		{Filename: "note.txt", MIMEType: "text/plain", Data: []byte("x")},
		{Filename: "big.pdf", MIMEType: "application/pdf",
			Data: make([]byte, MaxDocumentBytes+1)},
	}
	for _, input := range cases {
		if _, _, err := s.SaveDocument(ctx, input, dir); err == nil {
			t.Errorf("%q accepted", input.Filename)
		}
	}
	if _, _, err := s.SaveDocument(ctx, DocumentInput{
		Filename: "ledger.csv", MIMEType: "text/csv", Data: []byte("source,amount\npower,1\n"),
	}, dir); err != nil {
		t.Errorf("csv rejected: %v", err)
	}
	if _, err := s.DocumentByID(ctx, "missing"); err != nil {
		t.Errorf("missing document error = %v", err)
	}
}

func TestResolveDocumentPath(t *testing.T) {
	dir := t.TempDir()
	absolute := filepath.Join(dir, "elsewhere", "bill.pdf")
	if got := ResolveDocumentPath(absolute, dir); got != absolute {
		t.Errorf("absolute = %q", got)
	}
	if got := ResolveDocumentPath(filepath.Join("documents", "ab", "x.pdf"), dir); got !=
		filepath.Join(dir, "documents", "ab", "x.pdf") {
		t.Errorf("relative = %q", got)
	}
	if got := ResolveDocumentPath("", dir); got != "" {
		t.Errorf("empty = %q", got)
	}
}
