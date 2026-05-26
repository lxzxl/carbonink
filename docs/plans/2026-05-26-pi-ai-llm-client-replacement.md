# pi-ai LLM Client Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In a single PR, replace `LLMClient` + 5 `@ai-sdk/*` packages with an Effect-wrapped `AiClient` service backed by `@earendil-works/pi-ai`. Migrate 5 stages + 5 services + 1 IPC handler + Settings UI in the same PR. Net diff ~-500 lines (delete more than add).

**Architecture:** New `src/main/llm/ai-client.ts` exposes Effect-returning `generateObject` / `generateText` / `ping` with tagged errors (`AiAuthError` / `AiRateLimited` / `AiSchemaMismatch` / `AiTimeout` / `AiNoData` / `AiProviderError`) and built-in retry. Already-Effect services (answer-generation) consume via Tag. Non-Effect services (extraction, ef-matcher, questionnaire) call `Effect.runPromise` at boundary. `classification-service` gets Effect-ified inline. `extraction-service` stays Promise-shape (defer Effect migration).

**Tech Stack 增量：** `@earendil-works/pi-ai` added; `@ai-sdk/{anthropic,azure,deepseek,openai,openai-compatible}` + `ai` removed. No new dev-deps.

**Spec:** [docs/specs/2026-05-26-pi-ai-llm-client-replacement.md](../specs/2026-05-26-pi-ai-llm-client-replacement.md)

**Scope:**
- ✅ Single big PR (Path A from brainstorm)
- ✅ `AiClient` Effect service + tagged errors + retry/timeout
- ✅ 5 stages mechanically migrated
- ✅ answer-generation Effect cleanup (delete LLMCallFailed/LLMNoData/LLMSchemaMismatch)
- ✅ classification-service Effect-ified
- ✅ extraction / ef-matcher / questionnaire boundary `Effect.runPromise`
- ✅ Settings UI: 5 recommended + 32 full provider picker + Anthropic OAuth button
- ✅ One-time provider config migration on startup
- ✅ Manual smoke recorded
- ❌ extraction-service full Effect migration (future PR)
- ❌ streaming UI / cost estimation / multi-provider per-feature (out of scope)
- ❌ Removing CredentialService (keep — still right home for keys + OAuth tokens)

**Verification gate (every task):**
```bash
pnpm --filter carbonink typecheck && pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check <changed-files>
```

---

## File Structure

**新建：**
- `src/main/llm/ai-client.ts` — Effect-wrapped pi-ai client
- `src/main/llm/errors.ts` — `AiErr` tagged union (Data.TaggedError)
- `tests/main/llm/ai-client.test.ts` — comprehensive unit tests
- `tests/main/llm/stages/*.test.ts` (5 files, or 1 parametrized)
- `tests/main/services/settings-service-migration.test.ts` — provider config migration

**修改：**
- `src/shared/types.ts` — providerConfig discriminatedUnion → single object
- `src/main/llm/stages/types.ts` — `StageCtx.llm` → `StageCtx.ai`
- `src/main/llm/stages/{china-utility,freight,fuel-receipt,purchase,travel}.ts` × 5
- `src/main/llm/stages/registry.ts`
- `src/main/llm/report-narrative.ts`
- `src/main/services/answer-generation/{tags,index,errors}.ts`
- `src/main/services/classification-service.ts` — Effect-ified
- `src/main/services/extraction-service.ts`
- `src/main/services/ef-matcher-service.ts`
- `src/main/services/questionnaire-service.ts`
- `src/main/services/settings-service.ts` — provider migration
- `src/main/ipc/context.ts`
- `src/main/ipc/handlers/settings.ts`
- `src/main/ipc/sanitize.ts`
- `src/renderer/lib/api/settings.ts`
- `src/renderer/features/onboarding/*` — provider picker
- `src/renderer/components/SettingsPage.tsx` (or ProviderSettings) — post-onboarding edit
- `messages/{en,zh-CN}.json` — provider name strings
- `desktop/package.json` — drop 5 ai-sdk + ai; add pi-ai

