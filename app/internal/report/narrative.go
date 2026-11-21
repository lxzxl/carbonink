package report

// Narrative is the six-section ISO 14064-1 body.
type Narrative struct {
	BoundaryDescription    string `json:"boundary_description"`
	ReportingBoundary      string `json:"reporting_boundary_description"`
	MethodologyDescription string `json:"methodology_description"`
	EmissionsSummary       string `json:"emissions_summary"`
	SignificantChanges     string `json:"significant_changes"`
	NotableObservations    string `json:"observations"`
}

// TCFDNarrative is the four-pillar TCFD body.
type TCFDNarrative struct {
	Governance     string `json:"governance"`
	Strategy       string `json:"strategy"`
	RiskManagement string `json:"risk_management"`
	MetricsTargets string `json:"metrics_targets"`
}

const isoPromptDescription = "Save the ISO 14064-1 report narrative."

const isoSchema = `{
  "type": "object",
  "required": ["boundary_description", "reporting_boundary_description",
               "methodology_description", "emissions_summary",
               "significant_changes", "observations"],
  "additionalProperties": false,
  "properties": {
    "boundary_description": {"type": "string", "minLength": 50, "maxLength": 800},
    "reporting_boundary_description": {"type": "string", "minLength": 50, "maxLength": 800},
    "methodology_description": {"type": "string", "minLength": 100, "maxLength": 1200},
    "emissions_summary": {"type": "string", "minLength": 100, "maxLength": 1500},
    "significant_changes": {"type": "string", "minLength": 20, "maxLength": 800},
    "observations": {"type": "string", "minLength": 50, "maxLength": 800}
  }
}`

const tcfdPromptDescription = "Save the TCFD report narrative."

const tcfdSchema = `{
  "type": "object",
  "required": ["governance", "strategy", "risk_management", "metrics_targets"],
  "additionalProperties": false,
  "properties": {
    "governance": {"type": "string", "minLength": 80, "maxLength": 1200},
    "strategy": {"type": "string", "minLength": 80, "maxLength": 1500},
    "risk_management": {"type": "string", "minLength": 80, "maxLength": 1200},
    "metrics_targets": {"type": "string", "minLength": 100, "maxLength": 1500}
  }
}`

func isoSystemPrompt(language string) string {
	if language == "zh-CN" {
		return `你是 ISO 14064-1:2018 GHG 盘查报告撰稿人。严格遵循以下规则:

1. 你只能使用 <inventory> 块中提供的数字与名称。任何 <inventory> 中不存在的事实, 一律写 "本期未评估"。严禁推测、补充或虚构。
2. 不要在文本中改动 <inventory> 给出的数字 (允许换算单位时另当别论)。
3. 语气专业、克制、不夸张。每个 section 250-450 字之间。
4. 边界方法措辞: equity_share → "股权法"; financial_control → "财务控制法"; operational_control → "运营控制法"。
5. 排放因子来源信息若 <inventory> 提供, 在 methodology_description 中必须披露 GWP 基准 (AR5 / AR6)。
6. 输出必须是 JSON, 完全符合给定 schema, 不要添加 schema 外的字段。`
	}
	return `You are an ISO 14064-1:2018 GHG inventory report writer. Strict rules:

1. You may only use numbers and names from the <inventory> block. For any fact not present in <inventory>, write "Not assessed in this inventory". No speculation, no extrapolation, no fabrication.
2. Do not alter numbers from <inventory> (unit conversion is allowed when explicit).
3. Tone: professional, restrained, never promotional. Each section 250-450 words.
4. Boundary phrasing: equity_share → "equity share"; financial_control → "financial control"; operational_control → "operational control".
5. If <inventory> includes EF source provenance, the methodology_description must disclose the GWP basis (AR5 / AR6).
6. Output must be JSON matching the schema exactly, no extra fields.`
}

func tcfdSystemPrompt(language string) string {
	if language == "zh-CN" {
		return `你是气候相关财务信息披露 (TCFD) 报告撰稿人, 为一家企业撰写四支柱披露: 治理 (governance)、战略 (strategy)、风险管理 (risk_management)、指标与目标 (metrics_targets)。严格遵循以下规则:

1. 你只能使用 <inventory> 块中提供的数字与名称。任何 <inventory> 中不存在的事实, 一律写 "本期未评估"。严禁推测、补充或虚构。
2. 不要在文本中改动 <inventory> 给出的数字。
3. <inventory> 只包含温室气体盘查数据。气候风险、机遇、情景分析、内部碳价若无数据, 相应段落写 "本期未开展定量评估", 并克制地说明四支柱框架下该披露项的含义与后续完善方向——不要编造任何情景或风险量化结果。
4. metrics_targets 必须引用 <inventory> 的范围一/二/三合计与主要排放源, 并披露排放因子的 GWP 基准 (AR5 / AR6); 若有基准年或上期数据, 须给出对比。
5. 语气专业、克制、不夸张。每段 250-500 字。
6. 输出必须是 JSON, 完全符合给定 schema, 不要添加 schema 外的字段。`
	}
	return `You are a TCFD (Task Force on Climate-related Financial Disclosures) report writer producing the four pillars: governance, strategy, risk_management, metrics_targets. Strict rules:

1. You may only use numbers and names from the <inventory> block. For any fact not present in <inventory>, write "Not assessed in this period". No speculation, no extrapolation, no fabrication.
2. Do not alter numbers from <inventory>.
3. <inventory> contains GHG inventory data only. Where climate risks, opportunities, scenario analysis, or internal carbon pricing have no data, the section must state "No quantitative assessment was performed this period" and soberly explain what that TCFD disclosure covers and how it could be developed — never invent scenarios or risk quantifications.
4. metrics_targets must cite the Scope 1/2/3 totals and main emission sources from <inventory>, disclose the GWP basis (AR5 / AR6), and compare against the base year or prior period when present.
5. Tone: professional, restrained, never promotional. Each section 250-500 words.
6. Output must be JSON matching the schema exactly, no extra fields.`
}
