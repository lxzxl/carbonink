# pi-ai LLM Client Replacement — Design

**Date:** 2026-05-26
**Status:** spec
**Trigger:** [Roadmap Item 3](../ROADMAP.md) + [pi integration spike](../research/2026-05-26-pi-integration-spike.md). The spike validated that `@earendil-works/pi-ai` covers all required providers (5 currently → 32 with pi-ai, including the Chinese market matrix: deepseek / kimi / moonshot / minimax / qwen / zhipu) and offers OAuth, prompt-caching, and provider-aware capability metadata that our hand-rolled `LLMClient` doesn't have. This spec lands the full replacement in a single PR, per [brainstorm decision](#decisions).

## Goal

Replace `desktop/src/main/llm/llm-client.ts` (583 lines, 5 ai-sdk providers, hand-rolled error mapping, manual retry) with an Effect-wrapped `AiClient` service backed by `@earendil-works/pi-ai`. Consumers (5 stages + 4 services + 1 IPC handler) call the new client; the old `LLMClient` class and 5 `@ai-sdk/*` packages get deleted in the same commit.

Internal architecture upgrade, **not user-visible feature work** — the user only sees a richer Provider picker in Settings (recommended 5 + collapsible 32 full list). Aligned with the [internal-architecture-not-Pi-push](../../../../../.claude/projects/-Users-lxz-ws-personal/memory/project_pi_integration_rationale.md) principle: pi-ai is consumed as a library, not as an external surface.

## Decisions

Settled during brainstorm (2026-05-26):

- **Path A — single big PR** (rejected B incremental + C facade). Diff is bounded (~2000 lines, 30-50 files), the spike already de-risked pi-ai itself, and double-path maintenance costs more than the blast-radius risk.
- **No `LLMClient` thin adapter retained** — consumers call the new `AiClient` directly, not through an old-shape facade. Vendor lock-in to pi-ai is acceptable; `AiClient`'s surface is pi-ai-shaped, not legacy-shaped.
- **Effect-wrapped `AiClient`** — follows the `amap-client.ts` pattern (Style B from brainstorm): methods return `Effect.Effect<Out, AiErr, never>` with retry / timeout / tagged errors baked in. Already-Effect-based services (answer-generation, routing) gain direct composability; non-Effect services use `Effect.runPromise` at their boundary.
- **Selective Effect migration of B-class consumers**: classification-service (small) gets Effect-ified in this PR; extraction-service (large, multi-step) keeps Promise surface and uses `Effect.runPromise` at the boundary. Future PR can finish extraction.

## Architecture

```
┌─ src/main/llm/ai-client.ts ─────────────────────────────────┐  ← new
│   buildAiClientLayer(deps) → Layer<AiClientTag>             │
│   AiClient interface:                                        │
│     generateObject<T>({schema, prompt, system, images, timeoutMs}) │
│         → Effect.Effect<T, AiErr, never>                     │
│     generateText({prompt, system, timeoutMs})                │
│         → Effect.Effect<string, AiErr, never>                │
│     ping() → Effect.Effect<{ok:true}, AiAuthError|AiProviderError, never>│
│                                                              │
│   Internal: wraps pi-ai's tool-call mechanism for            │
│   structured output (pi-ai has no native generateObject).    │
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │ Effect.gen / yield* AiClientTag
                          │
┌─ Effect-based consumers ─────────────────────────────────────┐
│   answer-generation/index.ts  — yield* ai.generateObject     │
│   answer-generation/tags.ts   — Tag swap (LLMClientTag       │
│                                  → AiClientTag)              │
│   routing (already Effect; no change)                        │
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │ Effect.runPromise at boundary
                          │
┌─ Non-Effect consumers (Promise-shape) ───────────────────────┐
│   extraction-service.ts    — runPromise(ai.generateObject)   │
│   ef-matcher-service.ts    — runPromise                      │
│   questionnaire-service.ts — runPromise                      │
│   classification-service.ts → effect-ified (small)           │
│   stages/*.ts (5 stages)   → Effect-returning run() method   │
│   report-narrative.ts      — runPromise(ai.generateText)     │
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─ IPC layer ──────────────────────────────────────────────────┐
│   ipc/handlers/settings.ts — ping/test connection via         │
│       Effect.runPromise(ai.ping()) at handler boundary       │
│   ipc/context.ts          — buildAiClientLayer at startup,    │
│       provided once per IpcContext                           │
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │
┌─ Settings UI ────────────────────────────────────────────────┐
│   onboarding provider picker  — 5 recommended + 32 full      │
│   Anthropic OAuth button      — pi-ai loopback flow          │
└──────────────────────────────────────────────────────────────┘

Deleted unchanged:
• src/main/llm/llm-client.ts        — 583 lines
• src/main/llm/vision-capability.ts — see "Vision capability" below
• tests/main/llm/llm-client-*.test.ts × 5

Dependencies:
+ @earendil-works/pi-ai
- @ai-sdk/anthropic
- @ai-sdk/azure
- @ai-sdk/deepseek
- @ai-sdk/openai
- @ai-sdk/openai-compatible
- ai
```

