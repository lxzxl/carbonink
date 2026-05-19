#!/usr/bin/env node
/**
 * Seed the LOCAL running app's sqlite with a realistic 2025 inventory so
 * the questionnaire AI answer flow has data to summarize from.
 *
 * What gets inserted (idempotent — re-running is safe):
 *   - Reporting period: 2025 annual (created if missing)
 *   - 5 emission sources covering common scopes:
 *       · 公司电力消耗     (scope 2, electricity.grid)
 *       · 公司班车油料     (scope 1, fuel.mobile diesel)
 *       · 仓库柴油叉车     (scope 1, fuel.mobile diesel)
 *       · 公司天然气供暖   (scope 1, fuel.stationary)
 *       · 员工出差         (scope 3, business_travel — placeholder)
 *   - 8 activity_data rows distributed across the 5 sources, all dated 2025
 *
 * Usage:
 *   node scripts/seed-test-data.mjs
 *   node scripts/seed-test-data.mjs --db /custom/path/to/app.sqlite
 *
 * Default db path: ~/Library/Application Support/carbonbook/app.sqlite
 *   (override with --db for Linux/Windows)
 *
 * Pre-flight: the app must have been launched at least once so the
 * organization + first site rows exist. The script reads them and
 * attaches the seed data to the existing org.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';

const { values } = parseArgs({
  options: { db: { type: 'string' } },
});

const DB_PATH =
  values.db ?? join(homedir(), 'Library', 'Application Support', 'carbonbook', 'app.sqlite');

if (!existsSync(DB_PATH)) {
  console.error(`✗ DB not found: ${DB_PATH}`);
  console.error('  Launch the carbonbook app once (pnpm dev) so onboarding creates it.');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const org = db.prepare('SELECT id FROM organization LIMIT 1').get();
if (!org) {
  console.error('✗ No organization in DB. Complete onboarding in the app first.');
  process.exit(1);
}
const site = db.prepare('SELECT id FROM site WHERE organization_id = ? LIMIT 1').get(org.id);
if (!site) {
  console.error('✗ No site for this organization. Onboarding should have created one.');
  process.exit(1);
}

const now = new Date().toISOString();

// ---------------------------------------------------------------------------
// 2025 reporting period (idempotent on UNIQUE org/year/granularity)
// ---------------------------------------------------------------------------
let period = db
  .prepare('SELECT id FROM reporting_period WHERE organization_id = ? AND year = ?')
  .get(org.id, 2025);
if (!period) {
  const periodId = randomUUID();
  db.prepare(
    `INSERT INTO reporting_period
       (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
     VALUES (?, ?, 2025, 'annual', '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z', 1, ?)`,
  ).run(periodId, org.id, now);
  period = { id: periodId };
  console.log('  + reporting_period 2025 (annual)');
} else {
  console.log('  ✓ reporting_period 2025 already exists');
}

// ---------------------------------------------------------------------------
// Emission sources — find-or-create by (site_id, name)
// ---------------------------------------------------------------------------
const SOURCES = [
  {
    name: '公司电力消耗',
    scope: 2,
    category: 'electricity.grid',
    ghg_protocol_path: 'scope2.location',
  },
  {
    name: '公司班车油料',
    scope: 1,
    category: 'fuel.mobile',
    ghg_protocol_path: 'scope1.mobile_combustion',
  },
  {
    name: '仓库柴油叉车',
    scope: 1,
    category: 'fuel.mobile',
    ghg_protocol_path: 'scope1.mobile_combustion',
  },
  {
    name: '公司天然气供暖',
    scope: 1,
    category: 'fuel.stationary',
    ghg_protocol_path: 'scope1.stationary_combustion',
  },
  {
    name: '员工出差',
    scope: 3,
    category: 'business_travel',
    ghg_protocol_path: 'scope3.cat6_business_travel',
  },
];

const sourceIds = {};
for (const s of SOURCES) {
  let row = db
    .prepare('SELECT id FROM emission_source WHERE site_id = ? AND name = ?')
    .get(site.id, s.name);
  if (!row) {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO emission_source
         (id, site_id, name, scope, category, ghg_protocol_path, default_ef_query, template_origin, is_active)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'seed-script', 1)`,
    ).run(id, site.id, s.name, s.scope, s.category, s.ghg_protocol_path);
    row = { id };
    console.log(`  + emission_source ${s.name}`);
  } else {
    console.log(`  ✓ emission_source ${s.name} exists`);
  }
  sourceIds[s.name] = row.id;
}

// ---------------------------------------------------------------------------
// Activity data — 8 rows across 2025
// EF rows below are already seeded via migrations 008/011.
// ---------------------------------------------------------------------------
const ACTIVITIES = [
  // Electricity — quarterly chunks
  {
    source: '公司电力消耗',
    start: '2025-01-01',
    end: '2025-03-31',
    amount: 28_500,
    unit: 'kWh',
    ef_code: 'electricity.grid.cn.national.2024',
    co2e_kg_per_unit: 0.5703,
  },
  {
    source: '公司电力消耗',
    start: '2025-04-01',
    end: '2025-06-30',
    amount: 31_200,
    unit: 'kWh',
    ef_code: 'electricity.grid.cn.national.2024',
    co2e_kg_per_unit: 0.5703,
  },
  {
    source: '公司电力消耗',
    start: '2025-07-01',
    end: '2025-09-30',
    amount: 35_800,
    unit: 'kWh',
    ef_code: 'electricity.grid.cn.national.2024',
    co2e_kg_per_unit: 0.5703,
  },
  {
    source: '公司电力消耗',
    start: '2025-10-01',
    end: '2025-12-31',
    amount: 29_400,
    unit: 'kWh',
    ef_code: 'electricity.grid.cn.national.2024',
    co2e_kg_per_unit: 0.5703,
  },
  // Diesel — shuttle + forklift
  {
    source: '公司班车油料',
    start: '2025-01-01',
    end: '2025-12-31',
    amount: 1_840,
    unit: 'L',
    ef_code: 'fuel.diesel.combustion.global.2024',
    co2e_kg_per_unit: 2.687,
  },
  {
    source: '仓库柴油叉车',
    start: '2025-01-01',
    end: '2025-12-31',
    amount: 620,
    unit: 'L',
    ef_code: 'fuel.diesel.combustion.global.2024',
    co2e_kg_per_unit: 2.687,
  },
  // Natural gas heating
  {
    source: '公司天然气供暖',
    start: '2025-01-01',
    end: '2025-12-31',
    amount: 4_200,
    unit: 'm3',
    ef_code: 'fuel.natural_gas.combustion.global.2024',
    co2e_kg_per_unit: 1.879,
  },
  // Business travel — placeholder ad-hoc estimate
  {
    source: '员工出差',
    start: '2025-01-01',
    end: '2025-12-31',
    amount: 86_400,
    unit: 'passenger-km',
    ef_code: 'electricity.grid.cn.national.2024',
    co2e_kg_per_unit: 0.255,
  },
];

const EF = {
  'electricity.grid.cn.national.2024': {
    year: 2024,
    source: 'MEE_China',
    geography: 'CN',
    dataset_version: '2024.q4',
  },
  'fuel.diesel.combustion.global.2024': {
    year: 2024,
    source: 'IPCC_AR6',
    geography: 'GLOBAL',
    dataset_version: '2024.v1',
  },
  'fuel.natural_gas.combustion.global.2024': {
    year: 2024,
    source: 'IPCC_AR6',
    geography: 'GLOBAL',
    dataset_version: '2024.v1',
  },
};

// activity_data has an FK to pinned_emission_factor (a snapshot of the EF
// at the moment an activity used it). In production the ef-matcher flow
// pins on first use. We pin here directly so the seed inserts don't FK-fail.
const pinExisting = db.prepare(
  `SELECT 1 FROM pinned_emission_factor
     WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
);
// Column lists differ: pinned has `pinned_at`/`pinned_from`, emission_factor
// has `notes`. Explicit projection keeps the snapshot semantics clear.
const pinInsertSql = `
  INSERT INTO pinned_emission_factor (
    factor_code, year, source, geography, dataset_version,
    scope, category, ghg_protocol_path, input_unit, co2e_kg_per_unit,
    ch4_kg_per_unit, n2o_kg_per_unit, hfc_kg_per_unit, pfc_kg_per_unit,
    sf6_kg_per_unit, nf3_kg_per_unit, gwp_basis,
    name_zh, name_en, description_zh, description_en, citation_url,
    pinned_at, pinned_from
  )
  SELECT
    factor_code, year, source, geography, dataset_version,
    scope, category, ghg_protocol_path, input_unit, co2e_kg_per_unit,
    ch4_kg_per_unit, n2o_kg_per_unit, hfc_kg_per_unit, pfc_kg_per_unit,
    sf6_kg_per_unit, nf3_kg_per_unit, gwp_basis,
    name_zh, name_en, description_zh, description_en, citation_url,
    ?, 'seed-script'
  FROM emission_factor
   WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?
`;
const pinInsert = db.prepare(pinInsertSql);
for (const [code, ef] of Object.entries(EF)) {
  if (pinExisting.get(code, ef.year, ef.source, ef.geography, ef.dataset_version)) continue;
  const info = pinInsert.run(now, code, ef.year, ef.source, ef.geography, ef.dataset_version);
  if (info.changes === 0) {
    console.warn(`  ! EF ${code} not in emission_factor — skipping`);
  } else {
    console.log(`  + pinned_emission_factor ${code}`);
  }
}

let inserted = 0;
let skipped = 0;
const existsActivity = db.prepare(
  `SELECT 1 FROM activity_data
     WHERE emission_source_id = ? AND reporting_period_id = ?
       AND occurred_at_start = ? AND occurred_at_end = ?`,
);
const insertActivity = db.prepare(
  `INSERT INTO activity_data
     (id, site_id, emission_source_id, reporting_period_id,
      occurred_at_start, occurred_at_end,
      amount, unit,
      ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
      computed_co2e_kg, computed_at,
      extraction_id, notes, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'seed-script', ?, ?)`,
);

for (const a of ACTIVITIES) {
  const sourceId = sourceIds[a.source];
  const ef = EF[a.ef_code];
  if (!sourceId || !ef) {
    console.warn(`  ! Skipping ${a.source} — missing source or EF reference`);
    continue;
  }
  const exists = existsActivity.get(
    sourceId,
    period.id,
    `${a.start}T00:00:00Z`,
    `${a.end}T23:59:59Z`,
  );
  if (exists) {
    skipped++;
    continue;
  }
  const co2e = Math.round(a.amount * a.co2e_kg_per_unit * 100) / 100;
  insertActivity.run(
    randomUUID(),
    site.id,
    sourceId,
    period.id,
    `${a.start}T00:00:00Z`,
    `${a.end}T23:59:59Z`,
    a.amount,
    a.unit,
    a.ef_code,
    ef.year,
    ef.source,
    ef.geography,
    ef.dataset_version,
    co2e,
    now,
    now,
    now,
  );
  inserted++;
}
console.log(`  + ${inserted} activity_data row(s)${skipped ? `, ${skipped} already present` : ''}`);

console.log('\n✓ Seed complete. Refresh the app to see 2025 data in /activities and dashboard.');
