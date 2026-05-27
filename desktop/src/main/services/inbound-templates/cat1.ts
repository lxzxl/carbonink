import type { InboundTemplate } from '@shared/types';

/**
 * Cat 1 (Purchased Goods and Services) supplier disclosure template — v2.0.
 *
 * Structure follows GHG Protocol Scope 3 Standard, Chapter 7's tiered
 * preference order:
 *
 *  - **Tier 1** — supplier-specific per-unit product carbon footprint
 *    (kgCO2e/kg). Highest fidelity; used preferentially when present.
 *  - **Tier 2** — supplier-allocated company-level emissions (total Scope
 *    1+2 + allocation method + share attributable to our purchase).
 *
 * The three "meta.*" questions carry `tier: null` — they're descriptive
 * context (legal name, reporting period, inventory status) that ingest
 * doesn't translate into `activity_data` but does surface in the review
 * UI for the user to confirm the disclosure is well-formed.
 *
 * Tier 3 (supplier reports raw activity data — electricity, fuel — that
 * we convert via our public EF table) is deliberately deferred to v2.1.
 *
 * The template is hard-coded as a TypeScript constant rather than a DB
 * row because v2.0 ships exactly one template and the content is part
 * of the product, not user-authored. v2.x with multi-template + an
 * authoring UI may move templates into the DB.
 *
 * Each question's `cell_ref` (e.g. `'tier2!B5'`) is the xlsx cell address
 * where the supplier types their answer. ExcelTemplateRenderer reads
 * these to lay out the workbook on export and to look up filled values
 * on parse. Changing a `cell_ref` is a breaking change for any in-flight
 * xlsx (the sentinel sheet's `template_version` would have to bump too).
 */
export const CAT1_SUPPLIER_DISCLOSURE: InboundTemplate = {
  template_kind: 'cat1_supplier_disclosure',
  version: '1.0',
  scope: 3,
  category: 'purchased_goods',
  ghg_protocol_path: 'scope3.cat1_purchased_goods',
  questions: [
    // ----- Metadata (no tier) -------------------------------------------
    {
      position: 'meta.1',
      tier: null,
      kind: 'narrative',
      raw_zh: '请填写贵公司法定名称（与营业执照一致）。',
      raw_en: "Please enter your company's legal name (matching business license).",
      expected_unit: null,
      cell_ref: 'metadata!B5',
    },
    {
      position: 'meta.2',
      tier: null,
      kind: 'narrative',
      raw_zh:
        '本次填报对应的报告期。我方采购报告期为 {{period_year}} 年，请填写贵公司对应的报告期（例如 2025 自然年、2024 财年）。',
      raw_en:
        'Reporting period this disclosure covers. Our purchase period: {{period_year}}. Please enter your company’s corresponding reporting period (e.g. 2025 calendar year, FY2024).',
      expected_unit: null,
      cell_ref: 'metadata!B7',
    },
    {
      position: 'meta.3',
      tier: null,
      kind: 'categorical',
      raw_zh:
        '贵公司是否已编制正式的温室气体清单？请填写：无 / 自行核算未审 / 第三方核证 / 已取得 ISO 14064 / 其他。',
      raw_en:
        'Does your company maintain a formal GHG inventory? Please choose: None / Self-reported, unverified / Third-party verified / ISO 14064 certified / Other.',
      expected_unit: null,
      cell_ref: 'metadata!B9',
    },

    // ----- Tier 1: supplier-specific product carbon footprint -----------
    {
      position: 'tier1.1',
      tier: 1,
      kind: 'numerical',
      raw_zh:
        '贵公司供给我方产品的单位碳足迹（kgCO2e/kg 产品）。如有第三方 PCF 报告，请将文件作为附件一并发回，并在备注列注明文件名。',
      raw_en:
        'Per-kg product carbon footprint of goods supplied to us (kgCO2e/kg). If a third-party PCF report exists, please attach it to your reply email and note the filename in the comment column.',
      expected_unit: 'kgCO2e/kg',
      cell_ref: 'tier1!B5',
    },

    // ----- Tier 2: allocated company emissions --------------------------
    {
      position: 'tier2.1',
      tier: 2,
      kind: 'numerical',
      raw_zh: '贵公司报告期内 Scope 1 + Scope 2 排放总量（kgCO2e）。',
      raw_en: "Your company's total Scope 1 + Scope 2 emissions for the reporting period (kgCO2e).",
      expected_unit: 'kgCO2e',
      cell_ref: 'tier2!B5',
    },
    {
      position: 'tier2.2',
      tier: 2,
      kind: 'categorical',
      raw_zh: '排放归因方法（按质量份额 / 按经济价值 / 按物理量 / 其他）。',
      raw_en: 'Allocation method (mass-based / economic / physical / other).',
      expected_unit: null,
      cell_ref: 'tier2!B7',
    },
    {
      position: 'tier2.3',
      tier: 2,
      kind: 'numerical',
      raw_zh: '按上述分配方法归因于我方采购的排放量（kgCO2e）。',
      raw_en: 'Emissions attributable to our purchase (kgCO2e), per the allocation method above.',
      expected_unit: 'kgCO2e',
      cell_ref: 'tier2!B9',
    },
  ],
};
