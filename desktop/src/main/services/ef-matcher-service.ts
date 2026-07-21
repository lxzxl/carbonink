import { runAiObject } from '@main/llm/run-ai.js';
import type {
  EmissionFactor,
  MatcherResult,
  ProviderConfigV2,
  RecommendQuery,
  TextRecommendQuery,
} from '@shared/types.js';
import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import type { CredentialService } from './credential-service.js';
import { extractHint } from './ef-matcher/hint.js';
import type { EfService } from './ef-service.js';

const CANDIDATE_LIMIT = 20;

/**
 * Schema + prompt for the LLM emission-factor recommendation step.
 * Lives in the service so the AiClient stays a thin conduit — services
 * own their prompts.
 *
 * The recommendations carry the full composite primary key plus a
 * one-line Chinese reasoning string so the user can audit why each
 * factor was picked. Hallucinated PKs (i.e. recommendations that
 * don't match any candidate) are dropped by the caller after the
 * structured response is parsed.
 */
const recommendSchema = z.object({
  recommendations: z
    .array(
      z.object({
        factor_code: z.string(),
        year: z.number().int(),
        source: z.string(),
        geography: z.string(),
        dataset_version: z.string(),
        reasoning_zh: z.string().max(200),
      }),
    )
    .length(3),
});

type RecommendCandidate = Pick<
  EmissionFactor,
  | 'factor_code'
  | 'year'
  | 'source'
  | 'geography'
  | 'dataset_version'
  | 'input_unit'
  | 'name_zh'
  | 'name_en'
  | 'description_zh'
  | 'co2e_kg_per_unit'
>;

function formatCandidateList(candidates: ReadonlyArray<RecommendCandidate>): string {
  return candidates
    .map((c, i) => {
      const name = c.name_zh ?? c.name_en ?? c.factor_code;
      const desc = c.description_zh ?? '';
      return `${i + 1}. ${c.factor_code} | ${c.year} | ${c.geography} | ${c.input_unit ?? '?'} | ${c.co2e_kg_per_unit ?? '?'} kgCO2e/unit | ${name}${desc ? ` — ${desc}` : ''}`;
    })
    .join('\n');
}

function buildRecommendPrompt(
  parsedJson: string,
  candidates: ReadonlyArray<RecommendCandidate>,
): string {
  const candidateList = formatCandidateList(candidates);

  return `你是一名碳核算助理。下面是一份单据的抽取结果（parsed_json），以及一个候选排放因子清单。
请从候选清单中选出最贴合该单据的 3 个排放因子，并给出 1-2 句简短的中文理由。

<parsed_json>
${parsedJson}
</parsed_json>

<candidates>
${candidateList}
</candidates>

返回 JSON：{ recommendations: [3 个对象，每个包含完整复合主键 factor_code/year/source/geography/dataset_version 以及 reasoning_zh] }。
factor_code 等 5 个键必须从上方候选清单中原样复制；不要凭空构造。`;
}

function buildTextRecommendPrompt(
  hintText: string,
  candidates: ReadonlyArray<RecommendCandidate>,
): string {
  const candidateList = formatCandidateList(candidates);

  return `你是一名碳核算助理。下面是一条活动数据台账的分组描述（同一批同类记录的共同描述与单位），以及一个候选排放因子清单。
请从候选清单中选出最贴合该组活动数据的 3 个排放因子，并给出 1-2 句简短的中文理由。

<ledger_group>
${hintText}
</ledger_group>

<candidates>
${candidateList}
</candidates>

返回 JSON：{ recommendations: [3 个对象，每个包含完整复合主键 factor_code/year/source/geography/dataset_version 以及 reasoning_zh] }。
factor_code 等 5 个键必须从上方候选清单中原样复制；不要凭空构造。`;
}

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
      /**
       * Credential store consulted by the AiClient layer for the
       * provider API key. Threaded through here (rather than read once
       * at construction) because `runAiObject` rebuilds the layer per
       * call — provider config can change mid-session via Settings.
       */
      credentials: CredentialService;
      config: ProviderConfigV2;
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

    const prompt = buildRecommendPrompt(ext.parsed_json ?? '{}', rankedFull);
    const recommended = await this.llmRerank(prompt, rankedFull);

    const result: MatcherResult = { recommended, ranked_full: rankedFull };
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Text-hint variant for the batch activity import: same candidate pool
   * (the source's scope/category), same FTS backbone, same LLM top-3 layer —
   * but the hint is a ledger group's free text instead of an extraction's
   * parsed_json. Called once per confirm-group, not per row, which is what
   * keeps the LLM cost proportional to decisions rather than file size.
   */
  async recommendForText(q: TextRecommendQuery): Promise<MatcherResult> {
    const cacheKey = `text|${q.emission_source_id}|${q.hint_text}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const src = this.deps.emissionSourceService.get(q.emission_source_id);
    if (!src || q.hint_text.trim() === '') {
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

    const rankedFull = this.rankByFts(candidates, q.hint_text).slice(0, CANDIDATE_LIMIT);
    const recommended = await this.llmRerank(
      buildTextRecommendPrompt(q.hint_text, rankedFull),
      rankedFull,
    );

    const result: MatcherResult = { recommended, ranked_full: rankedFull };
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * LLM top-3 layer shared by both entry points. AiClient enforces the
   * 3-recommendations schema + retries transient failures. Any AiErr (auth,
   * rate-limit, schema mismatch, timeout, provider error) lands in the catch;
   * the matcher gracefully falls back to FTS5-only recommendations so the
   * user still sees the ranked_full list. Hallucinated PKs are dropped.
   */
  private async llmRerank(
    prompt: string,
    rankedFull: readonly EmissionFactor[],
  ): Promise<MatcherResult['recommended']> {
    try {
      const llmResult = await runAiObject(this.deps.config, this.deps.credentials, {
        schema: recommendSchema,
        prompt,
      });
      return llmResult.recommendations
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
      console.warn('[ef-matcher] LLM recommend failed:', err instanceof Error ? err.message : err);
      return [];
    }
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
