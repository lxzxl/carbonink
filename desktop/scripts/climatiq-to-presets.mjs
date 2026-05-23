#!/usr/bin/env node
// @ts-check
/**
 * climatiq-to-presets.mjs
 *
 * Self-contained Node 20+ ESM script that:
 *   1. Discovers the latest Climatiq `data_version`
 *   2. Crawls a curated allowlist of reputable sources (BEIS, EPA, IPCC, ...)
 *   3. Filters factors (public, recent, sensible region, has unit + category + name)
 *   4. Dedupes by `activity_id` (preferred region/year picked)
 *   5. Assigns scope 1/2/3 via a hand-maintained CATEGORY_TO_SCOPE table
 *   6. Picks a curated slice (favoring Scope 1/2 + select Scope 3 categories)
 *   7. Translates names to simplified Chinese via the Vercel AI SDK (gpt-4o-mini)
 *   8. Writes `desktop/src/main/data/preset-sources.json`
 *
 * Cache:
 *   - Raw API pages cached under `desktop/scripts/.climatiq-cache/` (gitignored)
 *   - Translations cached under the same dir, keyed by activity_id
 *
 * Run:
 *   node desktop/scripts/climatiq-to-presets.mjs --dry-run
 *   OPENAI_API_KEY=sk-... node desktop/scripts/climatiq-to-presets.mjs --limit 250
 */

import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ────────────────────────────────────────────────────────────────────────────
// Paths
// ────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DESKTOP_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.climatiq-cache');
const TRANSLATION_CACHE_FILE = path.join(CACHE_DIR, 'translations.json');
const OUTPUT_FILE = path.join(DESKTOP_ROOT, 'src/main/data/preset-sources.json');
const BACKUP_FILE = path.join(DESKTOP_ROOT, 'src/main/data/preset-sources.handcurated.json');

// ────────────────────────────────────────────────────────────────────────────
// CLI flags + env vars
// ────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function flag(name) {
  return argv.includes(name);
}
function value(name, fallback) {
  const idx = argv.findIndex((a) => a === name);
  if (idx === -1) return fallback;
  return argv[idx + 1] ?? fallback;
}

const LIMIT = parseInt(value('--limit', '300'), 10);
const SOURCES_OVERRIDE = value('--sources', null);
const DRY_RUN = flag('--dry-run');
const NO_TRANSLATE = flag('--no-translate');
const CACHE_ONLY = flag('--cache-only');
const REFRESH = flag('--refresh');

const CLIMATIQ_API_TOKEN = process.env.CLIMATIQ_API_TOKEN || 'DZBYBS4XXH4C9TM6T5H9DGYMR8WD';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const BASE_URL = 'https://api.climatiq.io/data/v1';
const RESULTS_PER_PAGE = 500;

const DEFAULT_SOURCES = ['BEIS', 'EPA', 'IPCC', 'GHG Protocol', 'ADEME', 'ecoinvent'];
const SOURCES = SOURCES_OVERRIDE ? SOURCES_OVERRIDE.split(',').map((s) => s.trim()) : DEFAULT_SOURCES;

const ALLOWED_REGIONS = new Set(['CN', 'GLOBAL', 'World', 'GB', 'US', 'EU', 'OECD']);
const REGION_PRIORITY = ['CN', 'GLOBAL', 'World', 'GB', 'US', 'EU', 'OECD'];
const MIN_YEAR = 2022;

// ────────────────────────────────────────────────────────────────────────────
// Category → scope mapping
//
// Manual curation. Climatiq exposes ~200+ distinct category strings;
// mapping every one is wasted effort, so:
//   - Scope 1 / 2 / 3 mappings cover ~50 categories we actually want to ship
//   - Categories not in the map are LOGGED + SKIPPED (visible in the summary)
//   - Add new categories here after reviewing the missing-category report
// ────────────────────────────────────────────────────────────────────────────

