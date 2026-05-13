import type { Database } from 'better-sqlite3';
import type { LLMClient } from '@main/llm/llm-client.js';
import type { EmissionFactor, MatcherResult, RecommendQuery, ProviderConfig } from '@shared/types.js';
import type { EfService } from './ef-service.js';
import { extractHint } from './ef-matcher/hint.js';

const CANDIDATE_LIMIT = 20;

/**
 * Minimal interface for extraction lookup. The real ExtractionService exposes
 * `getById(id)`, but we accept the narrower `get(id)` duck-type so tests can
 * supply simple mocks and the service can be wired in production with a thin
 * adapter wrapping `getById`.
 */
interface ExtractionLookup {
  get(id: string): { id: string; prompt_version: string; parsed_json: string | null } | null;
}

/**
 * Minimal interface for emission-source lookup. The real EmissionSourceService
 * exposes `getById(id)`, but we accept `get(id)` for the same reason as above.
 */
interface EmissionSourceLookup {
  get(id: string): { scope: number; category: string | null } | null;
}

export class EfMatcherService {
  private readonly cache = new Map<string, MatcherResult>();

  constructor(
    private readonly deps: {
      db: Database;
      efService: Pick<EfService, 'list'>;
      extractionService: ExtractionLookup;
      emissionSourceService: EmissionSourceLookup;
      llmClient: Pick<LLMClient, 'recommendEfs'>;
      config: ProviderConfig;
    },
  ) {}

  async recommend(q: RecommendQuery): Promise<MatcherResult> {
    const cacheKey = `${q.extraction_id}|${q.emission_source_id}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    // Both services are synchronous (better-sqlite3 is fully sync).
    const ext = this.deps.extractionService.get(q.extraction_id);
    const src = this.deps.emissionSourceService.get(q.emission_source_id);

    if (!ext || !src) {
      const empty: MatcherResult = { recommended: [], ranked_full: [] };
      this.cache.set(cacheKey, empty);
      return empty;
    }

    const filter: { scope: 1 | 2 | 3; category?: string } = {
      scope: src.scope as 1 | 2 | 3,
    };
    if (src.category) filter.category = src.category;
    const candidates = this.deps.efService.list(filter);

    if (candidates.length === 0) {
      const empty: MatcherResult = { recommended: [], ranked_full: [] };
      this.cache.set(cacheKey, empty);
      return empty;
    }

    const parsed = JSON.parse(ext.parsed_json ?? '{}') as Record<string, unknown>;
    const hint = extractHint(ext.prompt_version, parsed);
    const rankedFull = this.rankByFts(candidates, hint).slice(0, CANDIDATE_LIMIT);

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
      console.warn(
        '[ef-matcher] LLM recommend failed:',
        err instanceof Error ? err.message : err,
      );
      recommended = [];
    }

    const result: MatcherResult = { recommended, ranked_full: rankedFull };
    this.cache.set(cacheKey, result);
    return result;
  }

  private rankByFts(candidates: readonly EmissionFactor[], hint: string): EmissionFactor[] {
    if (!hint || candidates.length === 0) return [...candidates];

    // Escape double-quotes in the hint so the FTS5 phrase query is valid.
    const ftsQuery = `"${hint.replace(/"/g, '""')}"`;

    type FtsPk = {
      factor_code: string;
      year: number;
      source: string;
      geography: string;
      dataset_version: string;
    };

    let rankedPks: FtsPk[];
    try {
      rankedPks = this.deps.db
        .prepare(
          `SELECT factor_code, year, source, geography, dataset_version
           FROM ef_fts
           WHERE ef_fts MATCH ?
           ORDER BY bm25(ef_fts) ASC`,
        )
        .all(ftsQuery) as FtsPk[];
    } catch {
      // FTS5 syntax error (e.g. empty or malformed query) → fall back to
      // unranked candidate order.
      return [...candidates];
    }

    const candidateKey = (e: FtsPk) =>
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
    // Append any candidates not matched by FTS5 (they may still be relevant).
    for (const c of candidates) {
      const k = candidateKey(c);
      if (!seen.has(k)) ordered.push(c);
    }
    return ordered;
  }
}
