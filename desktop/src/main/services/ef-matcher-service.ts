import type { AgentTool } from '@main/llm/ai-agent.js';
import { runAiAgent, runAiObject } from '@main/llm/run-ai.js';
import type {
  EmissionFactor,
  MatcherResult,
  ProviderConfigV2,
  RecommendQuery,
  TextRecommendQuery,
} from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import type { CredentialService } from './credential-service.js';
import { extractHint } from './ef-matcher/hint.js';
import type { EfService } from './ef-service.js';

const CANDIDATE_LIMIT = 20;

/** Rows returned per `search_ef` tool call — keeps agent context compact. */
const SEARCH_EF_LIMIT = 10;

/**
 * Turn budget for the group-recommendation agent loop. Tighter than the
 * answer-generation agent (6): a group match should re-search once or
 * twice, inspect a factor, submit. Overridable via `EF_MATCH_AGENT_MAX_TURNS`
 * (invalid / non-positive values fall back to the default 4), mirroring
 * `ANSWER_AGENT_MAX_TURNS` in answer-generation/agent-loop.ts.
 */
const EF_MATCH_AGENT_MAX_TURNS = (() => {
  const raw = process.env.EF_MATCH_AGENT_MAX_TURNS;
  if (raw === undefined) return 4;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : 4;
})();

/**
 * Wall-clock budget for one agent recommendation. Proportionate to the
 * 4-turn budget (answer-generation allows 90s for 6 turns); beyond this
 * the single-shot fallback serves the user faster than a thrashing loop.
 */
const EF_MATCH_AGENT_TIMEOUT_MS = 60_000;

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
 * System prompt for the agent-loop variant of the group recommendation.
 * The final structured hand-off is the `submit_response` tool `AiAgent.run()`
 * injects (validated against {@link recommendSchema}) — this prompt only has
 * to teach the retrieval tools + the copy-the-PK-verbatim discipline.
 */
const MATCH_AGENT_SYSTEM_PROMPT = `你是一名碳核算排放因子匹配助理。任务：为一组活动数据台账记录（同一批同类记录的共同描述与单位）从候选排放因子中选出最贴合的 3 个。

规则：
- 初始候选清单在用户消息里，已按全文检索相关度排序。
- 若初始候选不贴合（描述含糊、量纲不符），先调用 search_ef 换更贴近的关键词重搜（例如燃料/能源/物料的通用名）；需要确认适用范围时调用 get_ef_detail 查看因子的完整描述。
- 最终调用 submit_response 提交恰好 3 个推荐；factor_code/year/source/geography/dataset_version 五个键必须从候选清单或工具结果中原样复制，不得凭空构造。
- reasoning_zh 用 1-2 句中文说明贴合理由（如量纲一致、燃料类型对应）。`;

function buildAgentMatchUserPrompt(
  hintText: string,
  candidates: ReadonlyArray<RecommendCandidate>,
): string {
  return `<ledger_group>
${hintText}
</ledger_group>

<candidates>
${formatCandidateList(candidates)}
</candidates>`;
}

const searchEfParams = z.object({
  keywords: z.string().min(1).max(100),
});

const efDetailParams = z.object({
  factor_code: z.string().min(1),
  year: z.number().int(),
  source: z.string().min(1),
  geography: z.string().min(1),
  dataset_version: z.string().min(1),
});

/**
 * FTS5 query for agent-supplied keywords: each whitespace-separated term
 * becomes its own quoted PREFIX phrase (`"柴油"*`), joined by FTS5's
 * implicit AND. Prefix matching is load-bearing for Chinese: unicode61
 * does no CJK segmentation, so the seeded name「柴油燃烧」is a single
 * token — an exact-phrase `"柴油"` query misses it, `"柴油"*` hits.
 * Distinct from the backbone hint query (one exact phrase over the whole
 * hint — contract-frozen) so the agent can widen/narrow recall term by
 * term. Returns '' when the input collapses to nothing — callers treat
 * that as "no matches".
 */
function ftsQueryForKeywords(keywords: string): string {
  return keywords
    .split(/\s+/)
    .filter((t) => t !== '')
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');
}

/**
 * Map LLM/agent recommendations onto real candidate rows, dropping any
 * hallucinated composite PK that matches nothing in `pool`. Shared by the
 * single-shot path (pool = the top-20 the prompt showed) and the agent
 * path (pool = the full scope/category candidate set, since `search_ef`
 * can legitimately surface factors beyond the initial top-20).
 */
