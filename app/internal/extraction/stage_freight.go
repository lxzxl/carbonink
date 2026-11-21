package extraction

import (
	"encoding/json"
)

// freightSchema mirrors the 1.x zod schema. Four fields are nullable because
// they are commonly absent or mode-specific; distance is never estimated.
const freightSchema = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["doc_type", "supplier_name", "mode", "vehicle_class", "weight_kg",
    "volume_m3", "distance_km", "origin", "destination", "tracking_no",
    "amount_yuan", "occurred_at", "confidence"],
  "properties": {
    "doc_type": {"const": "freight"},
    "supplier_name": {"type": "string",
      "description": "Carrier / logistics provider name, e.g. 中远海运, 顺丰速运, 中铁集装箱. Empty string if not legible."},
    "mode": {"type": "string", "enum": ["road", "rail", "sea", "air"],
      "description": "road = trucks / vans / last-mile; rail = 铁路 / 中欧班列; sea = ocean container or bulk; air = air cargo."},
    "vehicle_class": {"type": ["string", "null"],
      "description": "Free-text within-mode subtype: 8 轴货车 / 冷链车 / 20ft 集装箱 / C70 / B777F. null if not legible."},
    "weight_kg": {"type": "number", "minimum": 0,
      "description": "Cargo gross weight in KILOGRAMS. Convert 吨/T by 1000. 0 if not legible."},
    "volume_m3": {"type": ["number", "null"], "minimum": 0,
      "description": "Cargo volume in cubic meters. null if absent."},
    "distance_km": {"type": ["number", "null"], "minimum": 0,
      "description": "Transport distance in kilometers, only when an explicit number appears on the receipt. Do NOT estimate from origin/destination."},
    "origin": {"type": "string",
      "description": "Origin / loading location, free-form. Empty string if not legible."},
    "destination": {"type": "string",
      "description": "Destination / unloading location, free-form. Empty string if not legible."},
    "tracking_no": {"type": ["string", "null"],
      "description": "Single tracking identifier: BL, container, train, road waybill or AWB number. null if absent."},
    "amount_yuan": {"type": "number", "minimum": 0,
      "description": "Total freight charges in CNY. 0 if not legible."},
    "occurred_at": {"type": "string",
      "description": "Shipment / loading date as YYYY-MM-DD. Use the loading date when both appear. Empty string if not legible."},
    "confidence": {"type": "string", "enum": ["high", "medium", "low"],
      "description": "high: all key fields clearly visible. medium: 1-2 inferred or a unit conversion. low: not freight, mode ambiguous, or several guesses."}
  }
}`

const freightFieldRules = `Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no ` + "```" + `json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date fields are strings in ISO format "YYYY-MM-DD".
- If a value is genuinely missing on the receipt, use null ONLY for the
  four fields explicitly marked nullable (vehicle_class, volume_m3,
  distance_km, tracking_no). Never omit a key. Never use null for
  required fields — emit a best-guess instead with confidence='low'.

Field mapping (Chinese freight documents follow many regional variations):
- doc_type: always "freight".
- supplier_name: the carrier / logistics provider, e.g.
  "中远海运" / "顺丰速运" / "中铁集装箱" / "DHL".
- mode: transport-mode discriminator (one of road/rail/sea/air):
  - road:  公路货车 / 卡车 / 货拉拉 / 顺丰快递 / 最后一公里
  - rail:  铁路 / 中欧班列 / X-list 班次
  - sea:   海运 / 集装箱 / 散货 / 港到港 / Bill of Lading (BL)
  - air:   航空货运 / 货机 / 客机腹舱 / Air Waybill (AWB)
  If multi-modal (e.g. 海铁联运), pick the dominant leg and set
  confidence='medium'.
- vehicle_class: free-text within-mode subtype.
  - road:  "8 轴货车" / "冷链车" / "液化气罐车" / "厢式货车"
  - sea:   "20ft 集装箱" / "40ft 集装箱" / "散货"
  - rail:  "C70" / "X70" / "中欧班列"
  - air:   "B777F" / "B747F" / "客机腹舱"
  null if not legible — affects only EF refinement.
- weight_kg: numeric KILOGRAMS.
  - "千克" / "kg" / "公斤"  → kg directly.
  - "吨" / "T" / "tonne" → multiply by 1000.
  - "克" / "g" → divide by 1000.
  - "磅" / "lb" → multiply by 0.4536 (and set confidence='medium').
  0 if not legible.
- volume_m3: numeric cubic meters (立方米 / m³ / CBM). null if absent.
- distance_km: numeric kilometers — fill ONLY if an explicit distance
  number appears on the receipt (e.g. highway toll receipt, some 中欧
  班列 documents print mileage). Do NOT estimate from origin /
  destination strings. Wrong example: "深圳 → 汉堡" → "distance_km:
  19000" is WRONG. Leave it null. The downstream EF Matcher will fill
  distance from a routing API.
- origin: free-form loading location, e.g. "深圳市宝安区" / "Hamburg" /
  "Shanghai Yangshan Port". Empty string if not legible.
- destination: free-form unloading location.
- tracking_no: pick the most prominent of: BL number, container number,
  train number, road waybill, AWB number. Use one canonical string.
  null if absent.
- amount_yuan: total CNY paid ("应付运费" / "总费用" / "Total Charges").
  Number only (no "¥" / "元"). 0 if not legible.
- occurred_at: loading / shipment date as ISO YYYY-MM-DD. If both
  loading and delivery dates appear, use the LOADING date. If only
  year-month shown ("2026-05"), assume the 15th. Empty string if not
  legible.
- confidence:
  - "high" if supplier, mode, weight_kg, origin, destination,
    amount_yuan, occurred_at are all clearly visible and unambiguous.
  - "medium" if one or two were inferred, OR a unit conversion was
    applied (吨 → kg, lb → kg), OR mode was inferred from context.
  - "low" if the document doesn't look like a freight document at all,
    OR multiple required fields are guesses, OR mode is ambiguous.

Ignore (DO NOT include in the output): payment method (cash/card/wire),
fapiao receipt number, customs declaration code, cargo description
detail, insurance number, surcharge breakdown.

Example valid response shape (do not copy the values — extract from the
real receipt):
{"doc_type":"freight","supplier_name":"顺丰速运","mode":"road","vehicle_class":"冷链车","weight_kg":1250,"volume_m3":4.5,"distance_km":null,"origin":"广州市番禺区","destination":"上海市浦东新区","tracking_no":"SF1234567890","amount_yuan":2680,"occurred_at":"2026-05-08","confidence":"high"}`

func init() {
	register(Stage{
		ID:          "freight.v1",
		Version:     "1.0.0",
		Description: "Chinese freight (运输单据) — classify + extract",
		Schema:      json.RawMessage(freightSchema),
		BuildPrompt: func(pdfText string) string {
			return `
You are extracting structured data from a Chinese freight / shipping document (运输单 / 物流单 / 提单).

Receipt text (extracted from PDF):
<receipt>
` + pdfText + `
</receipt>

` + freightFieldRules
		},
		BuildVisionMessages: func() VisionMessages {
			return VisionMessages{
				UserText: `You are extracting structured data from a Chinese freight / shipping document (运输单 / 物流单 / 提单).

The receipt is provided as one or more PNG images (one per PDF page) attached to this
message. Look at the images directly — do NOT request OCR text from another tool.

If the PDF shows multiple shipments batched together, extract the most prominent /
largest one and set confidence='low'.

` + freightFieldRules,
			}
		},
	})
}
