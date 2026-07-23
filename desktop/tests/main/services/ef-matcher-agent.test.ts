/**
 * Agent-loop path of `EfMatcherService.recommendForText` (ROADMAP §8.1-① v2).
 *
 * The generic agent runtime (`AiAgent` / pi-agent-core) has its own suite;
 * here the boundary seam `runAiAgent` is mocked and the tests cover the
 * matcher-side contract:
 *   - agent success maps recommendations (hallucinated PKs dropped, pool =
 *     full scope/category candidates, not just the top-20 shown in the
 *     prompt) and never invokes the single-shot path;
 *   - every failure mode (max-turns, stall, missing key, arbitrary error)
 *     falls back to the pre-existing single-shot rerank — recommendForText
 *     never throws;
 *   - one `ef_match.agent_trace` audit row per real attempt, carrying tool
 *     NAMES + counts only (no hint text, no factor names/codes);
 *   - the retrieval toolbox (search_ef / get_ef_detail) works against the
 *     real seeded catalog + FTS index.
 *
 * Companion files: `ef-matcher-service.test.ts` (single-shot unit tests —
 * untouched by the agent slice, their mock module has no `runAiAgent`, so
 * the service degrades to the fallback path exactly as designed) and
 * `ef-matcher-service-smoke.test.ts` (extraction path against seeded data).
 */
import { runMigrations } from '@main/db/migrate';
import { runAiAgent, runAiObject } from '@main/llm/run-ai';
import type { CredentialService } from '@main/services/credential-service';
import { EfMatcherService } from '@main/services/ef-matcher-service';
import { EfService } from '@main/services/ef-service';
import type { EmissionFactor } from '@shared/types';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/llm/run-ai', () => ({
  runAiObject: vi.fn(),
  runAiAgent: vi.fn(),
}));

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
} as never;

