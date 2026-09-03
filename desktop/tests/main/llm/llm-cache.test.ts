import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LLM_CACHE_VERSION, LlmCache } from '@main/llm/llm-cache';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

const schema = z.object({ doc_type: z.string(), confidence: z.number() });

describe('LlmCache', () => {
  let dir: string;
  let cache: LlmCache;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'carbonink-llm-cache-'));
    cache = new LlmCache(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('misses on empty cache and hits after set', () => {
    expect(cache.get('k1', schema)).toBeNull();
    cache.set('k1', { doc_type: 'fuel', confidence: 0.9 }, 60_000);
    expect(cache.get('k1', schema)).toEqual({ doc_type: 'fuel', confidence: 0.9 });
  });

  it('expires entries past their TTL', () => {
    cache.set('k1', { doc_type: 'fuel', confidence: 0.9 }, -1);
    expect(cache.get('k1', schema)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('rejects blobs that fail schema validation', () => {
    cache.set('k1', { doc_type: 'fuel', confidence: 'high' }, 60_000);
    expect(cache.get('k1', schema)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('persists across instances via the index file', () => {
    cache.set('k1', { doc_type: 'fuel', confidence: 0.9 }, 60_000);
    const reopened = new LlmCache(dir);
    expect(reopened.get('k1', schema)).toEqual({ doc_type: 'fuel', confidence: 0.9 });
  });

  it('clears everything on clear()', () => {
    cache.set('k1', { doc_type: 'fuel', confidence: 0.9 }, 60_000);
    cache.clear();
    expect(cache.get('k1', schema)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('wipes the cache on a format version bump without crashing', () => {
    cache.set('k1', { doc_type: 'fuel', confidence: 0.9 }, 60_000);
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      version: number;
    };
    index.version = LLM_CACHE_VERSION + 1;
    writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
    const reopened = new LlmCache(dir);
    expect(reopened.get('k1', schema)).toBeNull();
    expect(reopened.size).toBe(0);
  });

  it('recovers from a corrupt index file', () => {
    writeFileSync(join(dir, 'index.json'), 'not-json{{{');
    const reopened = new LlmCache(dir);
    expect(reopened.size).toBe(0);
    reopened.set('k1', { doc_type: 'fuel', confidence: 0.9 }, 60_000);
    expect(reopened.get('k1', schema)).toEqual({ doc_type: 'fuel', confidence: 0.9 });
  });
});
