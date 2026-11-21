// Package inbound owns the supplier disclosure flow: the Cat 1 template, the
// fillable workbook we send out, the parser for the reply, and the tier
// selection that turns a reply into an inventory row.
package inbound

// TemplateKind is the 1.x template identifier; it is stored on the
// questionnaire row and embedded in the workbook's sentinel sheet.
const TemplateKind = "cat1_supplier_disclosure"

// TemplateVersion must match the sentinel written into every workbook.
const TemplateVersion = "1.0"

// Workbook layout constants. Changing a cell ref or sentinel key invalidates
// workbooks already in flight.
const (
	sentinelSheet = "__sentinels"
	coverSheet    = "封面 Cover"
	notesColumn   = "C"

	sentinelTemplateKind  = "__carbonink.template_kind"
	sentinelVersion       = "__carbonink.template_version"
	sentinelQuestionnaire = "__carbonink.questionnaire_id"
	sentinelPeriod        = "__carbonink.expected_period"
)

// Question is one template position: where it lives in the workbook and how
// its answer should be read.
type Question struct {
	Position     string
	Tier         int
	Kind         string
	RawZH        string
	RawEN        string
	ExpectedUnit string
	CellRef      string
}

// Template is one disclosure form and its fixed question set.
type Template struct {
	Kind      string
	Version   string
	Scope     int
	Category  string
	Questions []Question
}

// Cat1 is the GHG Protocol Scope 3 Category 1 supplier disclosure: three
// metadata rows, one Tier 1 per-product footprint, and the Tier 2 trio.
var Cat1 = Template{
	Kind:     TemplateKind,
	Version:  TemplateVersion,
	Scope:    3,
	Category: "purchased_goods",
	Questions: []Question{
		{Position: "meta.1", Kind: "narrative", CellRef: "metadata!B5",
			RawZH: "请填写贵公司法定名称（与营业执照一致）。",
			RawEN: "Please enter your company's legal name (matching business license)."},
		{Position: "meta.2", Kind: "narrative", CellRef: "metadata!B7",
			RawZH: "本次填报对应的报告期。我方采购报告期为 {{period_year}} 年，请填写贵公司对应的报告期（例如 2025 自然年、2024 财年）。",
			RawEN: "Reporting period this disclosure covers. Our purchase period: {{period_year}}. Please enter your company’s corresponding reporting period (e.g. 2025 calendar year, FY2024)."},
		{Position: "meta.3", Kind: "categorical", CellRef: "metadata!B9",
			RawZH: "贵公司是否已编制正式的温室气体清单？请填写：无 / 自行核算未审 / 第三方核证 / 已取得 ISO 14064 / 其他。",
			RawEN: "Does your company maintain a formal GHG inventory? Please choose: None / Self-reported, unverified / Third-party verified / ISO 14064 certified / Other."},
		{Position: "tier1.1", Tier: 1, Kind: "numerical", ExpectedUnit: "kgCO2e/kg",
			CellRef: "tier1!B5",
			RawZH:   "贵公司供给我方产品的单位碳足迹（kgCO2e/kg 产品）。如有第三方 PCF 报告，请将文件作为附件一并发回，并在备注列注明文件名。",
			RawEN:   "Per-kg product carbon footprint of goods supplied to us (kgCO2e/kg). If a third-party PCF report exists, please attach it to your reply email and note the filename in the comment column."},
		{Position: "tier2.1", Tier: 2, Kind: "numerical", ExpectedUnit: "kgCO2e",
			CellRef: "tier2!B5",
			RawZH:   "贵公司报告期内 Scope 1 + Scope 2 排放总量（kgCO2e）。",
			RawEN:   "Your company's total Scope 1 + Scope 2 emissions for the reporting period (kgCO2e)."},
		{Position: "tier2.2", Tier: 2, Kind: "categorical", CellRef: "tier2!B7",
			RawZH: "排放归因方法（按质量份额 / 按经济价值 / 按物理量 / 其他）。",
			RawEN: "Allocation method (mass-based / economic / physical / other)."},
		{Position: "tier2.3", Tier: 2, Kind: "numerical", ExpectedUnit: "kgCO2e",
			CellRef: "tier2!B9",
			RawZH:   "按上述分配方法归因于我方采购的排放量（kgCO2e）。",
			RawEN:   "Emissions attributable to our purchase (kgCO2e), per the allocation method above."},
	},
}

// TemplateByKind resolves a stored template kind.
func TemplateByKind(kind string) (Template, bool) {
	if kind == Cat1.Kind {
		return Cat1, true
	}
	return Template{}, false
}

// QuestionByPosition finds one template position.
func (t Template) QuestionByPosition(position string) (Question, bool) {
	for _, q := range t.Questions {
		if q.Position == position {
			return q, true
		}
	}
	return Question{}, false
}

// included returns the template questions named by positions, in template
// order. An empty selection means every question.
func (t Template) included(positions []string) []Question {
	if len(positions) == 0 {
		return append([]Question(nil), t.Questions...)
	}
	wanted := make(map[string]bool, len(positions))
	for _, position := range positions {
		wanted[position] = true
	}
	out := make([]Question, 0, len(positions))
	for _, q := range t.Questions {
		if wanted[q.Position] {
			out = append(out, q)
		}
	}
	return out
}

// signature is the stable cross-questionnaire key for one template position.
func signature(version, position string) string {
	return "inbound:" + TemplateKind + ":" + version + ":" + position
}
