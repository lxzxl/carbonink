import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import { AgentSkillService, type SkillResolver } from '@main/services/agent-skill-service';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const tmpDirs: string[] = [];
const dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeService(opts: { bundledContent?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'skill-test-'));
  tmpDirs.push(home);
  const bundledPath = join(home, 'bundled-SKILL.md');
  writeFileSync(bundledPath, opts.bundledContent ?? '# bundled skill v1\nhello\n');
  const db = new Database(':memory:');
  runMigrations(db);
  dbs.push(db);
  const resolver: SkillResolver = {
    bundledSkillPath: () => bundledPath,
  };
  const svc = new AgentSkillService({
    db,
    resolver,
    now: () => new Date('2026-05-26T12:00:00Z'),
    home,
  });
  return { svc, home, db, bundledPath };
}

describe('AgentSkillService.detect', () => {
  it('returns not_installed when canonical dir missing', async () => {
    const { svc } = makeService();
    const r = await svc.detect();
    expect(r.state).toBe('not_installed');
    expect(r.detectedHosts).toContain('agentsShared');
  });

  it('detects Claude Code host when ~/.claude/skills exists', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    const r = await svc.detect();
    expect(r.detectedHosts).toContain('claudeCode');
  });

  it('detects Pi host when ~/.pi/agent/skills exists', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.pi/agent/skills'), { recursive: true });
    const r = await svc.detect();
    expect(r.detectedHosts).toContain('pi');
  });

  it('detects Codex host when ~/.codex/skills exists', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.codex/skills'), { recursive: true });
    const r = await svc.detect();
    expect(r.detectedHosts).toContain('codex');
  });

  it('returns installed + needsUpdate:false when content matches bundled', async () => {
    const { svc, home } = makeService({ bundledContent: '# v2\n' });
    const canon = join(home, '.agents/skills/carbonink-mcp');
    mkdirSync(canon, { recursive: true });
    writeFileSync(join(canon, 'SKILL.md'), '# v2\n');
    const r = await svc.detect();
    expect(r.state).toBe('installed');
    if (r.state === 'installed') {
      expect(r.needsUpdate).toBe(false);
    }
  });

  it('returns installed + needsUpdate:true when content differs from bundled', async () => {
    const { svc, home } = makeService({ bundledContent: '# v2\n' });
    const canon = join(home, '.agents/skills/carbonink-mcp');
    mkdirSync(canon, { recursive: true });
    writeFileSync(join(canon, 'SKILL.md'), '# v1\n');
    const r = await svc.detect();
    if (r.state === 'installed') {
      expect(r.needsUpdate).toBe(true);
    }
  });

  it('hostsLinked reflects existing symlinks pointing at canonical', async () => {
    const { svc, home } = makeService();
    const canon = join(home, '.agents/skills/carbonink-mcp');
    mkdirSync(canon, { recursive: true });
    writeFileSync(join(canon, 'SKILL.md'), '# bundled skill v1\nhello\n');
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    symlinkSync('../../.agents/skills/carbonink-mcp', join(home, '.claude/skills/carbonink-mcp'));
    const r = await svc.detect();
    if (r.state === 'installed') {
      expect(r.hostsLinked).toContain('claudeCode');
      expect(r.hostsLinked).toContain('agentsShared');
    }
  });

  it('does not mistake a regular dir for our symlink', async () => {
    const { svc, home } = makeService();
    const canon = join(home, '.agents/skills/carbonink-mcp');
    mkdirSync(canon, { recursive: true });
    writeFileSync(join(canon, 'SKILL.md'), '# bundled skill v1\nhello\n');
    mkdirSync(join(home, '.claude/skills/carbonink-mcp'), { recursive: true }); // regular dir, not symlink
    const r = await svc.detect();
    if (r.state === 'installed') {
      expect(r.hostsLinked).not.toContain('claudeCode');
    }
  });
});

