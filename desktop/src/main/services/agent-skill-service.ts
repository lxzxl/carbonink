import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import type { AgentHost, SkillDetectResult } from '@shared/types.js';
import type Database from 'better-sqlite3';

export type { AgentHost, SkillDetectResult } from '@shared/types.js';

export interface SkillResolver {
  /** Absolute path to the bundled SKILL.md (production: process.resourcesPath; dev: project path). */
  bundledSkillPath(): string;
}

export interface AgentSkillDeps {
  db: Database.Database;
  resolver: SkillResolver;
  now: () => Date;
  /** Override home directory (testing). Defaults to os.homedir(). */
  home?: string;
}

const SKILL_DIR_NAME = 'carbonink-mcp';
const SKILL_FILE = 'SKILL.md';

const HOST_PARENT_DIRS: Record<Exclude<AgentHost, 'agentsShared'>, (h: string) => string> = {
  claudeCode: (h) => join(h, '.claude/skills'),
  pi: (h) => join(h, '.pi/agent/skills'),
  codex: (h) => join(h, '.codex/skills'),
};

export class AgentSkillService {
  constructor(private readonly deps: AgentSkillDeps) {}

  private get home(): string {
    return this.deps.home ?? homedir();
  }

  private canonicalDir(): string {
    return join(this.home, '.agents/skills', SKILL_DIR_NAME);
  }

  private canonicalFile(): string {
    return join(this.canonicalDir(), SKILL_FILE);
  }

  async detect(): Promise<SkillDetectResult> {
    const detectedHosts: AgentHost[] = ['agentsShared'];
    for (const host of Object.keys(HOST_PARENT_DIRS) as Array<keyof typeof HOST_PARENT_DIRS>) {
      if (existsSync(HOST_PARENT_DIRS[host](this.home))) {
        detectedHosts.push(host);
      }
    }

    const canonical = this.canonicalFile();
    if (!existsSync(canonical)) {
      return { state: 'not_installed', detectedHosts };
    }

    const installedSha = sha256(readFileSync(canonical));
    const bundledSha = sha256(readFileSync(this.deps.resolver.bundledSkillPath()));
    const needsUpdate = installedSha !== bundledSha;

    const hostsLinked: AgentHost[] = ['agentsShared'];
    for (const host of Object.keys(HOST_PARENT_DIRS) as Array<keyof typeof HOST_PARENT_DIRS>) {
      const linkPath = join(HOST_PARENT_DIRS[host](this.home), SKILL_DIR_NAME);
      if (this.isOurSymlink(linkPath)) hostsLinked.push(host);
    }

    return {
      state: 'installed',
      canonicalPath: this.canonicalDir(),
      hostsLinked,
      needsUpdate,
      detectedHosts,
    };
  }

  private isOurSymlink(linkPath: string): boolean {
    try {
      const stat = lstatSync(linkPath);
      if (!stat.isSymbolicLink()) return false;
      const target = readlinkSync(linkPath);
      // Target should resolve to our canonical dir (tail match — last 3 path segments)
      return (
        target.endsWith(`/.agents/skills/${SKILL_DIR_NAME}`) ||
        target.endsWith(`\\.agents\\skills\\${SKILL_DIR_NAME}`)
      );
    } catch {
      return false;
    }
  }

