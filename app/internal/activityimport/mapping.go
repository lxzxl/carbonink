package activityimport

import (
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Field names one importable target column.
type Field string

const (
	FieldSourceName  Field = "source_name"
	FieldDescription Field = "description"
	FieldAmount      Field = "amount"
	FieldUnit        Field = "unit"
	FieldStart       Field = "occurred_at_start"
	FieldEnd         Field = "occurred_at_end"
	FieldNotes       Field = "notes"
)

// AllFields is the canonical display order.
var AllFields = []Field{
	FieldSourceName, FieldDescription, FieldAmount, FieldUnit,
	FieldStart, FieldEnd, FieldNotes,
}

// RequiredFields are the columns the import cannot proceed without.
var RequiredFields = []Field{FieldSourceName, FieldDescription, FieldAmount, FieldUnit}

// Mapping is target field -> 0-based column index. Absent means unmapped.
type Mapping map[Field]int

type alias struct {
	field   Field
	aliases []string
}

// Declaration order wins, one column per field, specific aliases before
// catch-alls. A single date column claims the start and the end falls back to
// it. Money columns are deliberately absent: spend is not a quantity.
var fieldAliases = []alias{
	{FieldSourceName, []string{
		"sourcename", "emissionsource", "source", "facility",
		"排放源名称", "排放源", "源名称", "设施", "设备",
	}},
	{FieldDescription, []string{
		"description", "activity", "item", "detail",
		"活动描述", "描述", "说明", "摘要", "品名", "项目", "名称",
	}},
	{FieldAmount, []string{
		"amount", "quantity", "qty", "活动数据", "活动量", "数量", "用量", "消耗量", "数值",
	}},
	{FieldUnit, []string{"unit", "单位", "计量单位", "活动单位"}},
	{FieldStart, []string{
		"occurredatstart", "startdate", "datefrom", "start",
		"开始日期", "起始日期", "开始时间", "日期", "date",
	}},
	{FieldEnd, []string{
		"occurredatend", "enddate", "dateto", "end", "结束日期", "截止日期", "结束时间",
	}},
	{FieldNotes, []string{"notes", "note", "remarks", "remark", "备注", "注"}},
}

var headerNoise = regexp.MustCompile(`[\s_\-()（）:：/\\.]+`)

func normalizeHeader(header string) string {
	return strings.ToLower(headerNoise.ReplaceAllString(header, ""))
}

// AutoMap detects the column mapping from the header row.
func AutoMap(headers []string) Mapping {
	normalized := make([]string, len(headers))
	for i, header := range headers {
		normalized[i] = normalizeHeader(header)
	}
	claimed := make(map[int]bool)
	mapping := Mapping{}
	for _, entry := range fieldAliases {
		for col, header := range normalized {
			if claimed[col] || header == "" {
				continue
			}
			if contains(entry.aliases, header) {
				mapping[entry.field] = col
				claimed[col] = true
				break
			}
		}
	}
	return mapping
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// MissingRequired lists the required fields without a mapped column.
func MissingRequired(mapping Mapping) []Field {
	var missing []Field
	for _, field := range RequiredFields {
		if _, ok := mapping[field]; !ok {
			missing = append(missing, field)
		}
	}
	return missing
}

// Issue is one row-level error or warning.
type Issue struct {
	Row    int
	Code   string
	Detail string
}

// ValidRow is a normalized row that can be grouped and imported.
type ValidRow struct {
	Row         int
	SourceName  string
	Description string
	Amount      float64
	Unit        string
	Start       string
	End         string
	Notes       string
}

// Validation is the preview plus the rows the later stages consume.
type Validation struct {
	TotalRows    int
	ValidCount   int
	ErrorCount   int
	WarningCount int
	Errors       []Issue
	Warnings     []Issue
	Sample       []ValidRow
	Valid        []ValidRow
}

// PeriodBounds are the reporting period's date-only bounds.
type PeriodBounds struct {
	Start string
	End   string
}

const (
	maxReportedIssues = 200
	sampleSize        = 5
)

var thousands = regexp.MustCompile(`^-?\d{1,3}(,\d{3})+(\.\d+)?$`)

func parseAmount(raw string) (float64, bool) {
	text := strings.TrimSpace(raw)
	if thousands.MatchString(text) {
		text = strings.ReplaceAll(text, ",", "")
	}
	if text == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) || value <= 0 {
		return 0, false
	}
	return value, true
}

var (
	ymdPattern    = regexp.MustCompile(`^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?(?:[T\s].*)?$`)
	serialPattern = regexp.MustCompile(`^\d{5}$`)
)

// ParseDate accepts only unambiguous shapes: year-first dates (with optional
// time suffix), Chinese dates, and raw Excel serials. Day-first vs month-first
// forms are rejected rather than guessed.
func ParseDate(raw string) (string, bool) {
	text := strings.TrimSpace(raw)
	if text == "" {
		return "", false
	}
	if match := ymdPattern.FindStringSubmatch(text); match != nil {
		year, _ := strconv.Atoi(match[1])
		month, _ := strconv.Atoi(match[2])
		day, _ := strconv.Atoi(match[3])
		if year < 1990 || year > 2100 {
			return "", false
		}
		date := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.UTC)
		if date.Year() != year || int(date.Month()) != month || date.Day() != day {
			return "", false
		}
		return date.Format("2006-01-02"), true
	}
	if serialPattern.MatchString(text) {
		serial, _ := strconv.Atoi(text)
		if serial < 20_000 || serial > 80_000 {
			return "", false
		}
		// Excel's serial epoch is 1899-12-30.
		date := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC).AddDate(0, 0, serial)
		return date.Format("2006-01-02"), true
	}
	return "", false
}

