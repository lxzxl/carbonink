// Package efimport normalizes user emission-factor libraries. It is
// database-free: the store owns namespacing, replacement, and auditing.
package efimport

import (
	"math"
	"regexp"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/activityimport"
)

// Field names one importable target column.
type Field string

const (
	FieldFactorCode Field = "factor_code"
	FieldNameZH     Field = "name_zh"
	FieldNameEN     Field = "name_en"
	FieldScope      Field = "scope"
	FieldCategory   Field = "category"
	FieldYear       Field = "year"
	FieldGeography  Field = "geography"
	FieldInputUnit  Field = "input_unit"
	FieldCO2e       Field = "co2e_kg_per_unit"
	FieldCH4        Field = "ch4_kg_per_unit"
	FieldN2O        Field = "n2o_kg_per_unit"
	FieldHFC        Field = "hfc_kg_per_unit"
	FieldPFC        Field = "pfc_kg_per_unit"
	FieldSF6        Field = "sf6_kg_per_unit"
	FieldNF3        Field = "nf3_kg_per_unit"
	FieldBiogenic   Field = "biogenic_co2_factor"
	FieldGWP        Field = "gwp_basis"
	FieldDescZH     Field = "description_zh"
	FieldDescEN     Field = "description_en"
	FieldNotes      Field = "notes"
	FieldCitation   Field = "citation_url"
)

// AllFields is the canonical template/display order.
var AllFields = []Field{
	FieldFactorCode, FieldNameZH, FieldNameEN, FieldScope, FieldCategory, FieldYear,
	FieldGeography, FieldInputUnit, FieldCO2e, FieldCH4, FieldN2O, FieldHFC, FieldPFC,
	FieldSF6, FieldNF3, FieldBiogenic, FieldGWP, FieldDescZH, FieldDescEN, FieldNotes,
	FieldCitation,
}

// RequiredFields must have a mapped column before import.
var RequiredFields = []Field{FieldScope, FieldYear, FieldInputUnit, FieldCO2e}

// Mapping is target field -> 0-based column index.
type Mapping map[Field]int

type alias struct {
	field   Field
	aliases []string
}

var fieldAliases = []alias{
	{FieldFactorCode, []string{"factorcode", "code", "因子编码", "因子代码", "编码", "代码"}},
	{FieldNameZH, []string{"namezh", "zhname", "中文名称", "中文名", "名称中文", "因子名称", "名称"}},
	{FieldNameEN, []string{"nameen", "enname", "englishname", "英文名称", "英文名", "名称英文", "name"}},
	{FieldScope, []string{"scope", "范围"}},
	{FieldCategory, []string{"category", "类别", "分类", "类目"}},
	{FieldYear, []string{"year", "年份", "年度", "年"}},
	{FieldGeography, []string{"geography", "region", "geo", "地区", "区域", "地理", "国家地区", "国家"}},
	{FieldInputUnit, []string{"inputunit", "unit", "单位", "活动单位", "计量单位"}},
	{FieldCO2e, []string{"co2ekgperunit", "co2e", "kgco2e", "co2ekg", "排放因子值", "排放因子",
		"因子值", "因子数值", "factorvalue", "value", "数值"}},
	{FieldCH4, []string{"ch4kgperunit", "ch4"}},
	{FieldN2O, []string{"n2okgperunit", "n2o"}},
	{FieldHFC, []string{"hfckgperunit", "hfc", "hfcs"}},
	{FieldPFC, []string{"pfckgperunit", "pfc", "pfcs"}},
	{FieldSF6, []string{"sf6kgperunit", "sf6"}},
	{FieldNF3, []string{"nf3kgperunit", "nf3"}},
	{FieldBiogenic, []string{"biogenicco2factor", "biogenicco2", "biogenic", "生物源co2",
		"生物源因子", "生物源"}},
	{FieldGWP, []string{"gwpbasis", "gwp", "gwp基准", "gwp版本"}},
	{FieldDescZH, []string{"descriptionzh", "中文描述", "描述中文", "描述", "说明"}},
	{FieldDescEN, []string{"descriptionen", "englishdescription", "英文描述", "description"}},
	{FieldNotes, []string{"notes", "note", "备注"}},
	{FieldCitation, []string{"citationurl", "citation", "url", "引用链接", "引用", "来源链接", "链接"}},
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

// MissingRequired lists required fields without a mapped column.
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

// ValidRow is one normalized factor. Gas fields are nil when the cell was
// empty; CO2e and the required fields are always set.
type ValidRow struct {
	Row           int
	FactorCode    string
	Year          int
	Geography     string
	Scope         int
	Category      string
	InputUnit     string
	CO2e          float64
	CH4           *float64
	N2O           *float64
	HFC           *float64
	PFC           *float64
	SF6           *float64
	NF3           *float64
	Biogenic      *float64
	GWP           string
	NameZH        string
	NameEN        string
	DescriptionZH string
	DescriptionEN string
	Notes         string
	CitationURL   string
}

// Validation is the preview plus the rows the import consumes.
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

const (
	maxReportedIssues = 200
	sampleSize        = 5
)

var thousands = regexp.MustCompile(`^-?\d{1,3}(,\d{3})+(\.\d+)?$`)

func parseNumber(raw string) (float64, bool) {
	text := strings.TrimSpace(raw)
	if thousands.MatchString(text) {
		text = strings.ReplaceAll(text, ",", "")
	}
	if text == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return value, true
}

func parseScope(raw string) (int, bool) {
	compact := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(raw), " ", ""))
	compact = strings.TrimPrefix(compact, "scope")
	compact = strings.TrimPrefix(compact, "范围")
	switch compact {
	case "1", "一":
		return 1, true
	case "2", "二":
		return 2, true
	case "3", "三":
		return 3, true
	default:
		return 0, false
	}
}

