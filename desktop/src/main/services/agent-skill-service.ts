import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
