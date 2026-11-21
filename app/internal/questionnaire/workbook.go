// Package questionnaire imports a customer's .xlsx questionnaire: it reads
// the non-empty cells, asks the model which rows are questions, and persists
// the answers and the reuse prefill through the store.
package questionnaire

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/xuri/excelize/v2"
)

// Cell is one non-empty spreadsheet cell. Ref is the "<sheet>!<A1>" form the
// 1.x writer uses, so an extracted question can point at its answer cell.
type Cell struct {
	Sheet string
	Row   int
	Col   int
	Value string
	Ref   string
}

// MaxWorkbookBytes bounds an import; real CDP workbooks are well under it.
const MaxWorkbookBytes = 50 << 20

// ParseWorkbook returns every non-empty cell across every sheet, in sheet and
// row order.
func ParseWorkbook(data []byte) ([]Cell, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("questionnaire: workbook is empty")
	}
	if len(data) > MaxWorkbookBytes {
		return nil, fmt.Errorf("questionnaire: workbook exceeds %d bytes", MaxWorkbookBytes)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("questionnaire: open workbook: %w", err)
	}
	defer f.Close()

	var out []Cell
	for _, sheet := range f.GetSheetList() {
		rows, err := f.Rows(sheet)
		if err != nil {
			return nil, fmt.Errorf("questionnaire: read sheet %q: %w", sheet, err)
		}
		rowNum := 0
		for rows.Next() {
			rowNum++
			columns, err := rows.Columns()
			if err != nil {
				rows.Close()
				return nil, fmt.Errorf("questionnaire: read row %d: %w", rowNum, err)
			}
			for i, value := range columns {
				if strings.TrimSpace(value) == "" {
					continue
				}
				col := i + 1
				name, err := excelize.CoordinatesToCellName(col, rowNum)
				if err != nil {
					rows.Close()
					return nil, err
				}
				out = append(out, Cell{Sheet: sheet, Row: rowNum, Col: col,
					Value: value, Ref: sheet + "!" + name})
			}
		}
		if err := rows.Error(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("questionnaire: read sheet %q: %w", sheet, err)
		}
		rows.Close()
	}
	return out, nil
}
