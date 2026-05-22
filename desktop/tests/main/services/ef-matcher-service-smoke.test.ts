/**
 * End-to-end smoke for EfMatcherService using REAL seeded data.
 *
 * Mocks only the LLM (deterministic top-3) and the upstream extraction /
 * emission_source rows. Everything else — the real EfService, the real
 * migrations 010 + 011 seeded catalog, the real FTS5 bm25 ranking —
 * runs against an in-memory SQLite that exactly mirrors production.
 *
 * Covers all 4 EF-Matcher-relevant stages (fuel/freight/travel/purchase)
 * plus a no-match negative case. Companion to the unit tests in
 * `ef-matcher-service.test.ts`, which use a fully-mocked candidate list.
 *
 * Used as the closest-to-production "Confirm flow" verification we can
 * run without launching Electron.
 */
import { runMigrations } from '@main/db/migrate';
import { EfMatcherService } from '@main/services/ef-matcher-service';
import { EfService } from '@main/services/ef-service';
import type { EmissionFactor, Extraction } from '@shared/types';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'fake-keyref',
} as never;

function setup(opts: {
  extraction: Extraction;
  source: { scope: number; category: string | null };
  /** Return the top-3 from this list; default: pass through the first 3. */
  llmPicker?: (candidates: EmissionFactor[]) => Array<{ ef: EmissionFactor; reasoning_zh: string }>;
}) {
  const db = new Database(':memory:');
  runMigrations(db);
  const efService = new EfService({ db });
  const recommendEfs = vi
    .fn()
    .mockImplementation((_config, _json, candidates: EmissionFactor[]) => {
      const picker =
        opts.llmPicker ??
        ((cs) => cs.slice(0, 3).map((ef) => ({ ef, reasoning_zh: `pick ${ef.factor_code}` })));
      const picks = picker(candidates);
      return Promise.resolve({
        recommendations: picks.map((p) => ({
          factor_code: p.ef.factor_code,
          year: p.ef.year,
          source: p.ef.source,
          geography: p.ef.geography,
          dataset_version: p.ef.dataset_version,
          reasoning_zh: p.reasoning_zh,
        })),
      });
    });
  const svc = new EfMatcherService({
    db,
    efService,
    extractionService: { get: vi.fn().mockReturnValue(opts.extraction) } as never,
    emissionSourceService: { get: vi.fn().mockReturnValue(opts.source) } as never,
    llmClient: { recommendEfs } as never,
    config: FAKE_CONFIG,
  });
  return { svc, recommendEfs, efService };
}

