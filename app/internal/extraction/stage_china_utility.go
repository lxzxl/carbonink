package extraction

import (
	"encoding/json"
)

// chinaUtilitySchema mirrors the 1.x zod schema: the shape is strict and every
// key is present, while values stay permissive so the model can admit that a
// field was not legible instead of inventing one.
const chinaUtilitySchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["doc_type", "supplier_name", "account_no", "amount_kwh", "amount_yuan",
    "period_start", "period_end", "confidence"],
  "properties": {
    "doc_type": {"const": "china_utility"},
    "supplier_name": {"type": "string",
      "description": "Utility company name, e.g. 国网XX供电公司. Empty string if not legible."},
    "account_no": {"type": ["string", "null"],
      "description": "User account number (户号), or null."},
    "amount_kwh": {"type": "number", "minimum": 0,
      "description": "Energy consumption in kWh (度). 0 if not legible."},
    "amount_yuan": {"type": ["number", "null"], "minimum": 0,
      "description": "Total bill amount in CNY (应收合计). Number only, no symbols. null if absent."},
    "period_start": {"type": "string",
      "description": "Billing period start as YYYY-MM-DD. Empty string if not legible."},
    "period_end": {"type": "string",
      "description": "Billing period end as YYYY-MM-DD. Empty string if not legible."},
    "confidence": {"type": "string", "enum": ["high", "medium", "low"],
      "description": "high: all four key fields clearly visible. medium: 1-2 inferred. low: not a Chinese utility bill, or text unreadable."}
  }
}`

const chinaUtilityFieldRules = `Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no ` + "```" + `json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date fields are strings in ISO format "YYYY-MM-DD".
- If a value is genuinely missing on the bill, use null ONLY for the
  fields explicitly marked nullable (account_no, amount_yuan). Never omit
  a key. Never use null for required fields — emit a best-guess instead
  with confidence='low'.

Field mapping (Chinese bills follow regional variations):
- doc_type: always "china_utility" — even if the bill looks unusual,
  the user already classified it; you're confirming + extracting.
- supplier_name: the issuing utility, e.g. "国网北京市电力公司",
  "南方电网XX供电局". Take the most specific company name visible.
- account_no: "户号" / "用户编号" / "客户编号". null if not shown.
- amount_kwh: numeric kWh consumption.
  - "用电量" / "电量" / "实用电量" → kWh value
  - If shown as "度", that IS kWh (1 度 = 1 kWh)
  - If shown as "万度", multiply by 10000
- amount_yuan: total billed amount in CNY.
  - "应收合计" / "本月电费" / "实收金额" / "总金额"
  - Number only (no "¥" / "元"). null if absent.
- period_start / period_end:
  - "计费起止" / "用电期间" / "抄表日期" gives the range.
  - "上次抄表日期" → period_start, "本次抄表日期" → period_end.
  - Format as ISO YYYY-MM-DD. If only year-month shown ("2025-09"),
    assume first/last day of month.
- confidence:
  - "high" if supplier_name, amount_kwh, period_start, period_end are
    all clearly visible and unambiguous.
  - "medium" if one of those was inferred or partially obscured.
  - "low" if the document doesn't look like a Chinese utility bill at
    all, or multiple required fields are guesses.

Example valid response shape (do not copy the values — extract from the
real bill above):
{"doc_type":"china_utility","supplier_name":"国网北京市电力公司","account_no":"1234567890","amount_kwh":523.5,"amount_yuan":312.7,"period_start":"2025-09-01","period_end":"2025-09-30","confidence":"high"}`

func init() {
	register(Stage{
		ID:          "china_utility.v1",
		Version:     "1.0.0",
		Description: "Chinese electricity bill (国网/南方电网 风格) — classify + extract",
		Schema:      json.RawMessage(chinaUtilitySchema),
		BuildPrompt: func(pdfText string) string {
			return `
You are extracting structured data from a Chinese electricity utility bill (中国电费单).

Bill text (extracted from PDF):
<bill>
` + pdfText + `
</bill>

` + chinaUtilityFieldRules
		},
		BuildVisionMessages: func() VisionMessages {
			return VisionMessages{
				UserText: `You are extracting structured data from a Chinese electricity utility bill (中国电费单).

The bill is provided as one or more PNG images (one per PDF page) attached to this
message. Look at the images directly — do NOT request OCR text from another tool.

` + chinaUtilityFieldRules,
			}
		},
	})
}
