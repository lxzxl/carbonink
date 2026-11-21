package report

import (
	"errors"
	"fmt"

	"github.com/xuri/excelize/v2"
)

// WorkbookMIME is the Excel content type the save dialog uses.
const WorkbookMIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// XLSX writes the inventory appendix: summary, sources, factors, activities.
func (r *Report) XLSX(l Labels) ([]byte, error) {
	if r == nil || r.Data == nil {
		return nil, errors.New("report: no data to render")
	}
	f := excelize.NewFile()
	defer f.Close()
	bold, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		return nil, err
	}

	d := r.Data
	summary, err := f.NewSheet(l.Summary)
	if err != nil {
		return nil, err
	}
	// excelize always seeds a default sheet; the appendix is the user's
	// deliverable, so drop it once the summary exists.
	f.DeleteSheet("Sheet1")
	f.SetActiveSheet(summary)
	rows := [][]string{
		{l.Org, organizationName(d)},
		{l.Period, fmt.Sprintf("%d (%s — %s)", d.Period.Year, d.Period.Start, d.Period.End)},
		{l.Boundary, boundaryLabel(d.Organization.BoundaryKind, l)},
		{l.Generated, r.GeneratedAt},
		{},
		{l.Summary, l.CO2e},
		{l.Scope1, number(d.Totals.Scope1Kg)},
		{l.Scope2, number(d.Totals.Scope2Kg)},
		{l.Scope3, number(d.Totals.Scope3Kg)},
		{l.Total, number(d.Totals.TotalKg)},
	}
	if d.PriorPeriod != nil {
		rows = append(rows, []string{
			fmt.Sprintf("%s %d", l.PriorYear, d.PriorPeriod.Year),
			number(d.PriorPeriod.TotalKg),
		})
	}
	if d.BaseYear != nil {
		rows = append(rows, []string{
			fmt.Sprintf("%s %d", l.BaseYear, d.BaseYear.Year),
			number(d.BaseYear.TotalKg),
		})
	}
	writeRows(f, l.Summary, rows)
	f.SetCellStyle(l.Summary, "A6", "B6", bold)
	f.SetColWidth(l.Summary, "A", "A", 24)
	f.SetColWidth(l.Summary, "B", "B", 60)

	sources, err := f.NewSheet(l.Sources)
	if err != nil {
		return nil, err
	}
	_ = sources
	sourceRows := [][]string{{l.Source, l.Scope, l.CO2e, l.Share}}
	for _, source := range d.Sources {
		sourceRows = append(sourceRows, []string{
			source.Name, fmt.Sprint(source.Scope), number(source.CO2eKg),
			fmt.Sprintf("%.1f%%", source.SharePct),
		})
	}
	writeRows(f, l.Sources, sourceRows)
	styleHeader(f, l.Sources, 4, bold)

	factorRows := [][]string{{l.Name, l.Count, l.GWPBasis}}
	for _, ef := range d.EFSources {
		factorRows = append(factorRows, []string{ef.Source, fmt.Sprint(ef.Count), ef.GWPBasis})
	}
	if _, err := f.NewSheet(l.Factors); err != nil {
		return nil, err
	}
	writeRows(f, l.Factors, factorRows)
	styleHeader(f, l.Factors, 3, bold)

	activityRows := [][]string{{l.Site, l.Source, l.Scope, l.Amount, l.Unit, l.CO2e,
		l.EF, l.Year, l.Notes}}
	for _, a := range d.Activities {
		activityRows = append(activityRows, []string{
			a.Site, a.Source, fmt.Sprint(a.Scope), number(a.Amount), a.Unit,
			number(a.CO2eKg), a.EFSource, fmt.Sprint(a.EFYear), a.Notes,
		})
	}
	if _, err := f.NewSheet(l.Activities); err != nil {
		return nil, err
	}
	writeRows(f, l.Activities, activityRows)
	styleHeader(f, l.Activities, 9, bold)

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeRows(f *excelize.File, sheet string, rows [][]string) {
	for rowIndex, row := range rows {
		for colIndex, value := range row {
			cell, err := excelize.CoordinatesToCellName(colIndex+1, rowIndex+1)
			if err != nil {
				continue
			}
			_ = f.SetCellValue(sheet, cell, value)
		}
	}
}

func styleHeader(f *excelize.File, sheet string, columns int, style int) {
	f.SetColWidth(sheet, "A", "A", 28)
	if columns > 1 {
		last, _ := excelize.ColumnNumberToName(columns)
		f.SetColWidth(sheet, last, last, 32)
	}
	end, _ := excelize.CoordinatesToCellName(columns, 1)
	f.SetCellStyle(sheet, "A1", end, style)
}
