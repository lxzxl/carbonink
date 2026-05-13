# EF Matcher v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Combine SQLite FTS5 ranking + a `gpt-4o-mini` recommender to surface the 3 best emission factor candidates for the current document, alongside the existing scope/category-filtered list. Routing API is OUT OF SCOPE — Phase 2.

**Architecture:** New `EfMatcherService` (FTS5 query + LLM call + in-memory cache) behind a new IPC channel `ef:recommend`. ActivityForm renders a "Recommended for this document" section above the full candidate list when an extraction-derived `matcherHint` is present. ExtractionReview threads the hint through `build*InitialValues`.

**Tech Stack:** SQLite FTS5 (built into better-sqlite3), AI SDK 6 + zod (existing), TanStack Query (existing).

**Reference spec:** `docs/specs/2026-05-14-ef-matcher-v1-design.md`

**Baseline:** `commit 22cd453` on `main`. 381 vitest tests passing.

**Discipline notes:**
- The matcher is OPT-IN — code paths without a `matcherHint` (existing tests, future direct callers) MUST continue to work unchanged.
- Maintain green vitest after every task. Test count grows ~25 over the sub-project.
- `pnpm typecheck` must stay clean after every task.
- After every commit verify `git branch --show-current` returns `main`; recover via `git checkout -B main` if empty.
- Pre-existing hazard: `NODE_MODULE_VERSION 145` failures (184+) recover via:
  ```
  rm /Users/lxz/ws/personal/carbonbook/node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node && (cd /Users/lxz/ws/personal/carbonbook && pnpm rebuild better-sqlite3)
  ```
- Tests use `pnpm vitest run --pool=threads` (default forks pool has stuck-worker issues).

---

## Task 1: Migration 010 — FTS5 virtual table + sync triggers

**Files:**
- Create: `src/main/db/migrations/010_ef_fts.sql`
- Create: `tests/main/db/migrations/010_ef_fts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/db/migrations/010_ef_fts.test.ts`:

```ts
import { createTestDb } from '@tests/helpers/db';
import type { Database } from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

function efRowCount(db: Database, table: 'emission_factor' | 'ef_fts'): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return row.c;
}

function insertTestEf(db: Database, factor_code: string, name_zh: string) {
  db.prepare(`
    INSERT INTO emission_factor (
      factor_code, year, source, geography, dataset_version,
      scope, category, input_unit, co2e_kg_per_unit, gwp_basis,
      name_zh, name_en, description_zh, description_en, citation_url
    ) VALUES (?, 2024, 'TEST', 'GLOBAL', '2024.q1',
              1, 'test.cat', 'kg', 1.0, 'AR6',
              ?, '', '', '', 'http://example.com')
  `).run(factor_code, name_zh);
}

describe('migration 010 — ef_fts virtual table', () => {
  it('creates ef_fts and backfills from emission_factor', () => {
    const db = createTestDb();
    expect(efRowCount(db, 'ef_fts')).toBe(efRowCount(db, 'emission_factor'));
  });

  it('INSERT trigger keeps ef_fts in sync', () => {
    const db = createTestDb();
    const before = efRowCount(db, 'ef_fts');
    insertTestEf(db, 'test.trigger.insert', '柴油测试');
    expect(efRowCount(db, 'ef_fts')).toBe(before + 1);
    const hit = db.prepare(`SELECT factor_code FROM ef_fts WHERE ef_fts MATCH ?`).get('柴油测试') as { factor_code: string } | undefined;
    expect(hit?.factor_code).toBe('test.trigger.insert');
  });

  it('UPDATE trigger keeps ef_fts in sync', () => {
    const db = createTestDb();
    insertTestEf(db, 'test.trigger.update', '原始名称');
    db.prepare(`UPDATE emission_factor SET name_zh = ? WHERE factor_code = ?`).run('更新后名称', 'test.trigger.update');
    const oldHit = db.prepare(`SELECT factor_code FROM ef_fts WHERE ef_fts MATCH ?`).get('原始名称');
    const newHit = db.prepare(`SELECT factor_code FROM ef_fts WHERE ef_fts MATCH ?`).get('更新后名称') as { factor_code: string } | undefined;
    expect(oldHit).toBeUndefined();
    expect(newHit?.factor_code).toBe('test.trigger.update');
  });

  it('DELETE trigger keeps ef_fts in sync', () => {
    const db = createTestDb();
    insertTestEf(db, 'test.trigger.delete', '将被删除');
    db.prepare(`DELETE FROM emission_factor WHERE factor_code = ?`).run('test.trigger.delete');
    const hit = db.prepare(`SELECT factor_code FROM ef_fts WHERE ef_fts MATCH ?`).get('将被删除');
    expect(hit).toBeUndefined();
  });

  it('bm25 ranks more relevant rows higher', () => {
    const db = createTestDb();
    // Seed 008 has multiple electricity EFs. Query for '电网' (grid) — all
    // electricity rows should match; the one with '电网' in its name should rank first.
    const rows = db.prepare(`
      SELECT factor_code, bm25(ef_fts) AS rank FROM ef_fts WHERE ef_fts MATCH ?
      ORDER BY rank ASC LIMIT 3
    `).all('电网') as { factor_code: string; rank: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].factor_code).toMatch(/electricity\.grid/);
  });
});
```

Note: `createTestDb()` is the existing helper at `tests/helpers/db.ts` — it runs all migrations on an in-memory DB. After migration 010 is added, `createTestDb()` will pick it up automatically (the migration runner uses `import.meta.glob`).

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/db/migrations/010_ef_fts.test.ts --pool=threads
```
Expected: FAIL with "no such table: ef_fts" (the migration doesn't exist yet).

- [ ] **Step 3: Create the migration**

`src/main/db/migrations/010_ef_fts.sql`:

```sql
-- Migration 010: FTS5 index over emission_factor names + descriptions.
-- Used by EfMatcherService to rank candidate EFs by extraction-derived hints.
-- Tokenizer: unicode61 handles both English and CJK reasonably for short labels.
-- Each Chinese character becomes its own token, which suits our short-label query patterns.

CREATE VIRTUAL TABLE ef_fts USING fts5(
  factor_code UNINDEXED,
  year UNINDEXED,
  source UNINDEXED,
  geography UNINDEXED,
  dataset_version UNINDEXED,
  name_zh,
  name_en,
  description_zh,
  description_en,
  tokenize = "unicode61 remove_diacritics 2"
);

-- Backfill from existing rows.
INSERT INTO ef_fts(factor_code, year, source, geography, dataset_version,
                   name_zh, name_en, description_zh, description_en)
