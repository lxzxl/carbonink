#!/usr/bin/env node
/**
 * Seed a rich, realistic local-debug database in one command.
 *
 * Layer 1 (inventory core) is delegated to `seed-demo-company.mjs` with the
 * fictional `carbonink-demo-co` pack — invented company, 3 sites, 2 annual
 * periods, 10 sources across all three scopes, ~112 activity rows. Fictional
 * on purpose: debug output (screenshots, pasted SQL) never carries a real
 * company's name or audited footprint.
 *
 * Layer 2 (this file) adds the pipeline rows that make every other surface
 * debuggable without an LLM call or a manual click-through:
 *
 *   documents + extraction   5 stage PDFs (utility / fuel / freight /
 *                            purchase / travel) with matching `extraction`
 *                            rows in review_needed / parsed / rejected,
 *                            plus 5 `activity_data` rows bound via
 *                            `extraction_id` through the real pinned-EF path
 *   questionnaires           outbound: 2 customers, 2024 finalized (reuse
 *   (outbound)                source) + 2025 answering with one answer per
 *                            `source_kind` (ai_suggested / manual /
 *                            reused / mapped_inventory) + one unanswered
 *                            question, plus `agent_answer.generate` audit rows
 *   supplier disclosures     inbound: 1 ingested (Tier 2, with activity row
 *   (inbound)                + finalized answers), 1 received (tentative
 *                            answers awaiting review), 1 sent + overdue
 *                            (exercises D3 / sidebar badge / notify query)
 *   evidence                 `evidence` documents + `evidence_attachment`
 *                            links on activities and one answer
 *   snapshot                 one `calculation_snapshot` + lines for the 2025
 *                            period, with exactly one diverged line so the
 *                            D2 readiness blocker is visible
 *   user EF library          one consistent library (`user:debug-metals`)
 *                            plus one orphaned `user:gone-library` factor so
 *                            the T4 warning fires
 *   audit backfill           `activity_data.created` for every pack row
 *                            (the pack loader writes none, and without them
 *                            the T2 blocker drowns the readiness page)
 *
 * Deliberately NOT seeded: `question_mapping`, `company_profile`,
 * `narrative_bank` — zero production writers reference them, so fabricated
 * rows would debug nothing. `calculation_snapshot` IS seeded despite having
 * no production writer yet, because lineage + the D2 check read it.
 *
 * Usage:
 *   node scripts/seed-local-debug.mjs --db /tmp/debug.sqlite --init
 *   node scripts/seed-local-debug.mjs                                   # active workspace DB
 *   node scripts/seed-local-debug.mjs --db /tmp/debug.sqlite --init --pack hsbc-fy2025 --adopt-org
 *
 * Files land in `<dbdir>/uploads` (which IS `<userData>/uploads` when the
 * target is the real app DB), content-addressed exactly like
 * DocumentService: `<sha[0:2]>//<sha>.<ext>`.
 *
 * Re-runs are safe: every entity resolves by a stable sentinel key
 * (sha256 / name / signature) before inserting.
 *
 * ABI note (same as the other seed scripts): run under plain node. After
 * `pnpm build` / electron-rebuild the better-sqlite3 binding targets
 * Electron — fix with `pnpm --filter carbonink run rebuild:node`.
 */

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import ExcelJS from 'exceljs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED_PACK = join(HERE, 'seed-demo-company.mjs');

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    init: { type: 'boolean', default: false },
    pack: { type: 'string', default: 'carbonink-demo-co' },
    'adopt-org': { type: 'boolean', default: false },
  },
});

