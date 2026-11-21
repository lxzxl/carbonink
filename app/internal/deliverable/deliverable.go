// Package deliverable builds the client hand-off bundle: the report PDF, the
// Excel appendix, copies of every evidence file attached to the period's
// activity rows, a readiness worksheet, and a sha256 manifest.
package deliverable

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/store"
)

// ActivityRef ties a manifest line to the appendix's activity order.
type ActivityRef struct {
	ID         string
	SourceName string
}

// ReadinessRow is one already-localized checklist finding.
type ReadinessRow struct {
	Severity   string
	CheckID    string
	Title      string
	Detail     string
	EntityType string
	EntityID   string
}

// Readiness is the rendered sweep that ships as readiness.csv. Supplying it
// writes the file even when it found nothing: "N checks ran and none fired" is
// the statement a reviewer needs.
type Readiness struct {
	CheckedAt  string
	CheckCount int
	Blockers   int
	Warnings   int
	Notes      int
	Rows       []ReadinessRow
}

// NamedBytes is one generated document.
type NamedBytes struct {
	Name  string
	Bytes []byte
}

// Input describes one bundle.
type Input struct {
	PeriodID   string
	Activities []ActivityRef
	ReportPDF  NamedBytes
	Appendix   NamedBytes
	Readiness  *Readiness
	OutPath    string
}

// Result reports how many evidence rows were found and how many had no file.
type Result struct {
	EvidenceTotal   int
	EvidenceMissing int
}

type evidenceRow struct {
	ActivityID  string
	Filename    string
	SHA256      string
	SizeBytes   int64
	StoragePath string
}

// Build writes the bundle to Input.OutPath. Missing evidence files are
// recorded in the manifest and never abort the archive.
func Build(ctx context.Context, db *store.Store, in Input) (Result, error) {
	activityNo := make(map[string]int, len(in.Activities))
	sourceName := make(map[string]string, len(in.Activities))
	for i, activity := range in.Activities {
		activityNo[activity.ID] = i + 1
		sourceName[activity.ID] = activity.SourceName
	}

	rows, err := evidenceRows(ctx, db, in.PeriodID)
	if err != nil {
		return Result{}, err
	}
	filtered := make([]evidenceRow, 0, len(rows))
	for _, row := range rows {
		if _, ok := activityNo[row.ActivityID]; ok {
			filtered = append(filtered, row)
		}
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		return activityNo[filtered[i].ActivityID] < activityNo[filtered[j].ActivityID]
	})

	out, err := os.Create(in.OutPath)
	if err != nil {
		return Result{}, err
	}
	defer out.Close()
	archive := zip.NewWriter(out)
	defer archive.Close()

	var manifest []manifestRow
	appendBytes := func(doc NamedBytes, kind string) error {
		entry, err := archive.Create(doc.Name)
		if err != nil {
			return err
		}
		if _, err := entry.Write(doc.Bytes); err != nil {
			return err
		}
		manifest = append(manifest, manifestRow{
			File: doc.Name, Type: kind, SHA256: sum(doc.Bytes),
			SizeBytes: int64(len(doc.Bytes)), Status: "included",
		})
		return nil
	}
	if err := appendBytes(in.ReportPDF, "report"); err != nil {
		return Result{}, err
	}
	if err := appendBytes(in.Appendix, "appendix"); err != nil {
		return Result{}, err
	}
	if in.Readiness != nil {
		data := readinessCSV(*in.Readiness)
		if err := appendBytes(NamedBytes{Name: "readiness.csv", Bytes: data}, "readiness"); err != nil {
			return Result{}, err
		}
	}

	result := Result{EvidenceTotal: len(filtered)}
	used := map[string]struct{}{}
	for _, row := range filtered {
		number := activityNo[row.ActivityID]
		common := manifestRow{
			Type: "evidence", SHA256: row.SHA256, SizeBytes: row.SizeBytes,
			ActivityNo: number, ActivityID: row.ActivityID,
			SourceName: sourceName[row.ActivityID], OriginalFilename: row.Filename,
		}
		source, err := os.Open(row.StoragePath)
		if err != nil {
			result.EvidenceMissing++
			common.Status = "missing"
			manifest = append(manifest, common)
			continue
		}
		name := evidenceName(number, row.Filename, used)
		common.File, common.Status = name, "included"
		writer, err := archive.Create(name)
		if err == nil {
			_, err = io.Copy(writer, source)
		}
		source.Close()
		if err != nil {
			return Result{}, err
		}
		manifest = append(manifest, common)
	}

	manifestName := "manifest.csv"
	writer, err := archive.Create(manifestName)
	if err != nil {
		return Result{}, err
	}
	if _, err := writer.Write(manifestCSV(manifest)); err != nil {
		return Result{}, err
	}
	if err := archive.Close(); err != nil {
		return Result{}, err
	}
	return result, nil
}