**删除：**
- `src/main/llm/llm-client.ts`
- `src/main/llm/vision-capability.ts` (if pi-ai metadata sufficient; decide at Task 4)
- `tests/main/llm/llm-client.test.ts`
- `tests/main/llm/llm-client-classify.test.ts`
- `tests/main/llm/llm-client-extract-questions.test.ts`
- `tests/main/llm/llm-client-generate-answer.test.ts`
- `tests/main/llm/llm-client-recommend.test.ts`
- `tests/main/llm/vision-capability.test.ts` (if deletion)

---

## Types defined once in `@shared/types.ts` (Task 2)

```ts
export const providerConfig = z.object({
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof providerConfig>;

// Legacy shape kept locally in settings-service for migration only —
// NOT exported.
```

## Tagged errors defined once in `src/main/llm/errors.ts` (Task 1)

```ts
import { Data } from 'effect';
export class AiAuthError extends Data.TaggedError('AiAuthError')<{ provider: string }> {}
export class AiRateLimited extends Data.TaggedError('AiRateLimited')<{ retryAfter?: number }> {}
export class AiSchemaMismatch extends Data.TaggedError('AiSchemaMismatch')<{ raw: string; cause?: unknown }> {}
export class AiTimeout extends Data.TaggedError('AiTimeout')<{ timeoutMs: number }> {}
export class AiNoData extends Data.TaggedError('AiNoData')<{}> {}
export class AiProviderError extends Data.TaggedError('AiProviderError')<{ status?: number; cause?: unknown }> {}

export type AiErr = AiAuthError | AiRateLimited | AiSchemaMismatch | AiTimeout | AiNoData | AiProviderError;
```

---

### Task 1: AiClient scaffold — errors + Layer + ping()

**Files:**
- Create: `desktop/src/main/llm/errors.ts`
- Create: `desktop/src/main/llm/ai-client.ts`
- Create: `desktop/tests/main/llm/ai-client.test.ts`
- Modify: `desktop/package.json` — add `@earendil-works/pi-ai`

- [ ] **Step 1: Add pi-ai dep + verify install**

```bash
cd /Users/lxz/ws/personal/carbonbook/desktop
pnpm add @earendil-works/pi-ai
```

Verify the version is current (`pnpm view @earendil-works/pi-ai version`). Pin if necessary in package.json — current convention is `^X.Y.Z`.

- [ ] **Step 2: Write `errors.ts`** (verbatim from spec Tagged Errors section)

- [ ] **Step 3: Write failing tests for `ai-client.ts` — ping() path**

```ts
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiClientTag, buildAiClientLayer,
} from '@main/llm/ai-client';
import { AiAuthError, AiProviderError } from '@main/llm/errors';
import type { CredentialService } from '@main/services/credential-service';
import type { ProviderConfig } from '@shared/types';

function fakeCredentials(): CredentialService {
  return {
    getApiKey: vi.fn().mockResolvedValue('sk-fake-test-key'),
    setApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  } as unknown as CredentialService;
}

describe('AiClient.ping', () => {
  it('returns {ok: true} on successful pi-ai response', async () => {
    const config: ProviderConfig = { provider: 'deepseek', model: 'deepseek-chat' };
    const layer = buildAiClientLayer({ config, credentials: fakeCredentials() });
    const program = Effect.gen(function* () {
      const ai = yield* AiClientTag;
      return yield* ai.ping();
    });
    const r = await Effect.runPromise(program.pipe(Effect.provide(layer)));
    expect(r).toEqual({ ok: true });
  });

  // More tests in Task 2 (generateObject)
});
```

- [ ] **Step 4: Run test — confirm FAIL** (`Cannot find module '@main/llm/ai-client'`)

- [ ] **Step 5: Implement `ai-client.ts` minimal — Tag + Layer + ping()**