function fakeCredentials(): CredentialService {
  return {
    get: vi.fn(() => 'sk-fake'),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

const CANDIDATE_DIESEL: EmissionFactor = {
  factor_code: 'fuel.diesel.combustion',
  year: 2024,
  source: 'IPCC_AR6',
  geography: 'GLOBAL',
  dataset_version: '2024.q1',
  scope: 1,
  category: 'fuel.combustion',
  ghg_protocol_path: 'scope1.stationary',
  input_unit: 'L',
  co2e_kg_per_unit: 2.68,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '柴油',
  name_en: 'Diesel',
  description_zh: null,
  description_en: null,
  notes: null,
  biogenic_co2_factor: null,
  citation_url: 'https://example.com',
};

const CANDIDATE_GASOLINE: EmissionFactor = {
  ...CANDIDATE_DIESEL,
  factor_code: 'fuel.gasoline.combustion',
  co2e_kg_per_unit: 2.31,
  name_zh: '汽油',
  name_en: 'Gasoline',
};

/** Completed-run trace fixture returned by the mocked agent seam. */
const TRACE = {
  turnCount: 2,
  toolCalls: [
    { tool: 'search_ef', argsHash: 'h1', durationMs: 5 },
    { tool: 'get_ef_detail', argsHash: 'h2', durationMs: 3 },
  ],
  totalTokens: { input: 1200, output: 240 },
  totalDurationMs: 4200,
  stopReason: 'completed' as const,
};

function pkOf(ef: EmissionFactor, reasoning_zh: string) {
  return {
    factor_code: ef.factor_code,
    year: ef.year,
    source: ef.source,
    geography: ef.geography,
    dataset_version: ef.dataset_version,
    reasoning_zh,
  };
}

/** Tagged error mimicking the Effect Data.TaggedError shapes the seam rethrows. */
function taggedError(tag: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(tag), { _tag: tag, ...extra });
}

function makeService(opts: {
  source: { scope: number; category: string | null } | null;
  candidates: EmissionFactor[];
}) {
  const db = new Database(':memory:');
  runMigrations(db);
  const svc = new EfMatcherService({
    db,
    efService: { list: vi.fn().mockReturnValue(opts.candidates) } as never,
    extractionService: { get: vi.fn().mockReturnValue(null) } as never,
    emissionSourceService: { get: vi.fn().mockReturnValue(opts.source) } as never,
    credentials: fakeCredentials(),
    config: FAKE_CONFIG,
  });
  return { db, svc };
}

function agentTraceRows(db: InstanceType<typeof Database>) {
  const rows = db
    .prepare(
      `SELECT payload FROM audit_event WHERE event_kind = 'ef_match.agent_trace' ORDER BY occurred_at`,
    )
    .all() as Array<{ payload: string }>;
  return rows.map((r) => ({
    parsed: JSON.parse(r.payload) as Record<string, unknown>,
    raw: r.payload,
  }));
}

beforeEach(() => {
  vi.mocked(runAiObject).mockReset();
  vi.mocked(runAiAgent).mockReset();
});

describe('recommendForText — agent path', () => {
  it('maps agent recommendations, skips the single-shot path, and audits the trace', async () => {
    const { db, svc } = makeService({
      source: { scope: 1, category: 'fuel.combustion' },
      candidates: [CANDIDATE_GASOLINE, CANDIDATE_DIESEL],
    });
    vi.mocked(runAiAgent).mockResolvedValue({
      result: {
        recommendations: [
          pkOf(CANDIDATE_DIESEL, '台账描述为柴油'),
          pkOf(CANDIDATE_GASOLINE, '备选'),
          { ...pkOf(CANDIDATE_DIESEL, '幻觉'), factor_code: 'HALLUCINATED' },
        ],
      },
      trace: TRACE,
    });

    const r = await svc.recommendForText({ hint_text: '柴油 叉车', emission_source_id: 's1' });

    expect(r.recommended.map((x) => x.ef.factor_code)).toEqual([
      'fuel.diesel.combustion',
      'fuel.gasoline.combustion',
    ]);
    expect(r.ranked_full).toHaveLength(2);
    expect(runAiObject).not.toHaveBeenCalled();

    const events = agentTraceRows(db);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event?.parsed).toMatchObject({
      emission_source_id: 's1',
      is_fallback: false,
      stop_reason: 'completed',
      turn_count: 2,
      tool_call_summary: ['search_ef', 'get_ef_detail'],
      tokens: { input: 1200, output: 240 },
      duration_ms: 4200,
    });
    // Payload discipline: names + counts only — no hint text, no factor
    // names/codes, no reasoning content.
    expect(event?.raw).not.toContain('柴油');
    expect(event?.raw).not.toContain('叉车');
    expect(event?.raw).not.toContain('fuel.diesel');
    expect(event?.raw).not.toContain('台账');
  });

  it('accepts agent picks beyond the prompt top-20 as long as they are real candidates', async () => {
    // 22 candidates → ranked_full carries only the first 20; the agent can
    // still legitimately surface #22 via search_ef, so the hallucination
    // filter must run against the FULL pool.
    const candidates = Array.from({ length: 22 }, (_, i) => ({
      ...CANDIDATE_DIESEL,
      factor_code: `fuel.variant.${i}`,
      name_zh: `变体${i}`,
    }));
    const last = candidates[21];
    if (!last) throw new Error('fixture underflow');
    const { svc } = makeService({
      source: { scope: 1, category: 'fuel.combustion' },
      candidates,
    });
    vi.mocked(runAiAgent).mockResolvedValue({
      result: { recommendations: [pkOf(last, '经重搜命中')] },
      trace: TRACE,
    });

    const r = await svc.recommendForText({ hint_text: '能耗', emission_source_id: 's1' });

    expect(r.ranked_full).toHaveLength(20);
    expect(r.ranked_full.some((ef) => ef.factor_code === last.factor_code)).toBe(false);
    expect(r.recommended.map((x) => x.ef.factor_code)).toEqual([last.factor_code]);
  });

  it('falls back to the single-shot rerank on AgentMaxTurns and audits the fallback', async () => {
    const { db, svc } = makeService({
      source: { scope: 1, category: 'fuel.combustion' },
      candidates: [CANDIDATE_DIESEL],
    });
    vi.mocked(runAiAgent).mockRejectedValue(taggedError('AgentMaxTurns', { turnCount: 4 }));
    vi.mocked(runAiObject).mockResolvedValue({
      recommendations: [
        pkOf(CANDIDATE_DIESEL, '单发命中'),
        { ...pkOf(CANDIDATE_DIESEL, 'x'), factor_code: 'H1' },
        { ...pkOf(CANDIDATE_DIESEL, 'y'), factor_code: 'H2' },
      ],
    });

    const r = await svc.recommendForText({ hint_text: '柴油', emission_source_id: 's1' });

    expect(runAiObject).toHaveBeenCalledTimes(1);
    expect(r.recommended.map((x) => x.ef.factor_code)).toEqual(['fuel.diesel.combustion']);
    expect(r.recommended[0]?.reasoning_zh).toBe('单发命中');

    const events = agentTraceRows(db);
    expect(events).toHaveLength(1);
    expect(events[0]?.parsed).toMatchObject({
      is_fallback: true,
      stop_reason: 'max_turns',
      turn_count: 4,
      tool_call_summary: [],
    });
  });

  it('degrades to FTS-only when both agent and fallback fail (e.g. no API key)', async () => {
    const { db, svc } = makeService({
      source: { scope: 1, category: 'fuel.combustion' },
      candidates: [CANDIDATE_GASOLINE, CANDIDATE_DIESEL],
    });
    vi.mocked(runAiAgent).mockRejectedValue(taggedError('AiAuthError', { provider: 'openai' }));
    vi.mocked(runAiObject).mockRejectedValue(taggedError('AiAuthError', { provider: 'openai' }));

    const r = await svc.recommendForText({ hint_text: '柴油', emission_source_id: 's1' });

    expect(r.recommended).toEqual([]);
    expect(r.ranked_full).toHaveLength(2);
    expect(events0(db)).toMatchObject({ is_fallback: true, stop_reason: 'error' });
  });

  it('maps AgentStalled and AiTimeout to their audit stop_reasons', async () => {
    for (const [tag, stopReason] of [
      ['AgentStalled', 'stalled'],
      ['AiTimeout', 'aborted'],
    ] as const) {
      const { db, svc } = makeService({
        source: { scope: 1, category: 'fuel.combustion' },
        candidates: [CANDIDATE_DIESEL],
      });
      vi.mocked(runAiAgent).mockRejectedValue(taggedError(tag, { turnCount: 1 }));
      vi.mocked(runAiObject).mockResolvedValue({ recommendations: [] });

      await svc.recommendForText({ hint_text: '柴油', emission_source_id: 's1' });

      expect(events0(db)).toMatchObject({ is_fallback: true, stop_reason: stopReason });
    }
  });

  it('cache hits do not re-run the agent or write additional audit rows', async () => {
    const { db, svc } = makeService({
      source: { scope: 1, category: 'fuel.combustion' },
      candidates: [CANDIDATE_DIESEL],
    });
    vi.mocked(runAiAgent).mockResolvedValue({
      result: { recommendations: [pkOf(CANDIDATE_DIESEL, '命中')] },
      trace: TRACE,
    });

    await svc.recommendForText({ hint_text: '柴油 L', emission_source_id: 's1' });
    await svc.recommendForText({ hint_text: '柴油 L', emission_source_id: 's1' });
    expect(runAiAgent).toHaveBeenCalledTimes(1);
    expect(agentTraceRows(db)).toHaveLength(1);

    await svc.recommendForText({ hint_text: '汽油 L', emission_source_id: 's1' });
    expect(runAiAgent).toHaveBeenCalledTimes(2);
    expect(agentTraceRows(db)).toHaveLength(2);
  });
});

