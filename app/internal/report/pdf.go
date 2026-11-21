package report

import (
	"bytes"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/pdfgen"
	"app.carbonink.desktop/internal/store"

	"github.com/go-pdf/fpdf"
)

// Labels are the exported document's fixed copy, in its language.
type Labels struct {
	ISOTitle            string
	TCFDTitle           string
	Org                 string
	Period              string
	Boundary            string
	BoundaryEquity      string
	BoundaryFinancial   string
	BoundaryOperational string
	Responsible         string
	Generated           string
	Sites               string
	Site                string

	SectionBoundary     string
	SectionReporting    string
	SectionMethod       string
	SectionInventory    string
	SectionChanges      string
	SectionObservations string

	PillarGovernance string
	PillarStrategy   string
	PillarRisk       string
	PillarMetrics    string
	TCFDIntro        string

	Summary       string
	Sources       string
	Factors       string
	Activities    string
	Scope         string
	Source        string
	Name          string
	CO2e          string
	Share         string
	Year          string
	Amount        string
	Unit          string
	EF            string
	Notes         string
	Count         string
	GWPBasis      string
	Scope1        string
	Scope2        string
	Scope3        string
	Total         string
	BaseYear      string
	PriorYear     string
	Significant   string
	NoSignificant string
	PreparedBy    string
}

// PDF renders the report as its ISO 14064-1 or TCFD document.
func (r *Report) PDF(l Labels) ([]byte, error) {
	if r == nil || r.Data == nil {
		return nil, errors.New("report: no data to render")
	}
	switch r.Kind {
	case KindISO:
		return r.isoPDF(l)
	case KindTCFD:
		return r.tcfdPDF(l)
	}
	return nil, fmt.Errorf("report: unknown kind %q", r.Kind)
}

type pdfWriter struct {
	*fpdf.Fpdf
	report *Report
}

func newPDF() (*pdfWriter, error) {
	font := pdfgen.Font()
	if len(font) == 0 {
		return nil, errors.New("report: CJK font is missing")
	}
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(20, 20, 20)
	pdf.SetAutoPageBreak(true, 22)
	pdf.AddUTF8FontFromBytes("noto", "", font)
	w := &pdfWriter{Fpdf: pdf}
	pdf.SetFooterFunc(func() {
		pdf.SetY(-13)
		pdf.SetFont("noto", "", 8)
		pdf.SetTextColor(120, 120, 120)
		pdf.CellFormat(0, 5, fmt.Sprintf("CarbonInk · %d", pdf.PageNo()), "", 0, "C", false, 0, "")
	})
	return w, nil
}

func (w *pdfWriter) cover(title string, r *Report, l Labels) {
	d := r.Data
	w.AddPage()
	w.SetFillColor(22, 62, 47)
	w.Rect(0, 0, 210, 70, "F")
	if len(r.Logo) > 0 {
		options := fpdf.ImageOptions{ImageType: r.LogoFormat, ReadDpi: true}
		if info := w.RegisterImageOptionsReader("report-logo", options, bytes.NewReader(r.Logo)); info != nil {
			w.ImageOptions("report-logo", 155, 18, 38, 0, false, options, 0, "")
		}
	}
	w.SetTextColor(255, 255, 255)
	w.SetXY(20, 26)
	w.SetFont("noto", "", 22)
	width := 170.0
	if len(r.Logo) > 0 {
		width = 125
	}
	w.MultiCell(width, 12, w.safe(title), "", "L", false)
	w.SetXY(20, 50)
	w.SetFont("noto", "", 12)
	w.CellFormat(0, 8, w.safe(organizationName(d)), "", 1, "L", false, 0, "")

	w.SetTextColor(60, 60, 60)
	w.SetXY(20, 92)
	w.SetFont("noto", "", 11)
	w.keyValue(l.Org, organizationName(d))
	w.keyValue(l.Period, fmt.Sprintf("%d (%s — %s)", d.Period.Year, d.Period.Start, d.Period.End))
	w.keyValue(l.Boundary, boundaryLabel(d.Organization.BoundaryKind, l))
	if d.Organization.Responsible != "" {
		name := d.Organization.Responsible
		if d.Organization.ResponsibleRole != "" {
			name += " · " + d.Organization.ResponsibleRole
		}
		w.keyValue(l.Responsible, name)
	}
	if len(d.Sites) > 0 {
		names := make([]string, 0, len(d.Sites))
		for _, site := range d.Sites {
			names = append(names, siteName(site))
		}
		w.keyValue(l.Sites, strings.Join(names, ", "))
	}
	w.keyValue(l.Generated, r.GeneratedAt)
}