// Validate normalizes rows under mapping and reports errors and warnings.
// Error rows are skipped; warnings never block. Date-less rows inherit the
// period bounds later, so they are in range by construction.
func Validate(rows []Row, mapping Mapping, period *PeriodBounds) Validation {
	var out Validation
	out.TotalRows = len(rows)
	out.Valid = make([]ValidRow, 0, len(rows))
	seen := make(map[string]int)
	cell := func(cells []string, field Field) string {
		col, ok := mapping[field]
		if !ok || col < 0 || col >= len(cells) {
			return ""
		}
		return strings.TrimSpace(cells[col])
	}
	pushError := func(issue Issue) {
		out.ErrorCount++
		if len(out.Errors) < maxReportedIssues {
			out.Errors = append(out.Errors, issue)
		}
	}
	pushWarning := func(issue Issue) {
		out.WarningCount++
		if len(out.Warnings) < maxReportedIssues {
			out.Warnings = append(out.Warnings, issue)
		}
	}

	for _, row := range rows {
		var rowErrors []Issue
		sourceName := cell(row.Cells, FieldSourceName)
		if sourceName == "" {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "source_name_missing"})
		}
		description := cell(row.Cells, FieldDescription)
		if description == "" {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "description_missing"})
		}
		amountRaw := cell(row.Cells, FieldAmount)
		var amount float64
		if amountRaw == "" {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "amount_missing"})
		} else {
			var ok bool
			amount, ok = parseAmount(amountRaw)
			if !ok {
				rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "amount_invalid", Detail: amountRaw})
			}
		}
		unit := cell(row.Cells, FieldUnit)
		if unit == "" {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "unit_missing"})
		}

		startRaw := cell(row.Cells, FieldStart)
		endRaw := cell(row.Cells, FieldEnd)
		var start, end string
		startOK, endOK := true, true
		if startRaw != "" {
			start, startOK = ParseDate(startRaw)
			if !startOK {
				rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "date_invalid", Detail: startRaw})
			}
		}
		if endRaw != "" {
			end, endOK = ParseDate(endRaw)
			if !endOK {
				rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "date_invalid", Detail: endRaw})
			}
		}
		if startOK && endOK {
			if start != "" && end == "" {
				end = start
			}
			if end != "" && start == "" {
				start = end
			}
			if start != "" && end != "" && start > end {
				rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "date_range_invalid",
					Detail: start + " > " + end})
			}
		}
		if len(rowErrors) > 0 {
			for _, issue := range rowErrors {
				pushError(issue)
			}
			continue
		}

		if period != nil && start != "" && end != "" &&
			(start < period.Start || end > period.End) {
			pushWarning(Issue{Row: row.Number, Code: "period_mismatch", Detail: start + "~" + end})
		}
		key := strings.ToLower(sourceName) + "\x1f" + start + "\x1f" + end + "\x1f" +
			strconv.FormatFloat(amount, 'f', -1, 64) + "\x1f" + strings.ToLower(unit)
		if first, ok := seen[key]; ok {
			pushWarning(Issue{Row: row.Number, Code: "duplicate_in_file", Detail: strconv.Itoa(first)})
		} else {
			seen[key] = row.Number
		}
		valid := ValidRow{
			Row: row.Number, SourceName: sourceName, Description: description,
			Amount: amount, Unit: unit, Start: start, End: end,
			Notes: cell(row.Cells, FieldNotes),
		}
		out.Valid = append(out.Valid, valid)
		if len(out.Sample) < sampleSize {
			out.Sample = append(out.Sample, valid)
		}
	}
	out.ValidCount = len(out.Valid)
	return out
}
