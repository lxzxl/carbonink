import { AiAgentTag, buildAiAgentLayer } from '@main/llm/ai-agent';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfigV2 } from '@shared/types';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers (mirror ai-client.test.ts — same `CredentialService.get` signature,
// same `ProviderConfigV2` shape). Tests here only exercise Layer + Tag wiring
// and the stubbed `run()` failure mode; Task 2 will add behavior-level tests
// against a faux pi-agent-core transport.
// ---------------------------------------------------------------------------

function fakeCredentials(apiKey: string | null = 'sk-fake-test-key'): CredentialService {
  return {
    get: vi.fn((_k: string) => apiKey),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

function fakeConfig(): ProviderConfigV2 {
  return { provider: 'deepseek', model: 'deepseek-chat' };
}

describe('AiAgent scaffold (Item 4 Task 1)', () => {
  it('Layer + Tag wiring works (scaffold smoke)', async () => {
    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      // We only check the shape of the resolved service. `run()` is stubbed
      // (see below) so calling it would die — the scaffold smoke test must
      // not invoke it.
      expect(typeof agent.run).toBe('function');
      return 'ok';
    });

    const result = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(result).toBe('ok');
  });

  it('run() is stubbed → Effect.die when called', async () => {
    const layer = buildAiAgentLayer({
      config: fakeConfig(),
      credentials: fakeCredentials(),
    });

    const program = Effect.gen(function* () {
      const agent = yield* AiAgentTag;
      return yield* agent.run({
        systemPrompt: 'test',
        userPrompt: 'test',
        // Schema shape is irrelevant — `run()` dies before any validation
        // pathway is reached. The cast suppresses ZodSchema's structural
        // requirements that don't matter for a die-on-invoke stub.
        schema: { _def: { typeName: 'ZodAny' } } as never,
        tools: [],
      });
    });

    await expect(Effect.runPromise(program.pipe(Effect.provide(layer)))).rejects.toThrow(/Task 2/);
  });
});
