// Package inbound owns the supplier disclosure flow: the Scope 3 templates,
// the fillable workbook we send out, the parser for the reply, and the tier
// selection that turns a reply into an inventory row.
package inbound

import (
	"strings"

	"app.carbonink.desktop/internal/store"
)

// Built-in inbound disclosure template kinds. TemplateKind aliases
// TemplateCat1 for 1.x callers.
const (
	TemplateCat1 = "cat1_supplier_disclosure"
	TemplateCat4 = "cat4_upstream_transport"
	TemplateCat5 = "cat5_waste_generated"
	TemplateCat6 = "cat6_business_travel"

	TemplateKind          = TemplateCat1
	TemplateVersion       = "2.0"
	LegacyTemplateVersion = "1.0"
)

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

// Template is one disclosure form and its question set.
type Template struct {
	ID              string
	Custom          bool
	Kind            string
	Version         string
	Scope           int
	Category        string
	GHGProtocolPath string
	EFCategory      string
	LabelZH         string
	LabelEN         string
	SourceSuffixEN  string
	Tier1Unit       string
	DefaultUnit     string
	Questions       []Question
}

// FromStoreTemplate converts a persisted user-authored template into an
// inbound Template ready for workbook rendering, parsing, and ingestion.
func FromStoreTemplate(st store.InboundTemplate) Template {
	qs := make([]Question, 0, len(st.Questions))
	for _, q := range st.Questions {
		qs = append(qs, Question{
			Position:     q.Position,
			Tier:         q.Tier,
			Kind:         q.Kind,
			RawZH:        q.RawZH,
			RawEN:        q.RawEN,
			ExpectedUnit: q.ExpectedUnit,
			CellRef:      q.CellRef,
		})
	}
	suffix := strings.ReplaceAll(strings.TrimSpace(st.Category), "_", " ")
	if suffix == "" {
		suffix = "purchased goods"
	}
	return Template{
		ID:              st.ID,
		Custom:          true,
		Kind:            st.Kind,
		Version:         TemplateVersion,
		Scope:           st.Scope,
		Category:        st.Category,
		GHGProtocolPath: st.GHGProtocolPath,
		EFCategory:      st.EFCategory,
		LabelZH:         st.LabelZH,
		LabelEN:         st.LabelEN,
		SourceSuffixEN:  suffix,
		Tier1Unit:       st.Tier1Unit,
		DefaultUnit:     st.DefaultUnit,
		Questions:       qs,
	}
}

func metaQuestions() []Question {
	return []Question{
		{Position: "meta.1", Kind: "narrative", CellRef: "metadata!B5",
			RawZH: "请填写贵公司法定名称（与营业执照一致）。",
			RawEN: "Please enter your company's legal name (matching business license)."},
		{Position: "meta.2", Kind: "narrative", CellRef: "metadata!B7",
			RawZH: "本次填报对应的报告期。我方采购报告期为 {{period_year}} 年，请填写贵公司对应的报告期（例如 2025 自然年、2024 财年）。",
			RawEN: "Reporting period this disclosure covers. Our purchase period: {{period_year}}. Please enter your company’s corresponding reporting period (e.g. 2025 calendar year, FY2024)."},
		{Position: "meta.3", Kind: "categorical", CellRef: "metadata!B9",
			RawZH: "贵公司是否已编制正式的温室气体清单？请填写：无 / 自行核算未审 / 第三方核证 / 已取得 ISO 14064 / 其他。",
			RawEN: "Does your company maintain a formal GHG inventory? Please choose: None / Self-reported, unverified / Third-party verified / ISO 14064 certified / Other."},
	}
}

func tier2Questions(scopeZH, scopeEN string) []Question {
	return []Question{
		{Position: "tier2.1", Tier: 2, Kind: "numerical", ExpectedUnit: "kgCO2e",
			CellRef: "tier2!B5",
			RawZH:   "贵公司报告期内 Scope 1 + Scope 2 排放总量（kgCO2e）。",
			RawEN:   "Your company's total Scope 1 + Scope 2 emissions for the reporting period (kgCO2e)."},
		{Position: "tier2.2", Tier: 2, Kind: "categorical", CellRef: "tier2!B7",
			RawZH: "排放归因方法（按质量份额 / 按经济价值 / 按物理量 / 其他）。",
			RawEN: "Allocation method (mass-based / economic / physical / other)."},
		{Position: "tier2.3", Tier: 2, Kind: "numerical", ExpectedUnit: "kgCO2e",
			CellRef: "tier2!B9",
			RawZH:   "按上述分配方法归因于" + scopeZH + "的排放量（kgCO2e）。",
			RawEN:   "Emissions attributable to " + scopeEN + " (kgCO2e), per the allocation method above."},
	}
}

