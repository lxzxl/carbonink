// Package pdfgen draws the app's printable documents with fpdf. It embeds a
// GB 2312 subset of Noto Sans SC so Chinese text renders on every platform.
package pdfgen

import (
	"bytes"
	_ "embed"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
)

//go:embed fonts/NotoSansSC-subset.ttf
var cjkFont []byte

// Font returns the embedded CJK font every printable document shares.
func Font() []byte { return cjkFont }

// Labels is the exported language's fixed copy.
type Labels struct {
	DueDate     string
	GeneratedAt string
	Draft       string
	Finalized   string
	Source      string
	TOC         string
	Unanswered  string
	Unspecified string
	Kinds       map[string]string
}

// Questionnaire is one customer workbook ready to print.
type Questionnaire struct {
	CustomerName  string
	ReportingYear int
	DocumentName  string
	DueDate       string
	GeneratedOn   string
	Questions     []Question
}

// Question is one question and its answer, when present.
type Question struct {
	ID             string
	Position       string
	RawText        string
	NormalizedText string
	Kind           string
	ExpectedUnit   string
	Answer         *Answer
}

// Answer is the printable answer row.
type Answer struct {
	Value         string
	Unit          string
	FinalizedAt   string
	SourceSummary string
}

// Sheet is one worksheet's questions.
type Sheet struct {
	Name      string
	Questions []Question
}