describe('EfMatcherService — end-to-end smoke against real seeded catalog', () => {
  it('fuel_receipt.v1 with fuel_type=柴油 ranks diesel EFs in the top recommendations', async () => {
    const { svc, recommendEfs } = setup({
      extraction: {
        id: 'ext-fuel-1',
        parsed_json: JSON.stringify({ fuel_type: '柴油', fuel_category: 'diesel' }),
        prompt_version: 'fuel_receipt.v1',
      } as Extraction,
      // Migration 008 puts diesel + gasoline under category 'fuel.mobile'.
      // Migration 011 adds lpg/cng/jet_a under 'fuel.combustion' (stationary).
      // The matcher uses the source's category as a hard filter, so we need
      // 'fuel.mobile' here to put the diesel EF in the candidate pool.
      source: { scope: 1, category: 'fuel.mobile' },
    });

    const r = await svc.recommend({ extraction_id: 'ext-fuel-1', emission_source_id: 'src-fuel' });

    // FTS5 ranking must surface the diesel EF first against the '柴油 diesel' hint.
    expect(r.ranked_full.length).toBeGreaterThan(0);
    expect(r.ranked_full[0]?.factor_code).toMatch(/diesel/);

    // LLM saw the FTS-ordered candidate list; the recommendations resolved
    // back to real catalog rows (not hallucinated PKs).
    expect(recommendEfs).toHaveBeenCalledTimes(1);
    expect(r.recommended.length).toBeGreaterThan(0);
    expect(r.recommended.length).toBeLessThanOrEqual(3);
    expect(r.recommended[0]?.ef.factor_code).toMatch(/diesel/);
    expect(r.recommended[0]?.reasoning_zh).toBeTruthy();
  });

  it('freight.v1 with mode=road + supplier=顺丰 ranks freight.road* EFs first', async () => {
    const { svc } = setup({
      extraction: {
        id: 'ext-freight-1',
        parsed_json: JSON.stringify({
          mode: 'road',
          vehicle_class: '重型卡车',
          supplier_name: '顺丰',
        }),
        prompt_version: 'freight.v1',
      } as Extraction,
      source: { scope: 3, category: 'freight.road' },
    });

    const r = await svc.recommend({
      extraction_id: 'ext-freight-1',
      emission_source_id: 'src-freight',
    });

    expect(r.ranked_full.length).toBeGreaterThan(0);
    // All candidates must be in freight.road.* (the scope/category filter is doing its job).
    for (const ef of r.ranked_full) {
      expect(ef.category).toMatch(/^freight\.road/);
    }
    // Recommendations resolved (mocked LLM took the first 3).
    expect(r.recommended.length).toBeGreaterThan(0);
  });

  it('travel.v1 with mode=air ranks travel.air* EFs from the seeded catalog', async () => {
    const { svc } = setup({
      extraction: {
        id: 'ext-travel-1',
        parsed_json: JSON.stringify({
          mode: 'air',
          travel_class: '经济舱',
          supplier_name: '中国国际航空',
        }),
        prompt_version: 'travel.v1',
      } as Extraction,
      // Travel EFs use per-class categories (travel.air.economy.shorthaul etc.)
      // while user-chosen source categories are coarser. Prefix-match in
      // EfService.list lets the coarse 'travel.air' pull in all three seeded
      // travel.air.* variants; bm25 then ranks them against the hint.
      source: { scope: 3, category: 'travel.air' },
    });

    const r = await svc.recommend({
      extraction_id: 'ext-travel-1',
      emission_source_id: 'src-travel',
    });

    // 3 seeded travel.air.* EFs: economy.shorthaul, economy.longhaul, business.longhaul.
    expect(r.ranked_full.length).toBeGreaterThan(1);
    for (const ef of r.ranked_full) {
      expect(ef.category).toMatch(/^travel\.air/);
    }
    expect(r.recommended.length).toBeGreaterThan(0);
  });

  it('purchase.v1 with category=service routes to the CNY service EFs', async () => {
    const { svc } = setup({
      extraction: {
        id: 'ext-purchase-1',
        parsed_json: JSON.stringify({
          category: 'service',
          item_description: '咨询服务',
          supplier_name: '某咨询公司',
        }),
        prompt_version: 'purchase.v1',
      } as Extraction,
      // The seeded consulting EF has category 'purchase.service.consulting'
      // (factor_code 'purchase.service.consulting_generic').
      source: { scope: 3, category: 'purchase.service.consulting' },
    });

    const r = await svc.recommend({
      extraction_id: 'ext-purchase-1',
      emission_source_id: 'src-purchase',
    });

    expect(r.ranked_full.length).toBeGreaterThan(0);
    expect(r.ranked_full[0]?.input_unit).toBe('CNY');
    expect(r.recommended.length).toBeGreaterThan(0);
  });

  it('returns empty result when scope/category filter has no candidates', async () => {
    const { svc, recommendEfs } = setup({
      extraction: {
        id: 'e-empty',
        parsed_json: '{}',
        prompt_version: 'fuel_receipt.v1',
      } as Extraction,
      source: { scope: 3, category: 'this.category.does.not.exist' },
    });

    const r = await svc.recommend({ extraction_id: 'e-empty', emission_source_id: 'src-empty' });

    expect(r.ranked_full).toEqual([]);
    expect(r.recommended).toEqual([]);
    // The LLM is never called when there are no candidates.
    expect(recommendEfs).not.toHaveBeenCalled();
  });

  it('cache: a second recommend() with the same key does not re-invoke the LLM', async () => {
    const { svc, recommendEfs } = setup({
      extraction: {
        id: 'ext-cache',
        parsed_json: JSON.stringify({ fuel_type: '柴油' }),
        prompt_version: 'fuel_receipt.v1',
      } as Extraction,
      source: { scope: 1, category: 'fuel.combustion' },
    });

    await svc.recommend({ extraction_id: 'ext-cache', emission_source_id: 'src-cache' });
    await svc.recommend({ extraction_id: 'ext-cache', emission_source_id: 'src-cache' });

    expect(recommendEfs).toHaveBeenCalledTimes(1);
  });
});
