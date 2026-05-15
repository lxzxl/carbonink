/**
 * Canned per-stage extraction + recommendation data for E2E tests.
 *
 * Each entry in `CANNED` provides:
 *   - `extraction`: an `Omit<Extraction, 'id' | 'document_id' | 'created_at'>` whose
 *     `parsed_json` satisfies the corresponding stage's Zod schema when parsed.
 *   - `recommendation`: a `MatcherResult` whose `EmissionFactor` rows match real seeded
 *     rows from migrations 008 and 011. Using real composite PKs means the renderer's
 *     "confirm" flow can look up the EF by its FK without hitting a missing-row error.
 *
 * EF composite PKs used (one per stage):
 *   china_utility : electricity.grid.cn.national.2024 / 2024 / MEE_China  / CN        / 2024.q4
 *   fuel_receipt  : fuel.diesel.combustion.global.2024 / 2024 / IPCC_AR6   / GLOBAL    / 2024.v1
 *   freight       : freight.road.generic               / 2024 / DEFRA      / GLOBAL    / 2024.annual
 *   purchase      : purchase.material.steel_primary    / 2024 / EcoInvent  / GLOBAL    / 3.10
 *   travel        : travel.air.economy.shorthaul       / 2024 / DEFRA      / GLOBAL    / 2024.annual
 */

import type { EmissionFactor, Extraction, MatcherResult } from '../../src/shared/types.js';

// ---------------------------------------------------------------------------
// Real EF rows from seeded catalog
// ---------------------------------------------------------------------------

/** migration 008, row 1: China national grid average */
const EF_CHINA_UTILITY: EmissionFactor = {
  factor_code: 'electricity.grid.cn.national.2024',
  year: 2024,
  source: 'MEE_China',
  geography: 'CN',
  dataset_version: '2024.q4',
  scope: 2,
  category: 'electricity.grid',
  ghg_protocol_path: 'scope2.location',
  input_unit: 'kWh',
  co2e_kg_per_unit: 0.5703,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '中国国家电网平均',
  name_en: 'China national grid average',
  description_zh: null,
  description_en: null,
  notes: null,
  citation_url: 'https://www.mee.gov.cn/',
};

/** migration 008, row 7: diesel combustion */
const EF_FUEL_DIESEL: EmissionFactor = {
  factor_code: 'fuel.diesel.combustion.global.2024',
  year: 2024,
  source: 'IPCC_AR6',
  geography: 'GLOBAL',
  dataset_version: '2024.v1',
  scope: 1,
  category: 'fuel.mobile',
  ghg_protocol_path: 'scope1.mobile_combustion',
  input_unit: 'L',
  co2e_kg_per_unit: 2.683,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '柴油燃烧',
  name_en: 'Diesel combustion',
  description_zh: null,
  description_en: null,
  notes: null,
  citation_url: 'https://www.ipcc.ch/report/ar6/',
};

/** migration 011, row 4: generic road freight */
const EF_FREIGHT_ROAD: EmissionFactor = {
  factor_code: 'freight.road.generic',
  year: 2024,
  source: 'DEFRA',
  geography: 'GLOBAL',
  dataset_version: '2024.annual',
  scope: 3,
  category: 'freight.road',
  ghg_protocol_path: 'scope3.cat4_upstream_transportation',
  input_unit: 'tkm',
  co2e_kg_per_unit: 0.135,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '公路货运一般',
  name_en: 'Generic road freight',
  description_zh: null,
  description_en: null,
  notes: null,
  citation_url:
    'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting',
};

/** migration 011, row 17: primary steel material */
const EF_PURCHASE_STEEL: EmissionFactor = {
  factor_code: 'purchase.material.steel_primary',
  year: 2024,
  source: 'EcoInvent',
  geography: 'GLOBAL',
  dataset_version: '3.10',
  scope: 3,
  category: 'purchase.material.steel',
  ghg_protocol_path: 'scope3.cat1_purchased_goods',
  input_unit: 'kg',
  co2e_kg_per_unit: 2.3,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '原生钢材',
  name_en: 'Primary steel material',
  description_zh: null,
  description_en: null,
  notes: null,
  citation_url: 'https://www.ecoinvent.org/',
};

