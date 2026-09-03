import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ZodSchema } from 'zod';
import { sha256Hex } from './cache-key.js';

/**
 * File-backed deterministic-result cache for LLM calls.
 *
 * Layout: `<userData>/llm-cache/index.json` (version + per-entry
 * metadata keyed by key-hash) plus one `<hash>.json` blob per entry.
 * The blob filename is always `sha256(semanticKey)`; the index also
 * keeps the semantic key for debugging, truncated by `buildCacheKey`
 * so it carries no prompt content.
 *
 * Sync fs throughout — matches the better-sqlite3 sync world the
 * services live in, and cache IO is local + small. Writes are atomic
 * (temp + rename) so a crash mid-write can't corrupt a blob.
 *
 * TTL + key-versioning are the correctness mechanisms; LRU eviction at
 * 100 MB is backstop hygiene (typical blobs are <2 KB, so the budget
 * effectively never binds).
 */
export const LLM_CACHE_VERSION = 1;
export const LLM_CACHE_MAX_BYTES = 100 * 1024 * 1024;

interface IndexEntry {
  key: string;
  file: string;
  expiresAt: number;
  lastHit: number;
  size: number;
}

interface IndexFile {
  version: number;
  entries: Record<string, IndexEntry>;
}

export class LlmCache {
  private readonly dir: string;
  private readonly indexPath: string;
  private entries: Record<string, IndexEntry> = {};

  constructor(cacheDir: string) {
    this.dir = cacheDir;
    this.indexPath = join(cacheDir, 'index.json');
    this.load();
  }

  /**
   * Read + zod-validate. Returns null on miss, expiry, unreadable blob,
   * or schema mismatch (stale shape after a code change) — callers just
   * re-fetch. Expired/invalid entries are removed lazily on read.
   */
  get<T>(key: string, schema: ZodSchema<T>): T | null {
    const hash = sha256Hex(key);
    const entry = this.entries[hash];
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.remove(hash);
      return null;
    }
    let parsed: T | null = null;
    try {
      const raw: unknown = JSON.parse(readFileSync(join(this.dir, entry.file), 'utf8'));
      const result = schema.safeParse(raw);
      if (!result.success) {
        this.remove(hash);
        return null;
      }
      parsed = result.data;
    } catch {
      this.remove(hash);
      return null;
    }
    entry.lastHit = Date.now();
    this.save();
    return parsed;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    mkdirSync(this.dir, { recursive: true });
    const hash = sha256Hex(key);
    const file = `${hash}.json`;
    const body = JSON.stringify(value);
    const tmp = join(this.dir, `${hash}.tmp-${process.pid}`);
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, join(this.dir, file));
    this.entries[hash] = {
      key,
      file,
      expiresAt: Date.now() + ttlMs,
      lastHit: Date.now(),
      size: Buffer.byteLength(body, 'utf8'),
    };
    this.evictIfNeeded();
    this.save();
  }

  /** Drop every entry; returns the number of entries removed. */
  clear(): number {
    const n = Object.keys(this.entries).length;
    for (const hash of Object.keys(this.entries)) this.remove(hash);
    this.save();
    return n;
  }

  /** Entry count, for tests and the clear-cache confirmation path. */
  get size(): number {
    return Object.keys(this.entries).length;
  }

  private load(): void {
    let index: IndexFile | null = null;
    try {
      if (existsSync(this.indexPath)) {
        index = JSON.parse(readFileSync(this.indexPath, 'utf8')) as IndexFile;
      }
    } catch {
      index = null;
    }
    if (!index || index.version !== LLM_CACHE_VERSION || typeof index.entries !== 'object') {
      // Unknown/corrupt/older format: wipe blobs, start fresh. Never crash,
      // never serve stale data across a format bump.
      this.wipeDir();
      this.entries = {};
      return;
    }
    this.entries = index.entries;
    const now = Date.now();
    for (const hash of Object.keys(this.entries)) {
      const entry = this.entries[hash];
      if (!entry || entry.expiresAt <= now || !existsSync(join(this.dir, entry.file))) {
        this.remove(hash);
      }
    }
  }

  private save(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = join(this.dir, `index.tmp-${process.pid}`);
      const index: IndexFile = { version: LLM_CACHE_VERSION, entries: this.entries };
      writeFileSync(tmp, JSON.stringify(index), 'utf8');
      renameSync(tmp, this.indexPath);
    } catch {
      // Cache persistence is best-effort; a failed save just means the
      // next launch re-fetches. Never break a user flow over telemetry.
    }
  }

  private remove(hash: string): void {
    const entry = this.entries[hash];
    if (entry) {
      try {
        rmSync(join(this.dir, entry.file), { force: true });
      } catch {
        // Best-effort (see save()).
      }
      delete this.entries[hash];
    }
  }

  private evictIfNeeded(): void {
    let total = Object.values(this.entries).reduce((sum, e) => sum + e.size, 0);
    if (total <= LLM_CACHE_MAX_BYTES) return;
    const oldestFirst = Object.keys(this.entries).sort(
      (a, b) => (this.entries[a]?.lastHit ?? 0) - (this.entries[b]?.lastHit ?? 0),
    );
    for (const hash of oldestFirst) {
      if (total <= LLM_CACHE_MAX_BYTES) break;
      total -= this.entries[hash]?.size ?? 0;
      this.remove(hash);
    }
  }

  private wipeDir(): void {
    let names: string[] = [];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name.endsWith('.json') || name.includes('.tmp-')) {
        try {
          rmSync(join(this.dir, name), { force: true });
        } catch {
          // Best-effort (see save()).
        }
      }
    }
  }
}
