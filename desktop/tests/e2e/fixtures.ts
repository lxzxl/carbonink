/**
 * Shared E2E test fixtures — reusable canned data for screenshot specs.
 *
 * Goal: each spec describes its scenario by *composing* these primitives
 * rather than re-defining org/period/source/activity rows from scratch.
 * Keeps specs short and visually focused on the assertions/captures that
 * matter to that scenario.
 *
 * Why `unknown` everywhere instead of typed shapes:
 *   The harness's `cannedIpc` map sends these as JSON across the
 *   playwright → Electron-main structured-clone boundary. The renderer's
 *   IPC types are checked at the IPC layer (zod validation); from the
 *   harness side we just need shape-compatible JSON. Casting to `unknown`
 *   lets us avoid an O(N) port of `shared/types.ts` field-for-field —
 *   and avoids future churn when the schema evolves.
 *
 * Naming: `FIXTURE_<DOMAIN>_<VARIANT>` for data, `baselineIpcMocks()` for
 * the composer.
 */

import type { Organization } from '../../src/shared/schemas/organization.js';

// ---------------------------------------------------------------------------
// Organization, site, reporting period
// ---------------------------------------------------------------------------

// Exception to the `unknown` rule above: the org also feeds the harness's
// typed `cannedOrg` slot (not just the JSON `cannedIpc` map), so it must
// satisfy the real schema type — e.g. `boundary_kind` as the literal union.
export const FIXTURE_ORG = {
  id: 'org_e2e_demo',
  name_zh: '碳墨示例公司',
  name_en: 'CarbonInk Demo Co.',
  industry: 'Technology',
  country_code: 'CN',
  boundary_kind: 'operational_control',
  responsible_person_name: '张三',
  responsible_person_role: '可持续发展负责人',
  base_year_period_id: null,
  recalc_threshold_pct: 5,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-05-01T00:00:00.000Z',
} satisfies Organization;

export const FIXTURE_PERIOD = {
  id: 'period_2026_annual',
  organization_id: FIXTURE_ORG.id,
  year: 2026,
  granularity: 'annual',
  starts_at: '2026-01-01T00:00:00Z',
  ends_at: '2026-12-31T23:59:59Z',
  is_active: 1,
  created_at: '2026-01-01T00:00:00Z',
  significant_changes_text: null,
  recalculation_reason: null,
};

export const FIXTURE_SITE = {
  id: 'site_hq',
  organization_id: FIXTURE_ORG.id,
  name_zh: '总部',
  name_en: 'HQ',
  address: '北京市朝阳区某某路 1 号',
  country_code: 'CN',
  is_active: 1,
  created_at: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Provider config (used by /settings AIProviderSection, /documents banner)
// ---------------------------------------------------------------------------

// V2 wire shape (Item 3 Task 10b): no `apiKeyKeyref` — derived on the
// main side from `provider`. `apiKeyMasked` is the side-channel mask
// returned by `settings:get-provider`.
export const FIXTURE_PROVIDER = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyMasked: 'sk-...abcd',
};

// ---------------------------------------------------------------------------
// Emission sources — small but realistic set covering scope 1/2/3
// ---------------------------------------------------------------------------

export const FIXTURE_SOURCES = [
  {
    id: 'src_electricity',
    site_id: FIXTURE_SITE.id,
    name: '总部电力',
    scope: 2,
    category: 'electricity.grid',
    ghg_protocol_path: 'scope2.location',
    default_ef_query: null,
    template_origin: null,
    is_active: true,
  },
  {
    id: 'src_diesel',
    site_id: FIXTURE_SITE.id,
    name: '班车柴油',
    scope: 1,
    category: 'fuel.mobile',
    ghg_protocol_path: 'scope1.mobile_combustion',
    default_ef_query: null,
    template_origin: null,
    is_active: true,
  },
  {
    id: 'src_business_travel',
    site_id: FIXTURE_SITE.id,
    name: '员工出差',
    scope: 3,
    category: 'travel.air.economy.shorthaul',
    ghg_protocol_path: 'scope3.cat6_business_travel',
    default_ef_query: null,
    template_origin: null,
    is_active: true,
  },
];