describe('recommendForText — agent toolbox over the real seeded catalog', () => {
  it('wires search_ef + get_ef_detail with the 4-turn default budget', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const efService = new EfService({ db });
    const svc = new EfMatcherService({
      db,
      efService,
      extractionService: { get: vi.fn().mockReturnValue(null) } as never,
      emissionSourceService: {
        get: vi.fn().mockReturnValue({ scope: 1, category: 'fuel.mobile' }),
      } as never,
      credentials: fakeCredentials(),
      config: FAKE_CONFIG,
    });

    let captured: Parameters<typeof runAiAgent>[2] | undefined;
    vi.mocked(runAiAgent).mockImplementation(async (_config, _credentials, args) => {
      captured = args;
      return { result: { recommendations: [] }, trace: TRACE };
    });

    await svc.recommendForText({ hint_text: '柴油 叉车', emission_source_id: 's1' });

    expect(captured?.maxTurns).toBe(4);
    expect(captured?.timeoutMs).toBe(60_000);
    expect(captured?.tools.map((t) => t.name)).toEqual(['search_ef', 'get_ef_detail']);

    // search_ef: real FTS over the seeded fuel.mobile pool — diesel ranks
    // for 柴油, honest empty for gibberish (no padding with the full pool).
    const search = captured?.tools.find((t) => t.name === 'search_ef');
    const hits = (await search?.execute({ keywords: '柴油' })) as {
      count: number;
      results: Array<Record<string, unknown>>;
    };
    expect(hits.count).toBeGreaterThan(0);
    expect(hits.count).toBeLessThanOrEqual(10);
    expect(String(hits.results[0]?.factor_code)).toMatch(/diesel/);

    const none = (await search?.execute({ keywords: 'zzzz不存在词' })) as { count: number };
    expect(none).toEqual({ count: 0, results: [] });

    // get_ef_detail: exact composite key → full description fields;
    // unknown key → not_found.
    const detail = captured?.tools.find((t) => t.name === 'get_ef_detail');
    const first = hits.results[0] as {
      factor_code: string;
      year: number;
      source: string;
      geography: string;
      dataset_version: string;
    };
    const d = (await detail?.execute(first)) as Record<string, unknown>;
    expect(d.factor_code).toBe(first.factor_code);
    expect(d).toHaveProperty('description_zh');
    expect(d).toHaveProperty('co2e_kg_per_unit');

    const miss = await detail?.execute({
      factor_code: 'nope',
      year: 1999,
      source: 'X',
      geography: 'X',
      dataset_version: 'x',
    });
    expect(miss).toEqual({ error: 'not_found' });
  });
});

function events0(db: InstanceType<typeof Database>): Record<string, unknown> {
  const events = agentTraceRows(db);
  expect(events).toHaveLength(1);
  return events[0]?.parsed ?? {};
}