// RenderQuestionnaire lays out the cover, table of contents, and one section
// per worksheet.
func RenderQuestionnaire(q Questionnaire, labels Labels) ([]byte, error) {
	if len(cjkFont) == 0 {
		return nil, fmt.Errorf("pdfgen: CJK font is missing")
	}
	generated := q.GeneratedOn
	if generated == "" {
		generated = time.Now().Format("2006-01-02")
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(18, 18, 18)
	pdf.SetAutoPageBreak(true, 20)
	pdf.AddUTF8FontFromBytes("noto", "", cjkFont)
	pdf.SetFooterFunc(func() {
		pdf.SetY(-12)
		pdf.SetFont("noto", "", 8)
		pdf.SetTextColor(120, 120, 120)
		pdf.CellFormat(0, 5, fmt.Sprintf("CarbonInk · %d · %d", q.ReportingYear, pdf.PageNo()),
			"", 0, "C", false, 0, "")
	})

	// Cover.
	pdf.AddPage()
	pdf.SetFillColor(22, 62, 47)
	pdf.Rect(0, 0, 210, 64, "F")
	pdf.SetTextColor(255, 255, 255)
	pdf.SetXY(18, 22)
	pdf.SetFont("noto", "", 22)
	pdf.MultiCell(174, 11, cjkFontSafe(q.CustomerName), "", "L", false)
	pdf.SetXY(18, 46)
	pdf.SetFont("noto", "", 12)
	pdf.CellFormat(0, 8, fmt.Sprintf("%d · %s", q.ReportingYear,
		cjkFontSafe(q.DocumentName)), "", 1, "L", false, 0, "")

	pdf.SetTextColor(70, 70, 70)
	pdf.SetXY(18, 88)
	pdf.SetFont("noto", "", 11)
	if strings.TrimSpace(q.DueDate) != "" {
		pdf.CellFormat(0, 7, labels.DueDate+": "+q.DueDate, "", 1, "L", false, 0, "")
	}
	pdf.CellFormat(0, 7, labels.GeneratedAt+": "+generated, "", 1, "L", false, 0, "")

	sheets := groupQuestions(q.Questions, labels.Unspecified)

	// Table of contents.
	pdf.AddPage()
	pdf.SetTextColor(30, 30, 30)
	pdf.SetFont("noto", "", 17)
	pdf.CellFormat(0, 11, labels.TOC, "", 1, "L", false, 0, "")
	pdf.Ln(2)
	pdf.SetFont("noto", "", 11)
	for i, sheet := range sheets {
		pdf.SetTextColor(45, 45, 45)
		pdf.CellFormat(12, 9, fmt.Sprintf("%d", i+1), "", 0, "L", false, 0, "")
		pdf.CellFormat(140, 9, sheet.Name, "", 0, "L", false, 0, "")
		pdf.SetTextColor(110, 110, 110)
		pdf.CellFormat(22, 9, fmt.Sprintf("(%d)", len(sheet.Questions)), "", 1, "R", false, 0, "")
	}

	for i, sheet := range sheets {
		pdf.AddPage()
		pdf.SetTextColor(30, 30, 30)
		pdf.SetFont("noto", "", 16)
		pdf.CellFormat(0, 11, fmt.Sprintf("%d  %s", i+1, sheet.Name), "", 1, "L", false, 0, "")
		pdf.SetDrawColor(22, 62, 47)
		pdf.SetLineWidth(0.5)
		pdf.Line(18, pdf.GetY(), 192, pdf.GetY())
		pdf.Ln(5)
		for index, question := range sheet.Questions {
			renderQuestion(pdf, index+1, question, labels)
		}
	}
	if err := pdf.Error(); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func renderQuestion(pdf *fpdf.Fpdf, index int, q Question, labels Labels) {
	meta := make([]string, 0, 3)
	if q.Position != "" {
		meta = append(meta, q.Position)
	}
	meta = append(meta, labels.Kinds[q.Kind])
	if q.ExpectedUnit != "" {
		meta = append(meta, q.ExpectedUnit)
	}
	pdf.SetTextColor(120, 120, 120)
	pdf.SetFont("noto", "", 8)
	pdf.MultiCell(0, 5, strings.Join(meta, " · "), "", "L", false)

	text := q.RawText
	if strings.TrimSpace(text) == "" {
		text = q.NormalizedText
	}
	pdf.SetTextColor(35, 35, 35)
	pdf.SetFont("noto", "", 10)
	pdf.MultiCell(0, 5.6, fmt.Sprintf("%d. %s", index, cjkFontSafe(text)), "", "L", false)
	pdf.Ln(1)

	if q.Answer == nil || strings.TrimSpace(q.Answer.Value) == "" {
		pdf.SetTextColor(130, 130, 130)
		pdf.SetFont("noto", "", 10)
		pdf.MultiCell(0, 5.6, labels.Unanswered, "", "L", false)
	} else {
		pdf.SetFillColor(240, 244, 241)
		pdf.SetTextColor(22, 62, 47)
		pdf.SetFont("noto", "", 11)
		value := q.Answer.Value
		if q.Answer.Unit != "" {
			value += " " + q.Answer.Unit
		}
		pdf.MultiCell(0, 6, cjkFontSafe(value), "", "L", true)
		pdf.SetFont("noto", "", 8)
		pdf.SetTextColor(110, 110, 110)
		status := labels.Draft
		if q.Answer.FinalizedAt != "" {
			status = labels.Finalized
		}
		pdf.CellFormat(0, 5, status, "", 1, "R", false, 0, "")
		if strings.TrimSpace(q.Answer.SourceSummary) != "" {
			pdf.SetFont("noto", "", 8)
			pdf.SetTextColor(110, 110, 110)
			pdf.MultiCell(0, 5, labels.Source+": "+cjkFontSafe(q.Answer.SourceSummary),
				"", "L", false)
		}
	}
	pdf.Ln(2)
	pdf.SetDrawColor(225, 228, 226)
	pdf.SetLineWidth(0.2)
	pdf.Line(18, pdf.GetY(), 192, pdf.GetY())
	pdf.Ln(4)
}

// groupQuestions groups by worksheet, sorts each sheet by cell address, and
// appends the unspecified bucket last, matching the 1.x PDF data service.
func groupQuestions(questions []Question, unspecified string) []Sheet {
	const unspecifiedKey = "\x00"
	order := make([]string, 0, 4)
	groups := map[string][]Question{}
	for _, q := range questions {
		key := unspecifiedKey
		if sheet, _, ok := splitPosition(q.Position); ok {
			key = sheet
		}
		if _, exists := groups[key]; !exists {
			order = append(order, key)
		}
		groups[key] = append(groups[key], q)
	}
	for key, list := range groups {
		if key == unspecifiedKey {
			continue
		}
		sort.SliceStable(list, func(i, j int) bool {
			ri, ci := cellAddress(list[i].Position)
			rj, cj := cellAddress(list[j].Position)
			if ri != rj {
				return ri < rj
			}
			return ci < cj
		})
		groups[key] = list
	}
	out := make([]Sheet, 0, len(order))
	for _, key := range order {
		if key == unspecifiedKey {
			continue
		}
		out = append(out, Sheet{Name: key, Questions: groups[key]})
	}
	if list, ok := groups[unspecifiedKey]; ok {
		out = append(out, Sheet{Name: unspecified, Questions: list})
	}
	return out
}

func splitPosition(position string) (string, string, bool) {
	idx := strings.Index(position, "!")
	if idx <= 0 || idx == len(position)-1 {
		return "", "", false
	}
	return position[:idx], position[idx+1:], true
}

// cellAddress parses A1 into (row, column), both 1-based.
func cellAddress(position string) (int, int) {
	_, addr, ok := splitPosition(position)
	if !ok {
		return 0, 0
	}
	col, row := 0, 0
	seenDigit := false
	for _, ch := range strings.ToUpper(addr) {
		switch {
		case ch >= 'A' && ch <= 'Z':
			if seenDigit {
				return 0, 0
			}
			col = col*26 + int(ch-'A'+1)
		case ch >= '0' && ch <= '9':
			seenDigit = true
			row = row*10 + int(ch-'0')
		default:
			return 0, 0
		}
	}
	return row, col
}

// cjkFontSafe normalizes line endings and drops control characters fpdf would
// render as missing glyphs.
func cjkFontSafe(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || r >= 0x20 {
			return r
		}
		return -1
	}, text)
}