const CATEGORY_TO_SCOPE = {
  // ── Scope 1 — direct emissions (combustion / fugitives / process)
  Fuel: 1,
  'Refrigerants and Fugitive Gases': 1,
  // ── Scope 2 — purchased energy
  Electricity: 2,
  'Heat and Steam': 2,
  Cooling: 2,
  // ── Scope 3 — purchased goods / services / travel / freight / waste
  // Travel + freight (3.6 / 3.4 / 3.9 in the GHG protocol)
  'Air Travel': 3,
  'Road Travel': 3,
  'Rail Travel': 3,
  'Sea Travel': 3,
  'Air Freight': 3,
  'Road Freight': 3,
  'Rail Freight': 3,
  'Sea Freight': 3,
  'Transport Services and Warehousing': 3,
  Storage: 3,
  Vehicles: 3,
  'Vehicle Parts': 3,
  'Vehicle Maintenance and Services': 3,
  // Purchased goods + materials (3.1)
  Metals: 3,
  'Mined Materials': 3,
  Mining: 3,
  'Building Materials': 3,
  Construction: 3,
  Infrastructure: 3,
  'Pavement and Surfacing': 3,
  'Timber and Forestry Products': 3,
  'Paper and Cardboard': 3,
  'Paper Products': 3,
  'Plastics and Rubber Products': 3,
  'Chemical Products': 3,
  'Glass and Glass Products': 3,
  'Ceramic Goods': 3,
  'Fabricated Metal Products': 3,
  'Other Materials': 3,
  Machinery: 3,
  'Electrical Equipment': 3,
  Electronics: 3,
  'Office Equipment': 3,
  'DIY and Gardening Equipment': 3,
  Textiles: 3,
  'Clothing and Footwear': 3,
  'Personal Care and Accessories': 3,
  'Furnishings and Household': 3,
  Manufacturing: 3,
  // Food + agriculture
  'Arable Farming': 3,
  'Livestock Farming': 3,
  'Fishing/Aquaculture/Hunting': 3,
  'Agriculture/Hunting/Forestry/Fishing': 3,
  'Food and Beverage Services': 3,
  'Food/Beverages/Tobacco': 3,
  'Organic Products': 3,
  // Waste (3.5)
  'Waste Management': 3,
  'Waste Product': 3,
  'General Waste': 3,
  'Plastic Waste': 3,
  'Paper and Cardboard Waste': 3,
  'Metal Waste': 3,
  'Electrical Waste': 3,
  'Glass Waste': 3,
  'Construction Waste': 3,
  'Food and Organic Waste': 3,
  // Water + land
  'Water Supply': 3,
  'Water Treatment': 3,
  'Land Use Change': 3,
  'Land Use': 3,
  // Services (3.1 / 3.6 / 3.7)
  Accommodation: 3,
  'Professional Services': 3,
  'Financial Services': 3,
  'Insurance Services': 3,
  'Real Estate': 3,
  'Information and Communication Services': 3,
  'Health Care': 3,
  'Social Care': 3,
  Education: 3,
  'Recreation and Culture': 3,
  'Government Activities': 3,
  'Non-profit Activities': 3,
  'Organizational Activities': 3,
  'Operational Activities': 3,
  'Domestic Services': 3,
  'Energy Services': 3,
  'Maintenance and Repair': 3,
  'Equipment Repair': 3,
  'Equipment Rental': 3,
  'Consumer Goods Rental': 3,
  'General Retail': 3,
  'Wholesale Trade': 3,
  Housing: 3,
  Homeworking: 3,
};

// Whitelist of Scope 3 categories we want to keep when slicing to `--limit`.
// These are the ones most useful for company inventory (business travel,
// commuting proxies, freight, electricity-adjacent). Scope 1 + 2 are
// always preferred ahead of any Scope 3 entry.
const FAVORED_S3 = new Set([
  // Business travel + commuting proxies
  'Air Travel',
  'Road Travel',
  'Rail Travel',
  'Sea Travel',
  'Accommodation',
  'Vehicles',
  // Freight (upstream + downstream)
  'Air Freight',
  'Road Freight',
  'Rail Freight',
  'Sea Freight',
  'Transport Services and Warehousing',
  // Waste (3.5)
  'Waste Management',
  'Waste Product',
  'General Waste',
  'Plastic Waste',
  'Paper and Cardboard Waste',
  'Metal Waste',
  'Electrical Waste',
  'Glass Waste',
  'Construction Waste',
  'Food and Organic Waste',
  // Office consumables
  'Paper and Cardboard',
  'Office Equipment',
  'Electronics',
  // Water
  'Water Supply',
  'Water Treatment',
]);