func tier3Questions(descZH, descEN, qtyZH, qtyEN, unitZH, unitEN, defaultUnit string) []Question {
	return []Question{
		{Position: "tier3.1", Tier: 3, Kind: "narrative", CellRef: "tier3!B5",
			RawZH: descZH,
			RawEN: descEN},
		{Position: "tier3.2", Tier: 3, Kind: "numerical", ExpectedUnit: defaultUnit, CellRef: "tier3!B7",
			RawZH: qtyZH,
			RawEN: qtyEN},
		{Position: "tier3.3", Tier: 3, Kind: "categorical", CellRef: "tier3!B9",
			RawZH: unitZH,
			RawEN: unitEN},
	}
}

func buildTemplate(t Template, tier1 Question, scopeZH, scopeEN string, tier3 []Question) Template {
	qs := make([]Question, 0, 10)
	qs = append(qs, metaQuestions()...)
	qs = append(qs, tier1)
	qs = append(qs, tier2Questions(scopeZH, scopeEN)...)
	qs = append(qs, tier3...)
	t.Questions = qs
	return t
}

// Cat1 is the GHG Protocol Scope 3 Category 1 supplier disclosure.
var Cat1 = buildTemplate(
	Template{
		Kind:            TemplateCat1,
		Version:         TemplateVersion,
		Scope:           3,
		Category:        "purchased_goods",
		GHGProtocolPath: "scope3.cat1_purchased_goods",
		EFCategory:      "purchase",
		LabelZH:         "Scope 3 Cat 1 · 外购商品与服务",
		LabelEN:         "Scope 3 Cat 1 · Purchased Goods & Services",
		SourceSuffixEN:  "purchased goods",
		Tier1Unit:       "kg",
		DefaultUnit:     "kg",
	},
	Question{Position: "tier1.1", Tier: 1, Kind: "numerical", ExpectedUnit: "kgCO2e/kg",
		CellRef: "tier1!B5",
		RawZH:   "贵公司供给我方产品的单位碳足迹（kgCO2e/kg 产品）。如有第三方 PCF 报告，请将文件作为附件一并发回，并在备注列注明文件名。",
		RawEN:   "Per-kg product carbon footprint of goods supplied to us (kgCO2e/kg). If a third-party PCF report exists, please attach it to your reply email and note the filename in the comment column."},
	"我方采购", "our purchase",
	tier3Questions(
		"若无 Tier 1/2 数据，请描述供给我方的主要产品、原材料或服务类别（如 原生钢材 / 办公用纸 / 咨询服务）。",
		"If Tier 1/2 data is unavailable, describe the primary product, material, or service supplied to us (e.g. primary steel / office paper / consulting).",
		"报告期内供给我方的数量或采购金额（仅填数值）。",
		"Quantity or spend supplied to us during the reporting period (numeric value only).",
		"上述数量对应的计量单位（如 kg / t / CNY）。",
		"Unit for the quantity above (e.g. kg / t / CNY).",
		"kg",
	),
)

// Cat4 is the GHG Protocol Scope 3 Category 4 upstream transportation disclosure.
var Cat4 = buildTemplate(
	Template{
		Kind:            TemplateCat4,
		Version:         TemplateVersion,
		Scope:           3,
		Category:        "upstream_transport",
		GHGProtocolPath: "scope3.cat4_upstream_transportation",
		EFCategory:      "freight",
		LabelZH:         "Scope 3 Cat 4 · 上游运输与配送",
		LabelEN:         "Scope 3 Cat 4 · Upstream Transportation",
		SourceSuffixEN:  "upstream transport",
		Tier1Unit:       "tkm",
		DefaultUnit:     "tkm",
	},
	Question{Position: "tier1.1", Tier: 1, Kind: "numerical", ExpectedUnit: "kgCO2e/tkm",
		CellRef: "tier1!B5",
		RawZH:   "贵公司为我方提供上游运输服务的单位碳排放强度（kgCO2e/tkm）。如有第三方核证方法说明，请附回并注明文件名。",
		RawEN:   "Per-tonne-km emission intensity of upstream freight provided to us (kgCO2e/tkm). Attach supporting verification if available and note the filename."},
	"我方上游运输", "our upstream transport",
	tier3Questions(
		"若无 Tier 1/2 数据，请填写主要运输方式及车型（如 重型柴油货车 / 铁路货运 / 海运集装箱 / 空运）。",
		"If Tier 1/2 data is unavailable, describe the transport mode and vehicle class (e.g. heavy diesel truck / rail freight / sea container / air).",
		"报告期内承运我方货物的周转量（仅填数值）。",
		"Freight volume carried for us during the reporting period (numeric value only).",
		"上述周转量对应的计量单位（推荐 tkm）。",
		"Unit for the freight volume above (tkm recommended).",
		"tkm",
	),
)