// Validate normalizes rows under mapping. Error rows are skipped; warnings
// never block. knownUnits may be nil to skip the advisory unit warning.
func Validate(rows []activityimport.Row, mapping Mapping, knownUnits map[string]bool) Validation {
	var out Validation
	out.TotalRows = len(rows)
	out.Valid = make([]ValidRow, 0, len(rows))
	seen := make(map[string]bool)
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
	for idx, row := range rows {
		var rowErrors []Issue
		nameZH := cell(row.Cells, FieldNameZH)
		nameEN := cell(row.Cells, FieldNameEN)
		if nameZH == "" && nameEN == "" {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "name_missing"})
		}
		scopeRaw := cell(row.Cells, FieldScope)
		scope := 0
		if scopeRaw == "" {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "scope_missing"})
		} else if value, ok := parseScope(scopeRaw); !ok {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "scope_invalid", Detail: scopeRaw})
		} else {
			scope = value
		}
		yearRaw := cell(row.Cells, FieldYear)
		year := 0
		if yearRaw == "" {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "year_missing"})
		} else {
			value, err := strconv.Atoi(yearRaw)
			if err != nil || value < 1990 || value > 2100 {
				rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "year_invalid", Detail: yearRaw})
			} else {
				year = value
			}
		}
		unit := cell(row.Cells, FieldInputUnit)
		if unit == "" {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "unit_missing"})
		}
		co2eRaw := cell(row.Cells, FieldCO2e)
		var co2e float64
		if co2eRaw == "" {
			rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "co2e_missing"})
		} else {
			value, ok := parseNumber(co2eRaw)
			if !ok {
				rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "value_invalid", Detail: co2eRaw})
			} else {
				co2e = value
			}
		}
		gas := func(field Field) *float64 {
			raw := cell(row.Cells, field)
			if raw == "" {
				return nil
			}
			value, ok := parseNumber(raw)
			if !ok {
				rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "value_invalid", Detail: raw})
				return nil
			}
			return &value
		}
		ch4 := gas(FieldCH4)
		n2o := gas(FieldN2O)
		hfc := gas(FieldHFC)
		pfc := gas(FieldPFC)
		sf6 := gas(FieldSF6)
		nf3 := gas(FieldNF3)
		biogenic := gas(FieldBiogenic)
		gwp := "AR6"
		if raw := cell(row.Cells, FieldGWP); raw != "" {
			upper := strings.ToUpper(raw)
			if upper == "AR5" || upper == "AR6" {
				gwp = upper
			} else {
				rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "gwp_invalid", Detail: raw})
			}
		}
		code := cell(row.Cells, FieldFactorCode)
		if code == "" {
			code = "EF-" + pad5(idx+1)
		}
		geography := cell(row.Cells, FieldGeography)
		if geography == "" {
			geography = "GLOBAL"
		}
		if len(rowErrors) == 0 {
			key := code + "\x1f" + strconv.Itoa(year) + "\x1f" + geography
			if seen[key] {
				rowErrors = append(rowErrors, Issue{Row: row.Number, Code: "duplicate_key",
					Detail: code + " / " + strconv.Itoa(year) + " / " + geography})
			} else {
				seen[key] = true
			}
		}
		if len(rowErrors) > 0 {
			for _, issue := range rowErrors {
				pushError(issue)
			}
			continue
		}
		category := cell(row.Cells, FieldCategory)
		if category == "" {
			pushWarning(Issue{Row: row.Number, Code: "category_empty"})
		}
		if len(knownUnits) > 0 && !knownUnits[unit] {
			pushWarning(Issue{Row: row.Number, Code: "unit_unknown", Detail: unit})
		}
		valid := ValidRow{
			Row: row.Number, FactorCode: code, Year: year, Geography: geography, Scope: scope,
			Category: category, InputUnit: unit, CO2e: co2e, CH4: ch4, N2O: n2o, HFC: hfc,
			PFC: pfc, SF6: sf6, NF3: nf3, Biogenic: biogenic, GWP: gwp,
			NameZH: nameZH, NameEN: nameEN,
			DescriptionZH: cell(row.Cells, FieldDescZH), DescriptionEN: cell(row.Cells, FieldDescEN),
			Notes: cell(row.Cells, FieldNotes), CitationURL: cell(row.Cells, FieldCitation),
		}
		out.Valid = append(out.Valid, valid)
		if len(out.Sample) < sampleSize {
			out.Sample = append(out.Sample, valid)
		}
	}
	out.ValidCount = len(out.Valid)
	return out
}

func pad5(n int) string {
	text := strconv.Itoa(n)
	for len(text) < 5 {
		text = "0" + text
	}
	return text
}