/** migration 011, row 11: air economy short-haul */
const EF_TRAVEL_AIR: EmissionFactor = {
  factor_code: 'travel.air.economy.shorthaul',
  year: 2024,
  source: 'DEFRA',
  geography: 'GLOBAL',
  dataset_version: '2024.annual',
  scope: 3,
  category: 'travel.air.economy.shorthaul',
  ghg_protocol_path: 'scope3.cat6_business_travel',
  input_unit: 'passenger_km',
  co2e_kg_per_unit: 0.158,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '航空经济舱短程',
  name_en: 'Air travel economy short-haul',
  description_zh: null,
  description_en: null,
  notes: null,
  citation_url:
    'https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting',
};

// ---------------------------------------------------------------------------
// Shared extraction base fields (everything except prompt_version + parsed_json)
// ---------------------------------------------------------------------------

const BASE_EXTRACTION: Omit<
  Extraction,
  'id' | 'document_id' | 'created_at' | 'prompt_version' | 'parsed_json'
> = {
  llm_provider: 'openai',
  llm_model: 'gpt-4o-mini',
  raw_response: null,
  error_json: null,
  status: 'review_needed',
  reviewed_by_user_at: null,
  cost_usd: null,
};

// ---------------------------------------------------------------------------
// CANNED map
// ---------------------------------------------------------------------------

type CannedStage = {
  extraction: Omit<Extraction, 'id' | 'document_id' | 'created_at'>;
  recommendation: MatcherResult;
};

export const CANNED: Record<
  'china_utility.v1' | 'fuel_receipt.v1' | 'freight.v1' | 'purchase.v1' | 'travel.v1',
  CannedStage
