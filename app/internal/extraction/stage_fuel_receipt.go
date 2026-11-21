package extraction

import (
	"encoding/json"
)

// fuelReceiptSchema mirrors the 1.x zod schema. Two fields are nullable
// because pre-paid receipts hide unit price and walk-in customers often have
// no plate.
const fuelReceiptSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["doc_type", "supplier_name", "fuel_type", "fuel_category", "volume_l",
    "unit_price_yuan", "amount_yuan", "occurred_at", "license_plate", "confidence"],
  "properties": {
    "doc_type": {"const": "fuel_receipt"},
    "supplier_name": {"type": "string",
      "description": "Gas station / supplier name, e.g. 中国石化北京XX加油站, 中国石油. Empty string if not legible."},
    "fuel_type": {"type": "string",
      "description": "Fuel label exactly as printed: 92#汽油, 0#柴油, LPG, etc. Empty string if not legible."},
    "fuel_category": {"type": "string",
      "enum": ["gasoline", "diesel", "lpg", "cng", "jet_fuel", "marine_fuel", "biofuel", "other"],
      "description": "Coarse bucket driving emission-factor lookup. Unknown or non-fuel -> other."},
    "volume_l": {"type": "number", "minimum": 0,
      "description": "Fuel volume in liters. 0 if not legible. Convert m3 or kg with a reasonable density estimate and set confidence=medium."},
    "unit_price_yuan": {"type": ["number", "null"], "minimum": 0,
      "description": "Per-liter price in CNY. null if not shown."},
    "amount_yuan": {"type": "number", "minimum": 0,
      "description": "Total amount paid in CNY. 0 if not legible."},
    "occurred_at": {"type": "string",
      "description": "Date of fueling as YYYY-MM-DD. Empty string if not legible."},
    "license_plate": {"type": ["string", "null"],
      "description": "License plate of the fueled vehicle, e.g. 京A12345. null if absent."},
    "confidence": {"type": "string", "enum": ["high", "medium", "low"],
      "description": "high: supplier, category, volume, amount and date clearly visible. medium: 1-2 inferred or a unit conversion applied. low: not a fuel receipt, category=other, or several guesses."}
  }
}`

const fuelReceiptFieldRules = `Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no ` + "```" + `json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date fields are strings in ISO format "YYYY-MM-DD".
- If a value is genuinely missing on the receipt, use null ONLY for the
  two fields explicitly marked nullable (unit_price_yuan, license_plate).
  Never omit a key. Never use null for required fields — emit a
  best-guess instead with confidence='low'.

Field mapping (Chinese receipts follow regional variations):
- doc_type: always "fuel_receipt".
- supplier_name: the issuing gas station / supplier, e.g.
  "中国石化北京XX加油站", "中国石油第N加油站", or just "中国石化".
- fuel_type: the fuel label EXACTLY as printed on the receipt
  ("92#汽油", "95#汽油", "0#柴油", "-10#柴油", "LPG", "天然气", etc.).
  Empty string if not legible.
- fuel_category: coarse 8-bucket classification driving EF lookup.
  - gasoline:    92#/95#/98#/乙醇汽油/任何带 "汽油" 字样
  - diesel:      0#/-10#/-35#/任何带 "柴油" 字样
  - lpg:         "液化石油气" / "LPG" / "液化气"
  - cng:         "压缩天然气" / "CNG" / "天然气" (vehicle-fueling context)
  - jet_fuel:    "航空煤油" / "Jet A-1" / aviation
  - marine_fuel: "船用燃料油" / "船用柴油" / marine
  - biofuel:     "B5" / "B20" / "生物柴油" / biodiesel
  - other:       anything you can't confidently bucket above; also set
                 confidence='low' when you choose this.
- volume_l: numeric liters.
  - "升" / "L" / "公升" → liters directly.
  - "m³" (CNG by volume) → convert with density (CNG ~0.74 kg/m³ → no
    direct liter equivalent; report the m³ value AS IF it were liters
    and set confidence='medium' with the warning that volume_l is
    actually m³).
  - "kg" (LPG sometimes) → divide by ~0.54 kg/L (LPG density) and set
    confidence='medium'.
- unit_price_yuan: numeric CNY per liter ("单价" / "元/升"). null if not
  shown.
- amount_yuan: total CNY paid ("金额" / "实付" / "合计"). Number only
  (no "¥" / "元"). 0 if not legible.
- occurred_at: date as ISO YYYY-MM-DD. If only year-month shown
  ("2026-04"), assume the 15th. Fueling is a single-point event — set
  this to the receipt's printed date.
- license_plate: Chinese plate format ("京A12345", "粤B·12345", etc.).
  null if absent.
- confidence:
  - "high" if supplier_name, fuel_category, volume_l, amount_yuan, and
    occurred_at are all clearly visible and unambiguous.
  - "medium" if one was inferred OR a unit conversion was applied
    (m³ → L, kg → L).
  - "low" if the document doesn't look like a fuel receipt at all, OR
    fuel_category=other, OR multiple required fields are guesses.

Ignore (DO NOT include in the output): mileage, vehicle make, VIN,
fapiao receipt number, payment method (cash/card/QR), cashier id,
membership points.

Example valid response shape (do not copy values — extract from the
real receipt):
{"doc_type":"fuel_receipt","supplier_name":"中国石化北京加油站","fuel_type":"92#汽油","fuel_category":"gasoline","volume_l":38.5,"unit_price_yuan":7.85,"amount_yuan":302.23,"occurred_at":"2026-04-15","license_plate":"京A12345","confidence":"high"}`

func init() {
	register(Stage{
		ID:          "fuel_receipt.v1",
		Version:     "1.0.0",
		Description: "Chinese fuel receipt (加油单据) — classify + extract",
		Schema:      json.RawMessage(fuelReceiptSchema),
		BuildPrompt: func(pdfText string) string {
			return `
You are extracting structured data from a Chinese fuel receipt (加油单据).

Receipt text (extracted from PDF):
<receipt>
` + pdfText + `
</receipt>

` + fuelReceiptFieldRules
		},
		BuildVisionMessages: func() VisionMessages {
			return VisionMessages{
				UserText: `You are extracting structured data from a Chinese fuel receipt (加油单据).

The receipt is provided as one or more PNG images (one per PDF page) attached to this
message. Look at the images directly — do NOT request OCR text from another tool.

If the PDF shows multiple receipts batched together (gas stations sometimes do this),
extract the most prominent / largest one and set confidence='low'.

` + fuelReceiptFieldRules,
			}
		},
	})
}