type manifestRow struct {
	File             string
	Type             string
	SHA256           string
	SizeBytes        int64
	ActivityNo       int
	ActivityID       string
	SourceName       string
	OriginalFilename string
	Status           string
}

func evidenceRows(ctx context.Context, db *store.Store, periodID string) ([]evidenceRow, error) {
	rows, err := db.DB().QueryContext(ctx, `SELECT ea.activity_data_id, d.filename,
			d.sha256, d.size_bytes, d.storage_path
		FROM evidence_attachment ea
		JOIN document d ON d.id = ea.document_id
		JOIN activity_data ad ON ad.id = ea.activity_data_id
		WHERE ad.reporting_period_id = ? AND ea.activity_data_id IS NOT NULL
		ORDER BY ea.created_at, ea.id`, periodID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []evidenceRow
	for rows.Next() {
		var row evidenceRow
		if err := rows.Scan(&row.ActivityID, &row.Filename, &row.SHA256,
			&row.SizeBytes, &row.StoragePath); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func manifestCSV(rows []manifestRow) []byte {
	lines := []string{`"file","type","sha256","size_bytes","activity_no",
		"activity_id","source_name","original_filename","status"`}
	for _, row := range rows {
		if row.Type == "" {
			continue
		}
		activityNo := ""
		if row.ActivityNo > 0 {
			activityNo = strconv.Itoa(row.ActivityNo)
		}
		lines = append(lines, strings.Join([]string{
			field(row.File), field(row.Type), field(row.SHA256),
			field(strconv.FormatInt(row.SizeBytes, 10)), field(activityNo),
			field(row.ActivityID), field(row.SourceName),
			field(row.OriginalFilename), field(row.Status),
		}, ","))
	}
	return withBOM(strings.Join(lines, "\n") + "\n")
}

func readinessCSV(data Readiness) []byte {
	lines := []string{
		`"checked_at","checks_run","blockers","warnings","notes"`,
		strings.Join([]string{
			field(data.CheckedAt), field(strconv.Itoa(data.CheckCount)),
			field(strconv.Itoa(data.Blockers)), field(strconv.Itoa(data.Warnings)),
			field(strconv.Itoa(data.Notes)),
		}, ","),
		"",
		`"severity","check","finding","detail","entity_type","entity_id"`,
	}
	for _, row := range data.Rows {
		lines = append(lines, strings.Join([]string{
			field(row.Severity), field(row.CheckID), field(row.Title),
			field(row.Detail), field(row.EntityType), field(row.EntityID),
		}, ","))
	}
	return withBOM(strings.Join(lines, "\n") + "\n")
}

func field(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func withBOM(text string) []byte {
	return []byte("\ufeff" + text)
}

func sum(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func evidenceName(activityNo int, original string, used map[string]struct{}) string {
	safe := sanitizeFilename(original)
	prefix := fmt.Sprintf("%03d", activityNo)
	base := "evidence/" + prefix + "-" + safe
	if _, exists := used[base]; !exists {
		used[base] = struct{}{}
		return base
	}
	ext := filepath.Ext(safe)
	stem := strings.TrimSuffix(safe, ext)
	for n := 2; ; n++ {
		candidate := fmt.Sprintf("evidence/%s-%s-%d%s", prefix, stem, n, ext)
		if _, exists := used[candidate]; !exists {
			used[candidate] = struct{}{}
			return candidate
		}
	}
}

// sanitizeFilename drops control characters and replaces separators that
// would create nested or escaping zip entries. CJK and normal punctuation
// stay readable.
func sanitizeFilename(name string) string {
	const unsafe = `\/:*?"<>|`
	var out strings.Builder
	for _, ch := range name {
		if ch < 0x20 || ch == 0x7f {
			continue
		}
		if strings.ContainsRune(unsafe, ch) {
			out.WriteByte('_')
			continue
		}
		out.WriteRune(ch)
	}
	cleaned := strings.TrimSpace(out.String())
	if cleaned == "" {
		return "file.bin"
	}
	return cleaned
}
