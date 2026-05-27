import { runMigrations } from '@main/db/migrate';
import { recordAgentAudit } from '@main/services/answer-generation/audit';
import Database from 'better-sqlite3';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

const dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function makeDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  dbs.push(db);
  return db;
}

describe('recordAgentAudit', () => {
  it('writes a row with agent_answer.generate event_kind', async () => {
    const db = makeDb();
    await Effect.runPromise(
      recordAgentAudit({
        db,
        questionId: 'q1',
        isFallback: false,
        trace: {
          turnCount: 3,
          toolCalls: [
            { tool: 'list_activities', argsHash: 'a', durationMs: 5 },
            { tool: 'sum_co2e', argsHash: 'b', durationMs: 3 },
            { tool: 'submit_response', argsHash: 'c', durationMs: 1 },
          ],
          totalTokens: { input: 1200, output: 200 },
          totalDurationMs: 1500,
          stopReason: 'completed',
        },
        now: () => '2026-05-27T10:00:00Z',
      }),
    );

    const rows = db.prepare(`SELECT event_kind, payload FROM audit_event`).all() as Array<{
      event_kind: string;
      payload: string;
    }>;
    expect(rows.length).toBe(1);
    const row = rows[0];
    if (!row) throw new Error('expected one audit row');
    expect(row.event_kind).toBe('agent_answer.generate');
    const payload = JSON.parse(row.payload);
    expect(payload).toEqual({
      questionId: 'q1',
      isFallback: false,
      turnCount: 3,
      toolCallSummary: ['list_activities', 'sum_co2e', 'submit_response'],
      tokens: { input: 1200, output: 200 },
      durationMs: 1500,
      stopReason: 'completed',
    });
  });

  it('marks fallback rows with isFallback: true', async () => {
    const db = makeDb();
    await Effect.runPromise(
      recordAgentAudit({
        db,
        questionId: 'q2',
        isFallback: true,
        trace: {
          turnCount: 0,
          toolCalls: [],
          totalTokens: { input: 0, output: 0 },
          totalDurationMs: 0,
          stopReason: 'completed',
        },
        now: () => '2026-05-27T10:01:00Z',
      }),
    );

    const row = db.prepare(`SELECT payload FROM audit_event`).get() as { payload: string };
    expect(JSON.parse(row.payload).isFallback).toBe(true);
  });

  it('stores tool NAMES only, never args (sensitive-data hygiene)', async () => {
    const db = makeDb();
    await Effect.runPromise(
      recordAgentAudit({
        db,
        questionId: 'q3',
        isFallback: false,
        trace: {
          turnCount: 1,
          toolCalls: [
            {
              tool: 'list_activities',
              argsHash: 'this is the hashed args containing sensitive customer ids',
              durationMs: 5,
            },
          ],
          totalTokens: { input: 0, output: 0 },
          totalDurationMs: 5,
          stopReason: 'completed',
        },
        now: () => '2026-05-27T10:02:00Z',
      }),
    );

    const payload = JSON.parse(
      (db.prepare(`SELECT payload FROM audit_event`).get() as { payload: string }).payload,
    );
    // toolCallSummary should contain just the name, never the hash.
    expect(payload.toolCallSummary).toEqual(['list_activities']);
    expect(JSON.stringify(payload)).not.toContain('hashed args');
    expect(JSON.stringify(payload)).not.toContain('customer ids');
  });
});