// Cat5 is the GHG Protocol Scope 3 Category 5 waste generated in operations disclosure.
var Cat5 = buildTemplate(
	Template{
		Kind:            TemplateCat5,
		Version:         TemplateVersion,
		Scope:           3,
		Category:        "waste_generated",
		GHGProtocolPath: "scope3.cat5_waste_generated",
		EFCategory:      "",
		LabelZH:         "Scope 3 Cat 5 · 运营废弃物处理",
		LabelEN:         "Scope 3 Cat 5 · Waste Generated",
		SourceSuffixEN:  "waste generated",
		Tier1Unit:       "kg",
		DefaultUnit:     "kg",
	},
	Question{Position: "tier1.1", Tier: 1, Kind: "numerical", ExpectedUnit: "kgCO2e/kg",
		CellRef: "tier1!B5",
		RawZH:   "贵公司处置我方废弃物的单位碳排放强度（kgCO2e/kg 废弃物）。如有处理工艺说明或核证报告，请在备注列注明。",
		RawEN:   "Per-kg treatment emission intensity for waste received from us (kgCO2e/kg waste). Note any supporting report in the comment column."},
	"我方废弃物处置", "our waste treatment",
	tier3Questions(
		"若无 Tier 1/2 数据，请描述废弃物类别及处置方式（如 一般工业固废填埋 / 焚烧 / 回收再生 / 废水处理）。",
		"If Tier 1/2 data is unavailable, describe the waste stream and treatment method (e.g. landfill / incineration / recycling / wastewater treatment).",
		"报告期内接收处置的我方废弃物数量（仅填数值）。",
		"Quantity of our waste treated during the reporting period (numeric value only).",
		"上述数量对应的计量单位（如 kg / t）。",
		"Unit for the waste quantity above (e.g. kg / t).",
		"kg",
	),
)

// Cat6 is the GHG Protocol Scope 3 Category 6 business travel disclosure.
var Cat6 = buildTemplate(
	Template{
		Kind:            TemplateCat6,
		Version:         TemplateVersion,
		Scope:           3,
		Category:        "business_travel",
		GHGProtocolPath: "scope3.cat6_business_travel",
		EFCategory:      "travel",
		LabelZH:         "Scope 3 Cat 6 · 商务差旅与外包出行",
		LabelEN:         "Scope 3 Cat 6 · Business Travel",
		SourceSuffixEN:  "business travel",
		Tier1Unit:       "passenger_km",
		DefaultUnit:     "passenger_km",
	},
	Question{Position: "tier1.1", Tier: 1, Kind: "numerical", ExpectedUnit: "kgCO2e/passenger_km",
		CellRef: "tier1!B5",
		RawZH:   "贵公司为我方提供差旅或外包出行服务的单位碳排放强度（kgCO2e/人公里）。如有核算说明，请在备注列注明。",
		RawEN:   "Per-passenger-km emission intensity of travel services provided to us (kgCO2e/passenger_km). Note methodology details in the comment column."},
	"我方商务差旅", "our business travel",
	tier3Questions(
		"若无 Tier 1/2 数据，请填写主要出行方式及舱位/车型（如 国内高铁 / 短途经济舱 / 汽油出租车）。",
		"If Tier 1/2 data is unavailable, describe the travel mode and class (e.g. high-speed rail / short-haul economy flight / gasoline taxi).",
		"报告期内我方人员累计出行里程（仅填数值）。",
		"Total passenger distance for our travel during the reporting period (numeric value only).",
		"上述里程对应的计量单位（推荐 passenger_km）。",
		"Unit for the distance above (passenger_km recommended).",
		"passenger_km",
	),
)

var allTemplates = []Template{Cat1, Cat4, Cat5, Cat6}

// Templates returns every built-in supplier disclosure template in display order.
func Templates() []Template {
	return append([]Template(nil), allTemplates...)
}

// TemplateByKind resolves a stored template kind.
func TemplateByKind(kind string) (Template, bool) {
	for _, t := range allTemplates {
		if t.Kind == kind {
			return t, true
		}
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

// signatureFor is the stable cross-questionnaire key for one template position.
func signatureFor(kind, version, position string) string {
	return "inbound:" + kind + ":" + version + ":" + position
}

func signature(version, position string) string {
	return signatureFor(TemplateKind, version, position)
}