> = {
  // -------------------------------------------------------------------------
  // china_utility.v1 — Chinese electricity utility bill
  // Satisfies chinaUtilityExtraction Zod schema (china-utility.ts)
  // -------------------------------------------------------------------------
  'china_utility.v1': {
    extraction: {
      ...BASE_EXTRACTION,
      prompt_version: 'china_utility.v1',
      parsed_json: JSON.stringify({
        doc_type: 'china_utility',
        supplier_name: '国网北京市电力公司',
        account_no: '1000123456',
        amount_kwh: 1234,
        amount_yuan: 678.5,
        period_start: '2026-04-01',
        period_end: '2026-04-30',
        confidence: 'high',
      }),
    },
    recommendation: {
      recommended: [
        { ef: EF_CHINA_UTILITY, reasoning_zh: '中国国家电网平均，与账单地址（北京）最匹配。' },
        { ef: EF_CHINA_UTILITY, reasoning_zh: '备选：同一全国网格平均值。' },
        { ef: EF_CHINA_UTILITY, reasoning_zh: '兜底：国家电网平均排放因子。' },
      ],
      ranked_full: [EF_CHINA_UTILITY],
    },
  },

  // -------------------------------------------------------------------------
  // fuel_receipt.v1 — Chinese fuel receipt (diesel)
  // Satisfies fuelReceiptExtraction Zod schema (fuel-receipt.ts)
  // -------------------------------------------------------------------------
  'fuel_receipt.v1': {
    extraction: {
      ...BASE_EXTRACTION,
      prompt_version: 'fuel_receipt.v1',
      parsed_json: JSON.stringify({
        doc_type: 'fuel_receipt',
        supplier_name: '中国石化北京加油站',
        fuel_type: '0#柴油',
        fuel_category: 'diesel',
        volume_l: 60.5,
        unit_price_yuan: 7.52,
        amount_yuan: 454.96,
        occurred_at: '2026-04-15',
        license_plate: '京A12345',
        confidence: 'high',
      }),
    },
    recommendation: {
      recommended: [
        { ef: EF_FUEL_DIESEL, reasoning_zh: '柴油燃烧因子，与收据燃油类型（0#柴油）完全匹配。' },
        { ef: EF_FUEL_DIESEL, reasoning_zh: '备选：同一 IPCC AR6 柴油因子。' },
        { ef: EF_FUEL_DIESEL, reasoning_zh: '兜底：全球柴油平均排放因子。' },
      ],
      ranked_full: [EF_FUEL_DIESEL],
    },
  },

  // -------------------------------------------------------------------------
  // freight.v1 — Chinese freight / road shipment
  // Satisfies freightExtraction Zod schema (freight.ts)
  // -------------------------------------------------------------------------
  'freight.v1': {
    extraction: {
      ...BASE_EXTRACTION,
      prompt_version: 'freight.v1',
      parsed_json: JSON.stringify({
        doc_type: 'freight',
        supplier_name: '顺丰速运',
        mode: 'road',
        vehicle_class: '厢式货车',
        weight_kg: 1250,
        volume_m3: 4.5,
        distance_km: null,
        origin: '广州市番禺区',
        destination: '上海市浦东新区',
        tracking_no: 'SF1234567890',
        amount_yuan: 2680,
        occurred_at: '2026-05-08',
        confidence: 'high',
      }),
    },
    recommendation: {
      recommended: [
        { ef: EF_FREIGHT_ROAD, reasoning_zh: '公路货运通用因子，与运输模式（公路）匹配。' },
        { ef: EF_FREIGHT_ROAD, reasoning_zh: '备选：同一 DEFRA 公路货运通用因子。' },
        { ef: EF_FREIGHT_ROAD, reasoning_zh: '兜底：全球公路货运平均排放因子。' },
      ],
      ranked_full: [EF_FREIGHT_ROAD],
    },
  },

  // -------------------------------------------------------------------------
  // purchase.v1 — Chinese purchase invoice (steel)
  // Satisfies purchaseExtraction Zod schema (purchase.ts)
  // -------------------------------------------------------------------------
  'purchase.v1': {
    extraction: {
      ...BASE_EXTRACTION,
      prompt_version: 'purchase.v1',
      parsed_json: JSON.stringify({
        doc_type: 'purchase',
        supplier_name: '宝山钢铁股份有限公司',
        item_description: '热轧钢板 5mm / 冷轧钢板 3mm',
        category: 'raw_material',
        quantity_kg: 7500,
        amount_yuan: 48650,
        occurred_at: '2026-04-22',
        invoice_no: '12345678',
        confidence: 'medium',
      }),
    },
    recommendation: {
      recommended: [
        {
          ef: EF_PURCHASE_STEEL,
          reasoning_zh: '原生钢材排放因子，与采购品类（热轧/冷轧钢板）完全匹配。',
        },
        { ef: EF_PURCHASE_STEEL, reasoning_zh: '备选：同一 EcoInvent 原生钢材因子。' },
        { ef: EF_PURCHASE_STEEL, reasoning_zh: '兜底：全球平均原生钢排放因子。' },
      ],
      ranked_full: [EF_PURCHASE_STEEL],
    },
  },

  // -------------------------------------------------------------------------
  // travel.v1 — Chinese air travel receipt (economy short-haul)
  // Satisfies travelExtraction Zod schema (travel.ts)
  // -------------------------------------------------------------------------
  'travel.v1': {
    extraction: {
      ...BASE_EXTRACTION,
      prompt_version: 'travel.v1',
      parsed_json: JSON.stringify({
        doc_type: 'travel',
        supplier_name: '中国国际航空',
        mode: 'air',
        passenger_name: '张三',
        origin: '北京首都国际机场',
        destination: '上海虹桥国际机场',
        departure_at: '2026-04-15T08:30',
        arrival_at: '2026-04-15T10:50',
        travel_class: '经济舱',
        distance_km: null,
        flight_or_train_no: 'CA1234',
        vehicle_plate: null,
        amount_yuan: 1250,
        ticket_no: '7841234567890',
        confidence: 'high',
      }),
    },
    recommendation: {
      recommended: [
        {
          ef: EF_TRAVEL_AIR,
          reasoning_zh: '航空经济舱短程因子，与行程（北京→上海，经济舱）完全匹配。',
        },
        { ef: EF_TRAVEL_AIR, reasoning_zh: '备选：同一 DEFRA 短程经济舱因子。' },
        { ef: EF_TRAVEL_AIR, reasoning_zh: '兜底：短程航空经济舱平均排放因子。' },
      ],
      ranked_full: [EF_TRAVEL_AIR],
    },
  },
};