export const FIXTURE_SOURCES_WITH_STATS = FIXTURE_SOURCES.map((s, i) => ({
  ...s,
  activity_count: [3, 2, 1][i] ?? 0,
  total_co2e_kg: [1820.5, 410.2, 158][i] ?? 0,
  last_activity_at: '2026-05-10T00:00:00Z',
}));

// ---------------------------------------------------------------------------
// Activity data — populates the dashboard widgets + /activities table
// ---------------------------------------------------------------------------

export const FIXTURE_ACTIVITIES = [
  {
    id: 'act_001',
    site_id: FIXTURE_SITE.id,
    emission_source_id: 'src_electricity',
    reporting_period_id: FIXTURE_PERIOD.id,
    occurred_at_start: '2026-04-01T00:00:00Z',
    occurred_at_end: '2026-04-30T23:59:59Z',
    amount: 3200,
    unit: 'kWh',
    ef_factor_code: 'electricity.grid.cn.national.2024',
    ef_year: 2024,
    ef_source: 'MEE_China',
    ef_geography: 'CN',
    ef_dataset_version: '2024.q4',
    computed_co2e_kg: 1824.96,
    computed_at: '2026-05-02T00:00:00Z',
    extraction_id: null,
    notes: '2026 年 4 月账单',
    created_at: '2026-05-02T00:00:00Z',
    updated_at: '2026-05-02T00:00:00Z',
    source_document_id: null,
    source_document_filename: null,
  },
  {
    id: 'act_002',
    site_id: FIXTURE_SITE.id,
    emission_source_id: 'src_diesel',
    reporting_period_id: FIXTURE_PERIOD.id,
    occurred_at_start: '2026-04-15T00:00:00Z',
    occurred_at_end: '2026-04-15T00:00:00Z',
    amount: 152.8,
    unit: 'L',
    ef_factor_code: 'fuel.diesel.combustion.global.2024',
    ef_year: 2024,
    ef_source: 'IPCC_AR6',
    ef_geography: 'GLOBAL',
    ef_dataset_version: '2024.v1',
    computed_co2e_kg: 410.06,
    computed_at: '2026-04-18T00:00:00Z',
    extraction_id: 'ext_fuel_001',
    notes: null,
    created_at: '2026-04-18T00:00:00Z',
    updated_at: '2026-04-18T00:00:00Z',
    source_document_id: 'doc_fuel',
    source_document_filename: 'fuel-receipt-202604.pdf',
  },
  {
    id: 'act_003',
    site_id: FIXTURE_SITE.id,
    emission_source_id: 'src_business_travel',
    reporting_period_id: FIXTURE_PERIOD.id,
    occurred_at_start: '2026-03-12T00:00:00Z',
    occurred_at_end: '2026-03-12T00:00:00Z',
    amount: 1000,
    unit: 'passenger_km',
    ef_factor_code: 'travel.air.economy.shorthaul',
    ef_year: 2024,
    ef_source: 'DEFRA',
    ef_geography: 'GLOBAL',
    ef_dataset_version: '2024.annual',
    computed_co2e_kg: 158.0,
    computed_at: '2026-03-13T00:00:00Z',
    extraction_id: null,
    notes: '北京→上海经济舱',
    created_at: '2026-03-13T00:00:00Z',
    updated_at: '2026-03-13T00:00:00Z',
    source_document_id: null,
    source_document_filename: null,
  },
];

export const FIXTURE_TOTALS = {
  total_co2e_kg: 2393.02,
  scope1_kg: 410.06,
  scope2_kg: 1824.96,
  scope3_kg: 158.0,
};

// ---------------------------------------------------------------------------
// Documents (uploaded source files) + extraction statuses
// ---------------------------------------------------------------------------