const FAVORED_SOURCES = new Set(['BEIS', 'EPA', 'IPCC', 'GHG Protocol']);

// ────────────────────────────────────────────────────────────────────────────
// Utility
// ────────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** sourceToKey — safe filesystem name for cache files. */
function sourceToKey(source) {
  return source.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// ────────────────────────────────────────────────────────────────────────────
// Simple in-process throttle: ~3 requests/second
// ────────────────────────────────────────────────────────────────────────────

let lastRequestAt = 0;
const MIN_REQUEST_GAP_MS = 333;

async function throttledFetch(url, init = {}, attempt = 0) {
  const gap = Date.now() - lastRequestAt;
  if (gap < MIN_REQUEST_GAP_MS) await sleep(MIN_REQUEST_GAP_MS - gap);
  lastRequestAt = Date.now();

  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${CLIMATIQ_API_TOKEN}`, ...(init.headers || {}) },
    });
  } catch (err) {
    if (attempt < 3) {
      const backoff = 2 ** attempt * 1000;
      console.warn(`  ⚠️  network error (${err.message}); retry in ${backoff}ms`);
      await sleep(backoff);
      return throttledFetch(url, init, attempt + 1);
    }
    throw err;
  }

  if (res.status === 429 || res.status >= 500) {
    if (attempt < 3) {
      const backoff = 2 ** attempt * 1000;
      console.warn(`  ⚠️  HTTP ${res.status}; retry in ${backoff}ms`);
      await sleep(backoff);
      return throttledFetch(url, init, attempt + 1);
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} on ${url}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ────────────────────────────────────────────────────────────────────────────
// Climatiq API helpers
// ────────────────────────────────────────────────────────────────────────────

async function getLatestDataVersion() {
  const data = await throttledFetch(`${BASE_URL}/data-versions`);
  return data.latest_release ?? String(data.latest_major);
}

async function fetchPage(source, dataVersion, page) {
  const cacheKey = `${sourceToKey(source)}_${dataVersion}_page_${page}.json`;
  const cachePath = path.join(CACHE_DIR, cacheKey);

  if (!REFRESH && (await exists(cachePath))) {
    return readJson(cachePath);
  }
  if (CACHE_ONLY) {
    throw new Error(`--cache-only set but missing ${cachePath}`);
  }

  const url = new URL(`${BASE_URL}/search`);
  url.searchParams.set('data_version', dataVersion);
  url.searchParams.set('source', source);
  url.searchParams.set('page', String(page));
  url.searchParams.set('results_per_page', String(RESULTS_PER_PAGE));

  const data = await throttledFetch(url.toString());
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify(data), 'utf8');
  return data;
}

async function crawlSource(source, dataVersion) {
  const all = [];
  let page = 1;
  while (true) {
    const data = await fetchPage(source, dataVersion, page);
    all.push(...(data.results || []));
    const last = data.last_page ?? 1;
    if (page === 1) {
      console.log(`  [${source}] ${data.total_results} factors across ${last} pages`);
    }
    if (page % 10 === 0) {
      console.log(`  [${source}] page ${page}/${last} (cumulative ${all.length})`);
    }
    if (page >= last) break;
    page += 1;
  }
  return all;
}

// ────────────────────────────────────────────────────────────────────────────
// Filtering + dedup + scope assignment
// ────────────────────────────────────────────────────────────────────────────

function passesFilter(f) {
  if (f.access_type !== 'public') return false;
  if (!f.year || f.year < MIN_YEAR) return false;
  if (!f.region || !ALLOWED_REGIONS.has(f.region)) return false;
  if (!f.unit || typeof f.unit !== 'string' || !f.unit.trim()) return false;
  if (!f.category || !f.name) return false;
  return true;
}

/** Deduplicate by activity_id; prefer region priority then year DESC. */
function dedupeByActivityId(factors) {
  /** @type {Map<string, any>} */
  const best = new Map();
  for (const f of factors) {
    const existing = best.get(f.activity_id);
    if (!existing) {
      best.set(f.activity_id, f);
      continue;
    }
    if (preferA(f, existing)) best.set(f.activity_id, f);
  }
  return [...best.values()];
}

function preferA(a, b) {
  const ra = REGION_PRIORITY.indexOf(a.region);
  const rb = REGION_PRIORITY.indexOf(b.region);
  if (ra !== rb) return ra < rb;
  if (a.year !== b.year) return a.year > b.year;
  // Tie-break: favor "known good" sources
  const sa = FAVORED_SOURCES.has(a.source) ? 1 : 0;
  const sb = FAVORED_SOURCES.has(b.source) ? 1 : 0;
  return sa > sb;
}

/** Slice down to `limit`, preferring scope1+2, then favored scope3. */
function curatedSlice(factors, limit) {
  const scope12 = [];
  const scope3Favored = [];
  const scope3Other = [];
  for (const f of factors) {
    if (f._scope === 1 || f._scope === 2) scope12.push(f);
    else if (FAVORED_S3.has(f.category)) scope3Favored.push(f);
    else scope3Other.push(f);
  }

  // Sort each bucket by region priority, then year DESC, then favored source
  const cmp = (a, b) => {
    const ra = REGION_PRIORITY.indexOf(a.region);
    const rb = REGION_PRIORITY.indexOf(b.region);
    if (ra !== rb) return ra - rb;
    if (a.year !== b.year) return b.year - a.year;
    const sa = FAVORED_SOURCES.has(a.source) ? 1 : 0;
    const sb = FAVORED_SOURCES.has(b.source) ? 1 : 0;
    return sb - sa;
  };
  scope12.sort(cmp);
  scope3Favored.sort(cmp);
  scope3Other.sort(cmp);

  const out = [];
  for (const arr of [scope12, scope3Favored, scope3Other]) {
    for (const f of arr) {
      if (out.length >= limit) break;
      out.push(f);
    }
    if (out.length >= limit) break;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Translation (Vercel AI SDK, gpt-4o-mini)
// ────────────────────────────────────────────────────────────────────────────

async function loadTranslationCache() {
  if (!(await exists(TRANSLATION_CACHE_FILE))) return {};
  try {
    return await readJson(TRANSLATION_CACHE_FILE);
  } catch {
    return {};
  }
}

async function saveTranslationCache(cache) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(TRANSLATION_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

async function translateBatch(items, cache) {
  // items: Array<{ activity_id, name }>. Returns map activity_id → zh.
  // Caller already filtered uncached ones.
  if (items.length === 0) return {};

  const { openai } = await import('@ai-sdk/openai');
  const { generateObject } = await import('ai');
  const { z } = await import('zod');

  const schema = z.object({
    translations: z.array(
      z.object({
        id: z.string(),
        zh: z.string(),
      }),
    ),
  });

  const prompt = [
    'You are translating short emission-factor activity names from English to Simplified Chinese for a carbon-accounting product.',
    '',
    'Rules:',
    "- Output precise, concise Simplified Chinese (under 30 characters).",
    '- Preserve any unit tokens verbatim (e.g. "kg", "kWh", "L", "km", "person-km").',
    '- Preserve technical acronyms (HFC, LPG, HVO, GHG, etc.).',
    '- Do NOT add explanations. Just the translation.',
    '- Return one entry per input id, in any order.',
    '',
    'Inputs:',
    ...items.map((it) => `- id=${JSON.stringify(it.activity_id)} | en=${JSON.stringify(it.name)}`),
  ].join('\n');

  const result = await generateObject({
    model: openai('gpt-4o-mini'),
    schema,
    prompt,
  });

  /** @type {Record<string,string>} */
  const map = {};
  for (const row of result.object.translations) {
    map[row.id] = row.zh.trim();
  }
  // Persist as we go
  for (const it of items) {
    if (map[it.activity_id]) cache[it.activity_id] = map[it.activity_id];
  }
  return map;
}

async function translateAll(entries, cache) {
  if (NO_TRANSLATE || !OPENAI_API_KEY) {
    return entries.map((e) => ({ ...e, name_zh: e.name }));
  }

  const uncached = entries.filter((e) => !cache[e.activity_id]);
  console.log(
    `Translation: ${entries.length - uncached.length} cached, ${uncached.length} to translate via gpt-4o-mini`,
  );

  const BATCH = 40;
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH);
    try {
      await translateBatch(
        batch.map((e) => ({ activity_id: e.activity_id, name: e.name })),
        cache,
      );
      console.log(`  translated ${Math.min(i + BATCH, uncached.length)}/${uncached.length}`);
      await saveTranslationCache(cache);
    } catch (err) {
      console.warn(`  batch ${i / BATCH} failed: ${err.message}`);
      // Don't abort the whole run — leave these untranslated.
    }
  }

  return entries.map((e) => ({ ...e, name_zh: cache[e.activity_id] || e.name }));
}

// ────────────────────────────────────────────────────────────────────────────
// Main pipeline
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  console.log('═'.repeat(80));
  console.log('Climatiq → carbonbook preset catalog');
  console.log('═'.repeat(80));
  console.log(`Sources:  ${SOURCES.join(', ')}`);
  console.log(`Limit:    ${LIMIT}`);
  console.log(`Dry-run:  ${DRY_RUN}`);
  console.log(`Translate: ${!NO_TRANSLATE && !!OPENAI_API_KEY}`);
  console.log('');

  await mkdir(CACHE_DIR, { recursive: true });

  let dataVersion;
  if (CACHE_ONLY) {
    // Best-effort guess from cache filenames (avoids a network call).
    dataVersion = process.env.CLIMATIQ_DATA_VERSION || '33';
    console.log(`Using cached data_version=${dataVersion}`);
  } else {
    dataVersion = await getLatestDataVersion();
    console.log(`Latest data_version: ${dataVersion}`);
  }

  // 1. Crawl
  console.log('\nStep 1 — Crawling sources...');
  /** @type {any[]} */
  const all = [];
  for (const source of SOURCES) {
    try {
      const rows = await crawlSource(source, dataVersion);
      all.push(...rows.map((r) => ({ ...r, _source_crawled: source })));
    } catch (err) {
      console.warn(`  ⚠️  ${source} crawl failed: ${err.message}`);
    }
  }
  console.log(`Total fetched: ${all.length}`);

  // 2. Filter
  console.log('\nStep 2 — Filtering...');
  const filtered = all.filter(passesFilter);
  console.log(`After filter: ${filtered.length}`);

  // 3. Dedupe
  console.log('\nStep 3 — Deduplicating by activity_id...');
  const deduped = dedupeByActivityId(filtered);
  console.log(`After dedupe: ${deduped.length}`);

  // 4. Scope assignment
  console.log('\nStep 4 — Assigning scope...');
  /** @type {Map<string, number>} */
  const missingCats = new Map();
  const withScope = [];
  for (const f of deduped) {
    const scope = CATEGORY_TO_SCOPE[f.category];
    if (!scope) {
      missingCats.set(f.category, (missingCats.get(f.category) || 0) + 1);
      continue;
    }
    withScope.push({ ...f, _scope: scope });
  }
  console.log(`Scope-assigned: ${withScope.length}`);
  if (missingCats.size > 0) {
    console.log(`Unmapped categories (${missingCats.size}):`);
    const sortedMissing = [...missingCats.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cat, n] of sortedMissing.slice(0, 20)) {
      console.log(`  ${n.toString().padStart(5)}  ${cat}`);
    }
    if (sortedMissing.length > 20) {
      console.log(`  ... and ${sortedMissing.length - 20} more`);
    }
  }

  // 5. Curate slice
  console.log('\nStep 5 — Curating slice...');
  const sliced = curatedSlice(withScope, LIMIT);
  console.log(`Sliced to: ${sliced.length}`);
  const byScope = { 1: 0, 2: 0, 3: 0 };
  for (const e of sliced) byScope[e._scope]++;
  console.log(`  Scope 1: ${byScope[1]}`);
  console.log(`  Scope 2: ${byScope[2]}`);
  console.log(`  Scope 3: ${byScope[3]}`);

  // 6. Build entries (English-side ready); translate
  /** @type {Array<{ activity_id: string; name: string; scope: 1|2|3; category: string; hint_unit: string; source: string; region: string; year: number }>} */
  const entriesEn = sliced.map((f) => ({
    activity_id: f.activity_id,
    name: f.name,
    scope: f._scope,
    category: f.category,
    hint_unit: f.unit,
    source: f.source,
    region: f.region,
    year: f.year,
  }));

  if (DRY_RUN) {
    console.log(`\nDry-run complete. ${entriesEn.length} entries would be written.`);
    console.log(`(skipped translation + write)`);
    console.log(`\nElapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }

  console.log('\nStep 6 — Translating to Simplified Chinese...');
  const cache = await loadTranslationCache();
  const translated = await translateAll(entriesEn, cache);
  await saveTranslationCache(cache);

  const untranslated = translated.filter((e) => e.name_zh === e.name).length;
  console.log(`Translated: ${translated.length - untranslated} / ${translated.length}`);
  if (NO_TRANSLATE) {
    console.warn('  (translation skipped via --no-translate)');
  } else if (!OPENAI_API_KEY) {
    console.warn('  (translation skipped: OPENAI_API_KEY not set)');
  } else if (untranslated > 0) {
    console.warn(`  ⚠️  ${untranslated} entries fell back to English name`);
  }

  // 7. Backup existing + write
  console.log('\nStep 7 — Writing output...');
  if (await exists(OUTPUT_FILE)) {
    if (!(await exists(BACKUP_FILE))) {
      await rename(OUTPUT_FILE, BACKUP_FILE);
      console.log(`  Existing catalog backed up to: ${path.relative(DESKTOP_ROOT, BACKUP_FILE)}`);
    } else {
      console.log(`  Backup already present at: ${path.relative(DESKTOP_ROOT, BACKUP_FILE)} (not overwriting)`);
    }
  }

  const outEntries = translated.map((e) => ({
    id: e.activity_id,
    name_zh: e.name_zh,
    name_en: e.name,
    scope: e.scope,
    category: e.category,
    hint_unit: e.hint_unit,
    source: e.source,
    region: e.region,
    year: e.year,
  }));

  const outDoc = {
    __comment__: `Climatiq-derived preset catalog. data_version=${dataVersion}. Generated by desktop/scripts/climatiq-to-presets.mjs from ${SOURCES.join(', ')}. Previous hand-curated v1 catalog kept in preset-sources.handcurated.json.`,
    entries: outEntries,
  };
  await writeJson(OUTPUT_FILE, outDoc);
  console.log(`  Wrote: ${path.relative(DESKTOP_ROOT, OUTPUT_FILE)} (${outEntries.length} entries)`);

  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('Summary');
  console.log('═'.repeat(80));
  console.log(`Fetched:        ${all.length}`);
  console.log(`Filtered:       ${filtered.length}`);
  console.log(`Deduped:        ${deduped.length}`);
  console.log(`Scope-assigned: ${withScope.length}`);
  console.log(`Sliced:         ${sliced.length}`);
  console.log(`Written:        ${outEntries.length}`);
  console.log(`Untranslated:   ${untranslated}`);
  console.log('');
  console.log('By scope:');
  console.log(`  Scope 1: ${byScope[1]}`);
  console.log(`  Scope 2: ${byScope[2]}`);
  console.log(`  Scope 3: ${byScope[3]}`);
  console.log('');
  /** @type {Record<string, number>} */
  const bySource = {};
  for (const e of outEntries) bySource[e.source] = (bySource[e.source] || 0) + 1;
  console.log('By source:');
  for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
  console.log('');
  console.log(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