// ---------------------------------------------------------------------------
// Step 0: inventory core via the existing pack loader.
// ---------------------------------------------------------------------------
{
  const args = [SEED_PACK, '--pack', values.pack];
  if (values.db) args.push('--db', values.db);
  if (values.init) args.push('--init');
  if (values['adopt-org']) args.push('--adopt-org');
  const res = spawnSync('node', args, { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

// ---------------------------------------------------------------------------
// Step 1: open DB + resolve uploads dir.
// ---------------------------------------------------------------------------
function openDatabase(path) {
  try {
    return new Database(path);
  } catch (err) {
    if (String(err?.message ?? '').includes('NODE_MODULE_VERSION')) {
      console.error('\n✗ better-sqlite3 is currently built for Electron, not node.');
      console.error('  Fix: pnpm --filter carbonink run rebuild:node\n');
      process.exit(1);
    }
    throw err;
  }
}

const USER_DATA = join(homedir(), 'Library', 'Application Support', 'CarbonInk');
function activeWorkspaceDb() {
  const registryPath = join(USER_DATA, 'workspaces.json');
  try {
    const reg = JSON.parse(readFileSync(registryPath, 'utf8'));
    const active =
      reg.workspaces?.find((w) => w.id === reg.active_id) ?? reg.workspaces?.[0] ?? null;
    if (!active) return join(USER_DATA, 'app.sqlite');
    return join(USER_DATA, active.file);
  } catch {
    return join(USER_DATA, 'app.sqlite');
  }
}

const DB_PATH = values.db ?? activeWorkspaceDb();
if (!existsSync(DB_PATH)) {
  console.error(`✗ DB not found: ${DB_PATH} (pack loader should have created it)`);
  process.exit(1);
}
const db = openDatabase(DB_PATH);
db.pragma('foreign_keys = ON');

// Uploads dir: production layout is <userData>/uploads; for a scratch DB the
// sibling <dbdir>/uploads keeps the files next to the database.
const UPLOADS = join(dirname(DB_PATH), 'uploads');
mkdirSync(UPLOADS, { recursive: true });

const now = () => new Date().toISOString();
const NOW = now();
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

console.log('\n━━━ Layer 2: debug pipeline rows ━━━');
console.log(`  db      ${DB_PATH}`);
console.log(`  uploads ${UPLOADS}`);

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------
function storeFile(filename, bytes) {
  const sha = sha256Hex(bytes);
  const ext = filename.includes('.') ? `.${filename.split('.').pop().toLowerCase()}` : '.bin';
  const dir = join(UPLOADS, sha.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const absPath = join(dir, `${sha}${ext}`);
  if (!existsSync(absPath)) writeFileSync(absPath, bytes);
  return { sha, absPath, size: bytes.length };
}

const findDoc = db.prepare('SELECT * FROM document WHERE sha256 = ?');
function ensureDocument({ filename, mimeType, bytes, docType, uploadedBy }) {
  const sha = sha256Hex(bytes);
  const hit = findDoc.get(sha);
  if (hit) return hit;
  const { absPath, size } = storeFile(filename, bytes);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO document
       (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at, uploaded_by, doc_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sha, filename, mimeType, size, absPath, NOW, uploadedBy ?? null, docType ?? null);
  return db.prepare('SELECT * FROM document WHERE id = ?').get(id);
}

/** Minimal one-page text PDF. ASCII-only body (no font embedding needed). */
function makePdf(title, lines) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let y = 800;
  let content = `BT /F1 16 Tf 50 ${y} Td (${esc(title)}) Tj ET\n`;
  y -= 28;
  for (const line of lines) {
    content += `BT /F1 11 Tf 50 ${y} Td (${esc(line)}) Tj ET\n`;
    y -= 18;
  }
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const pinExists = db.prepare(
  `SELECT factor_code, year, source, geography, dataset_version FROM pinned_emission_factor
    WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
);
function ensurePin(factorCode) {
  const ef = db.prepare('SELECT * FROM emission_factor WHERE factor_code = ?').get(factorCode);
  if (!ef) throw new Error(`EF not in library: ${factorCode}`);
  if (!pinExists.get(ef.factor_code, ef.year, ef.source, ef.geography, ef.dataset_version)) {
    db.prepare(
      `INSERT INTO pinned_emission_factor (
         factor_code, year, source, geography, dataset_version,
         scope, category, ghg_protocol_path, input_unit, co2e_kg_per_unit,
         ch4_kg_per_unit, n2o_kg_per_unit, hfc_kg_per_unit, pfc_kg_per_unit,
         sf6_kg_per_unit, nf3_kg_per_unit, gwp_basis,
         name_zh, name_en, description_zh, description_en, citation_url,
         pinned_at, pinned_from)
       SELECT factor_code, year, source, geography, dataset_version,
         scope, category, ghg_protocol_path, input_unit, co2e_kg_per_unit,
         ch4_kg_per_unit, n2o_kg_per_unit, hfc_kg_per_unit, pfc_kg_per_unit,
         sf6_kg_per_unit, nf3_kg_per_unit, gwp_basis,
         name_zh, name_en, description_zh, description_en, citation_url,
         ?, 'seed:local-debug'
         FROM emission_factor
        WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
    ).run(NOW, ef.factor_code, ef.year, ef.source, ef.geography, ef.dataset_version);
  }
  return ef;
}

// ---------------------------------------------------------------------------
// Org / periods / sites / sources from the pack layer.
// ---------------------------------------------------------------------------
const org = db.prepare('SELECT * FROM organization LIMIT 1').get();
if (!org) {
  console.error('✗ no organization row — pack layer failed');
  process.exit(1);
}
const periods = db
  .prepare(`SELECT * FROM reporting_period WHERE organization_id = ? ORDER BY year ASC`)
  .all(org.id);
const periodByYear = new Map(periods.map((p) => [p.year, p]));
const P2025 = periodByYear.get(2025) ?? periods[periods.length - 1];
const P2024 = periodByYear.get(2024) ?? periods[0];
const sourceByName = (name) =>
  db
    .prepare(
      `SELECT es.* FROM emission_source es JOIN site s ON s.id = es.site_id
        WHERE s.organization_id = ? AND es.name = ?`,
    )
    .get(org.id, name);
const firstSite = db
  .prepare(`SELECT * FROM site WHERE organization_id = ? ORDER BY created_at LIMIT 1`)
  .get(org.id);

// Base year → 2024 so YoY sections and the D1 check both have the real shape.
if (P2024 && org.base_year_period_id !== P2024.id) {
  db.prepare(`UPDATE organization SET base_year_period_id = ?, updated_at = ? WHERE id = ?`).run(
    P2024.id,
    NOW,
    org.id,
  );
  console.log(`  + base_year → ${P2024.year}`);
}

// ---------------------------------------------------------------------------
// Documents + extractions + extraction-bound activities (one per stage).
// ---------------------------------------------------------------------------
const STAGE_DOCS = [
  {
    key: 'utility',
    filename: 'debug-2025-06-electricity-bill.pdf',
    stage: 'china_utility.v1',
    title: 'Electricity Bill - Jun 2025',
    lines: [
      'Supplier: East China Grid Power Co.',
      'Account No: 8821463007',
      'Billing period: 2025-06-01 to 2025-06-30',
      'Consumption: 18450 kWh',
      'Amount due: CNY 10231.40',
    ],
    parsed: {
      doc_type: 'china_utility',
      supplier_name: 'East China Grid Power Co.',
      account_no: '8821463007',
      amount_kwh: 18450,
      amount_yuan: 10231.4,
      period_start: '2025-06-01',
      period_end: '2025-06-30',
      confidence: 'high',
    },
    sourceName: '上海总部外购电力',
    amount: 18450,
    unit: 'kWh',
    ef: 'electricity.grid.cn.east.2024',
    start: '2025-06-01T00:00:00Z',
    end: '2025-06-30T23:59:59Z',
    extractionStatus: 'parsed',
  },
  {
    key: 'fuel',
    filename: 'debug-2025-06-15-diesel-receipt.pdf',
    stage: 'fuel_receipt.v1',
    title: 'Fuel Receipt - Diesel',
    lines: [
      'Station: Sinopec Suzhou Industrial Park Station',
      'Product: 0# Diesel',
      'Volume: 120 L @ CNY 7.62/L',
      'Total: CNY 914.40',
      'Date: 2025-06-15  Plate: Su-E8K421',
    ],
    parsed: {
      doc_type: 'fuel_receipt',
      supplier_name: 'Sinopec Suzhou Industrial Park Station',
      fuel_type: '0# Diesel',
      fuel_category: 'diesel',
      volume_l: 120,
      unit_price_yuan: 7.62,
      amount_yuan: 914.4,
      occurred_at: '2025-06-15',
      license_plate: 'Su-E8K421',
      confidence: 'high',
    },
    sourceName: '仓库叉车柴油',
    amount: 120,
    unit: 'L',
    ef: 'fuel.diesel.combustion.global.2024',
    start: '2025-06-15T00:00:00Z',
    end: '2025-06-15T23:59:59Z',
    extractionStatus: 'parsed',
  },
  {
    key: 'freight',
    filename: 'debug-2025-06-20-road-freight.pdf',
    stage: 'freight.v1',
    title: 'Road Freight Invoice',
    lines: [
      'Carrier: Suzhou Express Logistics Co.',
      'Mode: road (heavy diesel truck)',
      'Route: Suzhou Plant -> Guangzhou Warehouse',
      'Weight: 8500 kg x 1000 km = 8500 tkm (routed)',
      'Waybill: SF8821463007CN  Total: CNY 6120.00',
      'Loading date: 2025-06-20',
    ],
    parsed: {
      doc_type: 'freight',
      supplier_name: 'Suzhou Express Logistics Co.',
      mode: 'road',
      vehicle_class: 'heavy diesel truck',
      weight_kg: 8500,
      volume_m3: null,
      distance_km: null,
      origin: 'Suzhou Plant',
      destination: 'Guangzhou Warehouse',
      tracking_no: 'SF8821463007CN',
      amount_yuan: 6120,
      occurred_at: '2025-06-20',
      confidence: 'high',
    },
    sourceName: '公路货运（成品外发）',
    amount: 8500,
    unit: 'tkm',
    ef: 'freight.truck_diesel.china.2024',
    start: '2025-06-20T00:00:00Z',
    end: '2025-06-20T23:59:59Z',
    extractionStatus: 'review_needed',
  },
  {
    key: 'purchase',
    filename: 'debug-2025-05-12-steel-invoice.pdf',
    stage: 'purchase.v1',
    title: 'VAT Invoice - Steel',
    lines: [
      'Seller: Baoshan Steel Sales Co.',
      'Item: Cold-rolled steel sheet 1.0x1250mm',
      'Quantity: 5000 kg  Total: CNY 25000.00',
      'Invoice No: 24112099912345678',
      'Invoice date: 2025-05-12',
    ],
    parsed: {
      doc_type: 'purchase',
      supplier_name: 'Baoshan Steel Sales Co.',
      item_description: 'Cold-rolled steel sheet 1.0x1250mm',
      category: 'raw_material',
      quantity_kg: 5000,
      amount_yuan: 25000,
      occurred_at: '2025-05-12',
      invoice_no: '24112099912345678',
      confidence: 'high',
    },
    sourceName: '采购钢材（结构件）',
    amount: 5000,
    unit: 'kg',
    ef: 'material.steel.global.average.2024',
    start: '2025-05-12T00:00:00Z',
    end: '2025-05-12T23:59:59Z',
    extractionStatus: 'review_needed',
  },
  {
    key: 'travel',
    filename: 'debug-2025-06-10-flight-itinerary.pdf',
    stage: 'travel.v1',
    title: 'E-ticket Itinerary - CA1234',
    lines: [
      'Carrier: Air China',
      'Passenger: Zhang San  Flight: CA1234  Class: Y (economy)',
      'Route: PEK -> SHA  Distance: 1078 km (routed)',
      'Departure: 2025-06-10 08:30  Arrival: 2025-06-10 10:50',
      'Total: CNY 1200.00',
    ],
    parsed: {
      doc_type: 'travel',
      supplier_name: 'Air China',
      mode: 'air',
      passenger_name: 'Zhang San',
      origin: 'PEK',
      destination: 'SHA',
      departure_at: '2025-06-10T08:30',
      arrival_at: '2025-06-10T10:50',
      travel_class: 'Y',
      distance_km: 1078,
      flight_or_train_no: 'CA1234',
      vehicle_plate: null,
      amount_yuan: 1200,
      ticket_no: '999-1234567890',
      confidence: 'high',
    },
    sourceName: '员工商务出行 — 航空经济舱（短途）',
    amount: 1078,
    unit: 'passenger_km',
    ef: 'travel.air.economy.shorthaul',
    start: '2025-06-10T00:00:00Z',
    end: '2025-06-10T23:59:59Z',
    extractionStatus: 'parsed',
  },
];

const activityExists = db.prepare(
  `SELECT 1 FROM activity_data
    WHERE emission_source_id = ? AND reporting_period_id = ?
      AND occurred_at_start = ? AND occurred_at_end = ?`,
);
const insertActivity = db.prepare(
  `INSERT INTO activity_data
     (id, site_id, emission_source_id, reporting_period_id,
      occurred_at_start, occurred_at_end, amount, unit,
      ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
      computed_co2e_kg, computed_at, fuel_code, extraction_id, notes,
      created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
);
let docCount = 0;
let extCount = 0;
let actCount = 0;
const extractionByKey = {};
for (const spec of STAGE_DOCS) {
  const pdf = makePdf(spec.title, spec.lines);
  const doc = ensureDocument({
    filename: spec.filename,
    mimeType: 'application/pdf',
    bytes: pdf,
    docType: spec.stage,
    uploadedBy: 'seed:local-debug',
  });
  if (doc.uploaded_by === 'seed:local-debug') docCount++;

  let extraction = db
    .prepare(
      `SELECT * FROM extraction
        WHERE document_id = ? AND prompt_version = ?
          AND llm_provider = ? AND llm_model = ? AND status != 'rejected'`,
    )
    .get(doc.id, spec.stage, 'seed', 'synthetic-v1');
  if (!extraction) {
    const raw = JSON.stringify(spec.parsed);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO extraction
         (id, document_id, llm_provider, llm_model, prompt_version,
          raw_response, parsed_json, error_json, status, reviewed_by_user_at, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?)`,
    ).run(
      id,
      doc.id,
      'seed',
      'synthetic-v1',
      spec.stage,
      raw,
      raw,
      spec.extractionStatus,
      spec.extractionStatus === 'parsed' ? NOW : null,
      NOW,
    );
    extraction = db.prepare('SELECT * FROM extraction WHERE id = ?').get(id);
    extCount++;
  }
  extractionByKey[spec.key] = extraction;

  // Activity row bound to this extraction (amounts chosen in the EF's own
  // unit so no fuel conversion is involved: co2e = amount × factor).
  const src = sourceByName(spec.sourceName);
  if (!src) throw new Error(`pack source missing: ${spec.sourceName}`);
  if (!activityExists.get(src.id, P2025.id, spec.start, spec.end)) {
    const ef = ensurePin(spec.ef);
    const co2e = Math.round(spec.amount * ef.co2e_kg_per_unit * 100) / 100;
    insertActivity.run(
      randomUUID(),
      src.site_id,
      src.id,
      P2025.id,
      spec.start,
      spec.end,
      spec.amount,
      spec.unit,
      ef.factor_code,
      ef.year,
      ef.source,
      ef.geography,
      ef.dataset_version,
      co2e,
      NOW,
      `debug · ${spec.stage} · ${spec.filename}`,
      NOW,
      NOW,
    );
    // Wire the extraction FK the way ExtractionReview confirmation does.
    const row = db
      .prepare(
        `SELECT id FROM activity_data
          WHERE emission_source_id = ? AND reporting_period_id = ?
            AND occurred_at_start = ? AND occurred_at_end = ?`,
      )
      .get(src.id, P2025.id, spec.start, spec.end);
    db.prepare(`UPDATE activity_data SET extraction_id = ? WHERE id = ?`).run(
      extraction.id,
      row.id,
    );
    actCount++;
  }
}
// One discarded extraction on the fuel doc: proves the discard → retry loop
// renders (rejected row + active review_needed absent for that tuple).
{
  const fuelDoc = db
    .prepare('SELECT * FROM document WHERE filename = ?')
    .get(STAGE_DOCS[1].filename);
  const gone = db
    .prepare(`SELECT 1 FROM extraction WHERE document_id = ? AND status = 'rejected'`)
    .get(fuelDoc.id);
  if (!gone) {
    const raw = JSON.stringify({ ...STAGE_DOCS[1].parsed, volume_l: 0, confidence: 'low' });
    db.prepare(
      `INSERT INTO extraction
         (id, document_id, llm_provider, llm_model, prompt_version,
          raw_response, parsed_json, error_json, status, reviewed_by_user_at, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'rejected', ?, NULL, ?)`,
    ).run(
      randomUUID(),
      fuelDoc.id,
      'seed',
      'synthetic-v0',
      STAGE_DOCS[1].stage,
      raw,
      JSON.stringify({ reason: 'misread volume as 0 — discarded in debug seed' }),
      NOW,
      NOW,
    );
    extCount++;
  }
}
console.log(
  `  + ${docCount} stage document(s), ${extCount} extraction(s), ${actCount} extraction-bound activit(ies)`,
);