func (w *pdfWriter) keyValue(key, value string) {
	w.SetFont("noto", "", 9)
	w.SetTextColor(120, 120, 120)
	w.CellFormat(38, 6.5, w.safe(key), "", 0, "L", false, 0, "")
	w.SetTextColor(40, 40, 40)
	w.SetFont("noto", "", 10)
	w.MultiCell(0, 6.5, w.safe(value), "", "L", false)
}

func (w *pdfWriter) heading(text string) {
	if w.GetY() > 240 {
		w.AddPage()
	}
	w.Ln(3)
	w.SetTextColor(22, 62, 47)
	w.SetFont("noto", "", 14)
	w.MultiCell(0, 8, w.safe(text), "", "L", false)
	w.SetDrawColor(22, 62, 47)
	w.SetLineWidth(0.4)
	w.Line(20, w.GetY()+1, 190, w.GetY()+1)
	w.Ln(6)
}

func (w *pdfWriter) paragraph(text string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return
	}
	w.SetTextColor(40, 40, 40)
	w.SetFont("noto", "", 10)
	w.MultiCell(0, 6, w.safe(text), "", "L", false)
	w.Ln(2)
}

func (w *pdfWriter) table(headers []string, rows [][]string, widths []float64) {
	if len(rows) == 0 {
		return
	}
	w.SetFont("noto", "", 8.5)
	w.SetFillColor(240, 244, 241)
	w.SetTextColor(35, 35, 35)
	for i, header := range headers {
		width := 0.0
		if i < len(widths) {
			width = widths[i]
		}
		w.CellFormat(width, 7, w.safe(header), "1", 0, "L", true, 0, "")
	}
	w.Ln(-1)
	for _, row := range rows {
		for i, cell := range row {
			width := 0.0
			if i < len(widths) {
				width = widths[i]
			}
			w.CellFormat(width, 6.5, w.safe(cell), "1", 0, "L", false, 0, "")
		}
		w.Ln(-1)
	}
	w.Ln(4)
}

func (w *pdfWriter) safe(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || r >= 0x20 {
			return r
		}
		return -1
	}, text)
}

func (r *Report) isoPDF(l Labels) ([]byte, error) {
	w, err := newPDF()
	if err != nil {
		return nil, err
	}
	w.report = r
	w.cover(l.ISOTitle, r, l)
	w.AddPage()

	w.heading(l.SectionBoundary)
	w.paragraph(r.ISO.BoundaryDescription)

	w.heading(l.SectionReporting)
	w.paragraph(r.ISO.ReportingBoundary)

	w.heading(l.SectionMethod)
	w.paragraph(r.ISO.MethodologyDescription)
	rows := make([][]string, 0, len(r.Data.EFSources))
	for _, ef := range r.Data.EFSources {
		rows = append(rows, []string{ef.Source, strconv.Itoa(ef.Count), ef.GWPBasis})
	}
	w.table([]string{l.Name, l.Count, l.GWPBasis}, rows, []float64{110, 25, 35})

	w.heading(l.SectionInventory)
	w.totalsTable(l)
	sourceRows := make([][]string, 0, len(r.Data.Sources))
	for _, source := range r.Data.Sources {
		sourceRows = append(sourceRows, []string{
			source.Name, strconv.Itoa(source.Scope), number(source.CO2eKg),
			fmt.Sprintf("%.1f%%", source.SharePct),
		})
	}
	w.table([]string{l.Source, l.Scope, l.CO2e, l.Share}, sourceRows,
		[]float64{100, 18, 36, 16})
	w.paragraph(r.ISO.EmissionsSummary)

	w.heading(l.SectionChanges)
	changes := strings.TrimSpace(r.ISO.SignificantChanges)
	if changes == "" {
		changes = l.NoSignificant
	}
	w.paragraph(changes)

	w.heading(l.SectionObservations)
	w.paragraph(r.ISO.NotableObservations)
	return output(w)
}

