import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