function mapRecommendations(
  recs: z.infer<typeof recommendSchema>['recommendations'],
  pool: readonly EmissionFactor[],
): MatcherResult['recommended'] {
  return recs
    .map((rec) => {
      const ef = pool.find(
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
}

/**
 * Translate an agent-path failure into the audit trace's stop_reason +
 * turn count. Matches on `_tag` (not instanceof) so mocked seams and
 * plain Errors degrade to 'error' instead of throwing here.
 */
function stopReasonForError(err: unknown): { stopReason: string; turnCount: number } {
  const tag = (err as { _tag?: unknown } | null)?._tag;
  const turnCount = (err as { turnCount?: number } | null)?.turnCount ?? 0;
  if (tag === 'AgentMaxTurns') return { stopReason: 'max_turns', turnCount };
  if (tag === 'AgentStalled') return { stopReason: 'stalled', turnCount };
  if (tag === 'AiTimeout') return { stopReason: 'aborted', turnCount };
  return { stopReason: 'error', turnCount };
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
    const recommended = await this.agentRecommendWithFallback(q, candidates, rankedFull);

    const result: MatcherResult = { recommended, ranked_full: rankedFull };
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Agent-first recommendation for the batch-import group flow (ROADMAP
   * §8.1-① v2): drive `AiAgent` with the retrieval toolbox; on ANY failure
   * — turn budget, stall, timeout, missing key, provider error — fall back
   * to the pre-existing single-shot rerank, which itself degrades to
   * FTS-only (`[]`) on failure. Preserves recommendForText's never-throws
   * contract. One `ef_match.agent_trace` audit row per real attempt
   * (cache hits never reach here).
   */
  private async agentRecommendWithFallback(
    q: TextRecommendQuery,
    candidates: readonly EmissionFactor[],
    rankedFull: readonly EmissionFactor[],
  ): Promise<MatcherResult['recommended']> {
    const startedAt = Date.now();
    try {
      const { result, trace } = await runAiAgent(this.deps.config, this.deps.credentials, {
        systemPrompt: MATCH_AGENT_SYSTEM_PROMPT,
        userPrompt: buildAgentMatchUserPrompt(q.hint_text, rankedFull),
        schema: recommendSchema,
        tools: this.buildMatchTools(candidates),
        maxTurns: EF_MATCH_AGENT_MAX_TURNS,
        timeoutMs: EF_MATCH_AGENT_TIMEOUT_MS,
      });
      this.writeAgentTrace({
        emissionSourceId: q.emission_source_id,
        isFallback: false,
        stopReason: trace.stopReason,
        turnCount: trace.turnCount,
        toolCallSummary: trace.toolCalls.map((c) => c.tool),
        tokens: trace.totalTokens,
        durationMs: trace.totalDurationMs,
      });
      return mapRecommendations(result.recommendations, candidates);
    } catch (err) {
      const { stopReason, turnCount } = stopReasonForError(err);
      this.writeAgentTrace({
        emissionSourceId: q.emission_source_id,
        isFallback: true,
        stopReason,
        turnCount,
        toolCallSummary: [],
        tokens: { input: 0, output: 0 },
        durationMs: Date.now() - startedAt,
      });
      return this.llmRerank(buildTextRecommendPrompt(q.hint_text, rankedFull), rankedFull);
    }
  }

  /**
   * Retrieval toolbox for the match agent. Both tools operate strictly
   * within `candidates` (the source's scope/category pool) — the agent can
   * re-rank or inspect, never escape the filter. `submit_response` is NOT
   * here; `AiAgent.run()` injects it with {@link recommendSchema}.
   */
  private buildMatchTools(candidates: readonly EmissionFactor[]): AgentTool[] {
    const compact = (ef: EmissionFactor) => ({
      factor_code: ef.factor_code,
      year: ef.year,
      source: ef.source,
      geography: ef.geography,
      dataset_version: ef.dataset_version,
      name_zh: ef.name_zh,
      name_en: ef.name_en,
      input_unit: ef.input_unit,
      co2e_kg_per_unit: ef.co2e_kg_per_unit,
    });
    return [
      {
        name: 'search_ef',
        description:
          'Re-search the candidate emission factors with different keywords (space-separated, ' +
          `Chinese or English). Returns the top ${SEARCH_EF_LIMIT} matches from the same ` +
          'scope/category pool, best first. Use when the initial candidate list does not fit ' +
          'the ledger description; try broader or more generic terms.',
        parameters: z.toJSONSchema(searchEfParams),
        execute: async (rawArgs) => {
          const args = rawArgs as { keywords: string };
          const ftsQuery = ftsQueryForKeywords(args.keywords ?? '');
          if (ftsQuery === '') return { count: 0, results: [] };
          const ranked = this.rankByFtsQuery(candidates, ftsQuery, { matchesOnly: true }).slice(
            0,
            SEARCH_EF_LIMIT,
          );
          return { count: ranked.length, results: ranked.map(compact) };
        },
      },
      {
        name: 'get_ef_detail',
        description:
          'Read the full description of one candidate emission factor (Chinese/English names, ' +
          'descriptions, notes, unit, per-unit CO2e). Identify it by the exact composite key ' +
          'from a candidate list or search_ef result.',
        parameters: z.toJSONSchema(efDetailParams),
        execute: async (rawArgs) => {
          const args = rawArgs as z.infer<typeof efDetailParams>;
          const ef = candidates.find(
            (c) =>
              c.factor_code === args.factor_code &&
              c.year === args.year &&
              c.source === args.source &&
              c.geography === args.geography &&
              c.dataset_version === args.dataset_version,
          );
          if (!ef) return { error: 'not_found' };
          return {
            ...compact(ef),
            scope: ef.scope,
            category: ef.category,
            description_zh: ef.description_zh,
            description_en: ef.description_en,
            notes: ef.notes,
          };
        },
      },
    ];
  }

  /**
   * One audit row per agent attempt. Payload discipline (AGENTS.md): tool
   * NAMES, ids, counts, decision flags — never the hint text, factor
   * names, or any prompt content. Swallows write failures with a warn so
   * telemetry can't break the never-throws recommendation contract.
   */
  private writeAgentTrace(a: {
    emissionSourceId: string;
    isFallback: boolean;
    stopReason: string;
    turnCount: number;
    toolCallSummary: string[];
    tokens: { input: number; output: number };
    durationMs: number;
  }): void {
    try {
      const payload = {
        emission_source_id: a.emissionSourceId,
        is_fallback: a.isFallback,
        stop_reason: a.stopReason,
        turn_count: a.turnCount,
        tool_call_summary: a.toolCallSummary,
        tokens: a.tokens,
        duration_ms: a.durationMs,
      };
      this.deps.db
        .prepare(
          'INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)',
        )
        .run(newId(), 'ef_match.agent_trace', JSON.stringify(payload), new Date().toISOString());
    } catch (err) {
      console.warn(
        '[ef-matcher] agent trace audit write failed:',
        err instanceof Error ? err.message : err,
      );
    }
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
      return mapRecommendations(llmResult.recommendations, rankedFull);
    } catch (err) {
      console.warn('[ef-matcher] LLM recommend failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  private rankByFts(candidates: readonly EmissionFactor[], hint: string): EmissionFactor[] {
    if (!hint || candidates.length === 0) return [...candidates];

    // Escape double-quotes in the hint so the FTS5 phrase query is valid.
    const ftsQuery = `"${hint.replace(/"/g, '""')}"`;
    return this.rankByFtsQuery(candidates, ftsQuery, { matchesOnly: false });
  }

  /**
   * Shared FTS ranking core. `matchesOnly: false` (the backbone ranking)
   * appends unmatched candidates after the FTS hits — they may still be
   * relevant and the browse list wants the full pool. `matchesOnly: true`
   * (the `search_ef` tool) returns only actual hits so the agent gets an
   * honest empty result instead of the whole pool padded on.
   */
  private rankByFtsQuery(
    candidates: readonly EmissionFactor[],
    ftsQuery: string,
    opts: { matchesOnly: boolean },
  ): EmissionFactor[] {
    if (candidates.length === 0) return [];

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
      // FTS5 syntax error (e.g. empty or malformed query) → backbone falls
      // back to unranked candidate order; the search tool reports no hits.
      return opts.matchesOnly ? [] : [...candidates];
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
    if (!opts.matchesOnly) {
      // Append any candidates not matched by FTS5 (they may still be relevant).
      for (const c of candidates) {
        const k = candidateKey(c);
        if (!seen.has(k)) ordered.push(c);
      }
    }
    return ordered;
  }
}
