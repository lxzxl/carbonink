import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import type { IpcContext } from '@main/ipc/context';
import { agentSkillHandlers } from '@main/ipc/handlers/agent-skill';
import { AgentSkillService } from '@main/services/agent-skill-service';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tmpDirs: string[] = [];
const dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeCtx() {
  const home = mkdtempSync(join(tmpdir(), 'skill-ipc-'));
  tmpDirs.push(home);
  const bundled = join(home, 'bundled-SKILL.md');
  writeFileSync(bundled, '# bundled\n');
  const db = new Database(':memory:');
  runMigrations(db);
  dbs.push(db);
  const agentSkillService = new AgentSkillService({
    db,
    resolver: { bundledSkillPath: () => bundled },
    now: () => new Date('2026-05-26T12:00:00Z'),
    home,
  });
  const ctx = { db, agentSkillService } as unknown as IpcContext;
  return { ctx, agentSkillService };
}

describe('agentSkillHandlers', () => {
  it('skill:detect delegates to service.detect', async () => {
    const { ctx, agentSkillService } = makeCtx();
    const spy = vi.spyOn(agentSkillService, 'detect');
    const handlers = agentSkillHandlers(ctx);
    await handlers['skill:detect']!();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('skill:install wraps result in {ok:true}', async () => {
    const { ctx } = makeCtx();
    const handlers = agentSkillHandlers(ctx);
    const r = await handlers['skill:install']!();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.canonicalPath).toBeDefined();
    }
  });

  it('skill:install catches errors → {ok:false, error:"io_error"}', async () => {
    const { ctx, agentSkillService } = makeCtx();
    vi.spyOn(agentSkillService, 'install').mockRejectedValue(new Error('disk full'));
    const handlers = agentSkillHandlers(ctx);
    const r = await handlers['skill:install']!();
    expect(r).toEqual({ ok: false, error: 'io_error', message: 'disk full' });
  });

  it('skill:update wraps result in {ok:true}', async () => {
    const { ctx } = makeCtx();
    const handlers = agentSkillHandlers(ctx);
    await handlers['skill:install']!();
    const r = await handlers['skill:update']!();
    expect(r.ok).toBe(true);
  });

  it('skill:remove wraps result in {ok:true}', async () => {
    const { ctx } = makeCtx();
    const handlers = agentSkillHandlers(ctx);
    await handlers['skill:install']!();
    const r = await handlers['skill:remove']!();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.removed.length).toBeGreaterThan(0);
    }
  });
});
