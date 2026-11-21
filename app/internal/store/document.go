package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// MaxDocumentBytes is the soft cap for evidence and library uploads.
const MaxDocumentBytes = 50 << 20

var documentMIME = map[string]bool{
	"application/pdf": true,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
	"text/csv":   true,
	"image/png":  true,
	"image/jpeg": true,
	"image/webp": true,
}

// Document is one content-addressed upload.
type Document struct {
	ID          string
	SHA256      string
	Filename    string
	MIMEType    string
	SizeBytes   int64
	StoragePath string
	UploadedAt  string
	UploadedBy  string
}

// DocumentInput is one file staged for storage.
type DocumentInput struct {
	Filename   string
	MIMEType   string
	Data       []byte
	UploadedBy string
}

// SaveDocument writes the file under dataDir/documents/<sha prefix>/ and
// records it. The same bytes always resolve to the same row; reused reports
// that the row already existed.
func (s *Store) SaveDocument(ctx context.Context, in DocumentInput, dataDir string) (*Document, bool, error) {
	filename := strings.TrimSpace(in.Filename)
	if filename == "" {
		return nil, false, errors.New("document filename is required")
	}
	if len(in.Data) == 0 {
		return nil, false, errors.New("document is empty")
	}
	if len(in.Data) > MaxDocumentBytes {
		return nil, false, fmt.Errorf("document exceeds %d bytes", MaxDocumentBytes)
	}
	mimeType := strings.ToLower(strings.TrimSpace(in.MIMEType))
	if !documentMIME[mimeType] {
		return nil, false, fmt.Errorf("unsupported document type: %s", mimeType)
	}
	sum := sha256.Sum256(in.Data)
	digest := hex.EncodeToString(sum[:])
	existing, err := documentBySHA(ctx, s.db, digest)
	if err != nil {
		return nil, false, err
	}
	if existing != nil {
		return existing, true, nil
	}
	rel := filepath.Join("documents", digest[:2], digest+documentExt(filename))
	full := filepath.Join(dataDir, rel)
	if err := writeDocumentFile(full, in.Data); err != nil {
		return nil, false, err
	}
	id := newID()
	ts := now()
	_, err = s.db.ExecContext(ctx, `INSERT INTO document
			(id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, digest, filename, mimeType, len(in.Data), rel, ts, nullIfEmpty(in.UploadedBy))
	if err != nil {
		// A concurrent upload of the same bytes wins the unique index; return
		// the row it wrote instead of failing the caller.
		if existing, lookupErr := documentBySHA(ctx, s.db, digest); lookupErr == nil && existing != nil {
			return existing, true, nil
		}
		return nil, false, err
	}
	document, err := s.DocumentByID(ctx, id)
	if err != nil {
		return nil, false, err
	}
	return document, false, nil
}

// DocumentByID reads one document row.
func (s *Store) DocumentByID(ctx context.Context, id string) (*Document, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, sha256, filename, mime_type, size_bytes,
			storage_path, uploaded_at, coalesce(uploaded_by, '')
		FROM document WHERE id = ?`, id)
	document, err := scanDocument(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &document, nil
}

// ListDocuments returns documents newest first and the total count.
func (s *Store) ListDocuments(ctx context.Context, limit, offset int) ([]Document, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM document`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, sha256, filename, mime_type, size_bytes,
			storage_path, uploaded_at, coalesce(uploaded_by, '')
		FROM document ORDER BY uploaded_at DESC, id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	out := make([]Document, 0, limit)
	for rows.Next() {
		document, err := scanDocument(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, document)
	}
	return out, total, rows.Err()
}

// ResolveDocumentPath turns a stored path into a readable one. New uploads
// are relative to dataDir; imported 1.x rows may hold absolute paths.
func ResolveDocumentPath(storagePath, dataDir string) string {
	if storagePath == "" {
		return ""
	}
	if filepath.IsAbs(storagePath) {
		return storagePath
	}
	return filepath.Join(dataDir, storagePath)
}

func documentBySHA(ctx context.Context, q queryer, digest string) (*Document, error) {
	row := q.QueryRowContext(ctx, `SELECT id, sha256, filename, mime_type, size_bytes,
			storage_path, uploaded_at, coalesce(uploaded_by, '')
		FROM document WHERE sha256 = ?`, digest)
	document, err := scanDocument(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &document, nil
}

func scanDocument(row rowScanner) (Document, error) {
	var document Document
	err := row.Scan(&document.ID, &document.SHA256, &document.Filename, &document.MIMEType,
		&document.SizeBytes, &document.StoragePath, &document.UploadedAt, &document.UploadedBy)
	return document, err
}

func writeDocumentFile(full string, data []byte) error {
	if _, err := os.Stat(full); err == nil {
		return nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	dir := filepath.Dir(full)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(name, full)
}

func documentExt(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if len(ext) < 2 || len(ext) > 10 {
		return ".bin"
	}
	for _, r := range ext[1:] {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return ".bin"
		}
	}
	return ext
}