func (r *Report) tcfdPDF(l Labels) ([]byte, error) {
	w, err := newPDF()
	if err != nil {
		return nil, err
	}
	w.report = r
	w.cover(l.TCFDTitle, r, l)
	w.AddPage()
	w.paragraph(l.TCFDIntro)

	w.heading(l.PillarGovernance)
	w.paragraph(r.TCFD.Governance)

	w.heading(l.PillarStrategy)
	w.paragraph(r.TCFD.Strategy)

	w.heading(l.PillarRisk)
	w.paragraph(r.TCFD.RiskManagement)

	w.heading(l.PillarMetrics)
	w.totalsTable(l)
	sourceRows := make([][]string, 0, len(r.Data.Sources))
	for _, source := range r.Data.Sources {
		sourceRows = append(sourceRows, []string{
			source.Name, strconv.Itoa(source.Scope), number(source.CO2eKg),
			fmt.Sprintf("%.1f%%", source.SharePct),
		})
	}
	w.table([]string{l.Source, l.Scope, l.CO2e, l.Share}, sourceRows,
		[]float64{100, 18, 36, 16})
	w.paragraph(r.TCFD.MetricsTargets)
	return output(w)
}

func (w *pdfWriter) totalsTable(l Labels) {
	rows := [][]string{
		{l.Scope1, number(w.report.Data.Totals.Scope1Kg)},
		{l.Scope2, number(w.report.Data.Totals.Scope2Kg)},
		{l.Scope3, number(w.report.Data.Totals.Scope3Kg)},
		{l.Total, number(w.report.Data.Totals.TotalKg)},
	}
	if w.report.Data.PriorPeriod != nil {
		rows = append(rows, []string{
			fmt.Sprintf("%s %d", l.PriorYear, w.report.Data.PriorPeriod.Year),
			number(w.report.Data.PriorPeriod.TotalKg),
		})
	}
	if w.report.Data.BaseYear != nil {
		rows = append(rows, []string{
			fmt.Sprintf("%s %d", l.BaseYear, w.report.Data.BaseYear.Year),
			number(w.report.Data.BaseYear.TotalKg),
		})
	}
	w.table([]string{l.Summary, l.CO2e}, rows, []float64{120, 50})
}

func output(w *pdfWriter) ([]byte, error) {
	if err := w.Error(); err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	if err := w.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func boundaryLabel(kind string, l Labels) string {
	switch kind {
	case "equity_share":
		return l.BoundaryEquity
	case "financial_control":
		return l.BoundaryFinancial
	}
	return l.BoundaryOperational
}

func siteName(site store.ReportSite) string {
	if site.NameZH != "" {
		return site.NameZH
	}
	if site.NameEN != "" {
		return site.NameEN
	}
	return site.ID
}

// organizationName picks the Chinese legal name first, then English.
func organizationName(d *store.ReportData) string {
	if strings.TrimSpace(d.Organization.NameZH) != "" {
		return d.Organization.NameZH
	}
	if strings.TrimSpace(d.Organization.NameEN) != "" {
		return d.Organization.NameEN
	}
	return d.Organization.ID
}

func number(value float64) string {
	text := strconv.FormatFloat(value, 'f', 2, 64)
	whole, fraction, _ := strings.Cut(text, ".")
	var out strings.Builder
	for i, digit := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			out.WriteByte(',')
		}
		out.WriteRune(digit)
	}
	return out.String() + "." + fraction
}
