package questionnaire

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

// AnswerCell is one answer written back into the customer's workbook.
type AnswerCell struct {
	Ref   string
	Value string
	Draft bool
}

// WriteAnswers writes cells into a copy of the original workbook, keeping its
// sheets and formatting. A draft answer gets a "draft" cell comment, matching
// the 1.x writer. Cells whose sheet or reference cannot be resolved are
// skipped, as are cells without a position.
func WriteAnswers(original []byte, cells []AnswerCell) ([]byte, int, int, error) {
	if len(original) == 0 {
		return nil, 0, 0, fmt.Errorf("questionnaire: workbook is empty")
	}
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		return nil, 0, 0, fmt.Errorf("questionnaire: open workbook: %w", err)
	}
	defer f.Close()

	written, drafts := 0, 0
	for _, cell := range cells {
		ref := strings.TrimSpace(cell.Ref)
		sheet, address, ok := strings.Cut(ref, "!")
		if !ok || sheet == "" || address == "" {
			continue
		}
		if index, err := f.GetSheetIndex(sheet); err != nil || index < 0 {
			continue
		}
		if numeric, ok := numericValue(cell.Value); ok {
			err = f.SetCellValue(sheet, address, numeric)
		} else {
			err = f.SetCellValue(sheet, address, cell.Value)
		}
		if err != nil {
			continue
		}
		if cell.Draft {
			if err := f.AddComment(sheet, excelize.Comment{
				Cell: address, Author: "CarbonInk", Text: "draft",
			}); err == nil {
				drafts++
			}
		}
		written++
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, 0, 0, fmt.Errorf("questionnaire: write workbook: %w", err)
	}
	return buf.Bytes(), written, drafts, nil
}

func numericValue(value string) (float64, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return 0, false
	}
	n, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}
