import {
  createModels,
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { runMigrations } from '@main/db/migrate';
import { ReadinessAgentService } from '@main/services/readiness/agent';
import type { ProviderConfigV2 } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Layer 2 against a faux provider: the agent loop, the tools and the DB are
 * real; only the model is scripted. The cases that matter are the guardrails —
 * a hallucinated id, a severity the model chose for itself, and every way the
 * loop can fail — because those are what decide whether the deterministic
 * checklist stays trustworthy when an agent is bolted onto it.
 */

const NOW = '2026-02-01T00:00:00.000Z';
const CONFIG: ProviderConfigV2 = { provider: 'deepseek', model: 'deepseek-v4-flash' };

let db: Database.Database;
let faux: FauxProviderHandle | undefined;

function fauxModels(): MutableModels {
  if (!faux) throw new Error('faux provider not registered — call fauxProvider() first');
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

afterEach(() => {
  faux = undefined;
  db.close();
});

function fakeCredentials() {
  return {
    get: vi.fn(() => 'sk-fake-test-key'),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as never;
}

function build(config: ProviderConfigV2 | null = CONFIG): ReadinessAgentService {
  return new ReadinessAgentService({
    db,
    now: () => NOW,
    credentials: fakeCredentials(),
    config,
    // Drive the REAL turn loop against the faux provider, so the tool schemas
    // and executors are exercised rather than mocked past.
    ...(faux ? { modelsInstance: fauxModels() } : {}),
  });
}

function traces(): Array<Record<string, unknown>> {
  return (
    db
      .prepare(`SELECT payload FROM audit_event WHERE event_kind = 'readiness.agent_trace'`)
      .all() as Array<{ payload: string }>
  ).map((r) => JSON.parse(r.payload) as Record<string, unknown>);
}

/** One turn of tool use, then a submit_response carrying the findings. */
function scriptFindings(findings: unknown[]): void {
  faux = fauxProvider({ provider: 'deepseek', models: [{ id: 'deepseek-v4-flash' }] });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('list_emission_sources', {})], {
      stopReason: 'toolUse',
    }),
    fauxAssistantMessage([fauxToolCall('submit_response', { findings })], {
      stopReason: 'toolUse',
    }),
  ]);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare(
    `INSERT INTO organization (id, name_en, industry, country_code, boundary_kind, created_at, updated_at)
     VALUES ('org-1', 'Test Org', 'manufacturing', 'CN', 'operational_control', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO site (id, organization_id, name_en, country_code, created_at, updated_at)
     VALUES ('site-1', 'org-1', 'HQ', 'CN', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
     VALUES ('rp-1', 'org-1', 2024, 'annual', '2024-01-01', '2024-12-31', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO emission_source (id, site_id, name, scope, category)
     VALUES ('es-diesel', 'site-1', 'Diesel generator', 2, 'electricity.grid')`,
  ).run();
});

describe('readiness agent review', () => {
  it('surfaces both check kinds, anchored to the right entities', async () => {
    scriptFindings([
      {
        check_id: 'N6',
        emission_source_id: 'es-diesel',
        observation: 'A diesel generator burns fuel on site, so it is Scope 1, not Scope 2.',
      },
      {
        check_id: 'C6',
        observation: 'A manufacturer usually reports process emissions; none is present.',
      },
    ]);

    const findings = await build().review('rp-1');

    expect(findings).toHaveLength(2);
    const n6 = findings.find((f) => f.check_id === 'N6');
    expect(n6?.entity).toEqual({ type: 'emission_source', id: 'es-diesel' });
    expect(String(n6?.facts.observation)).toContain('Scope 1');
    // C6 is about an absence, so it hangs off the period.
    expect(findings.find((f) => f.check_id === 'C6')?.entity).toEqual({
      type: 'period',
      id: 'rp-1',
    });
  });

  it('drops a finding naming an emission source that does not exist', async () => {
    scriptFindings([
      { check_id: 'N6', emission_source_id: 'es-invented', observation: 'Looks wrong.' },
    ]);

    // A complaint about an entity the user cannot find is worse than silence.
    expect(await build().review('rp-1')).toEqual([]);
  });

  it('drops an N6 that cites no source at all', async () => {
    scriptFindings([{ check_id: 'N6', observation: 'Something is off somewhere.' }]);

    expect(await build().review('rp-1')).toEqual([]);
  });

  it('forces severity to info even though the model never chose it', async () => {
    scriptFindings([
      { check_id: 'N6', emission_source_id: 'es-diesel', observation: 'Scope looks wrong.' },
    ]);

    const findings = await build().review('rp-1');
    // Severity is assigned in code: the agent is questioning someone else's
    // classification call, which is not grounds to block a delivery.
    expect(findings[0]?.severity).toBe('info');
  });

  it('drops an empty observation rather than rendering a blank row', async () => {
    scriptFindings([
      { check_id: 'C6', observation: '   ' },
      { check_id: 'N6', emission_source_id: 'es-diesel', observation: 'Real one.' },
    ]);

    const findings = await build().review('rp-1');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.check_id).toBe('N6');
  });

  it('returns nothing when no AI provider is configured, and writes no trace', async () => {
    const findings = await build(null).review('rp-1');

    expect(findings).toEqual([]);
    // No call was attempted, so there is nothing to record.
    expect(traces()).toHaveLength(0);
  });

  it('returns nothing when the loop fails, and still records the attempt', async () => {
    // No scripted responses: the faux provider runs dry and the loop errors.
    faux = fauxProvider({ provider: 'deepseek', models: [{ id: 'deepseek-v4-flash' }] });
    faux.setResponses([]);

    expect(await build().review('rp-1')).toEqual([]);

    const trace = traces()[0];
    expect(trace?.stop_reason).toBe('failed');
    expect(trace?.finding_count).toBe(0);
  });

  it('returns nothing for an unknown period', async () => {
    scriptFindings([]);
    expect(await build().review('nope')).toEqual([]);
  });

  it('returns nothing when the organization has no sources to judge', async () => {
    db.prepare('DELETE FROM emission_source').run();
    scriptFindings([]);

    expect(await build().review('rp-1')).toEqual([]);
    // Never called the model, so nothing was spent and nothing is recorded.
    expect(traces()).toHaveLength(0);
  });

  it('records a trace carrying tool names and counts but no finding content', async () => {
    scriptFindings([
      {
        check_id: 'N6',
        emission_source_id: 'es-diesel',
        observation: 'A diesel generator is Scope 1.',
      },
    ]);

    await build().review('rp-1');

    const trace = traces()[0];
    expect(trace?.finding_count).toBe(1);
    expect(trace?.tool_calls).toContain('list_emission_sources');
    // Payload discipline: the model's sentence about the user's data must not
    // land in an append-only table.
    expect(JSON.stringify(trace)).not.toContain('diesel generator is Scope 1');
  });
});