  async install(): Promise<{
    canonicalPath: string;
    hostsLinked: AgentHost[];
    backupPath: string | null;
  }> {
    const bundledRaw = readFileSync(this.deps.resolver.bundledSkillPath());
    const canonicalDir = this.canonicalDir();
    const canonical = this.canonicalFile();

    let backupPath: string | null = null;
    let didWrite = false;

    if (existsSync(canonical)) {
      const existing = readFileSync(canonical);
      if (sha256(existing) === sha256(bundledRaw)) {
        // Already up-to-date; just ensure symlinks exist for any newly detected hosts
        const hostsLinked = this.ensureSymlinks(canonicalDir);
        return { canonicalPath: canonicalDir, hostsLinked, backupPath: null };
      }
      // Backup goes OUTSIDE the canonical dir so it survives if we ever rm -rf
      backupPath = `${canonicalDir}.carbonink-bak-${this.tsForFilename()}-${process.pid}-SKILL.md`;
      writeFileSync(backupPath, existing);
    }

    mkdirSync(canonicalDir, { recursive: true });
    const tmpPath = `${canonical}.carbonink-tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, bundledRaw);
    renameSync(tmpPath, canonical);
    didWrite = true;

    const hostsLinked = this.ensureSymlinks(canonicalDir);

    if (didWrite) {
      this.recordAudit('agent_skill.install', {
        canonicalPath: canonicalDir,
        hostsLinked,
        backupPath,
      });
    }

    return { canonicalPath: canonicalDir, hostsLinked, backupPath };
  }

  async update(): Promise<{
    canonicalPath: string;
    hostsLinked: AgentHost[];
    backupPath: string | null;
  }> {
    // Update is install when canonical exists (same logic).
    return this.install();
  }

  async remove(): Promise<{ removed: string[]; backupPath: string | null }> {
    const canonicalDir = this.canonicalDir();
    const canonical = this.canonicalFile();
    const removed: string[] = [];

    // 1. Tear down symlinks first (don't touch random files at link path)
    for (const host of Object.keys(HOST_PARENT_DIRS) as Array<keyof typeof HOST_PARENT_DIRS>) {
      const linkPath = join(HOST_PARENT_DIRS[host](this.home), SKILL_DIR_NAME);
      if (this.isOurSymlink(linkPath)) {
        try {
          unlinkSync(linkPath);
          removed.push(linkPath);
        } catch {
          // best effort
        }
      }
    }

    // 2. Backup canonical SKILL.md (path OUTSIDE canonicalDir so it survives rmSync)
    let backupPath: string | null = null;
    if (existsSync(canonical)) {
      const existing = readFileSync(canonical);
      backupPath = `${canonicalDir}.carbonink-bak-${this.tsForFilename()}-${process.pid}-SKILL.md`;
      writeFileSync(backupPath, existing);
    }

    // 3. Remove canonical dir
    if (existsSync(canonicalDir)) {
      rmSync(canonicalDir, { recursive: true, force: true });
      removed.push(canonicalDir);
    }

    if (removed.length > 0) {
      this.recordAudit('agent_skill.remove', { removed, backupPath });
    }

    return { removed, backupPath };
  }

  private ensureSymlinks(canonicalDir: string): AgentHost[] {
    const hosts: AgentHost[] = ['agentsShared'];
    for (const host of Object.keys(HOST_PARENT_DIRS) as Array<keyof typeof HOST_PARENT_DIRS>) {
      const parentDir = HOST_PARENT_DIRS[host](this.home);
      if (!existsSync(parentDir)) continue;
      const linkPath = join(parentDir, SKILL_DIR_NAME);
      // Idempotent: already our symlink → count it
      if (this.isOurSymlink(linkPath)) {
        hosts.push(host);
        continue;
      }
      // Something else exists there → refuse to overwrite
      if (existsSync(linkPath) || lstatSyncOrNull(linkPath)) continue;
      try {
        const rel = relative(parentDir, canonicalDir);
        symlinkSync(rel, linkPath);
        hosts.push(host);
      } catch {
        // best effort
      }
    }
    return hosts;
  }

  private tsForFilename(): string {
    return this.deps.now().toISOString().replace(/[:.]/g, '-');
  }

  private recordAudit(eventKind: string, payload: Record<string, unknown>): void {
    this.deps.db
      .prepare(`INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`)
      .run(randomUUID(), eventKind, JSON.stringify(payload), this.deps.now().toISOString());
  }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function lstatSyncOrNull(p: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}
