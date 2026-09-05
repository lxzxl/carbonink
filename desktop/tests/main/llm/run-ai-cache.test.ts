import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createModels,
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { buildCacheKey } from '@main/llm/cache-key';
import { LlmCache } from '@main/llm/llm-cache';
import { runAiObject } from '@main/llm/run-ai';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfigV2 } from '@shared/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// runAiObject deterministic cache — real call path, faux pi-ai model
// ---------------------------------------------------------------------------
//
// The service-level suites mock `runAiObject` at the module boundary, so they
// can only assert the service threads a stable key (see
// ef-matcher-service.test.ts). This suite drives the REAL `runAiObject`
// against a faux model + a temp-dir `LlmCache` to prove the boundary itself
// dedups: a cache hit returns without building a layer or calling the model.

const schema = z.object({ answer: z.string() });

const CONFIG: ProviderConfigV2 = { provider: 'deepseek', model: 'deepseek-chat' };

function fakeCredentials(): CredentialService {
  return {
    get: vi.fn(() => 'sk-fake-test-key'),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

let faux: FauxProviderHandle | undefined;

function fauxModels(): MutableModels {
  if (!faux) throw new Error('faux provider not registered — call fauxProvider() first');
  const models = createModels();
  models.setProvider(faux.provider);
  return models;
}

let dir = '';

afterEach(() => {
  faux = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function setup(scriptedAnswer: string) {
  faux = fauxProvider({ provider: 'deepseek', models: [{ id: 'deepseek-chat' }] });
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall('submit_response', { answer: scriptedAnswer })], {
      stopReason: 'toolUse',
    }),
  ]);
  dir = mkdtempSync(join(tmpdir(), 'run-ai-cache-test-'));
  const store = new LlmCache(dir);
  return {
    store,
    call: (prompt: string) =>
      runAiObject(CONFIG, fakeCredentials(), {
        schema,
        prompt,
        cache: {
          store,
          key: buildCacheKey({
            scope: 'smoke',
            provider: 'deepseek',
            model: 'x',
            promptVersion: 'v1',
            payload: { prompt },
          }),
          ttlMs: 60_000,
        },
        modelsInstance: faux ? fauxModels() : undefined,
      }),
  };
}

describe('runAiObject cache', () => {
  it('serves the second identical call from cache without re-invoking the model', async () => {
    const { call } = setup('cached-answer');

    const first = await call('same prompt');
    const second = await call('same prompt');

    expect(first).toEqual({ answer: 'cached-answer' });
    expect(second).toEqual({ answer: 'cached-answer' });
    // One queued faux response, consumed once — the second call never
    // reached the model (a second model call would run the queue dry and
    // throw).
    expect(faux?.state.callCount).toBe(1);
  });

  it('a changed prompt misses the cache and re-invokes the model', async () => {
    const { call } = setup('first-answer');
    await call('prompt one');

    // Queue the second answer for the expected miss.
    faux?.setResponses([
      fauxAssistantMessage([fauxToolCall('submit_response', { answer: 'second-answer' })], {
        stopReason: 'toolUse',
      }),
    ]);
    const second = await call('prompt two');

    expect(second).toEqual({ answer: 'second-answer' });
    expect(faux?.state.callCount).toBe(2);
  });

  it('without a cache request every call hits the model', async () => {
    faux = fauxProvider({ provider: 'deepseek', models: [{ id: 'deepseek-chat' }] });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('submit_response', { answer: 'a' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('submit_response', { answer: 'b' })], {
        stopReason: 'toolUse',
      }),
    ]);
    const invoke = () =>
      runAiObject(CONFIG, fakeCredentials(), { schema, prompt: 'p', modelsInstance: fauxModels() });

    await expect(invoke()).resolves.toEqual({ answer: 'a' });
    await expect(invoke()).resolves.toEqual({ answer: 'b' });
    expect(faux?.state.callCount).toBe(2);
  });
});
