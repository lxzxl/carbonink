package questionnaire

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"app.carbonink.desktop/internal/llm"
)

// extractSchema matches the 1.x zod schema: at most 500 questions, and the
// three question kinds. answer_cell_ref and expected_unit are nullable.
const extractSchema = `{
  "type": "object",
  "required": ["questions"],
  "additionalProperties": false,
  "properties": {
    "questions": {
      "type": "array",
      "maxItems": 500,
      "items": {
        "type": "object",
        "required": ["raw_text", "normalized_text", "answer_cell_ref", "expected_unit",
                     "sheet", "question_row", "question_kind"],
        "additionalProperties": false,
        "properties": {
          "raw_text":        {"type": "string"},
          "normalized_text": {"type": "string"},
          "answer_cell_ref": {"type": ["string", "null"]},
          "expected_unit":   {"type": ["string", "null"]},
          "sheet":           {"type": "string"},
          "question_row":    {"type": "integer"},
          "question_kind":   {"type": "string",
                              "enum": ["numerical", "categorical", "narrative"]}
        }
      }
    }
  }
}`

// ExtractedQuestion is one model-extracted question.
type ExtractedQuestion struct {
	RawText        string  `json:"raw_text"`
	NormalizedText string  `json:"normalized_text"`
	AnswerCellRef  *string `json:"answer_cell_ref"`
	ExpectedUnit   *string `json:"expected_unit"`
	Sheet          string  `json:"sheet"`
	QuestionRow    int     `json:"question_row"`
	QuestionKind   string  `json:"question_kind"`
}

type extractReply struct {
	Questions []ExtractedQuestion `json:"questions"`
}

// ParseExtractReply validates a model reply and returns its questions.
func ParseExtractReply(raw []byte) ([]ExtractedQuestion, error) {
	if err := llm.Validate([]byte(extractSchema), raw); err != nil {
		return nil, err
	}
	var reply extractReply
	if err := json.Unmarshal(raw, &reply); err != nil {
		return nil, fmt.Errorf("questionnaire: decode reply: %w", err)
	}
	return reply.Questions, nil
}

// BuildExtractPrompt is the 1.x prompt, verbatim, over the compact cell list.
func BuildExtractPrompt(cells []Cell) string {
	type key struct {
		sheet string
		row   int
	}
	byRow := map[key][]Cell{}
	sheetRows := map[string][]int{}
	for _, cell := range cells {
		k := key{sheet: cell.Sheet, row: cell.Row}
		if _, ok := byRow[k]; !ok {
			sheetRows[cell.Sheet] = append(sheetRows[cell.Sheet], cell.Row)
		}
		byRow[k] = append(byRow[k], cell)
	}
	sheets := make([]string, 0, len(sheetRows))
	for sheet := range sheetRows {
		sheets = append(sheets, sheet)
	}
	sort.Strings(sheets)

	var text strings.Builder
	for _, sheet := range sheets {
		text.WriteString("\n=== Sheet \"" + sheet + "\" ===\n")
		rows := sheetRows[sheet]
		sort.Ints(rows)
		seen := map[int]bool{}
		for _, rowNum := range rows {
			if seen[rowNum] {
				continue
			}
			seen[rowNum] = true
			rowCells := byRow[key{sheet: sheet, row: rowNum}]
			sort.Slice(rowCells, func(i, j int) bool { return rowCells[i].Col < rowCells[j].Col })
			parts := make([]string, len(rowCells))
			for i, cell := range rowCells {
				encoded, _ := json.Marshal(cell.Value)
				parts[i] = cell.Ref + "=" + string(encoded)
			}
			text.WriteString(fmt.Sprintf("Row %d: %s\n", rowNum, strings.Join(parts, " | ")))
		}
	}

	return `你是一名碳核算助理。下面是一份 CDP 风格的供应商问卷 Excel 表所有非空单元格的清单。请识别出每道**问题**，并指出其**答案应该填入哪个单元格**。

规则：
- 忽略目录、章节标题、表头说明、纯空白行。
- 一道问题通常占一行：问题文本在某一列，紧邻的右侧空单元格就是答案位置。
- 如果一行有"题面 + 单位列 + 答案列"，那答案在最右边的空列。
- 题面应该是个真正可被回答的问题（含数字、范围、是非等可量化语义），而非说明性文字。
- 提取问题原文 (raw_text)，并给出规范化版本 (normalized_text，去标点、去前缀编号、单空格)。
- 如能从题面推断单位（kWh、tCO2e、m³、% 等），写入 expected_unit；否则 null。
- answer_cell_ref：填入答案的目标单元格 ref（同 sheet，紧挨题面的空单元格）；如果不能确定，置 null。
- 排除任何已经填了数字/答案的单元格（那是示例值或别人答过的）。

<cells>` + text.String() + `</cells>

对每道题判断 question_kind：
- numerical：要求填数字 + 单位（如"年度用电量(kWh)"、"员工总人数"）
- categorical：要求短词答案（如"是否签署 SBTi 承诺"、"主要行业分类"、"报告期开始日期 (YYYY-MM-DD)"）
- narrative：要求 1-3 句叙述（如"请描述贵公司气候转型计划"、"说明可持续发展战略"）
判断不准则降级为 categorical。

返回 JSON: { questions: [{ raw_text, normalized_text, answer_cell_ref, expected_unit, sheet, question_row, question_kind }] }`
}
