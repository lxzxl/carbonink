import type { AgentTool } from '@main/llm/ai-agent.js';
import { buildCacheKey, sha256Hex, stableStringify } from '@main/llm/cache-key.js';
import type { LlmCache } from '@main/llm/llm-cache.js';
import { type AiCacheRequest, runAiAgent } from '@main/llm/run-ai.js';
import type { CredentialService } from '@main/services/credential-service.js';
import type { ProviderConfigV2, ReadinessFinding } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';

/**
 * Layer 2 of the readiness feature (spec 2026-08-13-readiness-agent-review):
 * the two checks a query cannot express.
 *
 * Everything else the original design imagined for this layer — prose
 * explanation, re-ranking, cause hypotheses — was dropped. A rule finding
 * already says exactly what is wrong, the ledger does not know why it happened,
 * and severity is already a total order. What is left is genuinely
 * model-shaped: judging whether an inventory's *structure* makes sense.
 *
 * Contract: this never throws and never blocks. Every failure returns `[]`,
 * because the deterministic checklist is the product and this is an addition
 * to it.
 */

const MAX_TURNS = (() => {
  const raw = Number.parseInt(process.env.READINESS_AGENT_MAX_TURNS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 4;
})();
const TIMEOUT_MS = 60_000;

/**
 * Prompt version pinned into readiness cache keys. Bump when
 * SYSTEM_PROMPT or reviewSchema changes.
 */
const READINESS_PROMPT_VERSION = 'v1';

/** Inventories change across runs — a day-long TTL. */
const READINESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_OBSERVATION_CHARS = 240;

const reviewSchema = z.object({
  findings: z
    .array(
      z.object({
        check_id: z.union([z.literal('C6'), z.literal('N6')]),
        /** Required for N6, absent for C6 (nothing exists to point at). */
        emission_source_id: z.string().optional(),
        observation: z.string(),
      }),
    )
    .max(20),
});

const SYSTEM_PROMPT = [
  'You review the STRUCTURE of a greenhouse-gas inventory for an ESG consultant.',
  'You are not checking arithmetic — deterministic rules already do that.',
  '',
  'Raise only two kinds of observation:',
  '- N6: an emission source whose scope or category contradicts what its name',
  '  describes (e.g. a diesel generator filed under Scope 2, which is for',
  '  purchased energy). Always cite the emission_source_id.',
  "- C6: an emission source this organization's industry would normally report",
  '  and which is absent entirely. Omit emission_source_id; nothing exists yet.',
  '',
  'Say nothing when the inventory looks structurally sound. An empty findings',
  'array is a good answer and is expected often. Do not restate what the data',
  'says, do not speculate about causes, and never invent an id: cite only ids',
  'returned by the tools.',
  'Keep each observation to one sentence.',
].join('\n');

export interface ReadinessAgentDeps {
  db: Database.Database;
  now: () => string;
  credentials: CredentialService;
  /** Null when the user has not configured a provider — review() then no-ops. */
  config: ProviderConfigV2 | null;
  /**
   * Test-only. A faux-backed `Models` collection lets a suite drive the real
   * turn loop (and so the real tool schemas) without a network or a key;
   * production leaves it undefined. Same hook `buildAiAgentLayer` documents.
   */
  modelsInstance?: Parameters<typeof runAiAgent>[2]['modelsInstance'];
  /**
   * File-backed deterministic-result cache. Absent in unit tests;
   * production wires the process `LlmCache` from the IPC context.
   */
  cache?: LlmCache;
}

interface SourceRow {
  id: string;
  name: string;
  scope: number;
  category: string | null;
}

export class ReadinessAgentService {
  constructor(private readonly deps: ReadinessAgentDeps) {}

  async review(reportingPeriodId: string): Promise<ReadinessFinding[]> {
    if (!this.deps.config) return [];

    const period = this.deps.db
      .prepare('SELECT id, organization_id, year FROM reporting_period WHERE id = ?')
      .get(reportingPeriodId) as { id: string; organization_id: string; year: number } | undefined;
    if (!period) return [];

    const sources = this.listSources(period.organization_id);
    if (sources.length === 0) return [];
    const knownIds = new Set(sources.map((s) => s.id));

    const startedAt = Date.now();
    try {
      const cache = this.cacheRequest(period);
      const { result, trace, cached } = await runAiAgent(this.deps.config, this.deps.credentials, {
        systemPrompt: SYSTEM_PROMPT,
        userPrompt:
          `Review the ${period.year} inventory. Start by listing the emission sources ` +
          'and the organization profile.',
        schema: reviewSchema,
        tools: this.buildTools(period.organization_id, period.id),
        maxTurns: MAX_TURNS,
        timeoutMs: TIMEOUT_MS,
        ...(this.deps.modelsInstance !== undefined
          ? { modelsInstance: this.deps.modelsInstance }
          : {}),
        ...(cache ? { cache } : {}),
      });

      // Cache hits skip the audit row — same rationale as the EF matcher:
      // no agent ran, so there is no attempt to record.
      if (!cached) {
        this.writeTrace({
          periodId: period.id,
          stopReason: trace.stopReason,
          turnCount: trace.turnCount,
          tools: trace.toolCalls.map((c) => c.tool),
          tokens: trace.totalTokens,
          durationMs: trace.totalDurationMs,
          findingCount: result.findings.length,
        });
      }

      return this.sanitize(result.findings, knownIds, period.id);
    } catch {
      // Every AiErr, AgentMaxTurns and AgentStalled lands here. The rule layer
      // has already produced its findings; degrading to "the agent added
      // nothing" is the only behaviour that keeps the checklist trustworthy.
      this.writeTrace({
        periodId: period.id,
        stopReason: 'failed',
        turnCount: 0,
        tools: [],
        tokens: { input: 0, output: 0 },
        durationMs: Date.now() - startedAt,
        findingCount: 0,
      });
      return [];
    }
  }

  /**
   * Post-processing lives in code, not in the prompt: a model asked to
   * self-police its own severity or its own ids will comply most of the time,
   * and "most of the time" is not a guardrail.
   */
  private sanitize(
    raw: ReadonlyArray<{
      check_id: 'C6' | 'N6';
      emission_source_id?: string | undefined;
      observation: string;
    }>,
    knownIds: ReadonlySet<string>,
    periodId: string,
  ): ReadinessFinding[] {
    const out: ReadinessFinding[] = [];
    for (const f of raw) {
      const observation = f.observation.trim().slice(0, MAX_OBSERVATION_CHARS);
      if (observation === '') continue;

      if (f.check_id === 'N6') {
        // Mirrors ef-matcher's hallucinated-PK filter: a finding about an
        // entity that does not exist is worse than no finding.
        const id = f.emission_source_id;
        if (id === undefined || !knownIds.has(id)) continue;
        out.push({
          check_id: 'N6',
          severity: 'info',
          entity: { type: 'emission_source', id },
          facts: { observation },
        });
        continue;
      }

      // C6 is about an absence, so it hangs off the period rather than a row.
      out.push({
        check_id: 'C6',
        severity: 'info',
        entity: { type: 'period', id: periodId },
        facts: { observation },
      });
    }
    return out;
  }

  private listSources(organizationId: string): SourceRow[] {
    return this.deps.db
      .prepare(
        `SELECT es.id, es.name, es.scope, es.category
           FROM emission_source es
           JOIN site s ON s.id = es.site_id
          WHERE s.organization_id = ? AND es.is_active = 1
          ORDER BY es.scope, es.name`,
      )
      .all(organizationId) as SourceRow[];
  }

  private activitySummary(periodId: string, organizationId: string): unknown {
    return this.deps.db
      .prepare(
        `SELECT es.id AS emission_source_id, es.name,
                COUNT(ad.id) AS row_count,
                COALESCE(SUM(ad.computed_co2e_kg), 0) AS co2e_kg
           FROM emission_source es
           JOIN site s ON s.id = es.site_id
      LEFT JOIN activity_data ad
             ON ad.emission_source_id = es.id AND ad.reporting_period_id = ?
          WHERE s.organization_id = ?
       GROUP BY es.id
       ORDER BY co2e_kg DESC`,
      )
      .all(periodId, organizationId);
  }

  private orgProfile(organizationId: string): unknown {
    const org = this.deps.db
      .prepare(
        `SELECT industry, country_code, boundary_kind,
                (SELECT COUNT(*) FROM site WHERE organization_id = organization.id)
                  AS site_count
           FROM organization WHERE id = ?`,
      )
      .get(organizationId);
    return org ?? { error: 'organization_not_found' };
  }

  /**
   * Inventory fingerprint for cache keys: everything the review can
   * observe through its tools (sources, per-source activity totals, org
   * profile). Any edit that could change the review changes the
   * fingerprint and invalidates the cached findings.
   */
  private cacheRequest(period: {
    id: string;
    organization_id: string;
    year: number;
  }): AiCacheRequest | undefined {
    if (!this.deps.cache || !this.deps.config) return undefined;
    const inventory = stableStringify({
      sources: this.listSources(period.organization_id),
      activity: this.activitySummary(period.id, period.organization_id),
      profile: this.orgProfile(period.organization_id),
    });
    return {
      store: this.deps.cache,
      key: buildCacheKey({
        scope: 'readiness',
        provider: this.deps.config.provider,
        model: this.deps.config.model,
        promptVersion: READINESS_PROMPT_VERSION,
        datasetVersion: sha256Hex(inventory),
        payload: { period_id: period.id, year: period.year },
      }),
      ttlMs: READINESS_CACHE_TTL_MS,
    };
  }

  /** Read-only, organization-scoped, and small enough to fit a few turns. */
  private buildTools(organizationId: string, periodId: string): AgentTool[] {
    return [
      {
        name: 'list_emission_sources',
        description:
          'List the active emission sources: id, name, scope (1|2|3), category. ' +
          'Cite these ids and no others.',
        parameters: z.toJSONSchema(z.object({})),
        execute: async () => ({ emission_sources: this.listSources(organizationId) }),
      },
      {
        name: 'summarize_activity',
        description:
          'Per-source totals for the period: row count and total co2e_kg. Use to tell ' +
          'a material source from a token one.',
        parameters: z.toJSONSchema(z.object({})),
        execute: async () => ({
          sources: this.activitySummary(periodId, organizationId),
        }),
      },
      {
        name: 'get_organization_profile',
        description:
          'The organization: industry, country, boundary and site count. Industry is ' +
          'what makes a missing source (C6) judgeable.',
        parameters: z.toJSONSchema(z.object({})),
        execute: async () => this.orgProfile(organizationId),
      },
    ];
  }

  /**
   * Payload discipline (AGENTS.md): tool names, counts and timings only. The
   * observations themselves are model output about the user's data and have no
   * business in an append-only table.
   */
  private writeTrace(t: {
    periodId: string;
    stopReason: string;
    turnCount: number;
    tools: string[];
    tokens: { input: number; output: number };
    durationMs: number;
    findingCount: number;
  }): void {
    this.deps.db
      .prepare('INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)')
      .run(
        newId(),
        'readiness.agent_trace',
        JSON.stringify({
          reporting_period_id: t.periodId,
          stop_reason: t.stopReason,
          turn_count: t.turnCount,
          tool_calls: t.tools,
          input_tokens: t.tokens.input,
          output_tokens: t.tokens.output,
          duration_ms: t.durationMs,
          finding_count: t.findingCount,
        }),
        this.deps.now(),
      );
  }
}