SELECT factor_code, year, source, geography, dataset_version,
       COALESCE(name_zh, ''), COALESCE(name_en, ''),
       COALESCE(description_zh, ''), COALESCE(description_en, '')
FROM emission_factor;

-- Sync triggers.
CREATE TRIGGER ef_fts_ai AFTER INSERT ON emission_factor BEGIN
  INSERT INTO ef_fts(factor_code, year, source, geography, dataset_version,
                     name_zh, name_en, description_zh, description_en)
  VALUES (NEW.factor_code, NEW.year, NEW.source, NEW.geography, NEW.dataset_version,
          COALESCE(NEW.name_zh, ''), COALESCE(NEW.name_en, ''),
          COALESCE(NEW.description_zh, ''), COALESCE(NEW.description_en, ''));
END;

CREATE TRIGGER ef_fts_ad AFTER DELETE ON emission_factor BEGIN
  DELETE FROM ef_fts WHERE
    factor_code = OLD.factor_code AND year = OLD.year AND
    source = OLD.source AND geography = OLD.geography AND
    dataset_version = OLD.dataset_version;
END;

CREATE TRIGGER ef_fts_au AFTER UPDATE ON emission_factor BEGIN
  DELETE FROM ef_fts WHERE
    factor_code = OLD.factor_code AND year = OLD.year AND
    source = OLD.source AND geography = OLD.geography AND
    dataset_version = OLD.dataset_version;
  INSERT INTO ef_fts(factor_code, year, source, geography, dataset_version,
                     name_zh, name_en, description_zh, description_en)
  VALUES (NEW.factor_code, NEW.year, NEW.source, NEW.geography, NEW.dataset_version,
          COALESCE(NEW.name_zh, ''), COALESCE(NEW.name_en, ''),
          COALESCE(NEW.description_zh, ''), COALESCE(NEW.description_en, ''));
END;
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/db/migrations/010_ef_fts.test.ts --pool=threads
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 386 tests passing (381 + 5 new).

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/db/migrations/010_ef_fts.sql tests/main/db/migrations/010_ef_fts.test.ts
git commit -m "feat(db): migration 010 — FTS5 virtual table over emission_factor"
git branch --show-current
```

---

## Task 2: Migration 011 — seed v2 EFs (cover all 5 stages)

**Files:**
- Create: `src/main/db/migrations/011_seed_emission_factors_v2.sql`
- Create: `tests/main/db/migrations/011_seed_v2.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/db/migrations/011_seed_v2.test.ts`:

```ts
import { createTestDb } from '@tests/helpers/db';
import { describe, expect, it } from 'vitest';