// ---------------------------------------------------------------------------
// Outbound questionnaires: 2024 finalized (reuse source) + 2025 answering.
// ---------------------------------------------------------------------------
async function buildQuestionnaireXlsx({ customerName, year, questions, tag }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CarbonInk local-debug seed';
  wb.created = new Date('2026-01-01');
  const meta = wb.addWorksheet('Company info');
  meta.columns = [{ width: 42 }, { width: 30 }, { width: 22 }];
  meta.addRows([
    ['ITEM', 'RESPONSE', 'UNIT'],
    ['Company legal name', customerName, ''],
    ['Reporting year', year, ''],
    ['Template', tag, ''],
    ['Inventory in place (yes/no)', '', ''],
  ]);
  const ghg = wb.addWorksheet('GHG emissions');
  ghg.columns = [{ width: 52 }, { width: 30 }, { width: 22 }];
  ghg.addRow(['QUESTION', 'ANSWER', 'UNIT']);
  for (const q of questions) ghg.addRow([q.raw, '', q.unit ?? '']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function ensureCustomer(name, role = 'customer') {
  const hit = db.prepare(`SELECT * FROM customer WHERE name = ? AND role = ?`).get(name, role);
  if (hit) return hit;
  const id = randomUUID();
  db.prepare(`INSERT INTO customer (id, name, notes, role, email) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    name,
    'seed:local-debug — safe to delete',
    role,
    null,
  );
  return db.prepare('SELECT * FROM customer WHERE id = ?').get(id);
}

const OUTBOUND_QUESTIONS = [
  {
    sig: 'sig:debug:scope2_total_kgco2e_shared',
    kind: 'numerical',
    unit: 'kgCO2e',
    position: 'GHG emissions!B2',
    raw: 'Please report your total Scope 2 (purchased electricity) GHG emissions for the reporting year.',
    normalized: 'reporting-year scope 2 GHG total',
  },
  {
    sig: 'sig:debug:electricity_kwh_shared',
    kind: 'numerical',
    unit: 'kWh',
    position: 'GHG emissions!B3',
    raw: 'Please report total purchased electricity consumption for the reporting year (kWh).',
    normalized: 'reporting-year purchased electricity total',
  },
  {
    sig: 'sig:debug:scope1_total_kgco2e_shared',
    kind: 'numerical',
    unit: 'kgCO2e',
    position: 'GHG emissions!B4',
    raw: 'Please report your total Scope 1 (direct) GHG emissions for the reporting year.',
    normalized: 'reporting-year scope 1 GHG total',
  },
  {
    sig: 'sig:debug:has_inventory',
    kind: 'categorical',
    unit: null,
    position: 'Company info!B4',
    raw: 'Has your company compiled a GHG inventory for the reporting year? (yes / no)',
    normalized: 'whether reporting-year GHG inventory compiled',
  },
  {
    sig: 'sig:debug:boundary_kind',
    kind: 'categorical',
    unit: null,
    position: 'Company info!B5',
    raw: 'Which organizational boundary approach is used? (equity share / financial control / operational control)',
    normalized: 'organizational boundary approach',
  },
  {
    sig: 'sig:debug:scope1_sources_narrative',
    kind: 'narrative',
    unit: null,
    position: 'GHG emissions!B5',
    raw: 'Briefly describe the main Scope 1 emission sources for the reporting year.',
    normalized: 'describe reporting-year main scope 1 sources',
  },
  {
    sig: 'sig:debug:travel_scope_narrative',
    kind: 'narrative',
    unit: null,
    position: 'GHG emissions!B6',
    raw: 'Briefly describe the business-travel accounting boundary (modes included, commuting or not).',
    normalized: 'describe travel accounting boundary',
  },
];

const insertQuestion = db.prepare(
  `INSERT INTO question
     (id, questionnaire_id, question_signature, signature_version,
      normalized_text, raw_text, parsed_intent,
      question_kind, expected_unit, position, required, tier)
   VALUES (?, ?, ?, 'v1', ?, ?, NULL, ?, ?, ?, ?, NULL)`,
);
const insertAnswer = db.prepare(
  `INSERT INTO answer
     (id, question_id, value, unit, source_kind, source_activity_data_id,
      source_summary, finalized_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
const findQuestionnaire = db.prepare(
  `SELECT q.id FROM questionnaire q
    WHERE q.customer_id = ? AND q.reporting_year = ?
      AND ((q.template_kind = ?) OR (q.template_kind IS NULL AND ? IS NULL))
      AND (SELECT COUNT(*) FROM question WHERE questionnaire_id = q.id) = ?`,
);

async function ensureOutbound({ customer, year, status, dueDate, questions, tag }) {
  let qn = findQuestionnaire.get(customer.id, year, tag ?? null, tag ?? null, questions.length);
  if (!qn) {
    const xlsx = await buildQuestionnaireXlsx({
      customerName: customer.name,
      year,
      questions: questions.map((q) => ({ raw: q.raw, unit: q.unit })),
      tag: tag ?? '',
    });
    const doc = ensureDocument({
      filename: `debug-questionnaire-${customer.name.split(' ')[1].toLowerCase()}-${year}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: xlsx,
      docType: null,
      uploadedBy: 'seed:local-debug',
    });
    const id = randomUUID();
    db.prepare(
      `INSERT INTO questionnaire
         (id, customer_id, document_id, template_kind, reporting_year,
          status, direction, due_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'outbound', ?, ?)`,
    ).run(id, customer.id, doc.id, tag, year, status, dueDate, NOW);
    for (const [i, q] of questions.entries()) {
      insertQuestion.run(
        randomUUID(),
        id,
        q.sig,
        q.normalized,
        q.raw,
        q.kind,
        q.unit,
        q.position,
        i < 4 ? 1 : 0,
      );
    }
    qn = { id };
    console.log(`  + outbound questionnaire ${customer.name} ${year} (${status})`);
  }
  return qn;
}

const CUSTOMER_A = ensureCustomer('Debug Auto Parts Customer (demo)');
const CUSTOMER_B = ensureCustomer('Debug Electronics Buyer (demo)');

// 2024 finalized — the reuse source for 2025 (shared signatures).
const QN_2024 = await ensureOutbound({
  customer: CUSTOMER_A,
  year: 2024,
  status: 'finalized',
  dueDate: '2025-03-31',
  questions: OUTBOUND_QUESTIONS.slice(0, 3),
  tag: 'debug_cdp',
});
{
  const qs = db
    .prepare(`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position`)
    .all(QN_2024.id);
  const totals2024 = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN es.scope = 1 THEN ad.computed_co2e_kg END), 0) AS s1,
              COALESCE(SUM(CASE WHEN es.scope = 2 THEN ad.computed_co2e_kg END), 0) AS s2
         FROM activity_data ad JOIN emission_source es ON es.id = ad.emission_source_id
        WHERE ad.reporting_period_id = ?`,
    )
    .get(P2024.id);
  const seed = [
    { v: String(Math.round(totals2024.s2 * 100) / 100), u: 'kgCO2e' },
    { v: '5420000', u: 'kWh' },
    { v: String(Math.round(totals2024.s1 * 100) / 100), u: 'kgCO2e' },
  ];
  // NOTE: no boundary_kind question on the 2024 form (first three only);
  // the reused demo instead copies the org's live boundary_kind below.
  qs.forEach((q, i) => {
    const has = db.prepare(`SELECT 1 FROM answer WHERE question_id = ?`).get(q.id);
    if (!has && seed[i]) {
      insertAnswer.run(
        randomUUID(),
        q.id,
        seed[i].v,
        seed[i].u,
        'manual',
        null,
        JSON.stringify('seeded 2024 baseline — reuse source for the 2025 questionnaire'),
        NOW,
      );
    }
  });
}

// 2025 answering — shared signatures for the first three (reuse path).
// One answer per source_kind + one blank question.
const QN_2025 = await ensureOutbound({
  customer: CUSTOMER_A,
  year: 2025,
  status: 'answering',
  dueDate: '2026-03-31',
  questions: OUTBOUND_QUESTIONS,
  tag: 'debug_cdp',
});
{
  const qs = db
    .prepare(`SELECT * FROM question WHERE questionnaire_id = ? ORDER BY position`)
    .all(QN_2025.id);
  const bySig = new Map(qs.map((q) => [q.question_signature, q]));
  const totals2025 = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN es.scope = 2 THEN ad.computed_co2e_kg END), 0) AS s2
         FROM activity_data ad JOIN emission_source es ON es.id = ad.emission_source_id
        WHERE ad.reporting_period_id = ?`,
    )
    .get(P2025.id);
  const steelAct = db
    .prepare(
      `SELECT ad.* FROM activity_data ad JOIN emission_source es ON es.id = ad.emission_source_id
        WHERE ad.reporting_period_id = ? AND es.name = ?
        ORDER BY ad.occurred_at_start LIMIT 1`,
    )
    .get(P2025.id, '采购钢材（结构件）');

  const seedAnswers = [
    {
      sig: 'sig:debug:scope2_total_kgco2e_shared',
      value: String(Math.round(totals2025.s2 * 100) / 100),
      unit: 'kgCO2e',
      kind: 'ai_suggested',
      activityId: null,
      summary: `Scope 2 total for 2025 from ${db.prepare(`SELECT COUNT(*) AS n FROM activity_data ad JOIN emission_source es ON es.id = ad.emission_source_id WHERE ad.reporting_period_id = ? AND es.scope = 2`).get(P2025.id).n} activity rows (factor electricity.grid.cn.east.2024)`,
      finalized: null,
      audit: { turnCount: 2, tools: ['sum_co2e', 'get_emission_factor'], stop: 'completed' },
    },
    {
      sig: 'sig:debug:electricity_kwh_shared',
      value: '5980000',
      unit: 'kWh',
      kind: 'manual',
      activityId: null,
      summary: 'typed from the June meter reading during debug',
      finalized: NOW,
      audit: null,
    },
    {
      sig: 'sig:debug:scope1_total_kgco2e_shared',
      value: String(Math.round((steelAct?.computed_co2e_kg ?? 0) * 100) / 100),
      unit: 'kgCO2e',
      kind: 'mapped_inventory',
      activityId: steelAct?.id ?? null,
      summary: `bound to steel purchase activity ${steelAct?.id ?? '?'}`,
      finalized: null,
      audit: null,
    },
  ];
  for (const s of seedAnswers) {
    const q = bySig.get(s.sig);
    if (!q || (!s.activityId && s.kind === 'mapped_inventory' && !steelAct)) continue;
    if (db.prepare(`SELECT 1 FROM answer WHERE question_id = ?`).get(q.id)) continue;
    const id = randomUUID();
    insertAnswer.run(
      id,
      q.id,
      s.value,
      s.unit,
      s.kind,
      s.activityId,
      JSON.stringify(s.summary),
      s.finalized,
    );
    if (s.audit) {
      db.prepare(
        `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        'agent_answer.generate',
        JSON.stringify({
          questionId: q.id,
          isFallback: false,
          turnCount: s.audit.turnCount,
          toolCallSummary: s.audit.tools,
          tokens: { input: 2100, output: 180 },
          durationMs: 8400,
          stopReason: s.audit.stop,
        }),
        NOW,
      );
    }
  }
  // reused: boundary_kind copies the org's live value verbatim, exactly the
  // shape QuestionnaireService.createFromUpload writes on a signature match
  // (source_kind='reused', finalized_at NULL).
  {
    const q2025 = bySig.get('sig:debug:boundary_kind');
    if (q2025 && !db.prepare(`SELECT 1 FROM answer WHERE question_id = ?`).get(q2025.id)) {
      insertAnswer.run(
        randomUUID(),
        q2025.id,
        org.boundary_kind,
        null,
        'reused',
        null,
        JSON.stringify(
          `reused from prior ${CUSTOMER_A.name} questionnaire (same question_signature)`,
        ),
        null,
      );
      console.log('  + outbound 2025 reused answer (boundary_kind ← prior questionnaire)');
    }
  }
  const narrativeSeeds = [
    {
      sig: 'sig:debug:scope1_sources_narrative',
      value: '工艺加热天然气、公司车辆汽油、仓库叉车柴油；三处合计约占清单 3%。',
      kind: 'ai_suggested',
      audit: { turnCount: 1, tools: ['list_emission_sources'], stop: 'completed' },
    },
    {
      sig: 'sig:debug:travel_scope_narrative',
      value: '短途航空经济舱 + 高铁；不含通勤。',
      kind: 'manual',
      audit: null,
    },
  ];
  for (const s of narrativeSeeds) {
    const q = bySig.get(s.sig);
    if (!q || db.prepare(`SELECT 1 FROM answer WHERE question_id = ?`).get(q.id)) continue;
    insertAnswer.run(
      randomUUID(),
      q.id,
      s.value,
      null,
      s.kind,
      null,
      JSON.stringify('seeded narrative'),
      null,
    );
    if (s.audit) {
      db.prepare(
        `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        'agent_answer.generate',
        JSON.stringify({
          questionId: q.id,
          isFallback: true,
          turnCount: s.audit.turnCount,
          toolCallSummary: s.audit.tools,
          tokens: { input: 0, output: 0 },
          durationMs: 0,
          stopReason: s.audit.stop,
        }),
        NOW,
      );
    }
  }
  const unanswered = qs.filter(
    (q) => !db.prepare(`SELECT 1 FROM answer WHERE question_id = ?`).get(q.id),
  );
  console.log(
    `  + outbound 2025 answers seeded (${qs.length - unanswered.length}/${qs.length}, ${unanswered.length} left blank for Generate)`,
  );
}

// Second customer, bare questionnaire in mapping — exercises the list + empty states.
await ensureOutbound({
  customer: CUSTOMER_B,
  year: 2025,
  status: 'mapping',
  dueDate: '2026-04-30',
  questions: OUTBOUND_QUESTIONS.slice(0, 2),
});

// ---------------------------------------------------------------------------
// Inbound supplier disclosures: ingested + received + sent-overdue.
// ---------------------------------------------------------------------------
const SUP_A = ensureCustomer('Suzhou Hengli New Materials Co. (demo supplier)', 'supplier');
const SUP_B = ensureCustomer('Dongguan Precision Electronics Co. (demo supplier)', 'supplier');
const SUP_C = ensureCustomer('Ningbo Huayun Logistics Co. (demo supplier)', 'supplier');

const INBOUND_POSITIONS = [
  { position: 'meta.1', tier: null, kind: 'narrative', unit: null },
  { position: 'meta.2', tier: null, kind: 'narrative', unit: null },
  { position: 'meta.3', tier: null, kind: 'categorical', unit: null },
  { position: 'tier1.1', tier: 1, kind: 'numerical', unit: 'kgCO2e/kg' },
  { position: 'tier2.1', tier: 2, kind: 'numerical', unit: 'kgCO2e' },
  { position: 'tier2.2', tier: 2, kind: 'categorical', unit: null },
  { position: 'tier2.3', tier: 2, kind: 'numerical', unit: 'kgCO2e' },
];
const INBOUND_RAW = {
  'meta.1': 'Legal name (matching business license)',
  'meta.2': 'Reporting period covered',
  'meta.3': 'Formal GHG inventory in place?',
  'tier1.1': 'Per-kg product carbon footprint (kgCO2e/kg)',
  'tier2.1': 'Total Scope 1+2 for the reporting period (kgCO2e)',
  'tier2.2': 'Allocation method',
  'tier2.3': 'Emissions attributable to our purchase (kgCO2e)',
};
const inboundSig = (pos) => `inbound:cat1_supplier_disclosure:1.0:${pos}`;

function ensureInboundDraft(supplier, year, status, dueDate) {
  const hit = db
    .prepare(
      `SELECT id, status FROM questionnaire
        WHERE customer_id = ? AND reporting_year = ? AND template_kind = ?
          AND direction = 'inbound'`,
    )
    .get(supplier.id, year, 'cat1_supplier_disclosure');
  if (hit) return hit;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO questionnaire
       (id, customer_id, document_id, template_kind, reporting_year,
        status, direction, due_date, created_at)
     VALUES (?, ?, NULL, 'cat1_supplier_disclosure', ?, 'draft', 'inbound', NULL, ?)`,
  ).run(id, supplier.id, year, NOW);
  for (const p of INBOUND_POSITIONS) {
    db.prepare(
      `INSERT INTO question
         (id, questionnaire_id, question_signature, signature_version,
          normalized_text, raw_text, parsed_intent, question_kind,
          expected_unit, position, required, tier)
       VALUES (?, ?, ?, 'v1', ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      id,
      inboundSig(p.position),
      INBOUND_RAW[p.position],
      INBOUND_RAW[p.position],
      p.kind,
      p.unit,
      p.position,
      p.tier === null ? 1 : 0,
      p.tier,
    );
  }
  if (status !== 'draft') {
    db.prepare(`UPDATE questionnaire SET status = ?, due_date = ? WHERE id = ?`).run(
      status,
      dueDate,
      id,
    );
  }
  console.log(`  + inbound ${status} ← ${supplier.name}`);
  return { id, status };
}

function upsertTentative(questionnaireId, valuesByPos) {
  const qByPos = new Map(
    db
      .prepare(`SELECT * FROM question WHERE questionnaire_id = ?`)
      .all(questionnaireId)
      .map((q) => [q.position, q]),
  );
  for (const [pos, v] of Object.entries(valuesByPos)) {
    const q = qByPos.get(pos);
    if (!q) continue;
    // Any answer row (tentative OR finalized) means this position is done:
    // the ingested disclosure finalizes its rows, so a re-run must not
    // attempt a second row past the UNIQUE(question_id) constraint.
    const has = db.prepare(`SELECT 1 FROM answer WHERE question_id = ?`).get(q.id);
    if (has) continue;
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
       VALUES (?, ?, ?, ?, 'manual', ?, NULL)`,
    ).run(
      randomUUID(),
      q.id,
      v.value,
      q.expected_unit,
      JSON.stringify({
        source: 'inbound_questionnaire',
        tier: q.tier,
        position: pos,
        ...(v.note ? { note: v.note } : {}),
      }),
    );
  }
}

// Ingested Tier 2 disclosure.
{
  const { id } = ensureInboundDraft(SUP_A, 2025, 'received', null);
  upsertTentative(id, {
    'meta.1': { value: 'Suzhou Hengli New Materials Co., Ltd.' },
    'meta.2': { value: '2025 calendar year' },
    'meta.3': { value: 'Third-party verified' },
    'tier2.1': { value: '1250000' },
    'tier2.2': { value: 'mass-based', note: '按质量份额' },
    'tier2.3': { value: '84500' },
  });
  const already = db
    .prepare(
      `SELECT 1 FROM activity_data WHERE inbound_question_id IN
         (SELECT id FROM question WHERE questionnaire_id = ?)`,
    )
    .get(id);
  if (!already) {
    const q = db
      .prepare(`SELECT id FROM question WHERE questionnaire_id = ? AND position = 'tier2.3'`)
      .get(id);
    const efCode = `supplier_direct.${SUP_A.id}.2025`;
    if (!pinExists.get(efCode, 2025, 'inbound_questionnaire', 'SUPPLIER', '1.0')) {
      db.prepare(
        `INSERT INTO pinned_emission_factor (
           factor_code, year, source, geography, dataset_version,
           scope, category, ghg_protocol_path, input_unit, co2e_kg_per_unit,
           gwp_basis, name_zh, name_en,
           description_zh, description_en, pinned_at, pinned_from)
         VALUES (?, 2025, 'inbound_questionnaire', 'SUPPLIER', '1.0',
                 3, 'purchased_goods', 'scope3.cat1_purchased_goods',
                 'kgCO2e', 1.0, 'AR6', '供应商直报排放', 'Supplier-reported direct emissions',
                 '供应商问卷直接报送的 kgCO2e；amount 已是 CO2e。',
                 'Supplier-reported direct emissions in kgCO2e; amount IS the CO2e value (no EF chain).',
                 ?, 'inbound_questionnaire')`,
      ).run(efCode, NOW);
    }
    const srcName = `${SUP_A.name} — purchased goods (2025)`;
    let src = db
      .prepare(`SELECT id FROM emission_source WHERE site_id = ? AND name = ?`)
      .get(firstSite.id, srcName);
    if (!src) {
      const sid = randomUUID();
      db.prepare(
        `INSERT INTO emission_source
           (id, site_id, name, scope, category, ghg_protocol_path,
            default_ef_query, template_origin, is_active)
         VALUES (?, ?, ?, 3, 'purchased_goods', 'scope3.cat1_purchased_goods',
                 NULL, 'inbound_questionnaire', 1)`,
      ).run(sid, firstSite.id, srcName);
      src = { id: sid };
    }
    const actId = randomUUID();
    db.prepare(
      `INSERT INTO activity_data (
         id, site_id, emission_source_id, reporting_period_id,
         occurred_at_start, occurred_at_end, amount, unit,
         ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
         computed_co2e_kg, computed_at, extraction_id, notes,
         created_at, updated_at, inbound_question_id, inbound_tier)
       VALUES (?, ?, ?, ?, '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z',
               84500, 'kgCO2e', ?, 2025, 'inbound_questionnaire', 'SUPPLIER', '1.0',
               84500, ?, NULL, ?, ?, ?, ?, 2)`,
    ).run(
      actId,
      firstSite.id,
      src.id,
      P2025.id,
      efCode,
      NOW,
      `来自 ${SUP_A.name} 供应商问卷 (2025)；供应商备注：按质量份额`,
      NOW,
      NOW,
      q.id,
    );
    db.prepare(`UPDATE answer SET finalized_at = ? WHERE question_id IN
      (SELECT id FROM question WHERE questionnaire_id = ?)`).run(NOW, id);
    db.prepare(`UPDATE questionnaire SET status = 'ingested' WHERE id = ?`).run(id);
    db.prepare(
      `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      'inbound_questionnaire.ingested',
      JSON.stringify({
        questionnaire_id: id,
        supplier_id: SUP_A.id,
        tier_selected: 2,
        activity_data_ids: [actId],
        emission_source_id: src.id,
        total_co2e_kg: 84500,
      }),
      NOW,
    );
    console.log('  + inbound ingested (Tier 2, 84,500 kgCO2e)');
  }
}
// Received (tentative answers, awaiting review) — Tier 1 PCF.
{
  const { id } = ensureInboundDraft(SUP_B, 2025, 'received', null);
  upsertTentative(id, {
    'meta.1': { value: 'Dongguan Precision Electronics Co., Ltd.' },
    'meta.2': { value: '2025 calendar year' },
    'meta.3': { value: 'Self-reported, unverified' },
    'tier1.1': { value: '2.35', note: 'PCF report DGE-PCF-2025-011 attached' },
  });
}
// Sent + overdue — D3 / badge / launch-notify predicate (sent + due < today).
ensureInboundDraft(SUP_C, 2025, 'sent', '2025-09-15');

// ---------------------------------------------------------------------------
// Evidence attachments.
// ---------------------------------------------------------------------------
{
  const pdf = makePdf('Meter photo log - Jan 2025', [
    'Site: Suzhou plant, meter E-01',
    'Reading: 406500 kWh (photo archived)',
    'Taken: 2025-01-31 by Zhang San',
  ]);
  const doc = ensureDocument({
    filename: 'debug-evidence-meter-photo.pdf',
    mimeType: 'application/pdf',
    bytes: pdf,
    docType: 'evidence',
    uploadedBy: 'seed:local-debug',
  });
  const targets = db
    .prepare(
      `SELECT ad.id FROM activity_data ad JOIN emission_source es ON es.id = ad.emission_source_id
        WHERE ad.reporting_period_id = ?
          AND es.name IN ('苏州基地外购电力', '苏州基地天然气（工艺加热）')
        ORDER BY ad.occurred_at_start LIMIT 2`,
    )
    .all(P2024.id);
  let n = 0;
  for (const t of targets) {
    const has = db
      .prepare(`SELECT 1 FROM evidence_attachment WHERE activity_data_id = ?`)
      .get(t.id);
    if (has) continue;
    const aid = randomUUID();
    db.prepare(
      `INSERT INTO evidence_attachment
         (id, activity_data_id, answer_id, document_id, note, created_at)
       VALUES (?, ?, NULL, ?, ?, ?)`,
    ).run(aid, t.id, doc.id, 'debug: meter photo for the January reading', NOW);
    db.prepare(
      `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      'evidence.attached',
      JSON.stringify({
        attachment_id: aid,
        activity_id: t.id,
        document_id: doc.id,
        sha256: doc.sha256,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
      }),
      NOW,
    );
    n++;
  }
  // One attachment on the finalized 2025 manual answer.
  const manualAns = db
    .prepare(
      `SELECT a.id FROM answer a JOIN question q ON q.id = a.question_id
        JOIN questionnaire qn ON qn.id = q.questionnaire_id
       WHERE qn.reporting_year = 2025 AND a.source_kind = 'manual' AND a.finalized_at IS NOT NULL
       LIMIT 1`,
    )
    .get();
  if (
    manualAns &&
    !db.prepare(`SELECT 1 FROM evidence_attachment WHERE answer_id = ?`).get(manualAns.id)
  ) {
    const aid = randomUUID();
    db.prepare(
      `INSERT INTO evidence_attachment
         (id, activity_data_id, answer_id, document_id, note, created_at)
       VALUES (?, NULL, ?, ?, ?, ?)`,
    ).run(aid, manualAns.id, doc.id, 'debug: meter ledger behind the typed value', NOW);
    db.prepare(
      `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      'evidence.attached',
      JSON.stringify({
        attachment_id: aid,
        answer_id: manualAns.id,
        document_id: doc.id,
        sha256: doc.sha256,
        mime_type: doc.mime_type,
        size_bytes: doc.size_bytes,
      }),
      NOW,
    );
    n++;
  }
  if (n > 0) console.log(`  + ${n} evidence attachment(s)`);
}

// ---------------------------------------------------------------------------
// User EF library (consistent) + one orphaned factor (T4).
// ---------------------------------------------------------------------------
{
  const libName = 'debug-metals-2025';
  const libSource = `user:${libName}`;
  const lib = db.prepare(`SELECT * FROM user_ef_library WHERE name = ?`).get(libName);
  if (!lib) {
    const csv = Buffer.from(
      'factor_code,year,geography,input_unit,co2e_kg_per_unit,name_en\n' +
        'debug.aluminum.primary,2024,GLOBAL,kg,8.2,Primary aluminium (debug)\n' +
        'debug.copper.cathode,2024,GLOBAL,kg,3.8,Copper cathode (debug)\n',
    );
    const doc = ensureDocument({
      filename: 'debug-metals-2025.csv',
      mimeType: 'text/csv',
      bytes: csv,
      docType: 'ef_library',
      uploadedBy: 'seed:local-debug',
    });
    const lid = randomUUID();
    db.prepare(
      `INSERT INTO user_ef_library
         (id, name, source, version, source_filename, document_id,
          factor_count, imported_at, created_at)
       VALUES (?, ?, ?, '2025.1', ?, ?, 2, ?, ?)`,
    ).run(lid, libName, libSource, 'debug-metals-2025.csv', doc.id, NOW, NOW);
    for (const [code, co2e, nameEn] of [
      ['debug.aluminum.primary', 8.2, 'Primary aluminium (debug)'],
      ['debug.copper.cathode', 3.8, 'Copper cathode (debug)'],
    ]) {
      db.prepare(
        `INSERT OR IGNORE INTO emission_factor (
           factor_code, year, source, geography, dataset_version,
           scope, category, ghg_protocol_path, input_unit,
           co2e_kg_per_unit, gwp_basis, name_zh, name_en)
         VALUES (?, 2024, ?, 'GLOBAL', '2025.1',
                 3, 'purchase.material.steel', 'scope3.cat1_purchased_goods', 'kg',
                 ?, 'AR6', ?, ?)`,
      ).run(code, libSource, co2e, `调试-${nameEn}`, nameEn);
    }
    db.prepare(
      `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      'ef_library.imported',
      JSON.stringify({
        library_id: lid,
        name: libName,
        version: '2025.1',
        factor_count: 2,
        document_id: doc.id,
      }),
      NOW,
    );
    console.log('  + user EF library debug-metals-2025 (2 factors)');
  }
  // Orphaned factor: pinned by an activity but its library row is gone.
  if (!db.prepare(`SELECT 1 FROM emission_factor WHERE factor_code = ?`).get('debug.zinc.gone')) {
    db.prepare(
      `INSERT INTO emission_factor (
         factor_code, year, source, geography, dataset_version,
         scope, category, ghg_protocol_path, input_unit,
         co2e_kg_per_unit, gwp_basis, name_zh, name_en)
       VALUES ('debug.zinc.gone', 2024, 'user:gone-library', 'GLOBAL', '2024.1',
               3, 'purchase.material.steel', 'scope3.cat1_purchased_goods', 'kg',
               4.1, 'AR6', '调试-锌（库已删）', 'Zinc (library deleted)')`,
    ).run();
    const ef = ensurePin('debug.zinc.gone');
    const src = sourceByName('采购钢材（结构件）');
    if (!activityExists.get(src.id, P2025.id, '2025-11-01T00:00:00Z', '2025-11-30T23:59:59Z')) {
      insertActivity.run(
        randomUUID(),
        src.site_id,
        src.id,
        P2025.id,
        '2025-11-01T00:00:00Z',
        '2025-11-30T23:59:59Z',
        400,
        'kg',
        ef.factor_code,
        ef.year,
        ef.source,
        ef.geography,
        ef.dataset_version,
        1640,
        NOW,
        'debug · orphaned user-library factor (T4)',
        NOW,
        NOW,
      );
    }
    console.log('  + orphaned user-library factor (T4 warning)');
  }
}

// ---------------------------------------------------------------------------
// Audit backfill: activity_data.created for every row missing it (T2).
// ---------------------------------------------------------------------------
{
  const rows = db
    .prepare(
      `SELECT ad.* FROM activity_data ad
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_event ae
           WHERE ae.event_kind = 'activity_data.created'
             AND json_extract(ae.payload, '$.activity_id') = ad.id
        )`,
    )
    .all();
  const stmt = db.prepare(
    `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      stmt.run(
        randomUUID(),
        'activity_data.created',
        JSON.stringify({
          activity_id: r.id,
          site_id: r.site_id,
          emission_source_id: r.emission_source_id,
          reporting_period_id: r.reporting_period_id,
          amount: r.amount,
          unit: r.unit,
          ef: {
            factor_code: r.ef_factor_code,
            year: r.ef_year,
            source: r.ef_source,
            geography: r.ef_geography,
            dataset_version: r.ef_dataset_version,
          },
          computed_co2e_kg: r.computed_co2e_kg,
          fuel_code: r.fuel_code,
          provenance: r.extraction_id
            ? 'extraction'
            : r.inbound_question_id
              ? 'inbound_questionnaire'
              : 'manual',
          extraction_id: r.extraction_id,
        }),
        r.created_at,
      );
    }
  });
  tx();
  if (rows.length > 0)
    console.log(`  + ${rows.length} activity_data.created audit row(s) backfilled`);
}

// ---------------------------------------------------------------------------
// Snapshot for the 2025 period: 6 faithful lines + 1 diverged (D2).
// ---------------------------------------------------------------------------
{
  const has = db
    .prepare(`SELECT 1 FROM calculation_snapshot WHERE reporting_period_id = ?`)
    .get(P2025.id);
  if (!has) {
    const lines = db
      .prepare(
        `SELECT ad.*, es.name AS source_name, es.scope, es.category, es.ghg_protocol_path,
                s.id AS sid, COALESCE(s.name_zh, s.name_en) AS site_name
           FROM activity_data ad
           JOIN emission_source es ON es.id = ad.emission_source_id
           JOIN site s ON s.id = ad.site_id
          WHERE ad.reporting_period_id = ?
          ORDER BY ad.occurred_at_start LIMIT 7`,
      )
      .all(P2025.id);
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN es.scope = 1 THEN ad.computed_co2e_kg END), 0) AS s1,
                COALESCE(SUM(CASE WHEN es.scope = 2 THEN ad.computed_co2e_kg END), 0) AS s2,
                COALESCE(SUM(CASE WHEN es.scope = 3 THEN ad.computed_co2e_kg END), 0) AS s3,
                COALESCE(SUM(ad.computed_co2e_kg), 0) AS total
           FROM activity_data ad JOIN emission_source es ON es.id = ad.emission_source_id
          WHERE ad.reporting_period_id = ?`,
      )
      .get(P2025.id);
    const snapId = randomUUID();
    db.prepare(
      `INSERT INTO calculation_snapshot
         (id, reporting_period_id, frozen_at, ef_dataset_versions, total_co2e_kg,
          scope1_kg, scope2_kg_location, scope2_kg_market, scope3_kg_by_cat, revision)
       VALUES (?, ?, ?, '{}', ?, ?, ?, NULL, '{}', 1)`,
    ).run(snapId, P2025.id, NOW, totals.total, totals.s1, totals.s2);
    const insertLine = db.prepare(
      `INSERT INTO calculation_snapshot_line
         (id, calculation_snapshot_id, original_activity_data_id,
          site_id_at_freeze, site_name_at_freeze,
          emission_source_id_at_freeze, emission_source_name_at_freeze,
          reporting_period_id_at_freeze, occurred_at_start, occurred_at_end,
          amount, unit, ef_input_unit, converted_amount,
          ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
          ef_co2e_kg_per_unit, ef_gwp_basis, computed_co2e_kg, scope, category, ghg_protocol_path,
          extraction_id_at_freeze, document_id_at_freeze, document_sha256_at_freeze)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    lines.forEach((r, i) => {
      // Last line frozen BEFORE a subsequent edit: keep the frozen
      // amount/unit/co2e/factor, then bump the live row so D2 fires.
      const diverged = i === lines.length - 1;
      const frozenCo2e = diverged
        ? Math.round(r.computed_co2e_kg * 0.9 * 100) / 100
        : r.computed_co2e_kg;
      if (diverged) {
        db.prepare(
          `UPDATE activity_data SET amount = amount + 50, updated_at = ? WHERE id = ?`,
        ).run(NOW, r.id);
      }
      const ef = db
        .prepare(
          `SELECT input_unit, co2e_kg_per_unit, gwp_basis FROM pinned_emission_factor
            WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
        )
        .get(r.ef_factor_code, r.ef_year, r.ef_source, r.ef_geography, r.ef_dataset_version);
      insertLine.run(
        randomUUID(),
        snapId,
        r.id,
        r.sid,
        r.site_name,
        r.emission_source_id,
        r.source_name,
        P2025.id,
        r.occurred_at_start,
        r.occurred_at_end,
        r.amount,
        r.unit,
        ef?.input_unit ?? r.unit,
        r.amount,
        r.ef_factor_code,
        r.ef_year,
        r.ef_source,
        r.ef_geography,
        r.ef_dataset_version,
        ef?.co2e_kg_per_unit ?? 0,
        ef?.gwp_basis ?? 'AR6',
        frozenCo2e,
        r.scope,
        r.category,
        r.ghg_protocol_path,
        r.extraction_id,
        null,
        null,
      );
    });
    console.log('  + calculation snapshot (7 lines, 1 diverged → D2 blocker visible)');
  }
}

// ---------------------------------------------------------------------------
// Summary.
// ---------------------------------------------------------------------------
const count = (sql, ...params) => db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n;
console.log('\n━━━ Debug database summary ━━━');
console.log(`  activities       ${count('SELECT id FROM activity_data')}`);
console.log(`  documents        ${count('SELECT id FROM document')}`);
console.log(`  extractions      ${count('SELECT id FROM extraction')}`);
console.log(
  `  questionnaires   ${count(`SELECT id FROM questionnaire`)} (outbound ${count(`SELECT id FROM questionnaire WHERE direction = 'outbound'`)} / inbound ${count(`SELECT id FROM questionnaire WHERE direction = 'inbound'`)})`,
);
console.log(`  questions        ${count('SELECT id FROM question')}`);
console.log(`  answers          ${count('SELECT id FROM answer')}`);
console.log(`  evidence links   ${count('SELECT id FROM evidence_attachment')}`);
console.log(
  `  snapshots        ${count('SELECT id FROM calculation_snapshot')} / lines ${count('SELECT id FROM calculation_snapshot_line')}`,
);
console.log(`  user EF libs     ${count('SELECT id FROM user_ef_library')}`);
console.log(`  audit events     ${count('SELECT id FROM audit_event')}`);
console.log('\n✓ Debug seed complete. Restart or refresh the app to see the data.\n');
db.close();
