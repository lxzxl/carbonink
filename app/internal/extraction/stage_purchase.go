package extraction

import (
	"encoding/json"
)

// purchaseSchema mirrors the 1.x zod schema. A multi-line invoice is
// aggregated into one row; quantity is null when any line uses a non-weight
// unit.
const purchaseSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["doc_type", "supplier_name", "item_description", "category",
    "quantity_kg", "amount_yuan", "occurred_at", "invoice_no", "confidence"],
  "properties": {
    "doc_type": {"const": "purchase"},
    "supplier_name": {"type": "string",
      "description": "Seller / vendor name (the entity that issued the invoice). Empty string if not legible."},
    "item_description": {"type": "string",
      "description": "Free-text description from the 货物或应税劳务、服务名称 column. Concatenate the top items with ' / '. Empty string if not legible."},
    "category": {"type": "string",
      "enum": ["raw_material", "component", "consumable", "office_supply", "service", "other"],
      "description": "Coarse 6-bucket classification driving EF lookup. other lowers confidence."},
    "quantity_kg": {"type": ["number", "null"], "minimum": 0,
      "description": "Total quantity in KILOGRAMS, only when the invoice gives an explicit weight. null for non-weight units or services."},
    "amount_yuan": {"type": "number", "minimum": 0,
      "description": "Total invoiced amount in CNY including VAT. 0 if not legible."},
    "occurred_at": {"type": "string",
      "description": "Invoice date as YYYY-MM-DD. Empty string if not legible."},
    "invoice_no": {"type": ["string", "null"],
      "description": "Invoice number (发票号码), usually 8 digits. null if absent."},
    "confidence": {"type": "string", "enum": ["high", "medium", "low"],
      "description": "high: supplier, category, amount and date clearly visible, single dominant item type. medium: multi-line aggregation or unit conversion. low: not a purchase invoice, category=other, or several guesses."}
  }
}`

const purchaseFieldRules = `Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no ` + "```" + `json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date fields are strings in ISO format "YYYY-MM-DD".
- If a value is genuinely missing on the invoice, use null ONLY for the
  two fields explicitly marked nullable (quantity_kg, invoice_no).
  Never omit a key. Never use null for required fields — emit a
  best-guess instead with confidence='low'.

Multi-line invoices: many Chinese purchase invoices show several line
items (different SKUs on one invoice). When that happens, aggregate
(AGGREGATE) them into a single row:
  - item_description: concatenate the top 2-3 most prominent items
    with " / " separators (e.g. "热轧钢板 5mm / 冷轧钢板 3mm").
  - category: pick the dominant category (the one matching most line
    items by value). If genuinely mixed, use 'other' + confidence='low'.
  - quantity_kg: sum the kg quantities across lines. If some lines use
    non-weight units, leave quantity_kg=null entirely (don't partial-sum).
  - amount_yuan: total invoice amount ("价税合计").
  - Set confidence='medium' for any multi-line aggregation.

Field mapping:
- doc_type: always "purchase".
- supplier_name: the SELLER (the entity that issued the invoice). E.g.
  "宝山钢铁股份有限公司" / "深圳市XX电子有限公司" / "京东商城".
- item_description: free-text item name(s) from the "货物或应税劳务、
  服务名称" column. Verbatim as printed (Chinese characters preserved).
- category: 6-bucket classification.
  - raw_material:  钢 / 塑料粒子 / 化工原料 / 木材 / 纸浆 / 金属原料
  - component:     PCB / 紧固件 / 阀门 / 模具 / 半成品 / 装配件
  - consumable:    包装材料 / 印刷品 / 防护用品 / 工业耗材
  - office_supply: 文具 / 办公设备 / 办公耗材 / 家具
  - service:       咨询 / 维修 / 设计 / 软件订阅 / 培训 / 法律服务
  - other:         cannot confidently bucket (e.g. mixed multi-line),
                   also set confidence='low'.
- quantity_kg: numeric KILOGRAMS, ONLY if invoice has explicit weight.
  - "千克" / "kg" / "公斤" → direct.
  - "吨" / "T" → multiply by 1000.
  - "克" / "g" → divide by 1000.
  - "件" / "支" / "套" / "张" / "项" / "月" / "年" → null (NOT a weight).
  - Service categories → null.
- amount_yuan: numeric CNY total ("价税合计" / "Total" / "应付金额").
  Number only, no "¥" / "元" / "CNY". 0 if not legible.
- occurred_at: invoice date ("开票日期") as ISO YYYY-MM-DD. If only
  year-month shown ("2026-04"), assume the 15th. Empty string if not
  legible.
- invoice_no: invoice number ("发票号码" — usually 8 digits on
  增值税专用发票). null if absent.
- confidence:
  - "high" if supplier_name, category, amount_yuan, occurred_at are all
    clearly visible AND single dominant item type.
  - "medium" if multi-line aggregation was applied, OR a unit conversion
    (吨 → kg) was applied, OR 1-2 fields were inferred.
  - "low" if the document doesn't look like a purchase invoice at all,
    OR multiple required fields are guesses, OR category=other.

Ignore (DO NOT include in the output): VAT breakdown (税额 / 税率),
payment terms, buyer info (买方名称 / 纳税人识别号 — that's the user's
own org), customs declaration code, line-level discounts, freight
charges that appear as a separate invoice line (that's a freight stage
concern, not purchase), bank account info.

Example valid response shape (do not copy values — extract from the
real invoice):
{"doc_type":"purchase","supplier_name":"宝山钢铁股份有限公司","item_description":"热轧钢板 5mm / 冷轧钢板 3mm","category":"raw_material","quantity_kg":7500,"amount_yuan":48650,"occurred_at":"2026-04-22","invoice_no":"12345678","confidence":"medium"}`

func init() {
	register(Stage{
		ID:          "purchase.v1",
		Version:     "1.0.0",
		Description: "Chinese purchase invoice (采购发票) — classify + extract",
		Schema:      json.RawMessage(purchaseSchema),
		BuildPrompt: func(pdfText string) string {
			return `
You are extracting structured data from a Chinese purchase invoice (采购发票 / 增值税专用发票 / 商业发票).

Invoice text (extracted from PDF):
<invoice>
` + pdfText + `
</invoice>

` + purchaseFieldRules
		},
		BuildVisionMessages: func() VisionMessages {
			return VisionMessages{
				UserText: `You are extracting structured data from a Chinese purchase invoice (采购发票 / 增值税专用发票 / 商业发票).

The invoice is provided as one or more PNG images (one per PDF page) attached to this
message. Look at the images directly — do NOT request OCR text from another tool.

If the PDF shows multiple invoices batched together (rare — usually one invoice per
PDF), extract the most prominent / first one and set confidence='low'.

` + purchaseFieldRules,
			}
		},
	})
}