describe('migration 011 — seed v2 emission factors', () => {
  it('seeds at least 20 new EFs across fuel/freight/travel/purchase', () => {
    const db = createTestDb();
    const row = db.prepare(`SELECT COUNT(*) AS c FROM emission_factor`).get() as { c: number };
    // 12 from migration 008 + ≥20 new from 011 = ≥32.
    expect(row.c).toBeGreaterThanOrEqual(32);
  });

  it('every seeded EF row has a non-empty citation_url and positive co2e_kg_per_unit', () => {
    const db = createTestDb();
    const bad = db.prepare(`
      SELECT factor_code FROM emission_factor
      WHERE citation_url IS NULL OR citation_url = '' OR co2e_kg_per_unit <= 0
    `).all() as { factor_code: string }[];
    expect(bad).toEqual([]);
  });

  it('covers freight modes (road, rail, sea, air)', () => {
    const db = createTestDb();
    for (const mode of ['road', 'rail', 'sea', 'air']) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM emission_factor WHERE category = ? OR category LIKE ?`).get(`freight.${mode}`, `freight.${mode}.%`) as { c: number };
      expect(row.c, `freight.${mode}`).toBeGreaterThan(0);
    }
  });

  it('covers travel modes (air, rail, taxi)', () => {
    const db = createTestDb();
    for (const mode of ['air', 'rail', 'taxi']) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM emission_factor WHERE category = ? OR category LIKE ?`).get(`travel.${mode}`, `travel.${mode}.%`) as { c: number };
      expect(row.c, `travel.${mode}`).toBeGreaterThan(0);
    }
  });

  it('covers a generic-CNY purchase EF for service invoices', () => {
    const db = createTestDb();
    const row = db.prepare(`
      SELECT factor_code FROM emission_factor
      WHERE input_unit = 'CNY' AND category LIKE 'purchase.%' LIMIT 1
    `).get();
    expect(row).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/db/migrations/011_seed_v2.test.ts --pool=threads
```
Expected: FAIL (assertions fail because migration 011 doesn't exist; total EF count is 12).

- [ ] **Step 3: Create the seed migration**

`src/main/db/migrations/011_seed_emission_factors_v2.sql`. The implementer authors ~20 rows covering the 5 stages. Constraints per row:
- `co2e_kg_per_unit > 0`
- `citation_url` non-empty (any URL; published source URLs preferred but placeholder OK if the EF is a documented estimate)
- `gwp_basis = 'AR6'`
- `scope` is correct for the category
- `input_unit` matches the typical activity-data unit for the category (e.g., `tonne-km` for freight, `passenger-km` for travel except taxi (`vehicle-km`), `kg` or `CNY` for purchase)

Required category coverage (from test assertions):
- freight.road, freight.rail, freight.sea, freight.air (at least one EF each; sub-categories like `freight.road.diesel.heavy` are also fine)
- travel.air, travel.rail, travel.taxi (at least one EF each)
- At least one purchase EF with `input_unit = 'CNY'` (for service-invoice fallback)

Suggested row breakdown (implementer may swap specific coefficients with cited values):
1. `'fuel.lpg.combustion'` (scope 1, kg, IPCC AR6 default)
2. `'fuel.cng.combustion'` (scope 1, m3, IPCC AR6 default)
3. `'fuel.jet_a.combustion'` (scope 1, L, IPCC AR6 default)
4. `'freight.road.generic'` (scope 3, tonne-km, EcoInvent or DEFRA)
5. `'freight.road.heavy_diesel_truck'` (scope 3, tonne-km, DEFRA 2024)
6. `'freight.road.medium_diesel_truck'` (scope 3, tonne-km, DEFRA 2024)
7. `'freight.road.light_van'` (scope 3, tonne-km, DEFRA 2024)
8. `'freight.rail.generic'` (scope 3, tonne-km, DEFRA 2024)
9. `'freight.sea.containerized'` (scope 3, tonne-km, DEFRA 2024)
10. `'freight.air.shorthaul'` (scope 3, tonne-km, DEFRA 2024)
11. `'travel.air.economy.shorthaul'` (scope 3, passenger-km, DEFRA 2024)
12. `'travel.air.economy.longhaul'` (scope 3, passenger-km, DEFRA 2024)
13. `'travel.air.business.longhaul'` (scope 3, passenger-km, DEFRA 2024)
14. `'travel.rail.highspeed_china'` (scope 3, passenger-km, MEE China)
15. `'travel.rail.regular_china'` (scope 3, passenger-km, MEE China)
16. `'travel.taxi.gasoline_vehicle'` (scope 3, vehicle-km, DEFRA 2024)
17. `'purchase.material.steel_primary'` (scope 3, kg, EcoInvent)
18. `'purchase.material.paper_office'` (scope 3, kg, EcoInvent)
19. `'purchase.service.office_supplies_generic'` (scope 3, CNY, MEE China I-O 2024)
20. `'purchase.service.consulting_generic'` (scope 3, CNY, MEE China I-O 2024)

Each row needs the full 16-column INSERT (see migration 008 for the exact column list). The implementer's job:
- write 20 INSERT VALUES tuples
- ensure each test assertion passes (coverage of freight modes, travel modes, CNY purchase EF)
- ensure `citation_url` is non-empty (URL or `'placeholder'` is acceptable for v1)

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/db/migrations/011_seed_v2.test.ts --pool=threads
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 391 passing (386 + 5 new).

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/db/migrations/011_seed_emission_factors_v2.sql tests/main/db/migrations/011_seed_v2.test.ts
git commit -m "feat(db): migration 011 — seed v2 EFs covering fuel/freight/travel/purchase"
git branch --show-current
```

---

## Task 3: Per-stage hint extractor

**Files:**
- Create: `src/main/services/ef-matcher/hint.ts`
- Create: `tests/main/services/ef-matcher/hint.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/services/ef-matcher/hint.test.ts`:

```ts
import { extractHint } from '@main/services/ef-matcher/hint';
import { describe, expect, it } from 'vitest';

describe('extractHint', () => {
  it('china_utility.v1 → supplier_name', () => {
    expect(extractHint('china_utility.v1', { supplier_name: '国家电网北京' })).toContain('国家电网北京');
  });

  it('fuel_receipt.v1 → fuel_type + fuel_category', () => {
    const out = extractHint('fuel_receipt.v1', { fuel_type: '柴油', fuel_category: 'diesel' });
    expect(out).toContain('柴油');
    expect(out).toContain('diesel');
  });

  it('freight.v1 → mode + vehicle_class + supplier_name', () => {
    const out = extractHint('freight.v1', { mode: 'road', vehicle_class: '重型卡车', supplier_name: '顺丰' });
    expect(out).toContain('road');
    expect(out).toContain('重型卡车');
    expect(out).toContain('顺丰');
  });

  it('purchase.v1 → category + item_description + supplier_name', () => {
    const out = extractHint('purchase.v1', { category: 'raw_material', item_description: '冷轧钢板', supplier_name: '宝钢' });
    expect(out).toContain('raw_material');
    expect(out).toContain('冷轧钢板');
    expect(out).toContain('宝钢');
  });

  it('travel.v1 → mode + travel_class + supplier_name', () => {
    const out = extractHint('travel.v1', { mode: 'air', travel_class: '经济舱', supplier_name: '国航' });
    expect(out).toContain('air');
    expect(out).toContain('经济舱');
    expect(out).toContain('国航');
  });

  it('returns empty string for unknown stage', () => {
    expect(extractHint('unknown.v9', { foo: 'bar' })).toBe('');
  });

  it('skips null/undefined/empty fields', () => {
    const out = extractHint('freight.v1', { mode: 'road', vehicle_class: null, supplier_name: '' });
    expect(out).toContain('road');
    expect(out).not.toContain('null');
    expect(out.split(/\s+/).filter(Boolean).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/ef-matcher/hint.test.ts --pool=threads
```
Expected: FAIL with "Cannot find module '@main/services/ef-matcher/hint'".

- [ ] **Step 3: Implement**

`src/main/services/ef-matcher/hint.ts`:

```ts
/**
 * Build the FTS5 query string for a given extraction.
 *
 * The hint extractor pulls the salient free-text fields per stage and
 * concatenates them. FTS5's bm25 will then rank emission factors by
 * which of these tokens appear in their names/descriptions.
 *
 * Null / undefined / empty values are skipped. Unknown stage → empty
 * string (caller handles "no hint" as a fall-back signal).
 */
export function extractHint(stageId: string, parsed: Record<string, unknown>): string {
  const fields: Record<string, string[]> = {
    'china_utility.v1': ['supplier_name'],
    'fuel_receipt.v1': ['fuel_type', 'fuel_category'],
    'freight.v1': ['mode', 'vehicle_class', 'supplier_name'],
    'purchase.v1': ['category', 'item_description', 'supplier_name'],
    'travel.v1': ['mode', 'travel_class', 'supplier_name'],
  };
  const keys = fields[stageId];
  if (!keys) return '';
  return keys
    .map((k) => parsed[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .join(' ');
}
```

- [ ] **Step 4: Run test to confirm pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/ef-matcher/hint.test.ts --pool=threads
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/ef-matcher/hint.ts tests/main/services/ef-matcher/hint.test.ts
git commit -m "feat(matcher): per-stage hint extractor for FTS5 queries"
git branch --show-current
```
Expected: 398 passing (391 + 7).

---

## Task 4: LLM client — `recommendEfs` method

**Files:**
- Modify: `src/main/llm/llm-client.ts` — add `recommendEfs()` method
- Create: `tests/main/llm/llm-client-recommend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/llm/llm-client-recommend.test.ts`:

```ts
import { LLMClient } from '@main/llm/llm-client';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

describe('LLMClient.recommendEfs', () => {
  it('builds a structured-output call with the recommendation schema', async () => {
    const fakeConfig = { provider: 'openai' as const, model: 'gpt-4o-mini', apiKey: 'sk-fake' };
    const client = new LLMClient();
    // Stub `extract` (which `recommendEfs` delegates to).
    const stub = vi.spyOn(client, 'extract').mockResolvedValue({
      recommendations: [
        { factor_code: 'fuel.diesel.combustion', year: 2024, source: 'IPCC_AR6', geography: 'GLOBAL', dataset_version: '2024.q1', reasoning_zh: '直接命中柴油' },
        { factor_code: 'electricity.grid.cn.national.2024', year: 2024, source: 'MEE_China', geography: 'CN', dataset_version: '2024.q4', reasoning_zh: '兜底选项' },
        { factor_code: 'fuel.gasoline.combustion', year: 2024, source: 'IPCC_AR6', geography: 'GLOBAL', dataset_version: '2024.q1', reasoning_zh: '同类燃料' },
      ],
    } as unknown as never);

    const result = await client.recommendEfs(fakeConfig, '{"fuel_type":"柴油"}', [
      { factor_code: 'fuel.diesel.combustion', year: 2024, source: 'IPCC_AR6', geography: 'GLOBAL', dataset_version: '2024.q1' } as never,
    ]);

    expect(result.recommendations).toHaveLength(3);
    expect(stub).toHaveBeenCalledTimes(1);
    // The schema passed to `extract` must be a zod schema with a `.parse` method.
    const [, schema, prompt] = stub.mock.calls[0] ?? [];
    expect(schema).toBeDefined();
    expect((schema as z.ZodType).parse).toBeTypeOf('function');
    // The prompt must include the candidates so the model can see them.
    expect(prompt).toContain('fuel.diesel.combustion');
    // The prompt must include the parsed extraction.
    expect(prompt).toContain('柴油');
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/llm-client-recommend.test.ts --pool=threads
```
Expected: FAIL ("recommendEfs is not a function").

- [ ] **Step 3: Implement**

Add to `src/main/llm/llm-client.ts` (at the bottom of the `LLMClient` class, before the closing `}`):

```ts
  /**
   * Ask the LLM to pick the 3 most-relevant emission factors from a
   * pre-filtered candidate list. Used by EfMatcherService to overlay
   * "Recommended for this document" suggestions on the EF picker.
   *
   * Inputs:
   * - `parsedJson`: the extraction's parsed_json string (the same blob
   *   the renderer renders fields from).
   * - `candidates`: the FTS5-ranked candidate list (max 20 rows).
   *
   * Output: zod-validated `{ recommendations: 3 × {composite_pk, reasoning_zh} }`.
   * Throws if the model fails schema validation (caller catches and
   * falls back to FTS5-only).
   */
  async recommendEfs(
    config: ProviderConfig,
    parsedJson: string,
    candidates: ReadonlyArray<{
      factor_code: string;
      year: number;
      source: string;
      geography: string;
      dataset_version: string;
      input_unit?: string;
      name_zh?: string | null;
      name_en?: string | null;
      description_zh?: string | null;
      co2e_kg_per_unit?: number;
    }>,
  ): Promise<{ recommendations: Array<{ factor_code: string; year: number; source: string; geography: string; dataset_version: string; reasoning_zh: string }> }> {
    const schema = z.object({
      recommendations: z.array(
        z.object({
          factor_code: z.string(),
          year: z.number().int(),
          source: z.string(),
          geography: z.string(),
          dataset_version: z.string(),
          reasoning_zh: z.string().max(200),
        }),
      ).length(3),
    });

    const candidateList = candidates
      .map((c, i) => {
        const name = c.name_zh ?? c.name_en ?? c.factor_code;
        const desc = c.description_zh ?? '';
        return `${i + 1}. ${c.factor_code} | ${c.year} | ${c.geography} | ${c.input_unit ?? '?'} | ${c.co2e_kg_per_unit ?? '?'} kgCO2e/unit | ${name}${desc ? ' — ' + desc : ''}`;
      })
      .join('\n');

    const prompt = `你是一名碳核算助理。下面是一份单据的抽取结果（parsed_json），以及一个候选排放因子清单。
请从候选清单中选出最贴合该单据的 3 个排放因子，并给出 1-2 句简短的中文理由。

<parsed_json>
${parsedJson}
</parsed_json>

<candidates>
${candidateList}
</candidates>

返回 JSON：{ recommendations: [3 个对象，每个包含完整复合主键 factor_code/year/source/geography/dataset_version 以及 reasoning_zh] }。
factor_code 等 5 个键必须从上方候选清单中原样复制；不要凭空构造。`;

    return this.extract(config, schema, prompt);
  }
```

Note: if the `LLMClient` file has top-level zod usage already, the `import { z } from 'zod';` is already present. If not, add it to the imports block.

- [ ] **Step 4: Run test to confirm pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/llm-client-recommend.test.ts --pool=threads
```
Expected: PASS, 1 test.

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/llm/llm-client.ts tests/main/llm/llm-client-recommend.test.ts
git commit -m "feat(llm): LLMClient.recommendEfs — top-K EF picker"
git branch --show-current
```
Expected: 399 passing (398 + 1).

---

## Task 5: EfMatcherService — FTS5 ranking + LLM wiring + cache

**Files:**
- Create: `src/main/services/ef-matcher-service.ts`
- Create: `tests/main/services/ef-matcher-service.test.ts`
- Modify: `src/shared/types.ts` — add `MatcherRecommendation`, `MatcherResult`, `RecommendQuery` exports

- [ ] **Step 1: Add shared types**

In `src/shared/types.ts`, add (alphabetically positioned):

```ts
export type RecommendQuery = {
  extraction_id: string;
  emission_source_id: string;
};

export type MatcherRecommendation = {
  ef: EmissionFactor;
  reasoning_zh: string;
};

export type MatcherResult = {
  recommended: MatcherRecommendation[];   // 0-3 items
  ranked_full: EmissionFactor[];          // ≤ 20 items, FTS5-sorted
};
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/services/ef-matcher-service.test.ts`:

```ts
import { EfMatcherService } from '@main/services/ef-matcher-service';
import type { Extraction } from '@shared/types';
import { createTestDb } from '@tests/helpers/db';
import { describe, expect, it, vi } from 'vitest';

function makeService(deps?: Partial<ConstructorParameters<typeof EfMatcherService>[0]>) {
  const db = createTestDb();
  const extractionService = {
    get: vi.fn().mockResolvedValue(null),
  };
  const emissionSourceService = {
    get: vi.fn().mockResolvedValue(null),
  };
  const efService = {
    list: vi.fn().mockReturnValue([]),
  };
  const llmClient = {
    recommendEfs: vi.fn().mockResolvedValue({ recommendations: [] }),
  };
  return new EfMatcherService({
    db,
    efService: efService as never,
    extractionService: extractionService as never,
    emissionSourceService: emissionSourceService as never,
    llmClient: llmClient as never,
    config: { provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-fake' } as never,
    ...deps,
  });
}

describe('EfMatcherService.recommend', () => {
  it('returns empty result when candidate list is empty', async () => {
    const ext = { id: 'e1', parsed_json: '{}', prompt_version: 'china_utility.v1' } as Extraction;
    const svc = makeService({
      extractionService: { get: vi.fn().mockResolvedValue(ext) } as never,
      emissionSourceService: { get: vi.fn().mockResolvedValue({ scope: 2, category: 'electricity.grid' }) } as never,
      efService: { list: vi.fn().mockReturnValue([]) } as never,
    });
    const r = await svc.recommend({ extraction_id: 'e1', emission_source_id: 's1' });
    expect(r).toEqual({ recommended: [], ranked_full: [] });
  });

  it('returns ranked_full sorted by FTS5 even when LLM fails', async () => {
    const ext = { id: 'e2', parsed_json: '{"fuel_type":"柴油"}', prompt_version: 'fuel_receipt.v1' } as Extraction;
    const candidates = [
      { factor_code: 'fuel.gasoline.combustion', year: 2024, source: 'IPCC_AR6', geography: 'GLOBAL', dataset_version: '2024.q1', name_zh: '汽油' } as never,
      { factor_code: 'fuel.diesel.combustion', year: 2024, source: 'IPCC_AR6', geography: 'GLOBAL', dataset_version: '2024.q1', name_zh: '柴油' } as never,
    ];
    const svc = makeService({
      extractionService: { get: vi.fn().mockResolvedValue(ext) } as never,
      emissionSourceService: { get: vi.fn().mockResolvedValue({ scope: 1, category: 'fuel.combustion' }) } as never,
      efService: { list: vi.fn().mockReturnValue(candidates) } as never,
      llmClient: { recommendEfs: vi.fn().mockRejectedValue(new Error('LLM down')) } as never,
    });
    const r = await svc.recommend({ extraction_id: 'e2', emission_source_id: 's2' });
    expect(r.recommended).toEqual([]);
    expect(r.ranked_full.length).toBeGreaterThan(0);
  });

  it('drops LLM-hallucinated PKs that do not match any candidate', async () => {
    const ext = { id: 'e3', parsed_json: '{}', prompt_version: 'china_utility.v1' } as Extraction;
    const candidates = [
      { factor_code: 'electricity.grid.cn.national.2024', year: 2024, source: 'MEE_China', geography: 'CN', dataset_version: '2024.q4' } as never,
    ];
    const svc = makeService({
      extractionService: { get: vi.fn().mockResolvedValue(ext) } as never,
      emissionSourceService: { get: vi.fn().mockResolvedValue({ scope: 2, category: 'electricity.grid' }) } as never,
      efService: { list: vi.fn().mockReturnValue(candidates) } as never,
      llmClient: {
        recommendEfs: vi.fn().mockResolvedValue({
          recommendations: [
            { factor_code: 'HALLUCINATED', year: 2024, source: 'X', geography: 'X', dataset_version: 'x', reasoning_zh: '幻觉' },
            { factor_code: 'electricity.grid.cn.national.2024', year: 2024, source: 'MEE_China', geography: 'CN', dataset_version: '2024.q4', reasoning_zh: '匹配' },
            { factor_code: 'ALSO_HALLUCINATED', year: 2024, source: 'X', geography: 'X', dataset_version: 'x', reasoning_zh: '幻觉2' },
          ],
        }),
      } as never,
    });
    const r = await svc.recommend({ extraction_id: 'e3', emission_source_id: 's3' });
    expect(r.recommended).toHaveLength(1);
    expect(r.recommended[0].ef.factor_code).toBe('electricity.grid.cn.national.2024');
  });

  it('caches by (extraction_id, source_id)', async () => {
    const ext = { id: 'e4', parsed_json: '{}', prompt_version: 'china_utility.v1' } as Extraction;
    const recommend = vi.fn().mockResolvedValue({ recommendations: [] });
    const svc = makeService({
      extractionService: { get: vi.fn().mockResolvedValue(ext) } as never,
      emissionSourceService: { get: vi.fn().mockResolvedValue({ scope: 2, category: 'electricity.grid' }) } as never,
      efService: { list: vi.fn().mockReturnValue([{ factor_code: 'x', year: 1, source: 's', geography: 'g', dataset_version: 'v' } as never]) } as never,
      llmClient: { recommendEfs: recommend } as never,
    });
    await svc.recommend({ extraction_id: 'e4', emission_source_id: 's4' });
    await svc.recommend({ extraction_id: 'e4', emission_source_id: 's4' });
    expect(recommend).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run test to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/ef-matcher-service.test.ts --pool=threads
```
Expected: FAIL ("Cannot find module").

- [ ] **Step 4: Implement service**

`src/main/services/ef-matcher-service.ts`:

```ts
import type { Database } from 'better-sqlite3';
import type { ProviderConfig } from '@main/llm/llm-client';
import type { LLMClient } from '@main/llm/llm-client';
import type { EmissionFactor, MatcherResult, RecommendQuery } from '@shared/types';
import type { EfService } from './ef-service';
import type { ExtractionService } from './extraction-service';
import type { EmissionSourceService } from './emission-source-service';
import { extractHint } from './ef-matcher/hint';

const CANDIDATE_LIMIT = 20;

export class EfMatcherService {
  private readonly cache = new Map<string, MatcherResult>();

  constructor(
    private readonly deps: {
      db: Database;
      efService: EfService;
      extractionService: ExtractionService;
      emissionSourceService: EmissionSourceService;
      llmClient: LLMClient;
      config: ProviderConfig;
    },
  ) {}

  async recommend(q: RecommendQuery): Promise<MatcherResult> {
    const cacheKey = `${q.extraction_id}|${q.emission_source_id}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // 1. Fetch extraction + source.
    const ext = await this.deps.extractionService.get(q.extraction_id);
    const src = await this.deps.emissionSourceService.get(q.emission_source_id);
    if (!ext || !src) {
      const empty: MatcherResult = { recommended: [], ranked_full: [] };
      this.cache.set(cacheKey, empty);
      return empty;
    }

    // 2. Candidate list via scope + category filter.
    const filter: { scope: 1 | 2 | 3; category?: string } = { scope: src.scope as 1 | 2 | 3 };
    if (src.category) filter.category = src.category;
    const candidates = this.deps.efService.list(filter);

    if (candidates.length === 0) {
      const empty: MatcherResult = { recommended: [], ranked_full: [] };
      this.cache.set(cacheKey, empty);
      return empty;
    }

    // 3. FTS5 ranking — sort candidates by bm25 against hint.
    const parsed = JSON.parse(ext.parsed_json ?? '{}') as Record<string, unknown>;
    const hint = extractHint(ext.prompt_version, parsed);
    const rankedFull = this.rankByFts(candidates, hint).slice(0, CANDIDATE_LIMIT);

    // 4. LLM top-3.
    let recommended: MatcherResult['recommended'] = [];
    try {
      const llmResult = await this.deps.llmClient.recommendEfs(
        this.deps.config,
        ext.parsed_json ?? '{}',
        rankedFull,
      );
      recommended = llmResult.recommendations
        .map((rec) => {
          const ef = rankedFull.find(
            (c) =>
              c.factor_code === rec.factor_code &&
              c.year === rec.year &&
              c.source === rec.source &&
              c.geography === rec.geography &&
              c.dataset_version === rec.dataset_version,
          );
          return ef ? { ef, reasoning_zh: rec.reasoning_zh } : null;
        })
        .filter((x): x is { ef: EmissionFactor; reasoning_zh: string } => x !== null);
    } catch (err) {
      // Silent fallback — log to console but don't bubble.
      // eslint-disable-next-line no-console
      console.warn('[ef-matcher] LLM recommend failed:', err instanceof Error ? err.message : err);
      recommended = [];
    }

    const result: MatcherResult = { recommended, ranked_full: rankedFull };
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Sort `candidates` by FTS5 bm25 against `hint`. Returns the same set
   * (composite-PK intersected) in ranked order. If hint is empty or FTS5
   * returns no matches, falls back to the input order.
   */
  private rankByFts(candidates: readonly EmissionFactor[], hint: string): EmissionFactor[] {
    if (!hint || candidates.length === 0) return [...candidates];

    // FTS5 query string: quote the whole thing to escape any reserved chars.
    const ftsQuery = `"${hint.replace(/"/g, '""')}"`;

    const rankedPks = this.deps.db
      .prepare(`
        SELECT factor_code, year, source, geography, dataset_version
        FROM ef_fts WHERE ef_fts MATCH ?
        ORDER BY bm25(ef_fts) ASC
      `)
      .all(ftsQuery) as Array<{ factor_code: string; year: number; source: string; geography: string; dataset_version: string }>;

    // Intersect with candidates (by composite PK).
    const candidateKey = (e: { factor_code: string; year: number; source: string; geography: string; dataset_version: string }) =>
      `${e.factor_code}|${e.year}|${e.source}|${e.geography}|${e.dataset_version}`;
    const candidateMap = new Map(candidates.map((c) => [candidateKey(c), c]));

    const ordered: EmissionFactor[] = [];
    const seen = new Set<string>();
    for (const r of rankedPks) {
      const k = candidateKey(r);
      const hit = candidateMap.get(k);
      if (hit) {
        ordered.push(hit);
        seen.add(k);
      }
    }
    // Append any candidates that didn't match FTS5 (no token overlap).
    for (const c of candidates) {
      const k = candidateKey(c);
      if (!seen.has(k)) ordered.push(c);
    }
    return ordered;
  }
}
```

Note on `ProviderConfig`: if it's not currently exported from `llm-client.ts`, add `export` to its declaration.

- [ ] **Step 5: Run test to confirm pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/ef-matcher-service.test.ts --pool=threads
```
Expected: PASS, 4 tests.

- [ ] **Step 6: typecheck + full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/ef-matcher-service.ts src/shared/types.ts tests/main/services/ef-matcher-service.test.ts
git commit -m "feat(matcher): EfMatcherService — FTS5 ranking + LLM top-K + cache"
git branch --show-current
```
Expected: 403 passing (399 + 4).

---

## Task 6: IPC channel `ef:recommend` + renderer API client

**Files:**
- Modify: `src/main/ipc/types.ts` — add `'ef:recommend'` to `IpcTypeMap`
- Create: `src/main/ipc/handlers/ef-matcher.ts`
- Modify: `src/main/ipc/setup.ts` — register the new handler
- Modify: `src/main/ipc/context.ts` — add `efMatcherService` to `IpcContext`
- Modify: `src/preload/bridge.ts` — add `'ef:recommend'` to `allowedChannels`
- Create: `src/renderer/lib/api/ef-matcher.ts`
- Create: `tests/main/ipc/handlers/ef-matcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/ipc/handlers/ef-matcher.test.ts`:

```ts
import { efMatcherHandlers } from '@main/ipc/handlers/ef-matcher';
import { describe, expect, it, vi } from 'vitest';

function makeCtx() {
  return {
    efMatcherService: {
      recommend: vi.fn().mockResolvedValue({ recommended: [], ranked_full: [] }),
    },
  } as never;
}

describe('ef:recommend handler', () => {
  it('zod-rejects malformed input (missing extraction_id)', async () => {
    const ctx = makeCtx();
    const handlers = efMatcherHandlers(ctx);
    await expect(handlers['ef:recommend']!({ emission_source_id: 's1' } as never)).rejects.toThrow();
  });

  it('zod-rejects malformed input (missing emission_source_id)', async () => {
    const ctx = makeCtx();
    const handlers = efMatcherHandlers(ctx);
    await expect(handlers['ef:recommend']!({ extraction_id: 'e1' } as never)).rejects.toThrow();
  });

  it('delegates to service on valid input', async () => {
    const ctx = makeCtx();
    const handlers = efMatcherHandlers(ctx);
    const result = await handlers['ef:recommend']!({ extraction_id: 'e1', emission_source_id: 's1' });
    expect(ctx.efMatcherService.recommend).toHaveBeenCalledWith({ extraction_id: 'e1', emission_source_id: 's1' });
    expect(result).toEqual({ recommended: [], ranked_full: [] });
  });
});
```

- [ ] **Step 2: Implement handler**

`src/main/ipc/handlers/ef-matcher.ts`:

```ts
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const recommendQuery = z.object({
  extraction_id: z.string().min(1),
  emission_source_id: z.string().min(1),
});

export function efMatcherHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'ef:recommend': (input) => ctx.efMatcherService.recommend(recommendQuery.parse(input)),
  };
}
```

- [ ] **Step 3: Wire it up**

In `src/main/ipc/types.ts`, add to the `IpcTypeMap`:
```ts
'ef:recommend': (input: RecommendQuery) => Promise<MatcherResult>;
```
Import `RecommendQuery` and `MatcherResult` from `@shared/types`.

In `src/main/ipc/context.ts`, add `efMatcherService: EfMatcherService` (with the matching import).

In `src/main/ipc/setup.ts`, register `efMatcherHandlers(ctx)` in whatever pattern the existing handlers use (e.g., add to the handler-merge call).

In `src/preload/bridge.ts`, add `'ef:recommend'` to `allowedChannels`.

- [ ] **Step 4: Create renderer API client**

`src/renderer/lib/api/ef-matcher.ts`:

```ts
import type { MatcherResult, RecommendQuery } from '@shared/types';

declare global {
  interface Window {
    api: {
      invoke<T>(channel: string, payload?: unknown): Promise<T>;
    };
  }
}

export const efMatcherApi = {
  recommend: (input: RecommendQuery): Promise<MatcherResult> => window.api.invoke('ef:recommend', input),
};
```

If the codebase has an existing renderer API client pattern (e.g., a shared `invoke` helper), match it — read `src/renderer/lib/api/emission-source.ts` as the canonical pattern.

- [ ] **Step 5: Find the main app wiring + register the service**

Find the main-process bootstrap that constructs `IpcContext`. Add a step: instantiate `EfMatcherService` with the existing dependencies (db, efService, extractionService, emissionSourceService, llmClient, config), then put it on `ctx`.

The bootstrap location is likely `src/main/index.ts` or `src/main/setup-services.ts` — search for where existing services like `EfService` and `ExtractionService` are instantiated.

- [ ] **Step 6: Run typecheck + tests**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run tests/main/ipc/handlers/ef-matcher.test.ts --pool=threads
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: typecheck clean. Handler test passes (3 tests). Full suite 406 passing (403 + 3).

- [ ] **Step 7: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/ipc/handlers/ef-matcher.ts src/main/ipc/types.ts src/main/ipc/context.ts src/main/ipc/setup.ts src/preload/bridge.ts src/renderer/lib/api/ef-matcher.ts tests/main/ipc/handlers/ef-matcher.test.ts
# also include any service-bootstrap file you modified in step 5
git status
git commit -m "feat(ipc): ef:recommend channel + renderer efMatcherApi client"
git branch --show-current
```

---

## Task 7: Wire matcherHint through ExtractionReview → all 5 builders → ActivityForm

**Files:**
- Modify: `src/renderer/components/ExtractionReview.tsx`
- Modify: All 5 `src/renderer/components/extractions/<stage>/prefill.ts` files
- Modify: `src/renderer/components/ActivityForm.tsx` (add `matcherHint` to `ActivityFormInitialValues`)

This is a PURE plumbing task — no UX yet. Just thread the value through. The `matcherHint` is OPTIONAL throughout.

- [ ] **Step 1: Extend `ActivityFormInitialValues`**

In `src/renderer/components/ActivityForm.tsx`, find the `ActivityFormInitialValues` type definition. Add:
```ts
matcherHint?: { extraction_id: string; stage_id: string };
```

- [ ] **Step 2: Update all 5 prefill builders**

For each of `src/renderer/components/extractions/{china-utility,fuel-receipt,freight,purchase,travel}/prefill.ts`, change the function signature to accept a third optional parameter and pass it through:

```ts
export function build<Stage>InitialValues(
  data: <Stage>Parsed,
  filename: string,
  matcherHint?: { extraction_id: string; stage_id: string },
): ActivityFormInitialValues {
  const out: ActivityFormInitialValues = {
    // ... existing body
  };
  if (matcherHint) out.matcherHint = matcherHint;
  return out;
}
```

The order of body operations is preserved — `matcherHint` is set at the end alongside `amount`.

- [ ] **Step 3: Update orchestrator**

In `src/renderer/components/ExtractionReview.tsx`, in the JSX where `initialValues` is built (the 5-arm ternary), construct the hint once:

```tsx
const matcherHint = {
  extraction_id: extraction.id,
  stage_id: extraction.prompt_version,
};
```

(Place this near the top of the component body, alongside the existing `useMemo(parseExtraction, ...)` line.)

Then pass `matcherHint` as the 3rd arg to each `build*InitialValues` call:

```tsx
parsed.stage === 'china_utility.v1'
  ? buildChinaUtilityInitialValues(parsed.data, document.filename, matcherHint)
  : parsed.stage === 'fuel_receipt.v1'
    ? buildFuelReceiptInitialValues(parsed.data, document.filename, matcherHint)
    : parsed.stage === 'freight.v1'
      ? buildFreightInitialValues(parsed.data, document.filename, matcherHint)
      : parsed.stage === 'purchase.v1'
        ? buildPurchaseInitialValues(parsed.data, document.filename, matcherHint)
        : buildTravelInitialValues(parsed.data, document.filename, matcherHint)
```

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean. The signature change is additive (3rd param optional) so existing callers compile.

- [ ] **Step 5: Run full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: 406 passing — UNCHANGED count. No new tests in this task; the existing 4 documents-review renderer tests + the integration smokes all continue to pass because `matcherHint` is opt-in.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/ActivityForm.tsx src/renderer/components/extractions/ src/renderer/components/ExtractionReview.tsx
git commit -m "feat(ui): thread matcherHint through ExtractionReview to ActivityForm"
git branch --show-current
```

---

## Task 8: i18n keys for matcher UX

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

- [ ] **Step 1: Add keys**

`messages/en.json` (alphabetically positioned among the existing keys):
```json
"ef_matcher_all_candidates": "All candidates",
"ef_matcher_loading": "Analyzing...",
"ef_matcher_no_candidates": "No emission factors match this source's scope/category.",
"ef_matcher_reasoning_label": "Reason:",
"ef_matcher_recommended_heading": "Recommended for this document"
```

`messages/zh-CN.json` (matching positions):
```json
"ef_matcher_all_candidates": "全部候选",
"ef_matcher_loading": "正在分析...",
"ef_matcher_no_candidates": "未找到与该排放源范围/类别匹配的排放因子。",
"ef_matcher_reasoning_label": "原因：",
"ef_matcher_recommended_heading": "为本单据推荐"
```

- [ ] **Step 2: Regenerate paraglide bindings (if there's a build step)**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Paraglide's vite plugin auto-regenerates on file change. If `pnpm typecheck` fails with "Cannot find name 'm.ef_matcher_recommended_heading'" later, you may need to run `pnpm paraglide:compile` or similar — check `package.json` scripts.

- [ ] **Step 3: Run full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add messages/en.json messages/zh-CN.json
git commit -m "feat(i18n): EF matcher UX strings (en + zh-CN)"
git branch --show-current
```
Expected: 406 passing — unchanged.

---

## Task 9: ActivityForm — Recommended section UX

**Files:**
- Modify: `src/renderer/components/ActivityForm.tsx`
- Create: `tests/renderer/activity-form-matcher.test.tsx`

- [ ] **Step 1: Write the failing renderer tests**

Create `tests/renderer/activity-form-matcher.test.tsx`. Model after the existing `tests/renderer/documents-review.test.tsx`. Three tests:

```tsx
// Test 1: matcherHint set + LLM happy path → Recommended section renders 3 starred rows.
// Test 2: matcherHint set + LLM fails (mocked rejection) → no Recommended section; full list still renders.
// Test 3: matcherHint absent → no Recommended section (current behavior preserved).
```

The implementer should mirror the existing test scaffold (QueryClient setup, TanStack Router stub, vi-mock of `efMatcherApi`).

Mocks to install:
```ts
vi.mock('@renderer/lib/api/ef-matcher', () => ({
  efMatcherApi: {
    recommend: vi.fn(),
  },
}));
```

Per test, set the mock implementation:
- Test 1: `mockResolvedValue({ recommended: [{ ef: <EF>, reasoning_zh: '直接命中' }, ...], ranked_full: [...] })`. Assert the heading `m.ef_matcher_recommended_heading` text renders; assert 3 EF names are in the DOM.
- Test 2: `mockRejectedValue(new Error('LLM down'))`. Assert the heading does NOT render. Assert at least one full-list EF row is in the DOM.
- Test 3: pass `initialValues={{ unit: 'kWh' }}` (no matcherHint). Assert the heading does NOT render. Assert the recommend mock was NEVER called.

- [ ] **Step 2: Run tests to confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/renderer/activity-form-matcher.test.tsx --pool=threads
```
Expected: FAIL.

- [ ] **Step 3: Implement in ActivityForm**

Within `src/renderer/components/ActivityForm.tsx`:

1. Read the `matcherHint` from `initialValues` (it's now part of the type).
2. Add a TanStack Query:
   ```ts
   const matcherQuery = useQuery({
     queryKey: ['ef:recommend', initialValues?.matcherHint?.extraction_id, selectedSourceId],
     queryFn: () => efMatcherApi.recommend({
       extraction_id: initialValues!.matcherHint!.extraction_id,
       emission_source_id: selectedSourceId!,
     }),
     enabled: !!initialValues?.matcherHint && !!selectedSourceId,
     staleTime: Infinity,
   });
   ```
3. In the JSX, BEFORE the existing EF radio list, render the Recommended section conditionally:
   ```tsx
   {initialValues?.matcherHint && selectedSourceId && (matcherQuery.isLoading || (matcherQuery.data?.recommended.length ?? 0) > 0) && (
     <div className="rounded-md border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/5 p-3">
       <h4 className="text-sm font-medium">{m.ef_matcher_recommended_heading()}</h4>
       {matcherQuery.isLoading ? (
         <p className="text-xs text-muted-foreground">{m.ef_matcher_loading()}</p>
       ) : (
         <ul className="mt-2 space-y-2">
           {matcherQuery.data?.recommended.map((rec) => (
             <li key={efKey(rec.ef)} className="text-sm">
               <label className="flex items-start gap-2">
                 <input
                   type="radio"
                   name="ef"
                   checked={selectedEfKey === efKey(rec.ef)}
                   onChange={() => pickEf(rec.ef)}
                 />
                 <span>
                   <span className="font-medium">⭐ {rec.ef.name_zh ?? rec.ef.name_en ?? rec.ef.factor_code}</span>
                   <span className="ml-2 text-xs text-muted-foreground">{rec.ef.co2e_kg_per_unit} kgCO₂e/{rec.ef.input_unit}</span>
                   <span className="block text-xs text-muted-foreground">{m.ef_matcher_reasoning_label()} {rec.reasoning_zh}</span>
                 </span>
               </label>
             </li>
           ))}
         </ul>
       )}
     </div>
   )}
   ```
4. Below the Recommended section, render the existing full list (with a heading `m.ef_matcher_all_candidates()`).
5. Import the API client:
   ```ts
   import { efMatcherApi } from '@renderer/lib/api/ef-matcher';
   ```

- [ ] **Step 4: Run renderer test to confirm pass**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/renderer/activity-form-matcher.test.tsx --pool=threads
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Full suite + typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm vitest run --pool=threads 2>&1 | tail -5
```
Expected: typecheck clean. 409 passing (406 + 3).

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/ActivityForm.tsx tests/renderer/activity-form-matcher.test.tsx
git commit -m "feat(ui): ActivityForm renders Recommended section when matcherHint is present"
git branch --show-current
```

---

## Task 10: Full test + lint sweep

**Files:** none — verification only.

- [ ] **Step 1: Run full suite**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -10
```
Expected: ≥409 tests passing.

- [ ] **Step 2: Typecheck**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean.

- [ ] **Step 3: Format + lint**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format
pnpm lint --max-diagnostics=80 2>&1 | tail -15
```
Expected: format may rewrite some files; lint shows 0 errors. If lint reports `assist/source/organizeImports` on the new files, fix manually with Edit.

If `pnpm format` made changes:
```bash
git diff --stat
git add -A
git commit -m "chore: biome format pass for EF Matcher v1"
```

- [ ] **Step 4: Branch sanity**

```bash
cd /Users/lxz/ws/personal/carbonbook
git branch --show-current
git log --oneline -15
```
Expected: `main` (not detached). The last ~10 commits are the EF Matcher tasks.

If `git branch --show-current` returns empty:
```bash
git checkout -B main
```

---

## Closeout

Sub-project 5 of 5 (EF Matcher v1) — the FINAL Phase 1 deliverable — lands on `main` with NO tag yet. After this lands, the consolidated manual smoke + `phase-1d` tag are the closing actions.

**Expected end state:**

- Migrations 010 (FTS5) and 011 (seed v2) applied.
- `ef_fts` virtual table present and trigger-synced with `emission_factor`.
- ~32 EFs in the catalog (up from 12).
- `EfMatcherService` registered on the IPC context.
- `ef:recommend` IPC channel reachable from the renderer.
- ActivityForm renders a "Recommended for this document" section above the full candidate list when the user reviews an extraction; degrades gracefully (full list still shown) if the LLM fails.
- `matcherHint` threaded through all 5 per-stage prefill builders.
- 5 new i18n keys (× 2 locales).
- ≥409 vitest tests passing.
- `pnpm typecheck` clean.
- `pnpm lint --max-diagnostics=80` shows 0 errors; only the pre-existing `noNonNullAssertion` warnings.

**Next:** consolidated manual smoke covering all 5 stages × Confirm flow × recommender ON, then tag `phase-1d`. Phase 2 work (routing API, EF library authoring, recommender confidence tuning) follows.
