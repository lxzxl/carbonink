#!/usr/bin/env node
/**
 * Item 4 (pi-agent-driven answer generation) — manual-smoke fixture seed.
 *
 * Pairs with docs/plans/2026-05-27-pi-agent-answer-generation.md Task 9.
 *
 * Run from `desktop/`:
 *
 *   pnpm exec node scripts/seed-item4-smoke.mjs
 *   pnpm exec node scripts/seed-item4-smoke.mjs --db /custom/path/to/app.sqlite
 *
 * Pre-flight: the app must have been launched at least once so the
 * organization + first site rows exist (onboarding writes them).
 *
 * ABI note: this script loads `better-sqlite3` under Node's ABI. If the
 * binding was last built for Electron (after `pnpm dev` or `pnpm build`),
 * the script will fail with NODE_MODULE_VERSION mismatch — fix once with
 *
 *   pnpm --filter carbonink run rebuild:node
 *
 * The next `pnpm --filter carbonink dev` will flip it back automatically
 * via the `predev` hook (`electron-rebuild -f -w better-sqlite3`), so
 * you don't need to undo this manually.
 *
 * What this script ensures (all idempotent):
 *   1. Inventory data via `scripts/seed-test-data.mjs` (spawned, not imported):
 *        - reporting_period 2025 annual
 *        - 5 emission_source rows (scopes 1/1/1/2/3)
 *        - 3 pinned_emission_factor rows
 *        - 8 activity_data rows across 2025
 *   2. Questionnaire fixture (added here):
 *        - 1 customer  "Item4 Smoke 客户"
 *        - 1 document  (synthetic, no file on disk needed — the FK is what
 *          matters, the answer-generation path never opens the file)
 *        - 1 questionnaire (status='answering', reporting_year=2025)
 *        - 7 question rows covering all three `question_kind` variants:
 *            · 3 numerical  (sum_co2e by scope; total electricity)
 *            · 2 categorical (yes/no inventory completion; boundary kind)
 *            · 2 narrative  (describe scope 1 sources; describe travel scope)
 *
 * After running, the user can:
 *   1. Restart `pnpm --filter carbonink dev`
 *   2. Navigate to `/questionnaires` → open "Item 4 Smoke Questionnaire"
 *   3. Click "Generate" on any question (single-shot test)
 *   4. Click "Generate all unanswered" (batch test)
 *   5. SQL check:
 *        sqlite3 ~/Library/Application\ Support/CarbonInk/app.sqlite \
 *          "SELECT payload FROM audit_event \
 *             WHERE event_kind='agent_answer.generate' \
 *             ORDER BY occurred_at DESC LIMIT 5;"
 *   6. Force fallback path: set `ANSWER_AGENT_MAX_TURNS=1` in the dev
 *      terminal before `pnpm dev`, then re-generate → `source_summary`
 *      gets the `【单 shot fallback】` prefix.
 *
 * Re-running this script is safe: customer / document / questionnaire /
 * questions are matched by stable sentinel keys (sha256, customer name,
 * question_signature). On the second run nothing is re-inserted; the
 * script prints "already present" lines.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { values } = parseArgs({
  options: { db: { type: 'string' } },
});

const DB_PATH =
  values.db ?? join(homedir(), 'Library', 'Application Support', 'CarbonInk', 'app.sqlite');

if (!existsSync(DB_PATH)) {
  console.error(`✗ DB not found: ${DB_PATH}`);
  console.error('  Launch the CarbonInk app once (pnpm dev) so onboarding creates it.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 1: delegate inventory seeding to the existing script.
//
// We spawn instead of import because seed-test-data.mjs is a side-effect
// entrypoint (parses argv, writes to stdout, exits). Spawning preserves
// its exit semantics + isolates its DB handle from ours.
// ---------------------------------------------------------------------------

console.log('━━━ Step 1: inventory seed (seed-test-data.mjs) ━━━');
const inv = spawnSync('node', [join(__dirname, 'seed-test-data.mjs'), '--db', DB_PATH], {
  stdio: 'inherit',
});
if (inv.status !== 0) {
  console.error('✗ Inventory seed failed; aborting before questionnaire seed.');
  process.exit(inv.status ?? 1);
}

// ---------------------------------------------------------------------------
// Step 2: questionnaire fixture.
// ---------------------------------------------------------------------------

console.log('\n━━━ Step 2: questionnaire fixture ━━━');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const now = new Date().toISOString();

// ---------- Customer ----------
//
// Stable name acts as the idempotency key. customer.id is opaque to us
// but we resolve-or-create by name so re-runs reuse the same row.
const CUSTOMER_NAME = 'Item4 Smoke 客户';
let customer = db.prepare('SELECT id FROM customer WHERE name = ?').get(CUSTOMER_NAME);
if (!customer) {
  const id = ulid();
  db.prepare(
    `INSERT INTO customer (id, name, notes) VALUES (?, ?, 'item4 smoke fixture — safe to delete')`,
  ).run(id, CUSTOMER_NAME);
  customer = { id };
  console.log(`  + customer "${CUSTOMER_NAME}" → ${id}`);
} else {
  console.log(`  ✓ customer "${CUSTOMER_NAME}" exists → ${customer.id}`);
}

// ---------- Document ----------
//
// `document` has a UNIQUE(sha256) constraint. We use a sentinel sha256
// that's obviously synthetic (`...5EED5EED...`) so re-runs deterministically
// resolve to the same row, and `doc_type` = 'customer_questionnaire'
// matches what the questionnaire upload flow uses.
//
// storage_path points at /dev/null — the answer-generation path never
// reads the file; only ExtractionService does, and we're not exercising
// that here. If you DO want extraction to run against this fixture,
// upload a real PDF via the UI instead.
const DOC_SHA = '5EED5EED5EED5EED5EED5EED5EED5EED5EED5EED5EED5EED5EED5EEDFA11BACC';
let doc = db.prepare('SELECT id FROM document WHERE sha256 = ?').get(DOC_SHA);
if (!doc) {
  const id = ulid();
  db.prepare(
    `INSERT INTO document
       (id, sha256, filename, mime_type, size_bytes, storage_path,
        uploaded_at, uploaded_by, doc_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    DOC_SHA,
    'item4-smoke-questionnaire.pdf',
    'application/pdf',
    0,
    '/dev/null',
    now,
    'seed:item4-smoke',
    'customer_questionnaire',
  );
  doc = { id };
  console.log(`  + document (synthetic) → ${id}`);
} else {
  console.log(`  ✓ document (synthetic) exists → ${doc.id}`);
}

// ---------- Questionnaire ----------
//
// (customer_id, reporting_year, template_kind) is our idempotency tuple.
// `cdp_lite` is just a label — the answer-generation path doesn't branch
// on template_kind, but having a stable value lets QA filter on it.
const TEMPLATE_KIND = 'cdp_lite';
const REPORTING_YEAR = 2025;
let qn = db
  .prepare(
    `SELECT id FROM questionnaire
       WHERE customer_id = ? AND reporting_year = ? AND template_kind = ?`,
  )
  .get(customer.id, REPORTING_YEAR, TEMPLATE_KIND);
if (!qn) {
  const id = ulid();
  db.prepare(
    `INSERT INTO questionnaire
       (id, customer_id, document_id, template_kind, reporting_year,
        status, due_date, created_at)
     VALUES (?, ?, ?, ?, ?, 'answering', '2026-06-30', ?)`,
  ).run(id, customer.id, doc.id, TEMPLATE_KIND, REPORTING_YEAR, now);
  qn = { id };
  console.log(`  + questionnaire (2025, ${TEMPLATE_KIND}) → ${id}`);
} else {
  console.log(`  ✓ questionnaire (2025, ${TEMPLATE_KIND}) exists → ${qn.id}`);
}

// ---------- Questions ----------
//
// `question_signature` is the idempotency key (stable per question).
// `position` must be UNIQUE within a questionnaire when set, so we use
// a numeric ordering. `expected_unit` is NULL for non-numerical kinds.
//
// Question design covers:
//   - sum_co2e by scope (Q1, Q3) — agent should call sum_co2e(year, scope)
//   - total electricity (Q2)     — agent should list_activities(scope=2)
//   - yes/no completion (Q4)     — agent infers from activity_count > 0
//   - boundary kind (Q5)         — agent reads organization metadata
//                                   (note: not currently exposed via a tool,
//                                   so this is a fallback-candidate question)
//   - scope 1 sources (Q6)       — list_emission_sources(scope=1)
//   - travel scope (Q7)          — narrative, agent leans on
//                                   list_emission_sources(scope=3)
const QUESTIONS = [
  {
    signature: 'sig:item4-smoke:scope2_total_kgco2e_2025',
    kind: 'numerical',
    unit: 'kgCO2e',
    position: '1',
    required: 1,
    raw: '请填报贵公司 2025 年度的范围 2（外购电力）温室气体排放总量。',
    normalized: '2025 年 scope 2 温室气体排放总量',
  },
  {
    signature: 'sig:item4-smoke:electricity_total_kwh_2025',
    kind: 'numerical',
    unit: 'kWh',
    position: '2',
    required: 1,
    raw: '请填报贵公司 2025 年度外购电力总消耗量（kWh）。',
    normalized: '2025 年外购电力总消耗量',
  },
  {
    signature: 'sig:item4-smoke:scope1_total_kgco2e_2025',
    kind: 'numerical',
    unit: 'kgCO2e',
    position: '3',
    required: 1,
    raw: '请填报贵公司 2025 年度的范围 1（直接排放）温室气体排放总量。',
    normalized: '2025 年 scope 1 温室气体排放总量',
  },
  {
    signature: 'sig:item4-smoke:has_2025_inventory',
    kind: 'categorical',
    unit: null,
    position: '4',
    required: 1,
    raw: '贵公司是否已经编制 2025 年度的温室气体排放清单？（是 / 否）',
    normalized: '是否已编制 2025 年温室气体清单',
  },
  {
    signature: 'sig:item4-smoke:boundary_kind',
    kind: 'categorical',
    unit: null,
    position: '5',
    required: 0,
    raw: '贵公司在编制温室气体清单时，组织边界采用的方法是？（权益份额 / 财务控制 / 运营控制）',
    normalized: '组织边界采用的方法',
  },
  {
    signature: 'sig:item4-smoke:scope1_sources_narrative',
    kind: 'narrative',
    unit: null,
    position: '6',
    required: 0,
    raw: '请简要描述贵公司 2025 年度主要的范围 1 排放源。',
    normalized: '描述 2025 年主要 scope 1 排放源',
  },
  {
    signature: 'sig:item4-smoke:scope3_travel_narrative',
    kind: 'narrative',
    unit: null,
    position: '7',
    required: 0,
    raw: '请简要说明贵公司 2025 年度统计的员工商务差旅口径（包含哪些交通方式、是否含通勤等）。',
    normalized: '描述 2025 年员工差旅统计口径',
  },
];

const existsQ = db.prepare(
  `SELECT 1 FROM question WHERE questionnaire_id = ? AND question_signature = ?`,
);
const insertQ = db.prepare(
  `INSERT INTO question
     (id, questionnaire_id, question_signature, signature_version,
      normalized_text, raw_text, parsed_intent,
      question_kind, expected_unit, position, required)
   VALUES (?, ?, ?, 'v1', ?, ?, NULL, ?, ?, ?, ?)`,
);

let qInserted = 0;
let qSkipped = 0;
for (const q of QUESTIONS) {
  if (existsQ.get(qn.id, q.signature)) {
    qSkipped++;
    continue;
  }
  insertQ.run(
    ulid(),
    qn.id,
    q.signature,
    q.normalized,
    q.raw,
    q.kind,
    q.unit,
    q.position,
    q.required,
  );
  qInserted++;
}
console.log(`  + ${qInserted} question(s)${qSkipped ? `, ${qSkipped} already present` : ''}`);

db.close();

// ---------------------------------------------------------------------------
// Summary banner — points the user at the next manual steps.
// ---------------------------------------------------------------------------

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✓ Item 4 smoke fixture ready.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Next steps (manual smoke — Task 9 in the plan):');
console.log('');
console.log('  1. (Re)start the dev app:');
console.log('       pnpm --filter carbonink dev');
console.log('');
console.log('  2. Navigate to /questionnaires → open the row for');
console.log(`     "${CUSTOMER_NAME}" (2025, ${TEMPLATE_KIND}).`);
console.log('');
console.log('  3. Single-shot agent path:');
console.log('       Click "Generate" on Q1 ("2025 范围 2 总量").');
console.log('       Wait ≤90s. Answer should appear; source_summary');
console.log('       should NOT start with 【单 shot fallback】.');
console.log('');
console.log('  4. Batch path:');
console.log('       Click "Generate all unanswered" → all 7 questions');
console.log('       fill within ~2min (concurrency=3 in the loop).');
console.log('');
console.log('  5. Verify audit trail:');
console.log('       sqlite3 "$HOME/Library/Application Support/CarbonInk/app.sqlite" \\');
console.log("         \"SELECT json_extract(payload, '$.isFallback'),");
console.log("                 json_extract(payload, '$.turnCount'),");
console.log("                 json_extract(payload, '$.stopReason'),");
console.log("                 json_extract(payload, '$.toolCallSummary')");
console.log('            FROM audit_event');
console.log("            WHERE event_kind='agent_answer.generate'");
console.log('            ORDER BY occurred_at DESC LIMIT 10;"');
console.log('');
console.log('  6. Force fallback (separate run):');
console.log('       ANSWER_AGENT_MAX_TURNS=1 pnpm --filter carbonink dev');
console.log('       → regenerate one of the same questions');
console.log('       → source_summary now prefixed 【单 shot fallback】');
console.log('       → audit row has isFallback=true, stopReason=max_turns');
console.log('');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Crockford-base32 ULID generator. We don't ship a ulid dep in this script
 * because all the production code paths use `randomUUID()` and we just need
 * a 26-char identifier whose prefix sorts by time (helps when scanning the
 * DB after a smoke run). Strictly speaking the app accepts any TEXT here.
 */
function ulid() {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I, L, O, U)
  const time = Date.now();
  let timeChars = '';
  let t = time;
  for (let i = 0; i < 10; i++) {
    timeChars = ALPHABET[t % 32] + timeChars;
    t = Math.floor(t / 32);
  }
  let randChars = '';
  for (let i = 0; i < 16; i++) {
    randChars += ALPHABET[Math.floor(Math.random() * 32)];
  }
  return timeChars + randChars;
}