describe('AgentSkillService.install', () => {
  it('creates canonical dir + SKILL.md from bundled', async () => {
    const { svc, home } = makeService({ bundledContent: '# fresh skill\n' });
    const r = await svc.install();
    expect(r.canonicalPath).toBe(join(home, '.agents/skills/carbonink-mcp'));
    expect(readFileSync(join(r.canonicalPath, 'SKILL.md'), 'utf-8')).toBe('# fresh skill\n');
    expect(r.hostsLinked).toEqual(['agentsShared']);
    expect(r.backupPath).toBeNull();
  });

  it('symlinks for hosts whose parent dir exists', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    mkdirSync(join(home, '.pi/agent/skills'), { recursive: true });
    const r = await svc.install();
    expect(r.hostsLinked).toEqual(expect.arrayContaining(['claudeCode', 'pi', 'agentsShared']));
    const stats = (p: string) => require('node:fs').lstatSync(p);
    expect(stats(join(home, '.claude/skills/carbonink-mcp')).isSymbolicLink()).toBe(true);
    expect(stats(join(home, '.pi/agent/skills/carbonink-mcp')).isSymbolicLink()).toBe(true);
  });

  it('does not create phantom dirs for hosts without parent', async () => {
    const { svc, home } = makeService();
    // No ~/.codex/skills/ exists
    await svc.install();
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  it('idempotent: second install with same content writes no backup', async () => {
    const { svc } = makeService();
    await svc.install();
    const r = await svc.install();
    expect(r.backupPath).toBeNull();
  });

  it('does not overwrite a non-symlink at the host link path', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.claude/skills/carbonink-mcp'), { recursive: true });
    writeFileSync(join(home, '.claude/skills/carbonink-mcp/SKILL.md'), '# user content');
    const r = await svc.install();
    expect(r.hostsLinked).not.toContain('claudeCode'); // refused to overwrite
    // user content preserved
    expect(readFileSync(join(home, '.claude/skills/carbonink-mcp/SKILL.md'), 'utf-8')).toBe(
      '# user content',
    );
  });

  it('records agent_skill.install audit event', async () => {
    const { svc, db } = makeService();
    await svc.install();
    const rows = db
      .prepare(`SELECT event_kind FROM audit_event WHERE event_kind = 'agent_skill.install'`)
      .all() as Array<{ event_kind: string }>;
    expect(rows.length).toBe(1);
  });
});

describe('AgentSkillService.update', () => {
  it('writes backup and replaces canonical when bundled differs', async () => {
    const { svc, home, bundledPath } = makeService({ bundledContent: '# v1\n' });
    await svc.install();
    writeFileSync(bundledPath, '# v2 updated\n');
    const r = await svc.update();
    expect(r.backupPath).toMatch(/\.carbonink-bak-/);
    expect(readFileSync(join(home, '.agents/skills/carbonink-mcp/SKILL.md'), 'utf-8')).toBe(
      '# v2 updated\n',
    );
  });

  it('no-op when canonical equals bundled', async () => {
    const { svc } = makeService();
    await svc.install();
    const r = await svc.update();
    expect(r.backupPath).toBeNull();
  });

  it('update logs agent_skill.install (update reuses install)', async () => {
    const { svc, db, bundledPath } = makeService({ bundledContent: '# v1\n' });
    await svc.install();
    writeFileSync(bundledPath, '# v2\n');
    await svc.update();
    const rows = db
      .prepare(`SELECT event_kind FROM audit_event WHERE event_kind = 'agent_skill.install'`)
      .all() as Array<{ event_kind: string }>;
    expect(rows.length).toBe(2);
  });
});

describe('AgentSkillService.remove', () => {
  it('removes symlinks and canonical dir, backs up SKILL.md', async () => {
    const { svc, home } = makeService();
    mkdirSync(join(home, '.claude/skills'), { recursive: true });
    await svc.install();
    const r = await svc.remove();
    expect(r.backupPath).toMatch(/\.carbonink-bak-/);
    expect(existsSync(join(home, '.agents/skills/carbonink-mcp'))).toBe(false);
    expect(existsSync(join(home, '.claude/skills/carbonink-mcp'))).toBe(false);
    // backup file lives OUTSIDE the canonical dir so it survives rmSync
    expect(r.backupPath).not.toBeNull();
    expect(existsSync(r.backupPath as string)).toBe(true);
  });

  it('no-op when not installed', async () => {
    const { svc } = makeService();
    const r = await svc.remove();
    expect(r.backupPath).toBeNull();
    expect(r.removed).toEqual([]);
  });

  it('records agent_skill.remove audit event', async () => {
    const { svc, db } = makeService();
    await svc.install();
    await svc.remove();
    const rows = db
      .prepare(`SELECT event_kind FROM audit_event WHERE event_kind = 'agent_skill.remove'`)
      .all() as Array<{ event_kind: string }>;
    expect(rows.length).toBe(1);
  });
});