export const FIXTURE_DOCUMENTS = [
  {
    id: 'doc_utility',
    sha256: 'a'.repeat(64),
    filename: '2026-04-utility-bill.pdf',
    mime_type: 'application/pdf',
    size_bytes: 184320,
    storage_path: '/dev/null',
    uploaded_at: '2026-05-01T08:00:00Z',
    uploaded_by: null,
    doc_type: 'china_utility',
  },
  {
    id: 'doc_fuel',
    sha256: 'b'.repeat(64),
    filename: 'fuel-receipt-202604.pdf',
    mime_type: 'application/pdf',
    size_bytes: 92160,
    storage_path: '/dev/null',
    uploaded_at: '2026-04-18T10:30:00Z',
    uploaded_by: null,
    doc_type: 'fuel_receipt',
  },
  {
    id: 'doc_freight',
    sha256: 'c'.repeat(64),
    filename: 'freight-sf-1234.pdf',
    mime_type: 'application/pdf',
    size_bytes: 71300,
    storage_path: '/dev/null',
    uploaded_at: '2026-05-08T15:00:00Z',
    uploaded_by: null,
    doc_type: 'freight',
  },
  {
    id: 'doc_purchase',
    sha256: 'd'.repeat(64),
    filename: 'invoice-steel-april.pdf',
    mime_type: 'application/pdf',
    size_bytes: 102400,
    storage_path: '/dev/null',
    uploaded_at: '2026-04-22T11:00:00Z',
    uploaded_by: null,
    doc_type: 'purchase',
  },
  {
    id: 'doc_travel',
    sha256: 'e'.repeat(64),
    filename: 'flight-ticket-ca1234.pdf',
    mime_type: 'application/pdf',
    size_bytes: 65000,
    storage_path: '/dev/null',
    uploaded_at: '2026-04-15T07:00:00Z',
    uploaded_by: null,
    doc_type: 'travel',
  },
];

export const FIXTURE_EXTRACTION_STATUSES = [
  { document_id: 'doc_utility', status: 'review_needed', count: 1 },
  { document_id: 'doc_fuel', status: 'review_needed', count: 1 },
  { document_id: 'doc_freight', status: 'review_needed', count: 1 },
  { document_id: 'doc_purchase', status: 'review_needed', count: 1 },
  { document_id: 'doc_travel', status: 'review_needed', count: 1 },
];

// ---------------------------------------------------------------------------
// Questionnaire (Phase 2 — CDP-style Excel questionnaire)
// ---------------------------------------------------------------------------

export const FIXTURE_QUESTIONNAIRE = {
  id: 'qst_cdp_2026',
  customer_id: 'cust_unilever',
  document_id: 'doc_q_cdp',
  template_kind: 'cdp',
  reporting_year: 2026,
  status: 'answering',
  due_date: '2026-06-30',
  created_at: '2026-04-15T00:00:00Z',
};

export const FIXTURE_QUESTIONNAIRE_LIST = [
  {
    ...FIXTURE_QUESTIONNAIRE,
    customer_name: 'Unilever Supply Chain',
    question_count: 12,
  },
];

export const FIXTURE_QUESTIONS = [
  {
    id: 'q_1',
    questionnaire_id: FIXTURE_QUESTIONNAIRE.id,
    question_signature: 'sig_total_scope2',
    signature_version: 'v1',
    normalized_text: 'What is your total Scope 2 emissions for the reporting year?',
    raw_text: '请填写报告年度内 Scope 2 总排放量（kg CO2e）',
    parsed_intent: '范围 2 总排放（基于位置的方法）',
    question_kind: 'numerical',
    expected_unit: 'kg CO2e',
    position: 'C5',
    required: 1,
  },
  {
    id: 'q_2',
    questionnaire_id: FIXTURE_QUESTIONNAIRE.id,
    question_signature: 'sig_renewable_pct',
    signature_version: 'v1',
    normalized_text: 'What percentage of your electricity comes from renewable sources?',
    raw_text: '可再生能源占电力使用的百分比',
    parsed_intent: '可再生电力占比',
    question_kind: 'numerical',
    expected_unit: '%',
    position: 'C6',
    required: 0,
  },
  {
    id: 'q_3',
    questionnaire_id: FIXTURE_QUESTIONNAIRE.id,
    question_signature: 'sig_climate_policy',
    signature_version: 'v1',
    normalized_text: 'Describe your company-wide climate policy.',
    raw_text: '请描述公司层面的气候政策',
    parsed_intent: '气候政策描述',
    question_kind: 'narrative',
    expected_unit: null,
    position: 'C10',
    required: 1,
  },
];