Use pi-ai's `getModel(provider, model)` + lightweight ping (a tiny `generateText("ping")` call with 5s timeout). Don't yet wire generateObject — that's Task 2.

```ts
import { Context, Effect, Layer } from 'effect';
import { /* pi-ai imports */ } from '@earendil-works/pi-ai';
import type { ZodSchema } from 'zod';
import type { CredentialService } from '@main/services/credential-service.js';
import type { ProviderConfig } from '@shared/types.js';
import {
  AiAuthError, AiNoData, AiProviderError, AiRateLimited, AiSchemaMismatch, AiTimeout,
  type AiErr,
} from './errors.js';

export interface AiClient {
  generateObject<T>(args: { /* ... */ }): Effect.Effect<T, AiErr, never>;
  generateText(args: { /* ... */ }): Effect.Effect<string, AiErr, never>;
  ping(): Effect.Effect<{ ok: true }, AiAuthError | AiProviderError, never>;
}

export class AiClientTag extends Context.Tag('llm/AiClient')<AiClientTag, AiClient>() {}

export function buildAiClientLayer(deps: {
  config: ProviderConfig;
  credentials: CredentialService;
  overrideKey?: string;
}): Layer.Layer<AiClientTag> {
  // Construct pi-ai model + AiClient instance internally
  return Layer.effect(AiClientTag, /* ... */);
}
```

Implement ping by calling pi-ai's smallest available endpoint, mapping HTTP errors to AiAuthError/AiProviderError.

- [ ] **Step 6: Run test — confirm PASS for ping path**

- [ ] **Step 7: Verification gate + Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook add \
  desktop/src/main/llm/errors.ts \
  desktop/src/main/llm/ai-client.ts \
  desktop/tests/main/llm/ai-client.test.ts \
  desktop/package.json \
  pnpm-lock.yaml
git -C /Users/lxz/ws/personal/carbonbook commit -m "$(cat <<'EOF'
feat(ai-client): scaffold Effect-wrapped pi-ai client + tagged errors

