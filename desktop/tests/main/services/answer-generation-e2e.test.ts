import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from '@earendil-works/pi-ai';
import { runMigrations } from '@main/db/migrate';
import { buildAiAgentLayer } from '@main/llm/ai-agent';
import { type AiClient, AiClientTag } from '@main/llm/ai-client';
import { ActivityDataService } from '@main/services/activity-data-service';
import * as answerSvc from '@main/services/answer-generation';
import {
  ActivityDataServiceTag,
  AnswerToolsTag,
  DbTag,
  NowTag,
  OrgServiceTag,
} from '@main/services/answer-generation/tags';
import { buildAnswerTools } from '@main/services/answer-generation/tools';
import { EmissionSourceService } from '@main/services/emission-source-service';
import { OrganizationService } from '@main/services/organization-service';
import { QuestionnaireService } from '@main/services/questionnaire-service';
import type { ProviderConfigV2 } from '@shared/types';
import Database from 'better-sqlite3';
import { Effect, Either, Exit, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Item 4 — agent answer-generation END-TO-END.
 *
 * This is the automated replacement for the manual smoke (Task 9). Where
 * `answer-generation-service.test.ts` mocks `AiAgent.run` wholesale and
 * fakes the inventory services, THIS file wires the *real* stack:
 *
 *   real seeded SQLite (org → site → period → source → EF → activities →
 *   questionnaire → questions)
 *     → real OrganizationService / ActivityDataService / EmissionSourceService
 *       / QuestionnaireService (read methods; heavy create-path sub-deps are
 *       stubbed because the tools never reach them)
 *     → real buildAnswerTools (the 5 inventory tools)
 *     → real buildAiAgentLayer turn-loop, driven by a FAUX pi-ai provider
 *       that scripts the LLM's tool calls deterministically
 *     → real answer-generation orchestrator (agent → fallback → audit)
 *
 * The only fake is the LLM itself (network), exactly as the manual smoke
 * couldn't avoid either. Everything between the IPC-equivalent service
 * entry and the SQLite writes is the production code path.
 *
 * Covers the 4 smoke steps:
 *   1. agent runs (real tools query real inventory) + answer written
 *   2. fallback works (real AgentStalled → single-shot → 【单 shot fallback】)
 *   3. audit_event agent_answer.generate row present + shaped
 *   4. batch generateAllUnanswered answers every question
 */

const CONFIG: ProviderConfigV2 = { provider: 'deepseek', model: 'deepseek-v4-flash' };

// Scope-2 inventory total the agent's sum_co2e tool must compute from the
// real seeded rows (30000 + 40000).
const SCOPE2_TOTAL = 70000;

let faux: FauxProviderRegistration | undefined;
afterEach(() => {
  faux?.unregister();
  faux = undefined;
});

function fakeCredentials(apiKey: string | null = 'sk-fake-test-key') {
  return {
    get: vi.fn(() => apiKey),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as never;
}

/** Single-shot AiClient stub used only on the fallback branch. */
function makeStubAi(generateObject: ReturnType<typeof vi.fn>): AiClient {
  return {
    generateObject: generateObject as unknown as AiClient['generateObject'],
    generateText: vi
      .fn()
      .mockReturnValue(Effect.die(new Error('generateText unexpected'))) as never,
    ping: vi.fn().mockReturnValue(Effect.die(new Error('ping unexpected'))) as never,
  };
}

const NOW = '2026-05-28T00:00:00.000Z';

/**
 * Seed a real inventory + outbound questionnaire. Mirrors the
 * `seed-item4-smoke.mjs` fixture in miniature: one scope-2 source with two
 * activity rows summing to SCOPE2_TOTAL, plus a 3-question questionnaire
 * (numerical / categorical / narrative).
 */
function seed(db: Database.Database): {
  organizationId: string;
  questionnaireId: string;
  questionIds: { num: string; cat: string; narr: string };
} {
  const organizationId = 'org-1';
  db.prepare(
    `INSERT INTO organization (id, name_zh, country_code, boundary_kind, created_at, updated_at)
     VALUES (?, '碳墨测试', 'CN', 'operational_control', ?, ?)`,
  ).run(organizationId, NOW, NOW);

  const siteId = 'site-1';
  db.prepare(
    `INSERT INTO site (id, organization_id, name_zh, country_code, is_active, created_at, updated_at)
     VALUES (?, ?, '上海总部', 'CN', 1, ?, ?)`,
  ).run(siteId, organizationId, NOW, NOW);

  const periodId = 'rp-2025';
  db.prepare(
    `INSERT INTO reporting_period
       (id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
     VALUES (?, ?, 2025, 'annual', '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z', 1, ?)`,
  ).run(periodId, organizationId, NOW);

  const sourceId = 'es-elec';
  db.prepare(
    `INSERT INTO emission_source (id, site_id, name, scope, category, ghg_protocol_path, is_active)
     VALUES (?, ?, '办公楼用电', 2, 'electricity.grid', 'scope2.location', 1)`,
  ).run(sourceId, siteId);

  // Pinned EF the activity rows reference (composite FK).
  const ef = {
    code: 'electricity.grid.cn.national.2024',
    year: 2024,
    source: 'MEE_China',
    geo: 'CN',
    ds: '2024.q4',
  };
  db.prepare(
    `INSERT INTO pinned_emission_factor
       (factor_code, year, source, geography, dataset_version, scope, category,
        ghg_protocol_path, input_unit, co2e_kg_per_unit, gwp_basis, pinned_at, pinned_from)
     VALUES (?, ?, ?, ?, ?, 2, 'electricity.grid', 'scope2.location', 'kWh', 0.5703, 'AR6', ?, 'seed')`,
  ).run(ef.code, ef.year, ef.source, ef.geo, ef.ds, NOW);

  const insertActivity = db.prepare(
    `INSERT INTO activity_data
       (id, site_id, emission_source_id, reporting_period_id, occurred_at_start, occurred_at_end,
        amount, unit, ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
        computed_co2e_kg, computed_at, extraction_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'kWh', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
  );
  for (const [i, co2e] of [30000, 40000].entries()) {
    insertActivity.run(
      `ad-${i}`,
      siteId,
      sourceId,
      periodId,
      '2025-01-01T00:00:00Z',
      '2025-03-31T23:59:59Z',
      50000,
      ef.code,
      ef.year,
      ef.source,
      ef.geo,
      ef.ds,
      co2e,
      NOW,
      NOW,
      NOW,
    );
  }

  db.prepare(`INSERT INTO customer (id, name) VALUES ('cu-1', 'Item4 Smoke 客户')`).run();
  db.prepare(
    `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
     VALUES ('doc-1', 'aa', 'q.xlsx', 'application/pdf', 1, '/tmp/q.xlsx', ?)`,
  ).run(NOW);
  const questionnaireId = 'qn-1';
  db.prepare(
    `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, created_at)
     VALUES (?, 'cu-1', 'doc-1', 2025, 'answering', ?)`,
  ).run(questionnaireId, NOW);

  const insertQ = db.prepare(
    `INSERT INTO question
       (id, questionnaire_id, question_signature, signature_version, normalized_text,
        raw_text, question_kind, expected_unit, position, required)
     VALUES (?, ?, ?, 'v1', ?, ?, ?, ?, ?, 1)`,
  );
  const questionIds = { num: 'q-num', cat: 'q-cat', narr: 'q-narr' };
  insertQ.run(
    questionIds.num,
    questionnaireId,
    'sig:num',
    '2025 范围 2 总排放',
    '请填报 2025 年范围 2 排放总量。',
    'numerical',
    'kgCO2e',
    '1',
  );
  insertQ.run(
    questionIds.cat,
    questionnaireId,
    'sig:cat',
    '是否已编制清单',
    '贵公司是否已编制 2025 年清单？',
    'categorical',
    null,
    '2',
  );
  insertQ.run(
    questionIds.narr,
    questionnaireId,
    'sig:narr',
    '描述范围1',
    '请描述主要范围 1 排放源。',
    'narrative',
    null,
    '3',
  );

  return { organizationId, questionnaireId, questionIds };
}

/**
 * Build the full AnswerLayer with the real services + real tools + real
 * AiAgent (over the faux provider) + a stub AiClient for the fallback
 * branch. Returns the layer + the live DB for assertions.
 */
function buildRealLayer(
  db: Database.Database,
  organizationId: string,
  fauxReg: FauxProviderRegistration,
  fallbackGenerateObject?: ReturnType<typeof vi.fn>,
): Layer.Layer<answerSvc.AnswerR> {
  // Real services. Heavy create-path sub-deps (ef/calculation/unit/document/
  // customer/credentials) are never reached by the read methods the tools +
  // inventory context use, so stubbing them is safe.
  const orgService = new OrganizationService({ db, now: () => NOW });
  const emissionSourceService = new EmissionSourceService({ db, now: () => NOW });
  const activityDataService = new ActivityDataService({
    db,
    now: () => NOW,
    efService: {} as never,
    calculationService: {} as never,
    unitConversionService: {} as never,
  });
  const questionnaireService = new QuestionnaireService({
    db,
    documentService: {} as never,
    customerService: {} as never,
    credentials: {} as never,
    now: () => NOW,
  } as never);

  const tools = buildAnswerTools({
    activityDataService,
    emissionSourceService,
    questionnaireService,
    organizationId,
  });

  const agentLayer = buildAiAgentLayer({
    config: CONFIG,
    credentials: fakeCredentials(),
    model: fauxReg.getModel(),
  });

  const stubAi = makeStubAi(
    fallbackGenerateObject ??
      vi.fn().mockReturnValue(Effect.die(new Error('fallback not expected in this test'))),
  );

  return Layer.mergeAll(
    Layer.succeed(DbTag, db),
    Layer.succeed(AiClientTag, stubAi),
    Layer.succeed(AnswerToolsTag, tools),
    Layer.succeed(OrgServiceTag, orgService),
    Layer.succeed(ActivityDataServiceTag, activityDataService),
    Layer.succeed(NowTag, () => NOW),
    agentLayer,
  ) as Layer.Layer<answerSvc.AnswerR>;
}

function readAnswer(db: Database.Database, questionId: string) {
  return db.prepare(`SELECT * FROM answer WHERE question_id = ?`).get(questionId) as
    | { value: string; unit: string | null; source_kind: string; source_summary: string | null }
    | undefined;
}

function readAuditPayloads(db: Database.Database): Array<Record<string, unknown>> {
  return (
    db
      .prepare(
        `SELECT payload FROM audit_event WHERE event_kind = 'agent_answer.generate' ORDER BY occurred_at`,
      )
      .all() as Array<{ payload: string }>
  ).map((r) => JSON.parse(r.payload) as Record<string, unknown>);
}

describe('Item 4 e2e — agent answer generation (real tools + real inventory + faux LLM)', () => {
  it('step 1+3: agent queries real inventory via sum_co2e, writes answer + audit (isFallback=false)', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const { organizationId, questionIds } = seed(db);

    faux = registerFauxProvider();
    faux.setResponses([
      // Turn 1: the model decides to aggregate scope-2 emissions.
      fauxAssistantMessage([fauxToolCall('sum_co2e', { scope: 2, year: 2025 })], {
        stopReason: 'toolUse',
      }),
      // Turn 2: the model finalizes with the figure it "read" from the tool.
      fauxAssistantMessage(
        [
          fauxToolCall('submit_response', {
            value: String(SCOPE2_TOTAL),
            unit: 'kgCO2e',
            source_summary: 'sum_co2e(scope=2) across 2 electricity activities',
          }),
        ],
        { stopReason: 'toolUse' },
      ),
    ]);

    const layer = buildRealLayer(db, organizationId, faux);
    const exit = await Effect.runPromiseExit(
      answerSvc.generate(questionIds.num, CONFIG).pipe(Effect.provide(layer)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);

    // The real sum_co2e tool, against the real DB, must return the real sum —
    // proving the tool the agent invoked is a genuine inventory query.
    const realActivityService = new ActivityDataService({
      db,
      now: () => NOW,
      efService: {} as never,
      calculationService: {} as never,
      unitConversionService: {} as never,
    });
    expect(
      realActivityService.sumCo2e({ organization_id: organizationId, scope: 2, year: 2025 }),
    ).toEqual({ total_kg: SCOPE2_TOTAL, count: 2 });

    const ans = readAnswer(db, questionIds.num);
    expect(ans?.value).toBe(String(SCOPE2_TOTAL));
    expect(ans?.unit).toBe('kgCO2e');
    expect(ans?.source_kind).toBe('ai_suggested');
    expect(ans?.source_summary ?? '').not.toContain('单 shot fallback');

    const audits = readAuditPayloads(db);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ isFallback: false, stopReason: 'completed' });
    expect(audits[0]?.toolCallSummary).toEqual(['sum_co2e']);
  });

  it('step 2: real AgentStalled → single-shot fallback with 【单 shot fallback】 prefix + audit isFallback=true', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const { organizationId, questionIds } = seed(db);

    faux = registerFauxProvider();
    // Same tool + identical args twice in a row → the real agent loop's
    // no-progress detector trips AgentStalled, which the orchestrator
    // recovers from by switching to the single-shot fallback.
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('sum_co2e', { scope: 2, year: 2025 })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('sum_co2e', { scope: 2, year: 2025 })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('sum_co2e', { scope: 2, year: 2025 })], {
        stopReason: 'toolUse',
      }),
    ]);

    const fallbackGen = vi.fn().mockReturnValue(
      Effect.succeed({
        value: String(SCOPE2_TOTAL),
        unit: 'kgCO2e',
        source_summary: 'single-shot summed inventory',
      }),
    );

    const layer = buildRealLayer(db, organizationId, faux, fallbackGen);
    const exit = await Effect.runPromiseExit(
      answerSvc.generate(questionIds.num, CONFIG).pipe(Effect.provide(layer)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(fallbackGen).toHaveBeenCalledOnce();

    const ans = readAnswer(db, questionIds.num);
    expect(ans?.source_summary ?? '').toContain('单 shot fallback');
    expect(ans?.source_summary ?? '').toContain('single-shot summed inventory');

    const audits = readAuditPayloads(db);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ isFallback: true, stopReason: 'stalled' });
  });

  it('step 4: batch generateAllUnanswered answers every question, one audit row each', async () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const { organizationId, questionnaireId } = seed(db);

    faux = registerFauxProvider();
    // Each agent run finalizes in one turn (turn 1 = submit_response →
    // terminate), so each run consumes exactly one queued step. The 3
    // unanswered questions run at concurrency 3; queue 3 identical
    // finalizers so order-of-consumption doesn't matter.
    const submit = () =>
      fauxAssistantMessage(
        [
          fauxToolCall('submit_response', {
            value: '42',
            unit: 'kgCO2e',
            source_summary: 'batch answer',
          }),
        ],
        { stopReason: 'toolUse' as const },
      );
    faux.setResponses([submit(), submit(), submit()]);

    const layer = buildRealLayer(db, organizationId, faux);
    const results = await Effect.runPromise(
      answerSvc.generateAllUnanswered(questionnaireId, CONFIG).pipe(Effect.provide(layer)),
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => Either.isRight(r))).toBe(true);

    const answerCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM answer a JOIN question q ON q.id = a.question_id WHERE q.questionnaire_id = ?`,
        )
        .get(questionnaireId) as { n: number }
    ).n;
    expect(answerCount).toBe(3);

    expect(readAuditPayloads(db)).toHaveLength(3);
  });
});