// ---------------------------------------------------------------------------
// Audit events (Phase 3 — audit log viewer)
//
// Shape: { id, event_kind, payload (JSON string), occurred_at }. The
// payload string is parsed by the renderer's per-kind detail panel.
// ---------------------------------------------------------------------------

export const FIXTURE_AUDIT_EVENTS = [
  {
    id: '01J0AUDIT0000000000000001',
    event_kind: 'extraction_confirmed',
    payload: JSON.stringify({
      extraction_id: 'ext_utility_001',
      document_id: 'doc_utility',
      stage_id: 'china_utility.v1',
      activity_id: 'act_001',
    }),
    occurred_at: '2026-05-02T09:00:00Z',
  },
  {
    id: '01J0AUDIT0000000000000002',
    event_kind: 'activity_created',
    payload: JSON.stringify({
      activity_id: 'act_001',
      emission_source_id: 'src_electricity',
      computed_co2e_kg: 1824.96,
    }),
    occurred_at: '2026-05-02T09:00:01Z',
  },
  {
    id: '01J0AUDIT0000000000000003',
    event_kind: 'extraction_discarded',
    payload: JSON.stringify({
      extraction_id: 'ext_legacy_42',
      reason: 'duplicate',
    }),
    occurred_at: '2026-04-29T14:22:00Z',
  },
  {
    id: '01J0AUDIT0000000000000004',
    event_kind: 'source_created',
    payload: JSON.stringify({
      source_id: 'src_business_travel',
      name: '员工出差',
      scope: 3,
    }),
    occurred_at: '2026-01-15T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// License state (Phase 4 — LicenseBanner reads this in __root)
//
// Default: trial-active with 13 days remaining. Makes the trial countdown
// banner visible in screenshots — more representative than "no license".
// ---------------------------------------------------------------------------

const TRIAL_EXPIRES_UNIX = Math.floor(new Date('2026-06-06T00:00:00Z').getTime() / 1000);
const TRIAL_GRACE_UNIX = Math.floor(new Date('2026-07-06T00:00:00Z').getTime() / 1000);

export const FIXTURE_LICENSE_TRIAL = {
  state: 'active',
  reason: 'trial active',
  claims: {
    iss: 'carbonink.xyz',
    license_id: 'lic_trial_e2e',
    user_id: 'usr_e2e',
    plan: 'trial@14d',
    features: ['core', 'ai_extract', 'report_pdf'],
    devices_max: 1,
    issued_at: Math.floor(new Date('2026-05-23T00:00:00Z').getTime() / 1000),
    expires_at: TRIAL_EXPIRES_UNIX,
    grace_until: TRIAL_GRACE_UNIX,
    revocation_check_after: Math.floor(new Date('2026-05-30T00:00:00Z').getTime() / 1000),
  },
  device_id: 'device_e2e',
  last_verified_at: '2026-05-23T00:00:00Z',
  consecutive_offline_days: 0,
};

export const FIXTURE_LICENSE_UNVERIFIED = {
  state: 'unverified',
  reason: 'no JWT activated',
  claims: null,
  device_id: 'device_e2e',
  last_verified_at: null,
  consecutive_offline_days: 0,
};

// ---------------------------------------------------------------------------
// Locale-aware projection — FIXTURE_* above are authored in zh (schema-
// of-record for our existing 694 vitest + the suite of e2e specs).
//
// For English-UI screenshot runs (tour.spec.ts with TOUR_LOCALE=en),
// `baselineIpcMocks('en')` swaps the user-facing strings — source
// names, activity notes, question text, person/role, address — to
// natural English equivalents. Internal IDs, units, EF codes, dates,
// numbers, and JSON shapes are locale-invariant.
//
// Why a compose-time projection (vs separate FIXTURE_X_EN constants):
//
//   - Existing constants stay as the single source of truth. Specs
//     that `import { FIXTURE_QUESTIONS }` and use them in their own
//     IPC setup (e.g. questionnaire-end-to-end.spec.ts) keep working
//     unchanged — they pin to zh data and assert against zh strings.
//
//   - One place to maintain. New zh fixture entry adds one row; its
//     EN translation lives next to it in the maps below.
//
//   - The renderer doesn't see "_zh / _en" pairs on monolingual
//     fields — production data is single-string (the user types one
//     value). The harness mimics that: pick one locale's projection
//     per launch, hand the renderer a flat shape.
//
// Fields that are ALREADY bilingual in the production schema
// (Organization.name_zh/name_en, Site.name_zh/name_en, the stages
// list's label_zh/label_en) pass through untouched — the renderer
// picks the right field based on its UI locale.
// ---------------------------------------------------------------------------

type Locale = 'zh-CN' | 'en';

const SOURCE_NAME_EN: Record<string, string> = {
  src_electricity: 'HQ Electricity',
  src_diesel: 'Shuttle Diesel',
  src_business_travel: 'Employee Business Travel',
};

const ACTIVITY_NOTES_EN: Record<string, string | null> = {
  act_001: 'April 2026 utility bill',
  act_002: null, // already null
  act_003: 'Beijing → Shanghai, economy',
};

const QUESTION_LOCALIZED_EN: Record<string, { raw_text: string; parsed_intent: string }> = {
  q_1: {
    raw_text: 'Please enter total Scope 2 emissions for the reporting year (kg CO2e).',
    parsed_intent: 'Scope 2 total (location-based)',
  },
  q_2: {
    raw_text: 'Percentage of electricity from renewable sources.',
    parsed_intent: 'Renewable electricity share',
  },
  q_3: {
    raw_text: 'Describe your company-wide climate policy.',
    parsed_intent: 'Climate policy narrative',
  },
};

function localizeSources(locale: Locale) {
  if (locale === 'zh-CN') return FIXTURE_SOURCES;
  return FIXTURE_SOURCES.map((s) => ({ ...s, name: SOURCE_NAME_EN[s.id] ?? s.name }));
}

function localizeSourcesWithStats(locale: Locale) {
  if (locale === 'zh-CN') return FIXTURE_SOURCES_WITH_STATS;
  return FIXTURE_SOURCES_WITH_STATS.map((s) => ({
    ...s,
    name: SOURCE_NAME_EN[s.id] ?? s.name,
  }));
}

function localizeActivities(locale: Locale) {
  if (locale === 'zh-CN') return FIXTURE_ACTIVITIES;
  return FIXTURE_ACTIVITIES.map((a) => ({
    ...a,
    notes: a.id in ACTIVITY_NOTES_EN ? ACTIVITY_NOTES_EN[a.id] : a.notes,
  }));
}

function localizeQuestions(locale: Locale) {
  if (locale === 'zh-CN') return FIXTURE_QUESTIONS;
  return FIXTURE_QUESTIONS.map((q) => {
    const en = QUESTION_LOCALIZED_EN[q.id];
    return en ? { ...q, raw_text: en.raw_text, parsed_intent: en.parsed_intent } : q;
  });
}

function localizeAuditEvents(locale: Locale) {
  if (locale === 'zh-CN') return FIXTURE_AUDIT_EVENTS;
  // Only one event embeds a zh string in its JSON payload (source_created
  // for src_business_travel). Rewrite the payload with the en source name
  // so the audit detail panel shows English. Other events have purely
  // identifier-shaped payloads (IDs, code paths) and are locale-invariant.
  return FIXTURE_AUDIT_EVENTS.map((ev) => {
    if (ev.event_kind !== 'source_created') return ev;
    const parsed = JSON.parse(ev.payload) as { source_id: string; name: string; scope: number };
    const enName = SOURCE_NAME_EN[parsed.source_id];
    if (!enName) return ev;
    return { ...ev, payload: JSON.stringify({ ...parsed, name: enName }) };
  });
}

function localizeOrg(locale: Locale) {
  if (locale === 'zh-CN') return FIXTURE_ORG;
  return {
    ...FIXTURE_ORG,
    responsible_person_name: 'John Smith',
    responsible_person_role: 'Sustainability Lead',
  };
}

function localizeSite(locale: Locale) {
  if (locale === 'zh-CN') return FIXTURE_SITE;
  return { ...FIXTURE_SITE, address: '1 Example Rd, Chaoyang District, Beijing' };
}

// ---------------------------------------------------------------------------
// Composer — baseline mock map covering every IPC the renderer hits on
// the basic routes (/, /sources, /activities, /audit, /documents,
// /questionnaires, /reports, /settings).
//
// `locale` controls the user-data projection (see locality block above).
// Defaults to 'zh-CN' for back-compat with every existing spec — they
// call `baselineIpcMocks()` with no args and continue to see zh data.
// Opt into 'en' from tour.spec.ts when `TOUR_LOCALE=en` is set.
//
// Specs override individual entries by spreading their own overrides last.
// ---------------------------------------------------------------------------

export function baselineIpcMocks(locale: Locale = 'zh-CN'): Record<string, unknown> {
  return {
    'org:has-any': true,
    'org:get-current': localizeOrg(locale),
    'org:list-sites': [localizeSite(locale)],
    'org:list-reporting-periods': [FIXTURE_PERIOD],
    'settings:get-provider': FIXTURE_PROVIDER,
    'settings:get-amap-key': { hasKey: true, maskedKey: 'amap...wxyz' },
    'settings:available': ['openai', 'anthropic', 'azure', 'deepseek', 'openai-compat'],
    'source:list-by-org': localizeSources(locale),
    'source:list-by-org-with-stats': localizeSourcesWithStats(locale),
    'source:list-presets': [],
    'activity:list-by-period': localizeActivities(locale),
    'activity:totals-by-period': FIXTURE_TOTALS,
    'document:list': FIXTURE_DOCUMENTS,
    'extraction:list-statuses': FIXTURE_EXTRACTION_STATUSES,
    'questionnaire:list': FIXTURE_QUESTIONNAIRE_LIST,
    'questionnaire:list-questions': localizeQuestions(locale),
    'audit:list': localizeAuditEvents(locale),
    'mcp:get-status': {
      built: true,
      installed: false,
      claudeConfigPath: '~/Library/Application Support/Claude/claude_desktop_config.json',
      mcpEntryPath: '/dev/null',
    },
    'updater:get-status': { state: 'idle' },
    'stages:list': [
      { id: 'china_utility.v1', label_zh: '中国电力账单', label_en: 'China utility bill' },
      { id: 'fuel_receipt.v1', label_zh: '燃油票据', label_en: 'Fuel receipt' },
      { id: 'freight.v1', label_zh: '货运单据', label_en: 'Freight bill' },
      { id: 'purchase.v1', label_zh: '采购发票', label_en: 'Purchase invoice' },
      { id: 'travel.v1', label_zh: '差旅票据', label_en: 'Travel ticket' },
    ],
    'app:get-info': {
      version: '1.0.0',
      name: 'CarbonInk',
      electron_version: '41.5.1',
      node_version: '20.18.0',
      chrome_version: '130.0.6723.69',
      platform: 'darwin',
      arch: 'arm64',
      user_data_dir: '/Users/demo/Library/Application Support/CarbonInk',
      started_at: '2026-05-24T12:00:00.000Z',
    },
    'cache:get-stats': {
      extraction_raw_bytes: 184_320,
      extraction_raw_count: 12,
      db_file_bytes: 524_288,
    },
  };
}