AiClient.ping() smoke-implemented; generateObject/generateText to follow.
AiErr tagged union ready for consumers to pattern-match. Adds
@earendil-works/pi-ai dep; @ai-sdk/* removals deferred to final cleanup
task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: AiClient.generateObject + generateText with retry/timeout/error mapping

**Files:**
- Modify: `desktop/src/main/llm/ai-client.ts`
- Modify: `desktop/tests/main/llm/ai-client.test.ts`

- [ ] **Step 1: Write failing tests covering each error path**

Add to test file:
- `generateObject` schema-valid response → returns parsed object
- `generateObject` schema mismatch → AiSchemaMismatch (no retry)
- `generateObject` pi-ai 401 → AiAuthError (no retry)
- `generateObject` pi-ai 429 → AiRateLimited (retries with backoff)
- `generateObject` pi-ai 500 → AiProviderError (retries once)
- `generateObject` timeout > timeoutMs → AiTimeout (no retry)
- `generateText` happy path + error mapping
- Retry assertions: count exactly 2 retries on 429, 1 retry on 500, 0 on 401

Mock pi-ai's HTTP layer (likely via vi.mock at the module path). If pi-ai exposes a fetch-injectable test mode, use that.

- [ ] **Step 2: Implement generateObject via pi-ai tool-call pattern**

pi-ai doesn't have native generateObject. Standard pattern (per spike):
```ts
const result = await piAi.complete(model, {
  messages: [{ role: 'user', content: prompt }],
  tools: [{
    name: 'submit_response',
    parameters: zodToJsonSchema(schema),  // or hand-rolled JSON Schema
  }],
  tool_choice: { type: 'tool', name: 'submit_response' },
});
const toolCall = result.content.find(c => c.type === 'tool_use');
if (!toolCall) throw new AiNoData({});
const parsed = schema.safeParse(toolCall.input);
if (!parsed.success) throw new AiSchemaMismatch({ raw: JSON.stringify(toolCall.input), cause: parsed.error });
return parsed.data;
```

Wrap in Effect with `Effect.tryPromise`, then `Effect.retry(RETRY_SCHEDULE)`, then `Effect.timeout(timeoutMs)`, then `Effect.catchTag` for selective retry-error mapping.

- [ ] **Step 3: Implement generateText (simpler — no schema)**

- [ ] **Step 4: Run tests — confirm all PASS**

- [ ] **Step 5: Verification gate + Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(ai-client): generateObject + generateText with retry/timeout

Tool-call-based structured output (pi-ai has no native generateObject).
Retry schedule fires on AiRateLimited (max 2x) and AiProviderError
(max 1x). AiAuthError, AiSchemaMismatch, AiTimeout fail immediately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Provider config simplification + migration

**Files:**
- Modify: `desktop/src/shared/types.ts`
- Modify: `desktop/src/main/services/settings-service.ts`
- Create: `desktop/tests/main/services/settings-service-migration.test.ts`

- [ ] **Step 1: Update providerConfig in shared/types.ts**

Replace the 5-variant discriminatedUnion with the simple object shape. Add a comment pointing at the migration in settings-service.

- [ ] **Step 2: Write failing migration tests**

Cover each old provider variant + corrupted input + already-new shape.

- [ ] **Step 3: Implement `migrateProviderConfig` in settings-service.ts**

Reads the saved JSON; if it matches the old shape, transforms; if not, returns null and lets the UI re-onboard.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Verification gate + Commit**

---

### Task 4: Stages migration (5 files mechanical)

**Files:**
- Modify: `desktop/src/main/llm/stages/types.ts`
- Modify: `desktop/src/main/llm/stages/{china-utility,freight,fuel-receipt,purchase,travel}.ts` × 5
- Modify: `desktop/src/main/llm/stages/registry.ts`
- Create or modify: `desktop/tests/main/llm/stages/*.test.ts` (5 stage tests)

- [ ] **Step 1: Update `StageCtx`**

```ts
// stages/types.ts
export interface StageCtx {
  ai: AiClient;  // was: llm: LLMClient
  // ... other fields unchanged
}

export interface ExtractionStage {
  name: string;
  outputSchema: ZodSchema<unknown>;
  // Methods now return Effect
  run(ctx: StageCtx, input: StageInput): Effect.Effect<unknown, AiErr, never>;
}
```

- [ ] **Step 2: Migrate each stage**

For each of 5 stages, change `async run(ctx, input)` to `run(ctx, input): Effect.Effect<...>` and inside, replace `await ctx.llm.generateObject(...)` with `return ctx.ai.generateObject(...)`.

- [ ] **Step 3: Update registry.ts** (type imports only)

- [ ] **Step 4: Write per-stage tests with mocked AiClient**

Each test: `mockAiClient.generateObject` returns fixture JSON → assert stage produces expected `StageResult`.

- [ ] **Step 5: Tests PASS + Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(stages): migrate 5 extraction stages to AiClient Effect

Stages now return Effect.Effect<Out, AiErr, never> instead of Promise.
Zod schemas unchanged. Mechanical replacement of ctx.llm.generateObject
with ctx.ai.generateObject.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: answer-generation Effect cleanup

**Files:**
- Modify: `desktop/src/main/services/answer-generation/tags.ts` — LLMClientTag → AiClientTag (re-export)
- Modify: `desktop/src/main/services/answer-generation/index.ts` — direct yield* ai.generateObject
- Modify: `desktop/src/main/services/answer-generation/errors.ts` — delete LLMCallFailed/LLMNoData/LLMSchemaMismatch
- Modify: `desktop/tests/main/services/answer-generation-service.test.ts` — mock AiClient instead of LLMClient

- [ ] **Step 1: Update tags.ts**

Replace `LLMClientTag` with `AiClientTag` re-export from `@main/llm/ai-client`. Update `buildAnswerLayer` to take `aiClient` instead of `llmClient`.

- [ ] **Step 2: Delete obsolete error classes**

`LLMCallFailed`, `LLMNoData`, `LLMSchemaMismatch` are subsumed by `AiErr`. Update `GenErr` union to include `AiErr` instead.

- [ ] **Step 3: Refactor `generate()` in index.ts**

```ts
// Before
const llmResult = yield* Effect.tryPromise({
  try: () => llmClient.generateAnswer(config, {...}),
  catch: (e) => new LLMCallFailed({ cause: e }),
});

// After
const ai = yield* AiClientTag;
const llmResult = yield* ai.generateObject({
  schema: GenerateAnswerOutputSchema,
  prompt: buildAnswerPrompt({...}),
  system: ANSWER_SYSTEM_PROMPT,
});
```

- [ ] **Step 4: Update existing test mocks**

- [ ] **Step 5: Tests PASS + Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook commit -m "refactor(answer-generation): consume AiClient via Tag, drop LLMCallFailed wrapper

Effect-tryPromise boilerplate around llmClient.generateAnswer goes away.
LLMCallFailed / LLMNoData / LLMSchemaMismatch errors deleted; subsumed
by AiErr tagged union. Retry/timeout now centralized in AiClient layer
(was: explicit Schedule per call).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: classification-service Effect-ified

**Files:**
- Modify: `desktop/src/main/services/classification-service.ts`
- Modify: `desktop/tests/main/services/classification-service.test.ts`
- Modify: any IPC handler calling classify() — update Promise → Effect boundary

- [ ] **Step 1: Convert classify() to Effect**

```ts
classify(documentId: string): Effect.Effect<ClassifyResult, AiErr | ProviderNotConfigured, AiClientTag> {
  return Effect.gen(function* () {
    const config = this.settings.getProviderConfig();
    if (!config) return yield* Effect.fail(new ProviderNotConfigured());
    const ai = yield* AiClientTag;
    return yield* ai.generateObject({
      schema: ClassifyResultSchema,
      prompt: buildClassifyPrompt(documentId),
      images: ...,
    });
  });
}
```

- [ ] **Step 2: Update IPC handler boundary**

Where the handler called `await classifySvc.classify(id)`, now do `Effect.runPromise(classifySvc.classify(id).pipe(Effect.provide(aiLayer)))`.

- [ ] **Step 3: Update mocks in tests**

- [ ] **Step 4: Tests PASS + Commit**

---

### Task 7: extraction-service + ef-matcher-service + questionnaire-service — Promise boundary

**Files:**
- Modify: `desktop/src/main/services/extraction-service.ts`
- Modify: `desktop/src/main/services/ef-matcher-service.ts`
- Modify: `desktop/src/main/services/questionnaire-service.ts`
- Modify: respective `.test.ts` files

For each of these services, keep the Promise-shape public API. At each LLMClient call site:

```ts
// Before
const result = await this.llmClient.recommendEfs(config, {...});

// After
const layer = buildAiClientLayer({ config, credentials: this.credentials });
const result = await Effect.runPromise(
  Effect.gen(function* () {
    const ai = yield* AiClientTag;
    return yield* ai.generateObject({...});
  }).pipe(Effect.provide(layer))
);
```

(Extract a `runWithAi(config, program)` helper to dedupe.)

- [ ] **Steps 1-5**: Same TDD cycle per file, then bundle commit.

```bash
git -C /Users/lxz/ws/personal/carbonbook commit -m "refactor(services): Promise-shape consumers use Effect.runPromise boundary

extraction-service, ef-matcher-service, questionnaire-service keep their
Promise public APIs but route LLM calls through AiClient at the call
site via a runWithAi helper. Future PR can effect-ify the rest.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: report-narrative + vision-capability decision

**Files:**
- Modify: `desktop/src/main/llm/report-narrative.ts`
- Decide + Delete or Modify: `desktop/src/main/llm/vision-capability.ts`
- Modify or delete: `desktop/tests/main/llm/vision-capability.test.ts`

- [ ] **Step 1: Investigate pi-ai vision metadata**

Check `getModel(p, m).input` for our 5 recommended providers. If it's reliable (each returns `['text', 'image']` correctly), delete vision-capability.ts. If patchy for Chinese providers, keep it as an override layer over pi-ai's data.

Document the decision in the commit message.

- [ ] **Step 2: Migrate report-narrative.ts**

Currently uses `generateText` via LLMClient. Replace with `Effect.runPromise(ai.generateText(...))`.

- [ ] **Step 3-5**: Tests + commit

---

### Task 9: IPC layer cleanup

**Files:**
- Modify: `desktop/src/main/ipc/context.ts` — remove `llmClient`, build `aiLayer` once at startup
- Modify: `desktop/src/main/ipc/handlers/settings.ts` — `ping-provider` runs Effect at boundary
- Modify: `desktop/src/main/ipc/sanitize.ts` — drop `LLMClient` type refs
- Modify: `desktop/src/renderer/lib/api/settings.ts` — type bindings update

- [ ] **Step 1: Context — drop llmClient field**

```ts
// Before
llmClient: LLMClient;

// After (no field — Layer constructed per request in handler)
```

Actually, AiClient layers depend on `config` which changes when user updates Settings — Layer can't be a static singleton. Two patterns to choose:
- (a) Per-call layer construction (simple, slight perf hit)
- (b) Stateful service that holds current config + rebuilds internal client on config change

Recommend (a) for v1 — simpler. Optimize if measurably slow.

- [ ] **Step 2: handlers/settings.ts — ping path**

Already covered in spec. Done at handler-call time:

```ts
'settings:ping-provider': async (input) => {
  const parsed = pingProviderInput.parse(input);
  const layer = buildAiClientLayer({
    config: parsed.config,
    credentials: ctx.credentials,
    overrideKey: parsed.apiKey,
  });
  return Effect.runPromise(
    pingProgram.pipe(
      Effect.provide(layer),
      Effect.catchAll((e) => Effect.succeed({ ok: false, error: errLabel(e) })),
    ),
  );
},
```

- [ ] **Step 3-5**: Tests + commit

---

### Task 10: Settings UI — provider picker + OAuth

**Files:**
- Modify: `desktop/src/renderer/features/onboarding/*` — provider picker steps
- Modify: `desktop/src/renderer/components/.../ProviderSettings.tsx` — post-onboarding edit (find actual filename)
- Modify: `desktop/messages/en.json` + `zh-CN.json` — new provider name keys

Constants module:
```ts
// e.g. src/shared/providers.ts
export const RECOMMENDED_PROVIDERS = [
  { id: 'deepseek',  models: ['deepseek-chat', 'deepseek-r1'] },
  { id: 'kimi-coding', models: ['kimi-k2'] },
  { id: 'qwen',      models: ['qwen3-max', 'qwen3-coder'] },
  { id: 'zhipu',     models: ['glm-4.6'] },
  { id: 'anthropic', models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'] },
] as const;
// 32 full list from pi-ai via getProviders() at runtime
```

UI structure:
- Recommended radio list (5 items)
- Disclosure "全部 provider" → all 32 (read from pi-ai at runtime if possible, or hard-coded as fallback)
- Model dropdown filtered by selected provider
- API key input (saves via credentialService) — except when OAuth is shown
- Anthropic OAuth button — visible only when `provider === 'anthropic'`; clicking starts pi-ai's loopback flow
- Validate connection button → IPC `ping`

- [ ] **Steps 1-N**: Component implementation + i18n + tests + commit

```bash
git -C /Users/lxz/ws/personal/carbonbook commit -m "feat(settings-ui): provider picker — 5 recommended + 32 full + Anthropic OAuth

Onboarding and post-onboarding both use the same picker. Recommended
list curates for Chinese market (DeepSeek/Kimi/Qwen/Zhipu) + Anthropic.
'Show all 32 providers' is a disclosure; the full list is enumerated
from pi-ai at runtime where possible. OAuth button only shows for
provider === 'anthropic'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Delete dead code + dependency cleanup

**Files (delete):**
- `desktop/src/main/llm/llm-client.ts`
- `desktop/tests/main/llm/llm-client.test.ts`
- `desktop/tests/main/llm/llm-client-classify.test.ts`
- `desktop/tests/main/llm/llm-client-extract-questions.test.ts`
- `desktop/tests/main/llm/llm-client-generate-answer.test.ts`
- `desktop/tests/main/llm/llm-client-recommend.test.ts`

**Files (modify):**
- `desktop/package.json` — remove `@ai-sdk/anthropic`, `@ai-sdk/azure`, `@ai-sdk/deepseek`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `ai`
- `pnpm-lock.yaml` — regenerated

- [ ] **Step 1: Delete the 5 test files** (already passing? Now they fail because LLMClient gone. We DELETE them, not "fix")

- [ ] **Step 2: Delete `llm-client.ts`**

- [ ] **Step 3: Remove ai-sdk + ai from package.json**

```bash
cd desktop
pnpm remove ai @ai-sdk/anthropic @ai-sdk/azure @ai-sdk/deepseek @ai-sdk/openai @ai-sdk/openai-compatible
```

- [ ] **Step 4: Full repo grep to verify no stragglers**

```bash
grep -rE "@ai-sdk|from ['\"]ai['\"]|LLMClient" desktop/src/ 2>/dev/null
```

Expected: zero hits.

- [ ] **Step 5: Final verification gate**

```bash
pnpm --filter carbonink typecheck
pnpm --filter carbonink test -- --run
pnpm --filter carbonink exec biome check $(git diff --name-only HEAD~10 -- '*.ts' '*.tsx' | xargs)
```

- [ ] **Step 6: Commit**

```bash
git -C /Users/lxz/ws/personal/carbonbook commit -m "chore(llm): delete LLMClient + @ai-sdk/* deps

Final cut: llm-client.ts (583 lines), 5 ai-sdk packages, and 5 dependent
test files all removed. Bundle size should drop several MB. AiClient
fully owns LLM access now.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Manual smoke (USER ACTION)

After Task 11 lands, restart `pnpm dev` so the new pi-ai client is loaded by main process, then walk through the 7-step smoke from the spec:

1. Fresh install → onboarding → pick DeepSeek → enter key → 验证连接 ✓
2. Run extraction on a fuel receipt PDF → activities created ✓
3. Run answer-generation on a question → returns reasonable answer ✓
4. Settings → switch to Anthropic → click OAuth login → loopback works ✓
5. Generate report → narrative emits both zh-CN and EN ✓
6. Old-user upgrade: install v1 → save provider config → quit → install new → reopen → provider migrated ✓
7. Bundle size sanity: `du -sh release/mac-arm64/CarbonInk.app/Contents/Resources/app.asar*` ✓

Fill the result into the spec's Verified Smoke Run table. Commit.

---

## Definition of Done

- All 11 implementer tasks committed
- `pnpm test` passes (delta ≤ 10 from baseline; tracks new ai-client + stage tests, minus 5 deleted llm-client tests)
- `pnpm typecheck` clean
- `pnpm exec biome check <changed-files>` clean
- `pnpm dist:mac` produces DMGs (v26 schema already fixed)
- Manual smoke 7 steps verified + recorded in spec
- `package.json` no longer contains `@ai-sdk/*` or `ai` — only `@earendil-works/pi-ai`
- Bundle size: smaller than pre-migration baseline (5 SDKs removed > 1 pi-ai added)

## Known follow-ups (out of v1)

- Effect-ify the rest of `extraction-service.ts` (currently runPromise at boundary)
- Streaming UI (pi-ai supports `stream`; show partial output for slow models)
- Cost estimation UI (pi-ai's per-model cost metadata)
- Multi-provider per-feature (one model for extraction, another for narrative)
- Token usage tracking → license metering hook