### Tagged errors

```ts
// src/main/llm/errors.ts (new)
export class AiAuthError extends TaggedError('AiAuthError')<{ provider: string }> {}
export class AiRateLimited extends TaggedError('AiRateLimited')<{ retryAfter?: number }> {}
export class AiSchemaMismatch extends TaggedError('AiSchemaMismatch')<{ raw: string; cause?: unknown }> {}
export class AiTimeout extends TaggedError('AiTimeout')<{ timeoutMs: number }> {}
export class AiNoData extends TaggedError('AiNoData')<{}> {}
export class AiProviderError extends TaggedError('AiProviderError')<{ status?: number; cause?: unknown }> {}

export type AiErr = AiAuthError | AiRateLimited | AiSchemaMismatch | AiTimeout | AiNoData | AiProviderError;
```

Retry semantics (built into the `AiClient` layer's Schedule):
- `AiRateLimited` → retry with exponential backoff (200ms, 400ms, 800ms max 2 retries)
- `AiProviderError` (5xx) → retry once
- `AiAuthError`, `AiSchemaMismatch`, `AiTimeout`, `AiNoData` → fail immediately

### Provider config simplification

```ts
// src/shared/types.ts — replaces the 5-variant discriminatedUnion
export const providerConfig = z.object({
  provider: z.string(),     // pi-ai provider id: 'deepseek' | 'anthropic' | 'kimi-coding' | ... (32 ids)
  model: z.string(),        // pi-ai model id within that provider
  baseUrl: z.string().optional(),  // OpenAI-compat / self-hosted only
});
export type ProviderConfig = z.infer<typeof providerConfig>;
```

API keys remain in `CredentialService` (safe-storage), keyed by `provider`. OAuth tokens (Anthropic) also go through `CredentialService` with a distinct key prefix.

### Provider config migration

One-time migration in `settings-service.ts` startup:

```ts
function migrateProviderConfig(raw: unknown): ProviderConfig | null {
  if (looksLikeNewShape(raw)) return raw as ProviderConfig;
  if (!isOldDiscriminatedShape(raw)) return null;
  const old = raw as OldProviderConfig;
  switch (old.provider) {
    case 'openai':        return { provider: 'openai',    model: old.model, baseUrl: old.baseUrl };
    case 'anthropic':     return { provider: 'anthropic', model: old.model };
    case 'azure':         return { provider: 'azure',     model: old.deployment, baseUrl: old.endpoint };
    case 'deepseek':      return { provider: 'deepseek',  model: old.model };
    case 'openai_compat': return { provider: old.customProviderId, model: old.model, baseUrl: old.baseUrl };
  }
}
```

Runs lazily on first read after upgrade; persisted result replaces old shape. Loosened detection — if migration fails (corrupted JSON / unknown provider name), user is sent back to onboarding's provider picker.

## Components

### `src/main/llm/ai-client.ts` (new, ~250 lines)

Public surface:

```ts
export interface AiClient {
  generateObject<T>(args: {
    schema: ZodSchema<T>;
    prompt: string;
    system?: string;
    images?: Buffer[];
    timeoutMs?: number;
  }): Effect.Effect<T, AiErr, never>;

  generateText(args: {
    prompt: string;
    system?: string;
    timeoutMs?: number;
  }): Effect.Effect<string, AiErr, never>;

  ping(): Effect.Effect<{ ok: true }, AiAuthError | AiProviderError, never>;
}

export class AiClientTag extends Context.Tag('llm/AiClient')<AiClientTag, AiClient>() {}

export function buildAiClientLayer(deps: {
  config: ProviderConfig;
  credentials: CredentialService;
  overrideKey?: string;       // for ping with not-yet-saved key
}): Layer.Layer<AiClientTag>;
```

Internal:
- Constructs pi-ai model via `getModel(config.provider, config.model)`
- `generateObject` implements structured output via pi-ai tool-call + Zod parse → on schema fail emit `AiSchemaMismatch`
- HTTP errors mapped to AiErr subtypes
- `RETRY_SCHEDULE` applied to retryable errors (rate-limited + provider-error)
- Timeout via `Effect.timeout` defaulting to 60s

### `src/main/llm/errors.ts` (new)

See "Tagged errors" above. Uses Effect's `Data.TaggedError` for ergonomic pattern matching.

### Updated consumers

| File | Pattern | LOC change |
|---|---|---|
| `src/main/llm/stages/types.ts` | `StageCtx.llm` → `StageCtx.ai`; methods return Effect | ~10 lines |
| `src/main/llm/stages/{china-utility,freight,fuel-receipt,purchase,travel}.ts` × 5 | `ctx.llm.generateObject` → return `ctx.ai.generateObject(...)` | ~15 lines each |
| `src/main/llm/stages/registry.ts` | Updates type imports | ~5 lines |
| `src/main/llm/report-narrative.ts` | `Effect.runPromise(ai.generateText(...))` | ~30 lines |
| `src/main/services/answer-generation/tags.ts` | `LLMClientTag` → `AiClientTag` (re-export) | ~5 lines |
| `src/main/services/answer-generation/index.ts` | Delete `Effect.tryPromise`/`LLMCallFailed` wrap; direct `yield* ai.generateObject` | ~40 lines |
| `src/main/services/answer-generation/errors.ts` | Delete `LLMCallFailed`, `LLMNoData`, `LLMSchemaMismatch` (subsumed by AiErr) | ~30 lines |
| `src/main/services/classification-service.ts` | Effect-ify (small service) | ~40 lines |
| `src/main/services/extraction-service.ts` | `Effect.runPromise(ai.generateObject(...))` boundary | ~20 lines |
| `src/main/services/ef-matcher-service.ts` | Same boundary pattern | ~15 lines |
| `src/main/services/questionnaire-service.ts` | Same | ~15 lines |
| `src/main/services/settings-service.ts` | Provider config migration + simplified shape | ~50 lines |
| `src/main/ipc/context.ts` | Build `AiClientLayer`, remove `llmClient` field | ~20 lines |
| `src/main/ipc/handlers/settings.ts` | `ping-provider` runs Effect at boundary | ~25 lines |
| `src/main/ipc/sanitize.ts` | Drop `LLMClient` type refs | ~5 lines |
| `src/shared/types.ts` | `providerConfig` simplified to single object | ~10 lines |
| `src/renderer/lib/api/settings.ts` | Type bindings | ~5 lines |
| `src/renderer/features/onboarding/*` | Provider picker UI: 5 recommended + 32 full + OAuth | ~150 lines |
| `src/renderer/components/.../ProviderSettings.tsx` (or equivalent) | Same shape for post-onboarding edit | ~80 lines |
| `desktop/messages/{en,zh-CN}.json` | New provider name strings | ~30 keys × 2 |

### Vision capability

`src/main/llm/vision-capability.ts` currently maintains a hand-rolled feature flag map (`provider → bool`) for whether image input is supported. pi-ai's `getModel(p, m).input` exposes the same as a structured array (`['text', 'image']` etc.).

**Implementation decision** (deferred until coding): if pi-ai's vision metadata is reliable across our 32 providers, delete `vision-capability.ts` and read directly from the model object. If pi-ai's data is patchy for Chinese providers (DeepSeek, Kimi, etc.), keep `vision-capability.ts` as a thin override layer.

Either way: not blocking the spec; verify at start of stage refactor.

### Settings UI

```
┌─ Provider 选择 ─────────────────────────────────────┐
│                                                     │
│ 推荐配置                                              │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ○ DeepSeek           (deepseek-chat / r1)       │ │
│ │ ○ 月之暗面 Kimi      (kimi-k2)                   │ │
│ │ ○ 通义千问 Qwen      (qwen3-max / qwen3-coder)  │ │
│ │ ○ 智谱 GLM           (glm-4.6)                  │ │
│ │ ○ Anthropic Claude   (sonnet-4.5 / opus)        │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ ▾ 全部 provider (32 个)                              │
│   [openai, azure, vertex, gemini, mistral, groq,    │
│    xai, perplexity, bedrock, ...]                   │
│                                                     │
│ Model: [filtered dropdown]                          │
│                                                     │
│ API key:    [_____________________] [验证连接]       │
│ Base URL:   [_____________________] (可选)           │
│                                                     │
│ ─或─                                                │
│ [使用 Anthropic OAuth 登录]  (仅当 provider=anthropic)│
└─────────────────────────────────────────────────────┘
```

Recommended list is hard-coded in v1.x; can move to remote config later. OAuth button only renders for `provider === 'anthropic'`.

## Out of scope

- ❌ Streaming UI (pi-ai supports `stream`; we don't show partial output today)
- ❌ Cost estimation UI (pi-ai exposes per-model cost metadata; separate spec)
- ❌ Multi-provider per-feature (one model for extraction, another for narrative)
- ❌ Reasoning level toggle (pi-ai supports `reasoning_effort` on some models)
- ❌ Token usage / metering (no license hook today; not added now)
- ❌ Full Effect-ification of `extraction-service.ts` (defer to future PR)
- ❌ Removing `CredentialService` (still the right home for API keys + OAuth tokens)
- ❌ Migrating cloud worker LLM calls (cloud doesn't call LLM directly today)

## Risks

| Risk | Mitigation |
|---|---|
| pi-ai's tool-call structured output diverges from ai-sdk's `generateObject` semantics (e.g., partial response, refusal handling) | First task is `ai-client.ts` + tests with comprehensive error mapping; smoke each error path before stage refactor |
| pi-ai's Anthropic OAuth loopback flow fails inside packaged Electron | Spike already proved OAuth exports exist; smoke step 4 (OAuth login) catches packaging-specific issues |
| Provider config migration corrupts user's saved config | Migration is read-only on first load; backup before write; if shape unrecognized, fall back to "re-pick provider" UX path |
| Effect.runPromise at non-Effect-service boundaries hides retry/timeout semantics | Document the pattern; each boundary call uses the same `provideAndRun` helper |
| Vision capability detection patchy across Chinese providers | Decide at impl time whether to keep `vision-capability.ts` as override layer |
| pi-ai version drift mid-PR | Pin exact version in package.json; spike was at `^0.75.x` — verify current and pin |

## Testing

### Unit tests

New `tests/main/llm/ai-client.test.ts` covers:
- `buildAiClientLayer` constructs successfully with each recommended provider
- `generateObject` returns schema-validated object on success
- `generateObject` maps pi-ai 401 → AiAuthError (no retry)
- `generateObject` maps pi-ai 429 → AiRateLimited (retries up to 2x)
- `generateObject` maps pi-ai 5xx → AiProviderError (retries once)
- `generateObject` schema mismatch → AiSchemaMismatch (no retry)
- `generateObject` timeout enforces `timeoutMs` → AiTimeout
- `generateText` happy path + error mapping
- `ping` happy path + auth-failure path

Per-stage tests in `tests/main/llm/stages/*.test.ts`:
- Each stage gets a unit test with a mocked AiClient returning fixture JSON
- Verifies stage builds the right prompt and parses the right schema
- 5 stages × 1 test = 5 new files (or one combined parametrized file)

Service migration tests (modify existing):
- `tests/main/services/answer-generation-service.test.ts` — Tag swap, assertions on `AiErr` instead of `LLMCallFailed`
- `tests/main/services/classification-service.test.ts` — Now Effect-based; mock AiClientTag
- `tests/main/services/extraction-service.test.ts` — Mock AiClient at runPromise boundary
- `tests/main/services/ef-matcher-service.test.ts` — Same boundary mock
- `tests/main/services/questionnaire-service.test.ts` — Same

New migration test `tests/main/services/settings-service-migration.test.ts`:
- Each of 5 old shapes (openai/anthropic/azure/deepseek/openai_compat) migrates correctly
- Already-new shape passes through
- Corrupted shape returns null (UX falls back to onboarding)

### IPC tests

`tests/main/ipc/settings-handlers.test.ts` — update to mock the new ping path via AiClient layer.

### Manual smoke

```
1. Fresh install → onboarding → pick DeepSeek → enter key → 验证连接 ✓
2. Run extraction on a fuel receipt PDF → activities created ✓
3. Run answer-generation on a question → returns reasonable answer ✓
4. Settings → switch to Anthropic → click OAuth login → loopback works ✓
5. Generate report → narrative emits both zh-CN and EN ✓
6. Old-user upgrade: install v1 → save provider config → quit → install new → reopen → provider migrated, key still works, generation runs ✓
7. Bundle size sanity: `du -sh release/mac-arm64/CarbonInk.app/Contents/Resources/app.asar*` — verify smaller than pre-migration baseline (5 ai-sdk packages removed)
```

### Verified smoke run

| Date | Builder | Platform | 1 (onboarding) | 2 (extraction) | 3 (answer-gen) | 4 (OAuth) | 5 (narrative) | 6 (migration) | 7 (bundle size) |
|---|---|---|---|---|---|---|---|---|---|
| 2026-05-27 | lxz | macOS (darwin arm64, dev mode) | ✅ via dynamic catalog | ✅ | ✅ | N/A (OAuth deferred to v1.x) | ✅ | ✅ | ✅ (5 ai-sdk packages + `ai` removed; pi-ai inlined into main bundle) |

### Bugs surfaced + fixed during smoke

- `2e0df31` — `@earendil-works/pi-ai` is ESM-only; the previous `externalizeDepsPlugin()` left it as a runtime `require()` that Electron's CJS loader couldn't resolve (`ERR_PACKAGE_PATH_NOT_EXPORTED` at launch). Fix excludes pi-ai from externalization so Rollup inlines it.
- `e7bce1d` — hardcoded `PROVIDER_DEFAULTS.deepseek.model = 'deepseek-chat'` didn't match pi-ai's catalog (`deepseek-v4-flash` / `deepseek-v4-pro`). Surfaced via "validate connection" → `pi-ai has no model registered`. Quick fix changed the default model; the root cause (hardcoding) was addressed in `b104193`.
- `b104193` — full dynamic catalog from pi-ai via new `settings:list-providers` / `settings:list-models` IPC channels. Drops `PROVIDER_OPTIONS`/`DEFAULTS`/`LABELS`. Eliminates the bug class. Also caught an unrelated bug: `CredentialService` allowlist was hardcoded to 5 keychain prefixes; would have rejected `llm.kimi-coding.apikey` etc. Replaced with structural regex.

### Known follow-ups (out of v1)

- Anthropic OAuth login (deferred to v1.x; placeholder copy in UI)
- Streaming UI (pi-ai supports it; we don't show partial output today)
- Cost estimation display (pi-ai's per-model cost metadata already piped through the catalog IPC; UI can opt in later)
- Token usage / license metering hook

## Definition of Done

- All implementer tasks committed
- `pnpm test` ≥ baseline ± 10 (delta = +new ai-client/stage tests, –5 old llm-client tests)
- `pnpm typecheck` clean
- `pnpm exec biome check <changed-files>` clean
- `pnpm dist:mac` produces DMGs
- Manual smoke 7 steps verified
- `package.json` no longer lists `@ai-sdk/*` or `ai` packages
- Manual smoke recorded in spec

## References

- [Roadmap Item 3](../ROADMAP.md)
- [Pi integration spike 2026-05-26](../research/2026-05-26-pi-integration-spike.md)
- [v1 MCP integration spec](2026-05-26-pi-mcp-extension-design.md) — pattern reference (license-gate, audit-event, service injection)
- [`amap-client.ts`](../../desktop/src/main/services/routing/amap-client.ts) — Effect-wrapped external service Style B reference
- [`answer-generation/tags.ts`](../../desktop/src/main/services/answer-generation/tags.ts) — Layer + Tag pattern reference
- [pi-ai package](https://github.com/earendil-works/pi/tree/main/packages/ai)
- [Effect docs — Data.TaggedError](https://effect.website/docs/error-management/yieldable-errors)
