// Package activityimport parses CSV and XLSX ledgers into the normalized rows
// the activity import wizard confirms. It is deliberately database-free so the
// rules stay unit-testable.
package activityimport

import (
	"bytes"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

const (
	// MaxFileBytes bounds the synchronous read from the picker.
	MaxFileBytes = 20 << 20
	// MaxDataRows bounds the rows the wizard groups and confirms.
	MaxDataRows = 50_000
)

// ParseError is a file-level failure. Code is locale-neutral so the UI can
// localize it; Detail carries a short, non-translated hint.
type ParseError struct {
	Code   string
	Detail string
}

func (e *ParseError) Error() string {
	if e.Detail == "" {
		return "activity import: " + e.Code
	}
	return fmt.Sprintf("activity import: %s (%s)", e.Code, e.Detail)
}

// Row keeps the 1-based number from the user's file so issues point at the
// exact spreadsheet row.
type Row struct {
	Number int
	Cells  []string
}

// Grid is the header row plus every non-empty data row, padded to the header
// width.
type Grid struct {
	Headers []string
	Rows    []Row
}

// ParseFile reads .csv or .xlsx bytes. CSV decodes as UTF-8 with a GB18030
// fallback, matching the 1.x importer's handling of Excel's plain "CSV" save.
func ParseFile(data []byte, filename string) (Grid, error) {
	if len(data) > MaxFileBytes {
		return Grid{}, &ParseError{Code: "file_too_large",
			Detail: fmt.Sprintf("%.1fMB", float64(len(data))/(1<<20))}
	}
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".csv":
		return parseCSV(data)
	case ".xlsx":
		return parseXLSX(data)
	default:
		return Grid{}, &ParseError{Code: "unsupported_file_type", Detail: filename}
	}
}

func parseCSV(data []byte) (Grid, error) {
	text, err := decodeCSV(data)
	if err != nil {
		return Grid{}, err
	}
	records := parseCSVRecords(text)
	rows := make([]Row, 0, len(records))
	for i, cells := range records {
		rows = append(rows, Row{Number: i + 1, Cells: cells})
	}
	return gridFromRows(rows)
}

func parseXLSX(data []byte) (Grid, error) {
	f, err := excelize.OpenReader(bytes.NewReader(data), excelize.Options{RawCellValue: true})
	if err != nil {
		return Grid{}, &ParseError{Code: "xlsx_invalid"}
	}
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return Grid{}, &ParseError{Code: "file_empty"}
	}
	matrix, err := f.GetRows(sheets[0], excelize.Options{RawCellValue: true})
	if err != nil {
		return Grid{}, &ParseError{Code: "xlsx_invalid"}
	}
	rows := make([]Row, 0, len(matrix))
	for i, cells := range matrix {
		trimmed := make([]string, len(cells))
		for j, cell := range cells {
			trimmed[j] = strings.TrimSpace(cell)
		}
		rows = append(rows, Row{Number: i + 1, Cells: trimmed})
	}
	return gridFromRows(rows)
}

func decodeCSV(data []byte) (string, error) {
	if utf8.Valid(data) {
		return strings.TrimPrefix(string(data), "\ufeff"), nil
	}
	decoded, _, err := transform.String(simplifiedchinese.GB18030.NewDecoder(), string(data))
	if err != nil {
		return "", &ParseError{Code: "csv_encoding_invalid"}
	}
	return strings.TrimPrefix(decoded, "\ufeff"), nil
}

// parseCSVRecords is a minimal RFC 4180 reader: comma-separated, `"` quoting
// with `""` escapes, CRLF or LF breaks, and quoted fields may span lines.
// Unlike encoding/csv it keeps blank records, so row numbers match the file.
func parseCSVRecords(text string) [][]string {
	var records [][]string
	var record []string
	var field strings.Builder
	inQuotes := false
	flushField := func() {
		record = append(record, strings.TrimSpace(field.String()))
		field.Reset()
	}
	flushRecord := func() {
		flushField()
		records = append(records, record)
		record = nil
	}
	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		if inQuotes {
			if ch == '"' {
				if i+1 < len(runes) && runes[i+1] == '"' {
					field.WriteRune('"')
					i++
					continue
				}
				inQuotes = false
				continue
			}
			field.WriteRune(ch)
			continue
		}
		switch ch {
		case '"':
			if field.Len() == 0 {
				inQuotes = true
				continue
			}
			field.WriteRune(ch)
		case ',':
			flushField()
		case '\n':
			flushRecord()
		case '\r':
			flushRecord()
			if i+1 < len(runes) && runes[i+1] == '\n' {
				i++
			}
		default:
			field.WriteRune(ch)
		}
	}
	if field.Len() > 0 || len(record) > 0 {
		flushRecord()
	}
	return records
}

func gridFromRows(rows []Row) (Grid, error) {
	nonEmpty := make([]Row, 0, len(rows))
	for _, row := range rows {
		if !blankRow(row.Cells) {
			nonEmpty = append(nonEmpty, row)
		}
	}
	if len(nonEmpty) == 0 {
		return Grid{}, &ParseError{Code: "file_empty"}
	}
	headers := nonEmpty[0].Cells
	if blankRow(headers) {
		return Grid{}, &ParseError{Code: "file_empty"}
	}
	dataRows := make([]Row, 0, len(nonEmpty)-1)
	for _, row := range nonEmpty[1:] {
		padded := make([]string, len(headers))
		copy(padded, row.Cells)
		dataRows = append(dataRows, Row{Number: row.Number, Cells: padded})
	}
	if len(dataRows) > MaxDataRows {
		return Grid{}, &ParseError{Code: "too_many_rows", Detail: fmt.Sprint(len(dataRows))}
	}
	return Grid{Headers: headers, Rows: dataRows}, nil
}

func blankRow(cells []string) bool {
	for _, cell := range cells {
		if cell != "" {
			return false
		}
	}
	return true
}

// ReadFile is ParseFile for a reader, capped at MaxFileBytes.
func ReadFile(r io.Reader, filename string) (Grid, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxFileBytes+1))
	if err != nil {
		return Grid{}, &ParseError{Code: "read_failed"}
	}
	if len(data) > MaxFileBytes {
		return Grid{}, &ParseError{Code: "file_too_large"}
	}
	return ParseFile(data, filename)
}
