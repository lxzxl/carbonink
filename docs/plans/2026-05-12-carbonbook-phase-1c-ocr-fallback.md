# Phase 1c — OCR fallback (vision-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `pdf-parse` returns no usable text on a PDF, automatically render the PDF pages to PNG and send them to a vision-capable LLM, producing the same `china_utility.v1` extraction shape as the text path — no more `PdfNotReadableError` dead-end for scanned bills.

**Architecture:** `ExtractionService.run()` catches `PdfNotReadableError` locally and switches to a vision branch: `pdfToImages(bytes)` (pdfjs-dist + @napi-rs/canvas) → `stage.buildVisionMessages()` → `LLMClient.extractWithImages()` (AI SDK 6 multipart `messages`). A static `VISION_CAPABLE_MODELS` map gates the path; misconfigured providers raise a whitelisted `VisionUnsupportedError` toast pointing at Settings. A new `extraction:progress` `webContents.send` channel notifies the renderer when the pipeline switches to vision so the spinner text flips to "正在识别图像（需要更长时间）…".

**Tech Stack:** Electron 41 + Vite, TypeScript, AI SDK 6 (`@ai-sdk/*`), pdfjs-dist 5.x (already transitive via pdf-parse, promote to direct dep), `@napi-rs/canvas` 0.1.x, better-sqlite3 12.x, TanStack Router/Query, paraglide i18n, biome lint/format, vitest 4.x.

**Spec:** `docs/specs/2026-05-12-phase-1c-ocr-fallback-design.md` (commit `ad8eb61`).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/main/llm/pdf-to-images.ts` | **create** | Pure async function: `pdfToImages(bytes: Buffer, opts?: { dpi?: number }): Promise<Buffer[]>`. Wraps `pdfjs-dist` (legacy build) + `@napi-rs/canvas`. One PNG buffer per page. Default DPI 200. |
| `src/main/llm/vision-capability.ts` | **create** | `VISION_CAPABLE_MODELS` map + `assertVisionCapable(config)` + `VisionUnsupportedError` class. |
| `src/main/llm/stages/types.ts` | modify | Add `VisionMessages` type + optional `buildVisionMessages?(): VisionMessages` to `Stage<T>`. Drop the unused `'image' \| 'json'` from `inputType` (Phase 1c uses method presence to announce vision support, not `inputType` flag). |
| `src/main/llm/stages/china-utility.ts` | modify | Implement `buildVisionMessages()` using the same field-mapping rules. Export internal helper `chinaUtilityFieldRules` shared by both prompts. |
| `src/main/llm/llm-client.ts` | modify | Add `extractWithImages<T>(config, schema, messages, images): Promise<T>`. Builds multipart `messages: [{role:'user', content:[{type:'text',...}, ...image parts]}]` and calls `generateObject({ model, schema, messages, mode: 'json' })`. |
| `src/main/services/extraction-service.ts` | modify | Wrap text path in `try { ... } catch (PdfNotReadableError)`; in catch, run vision branch: `assertVisionCapable` → emit progress → `pdfToImages` → `stage.buildVisionMessages` → `llm.extractWithImages` → INSERT (same cache key). Add new export `StageDoesNotSupportVisionError`. Add `emitProgress` DI hook. |
| `src/main/ipc/progress.ts` | **create** | `createProgressEmitter(getWindow)` returns `(channel, payload) => void` that calls `webContents.send` on the main window, no-op on null. |
| `src/main/window.ts` | modify | Add `getMainWindow(): BrowserWindow \| null` (module-level slot; assigned in `createMainWindow`, cleared on `closed`). |
| `src/main/ipc/context.ts` | modify | Inject `progressEmitter` into the `ExtractionService` constructor. |
| `src/main/ipc/setup.ts` | modify | Build the production `progressEmitter` from `getMainWindow` and pass through `createIpcContext`. |
| `src/main/ipc/sanitize.ts` | modify | Whitelist `VisionUnsupportedError` and `StageDoesNotSupportVisionError` (same passthrough pattern as `PdfNotReadableError`). |
| `src/main/ipc/types.ts` | modify | Add `IpcPushTypeMap` (separate from `IpcTypeMap`) with `'extraction:progress': { document_id: string; phase: 'vision' }`. |
| `src/preload/bridge.ts` | modify | Add `allowedPushChannels` allowlist + `subscribe<C>(channel, callback): () => void` on `IpcBridge`. Channels outside the push allowlist throw. |
| `src/preload/index.ts` | modify | Wire `subscribe` through `ipcRenderer.on` / `removeListener`. |
| `src/renderer/lib/ipc.ts` | modify | Add `subscribe<C>(channel, callback): () => void` typed against `IpcPushTypeMap`. |
| `src/renderer/components/DocumentsUpload.tsx` | modify | Subscribe to `extraction:progress` for the current document; flip `'extracting'` spinner label to `documents_extracting_vision()` on `phase: 'vision'`. |
| `src/renderer/routes/documents_.$id.tsx` | modify | Same flip in `RunExtractionAction`'s pending state via the same subscription. |
| `messages/en.json` | modify | Add `documents_extracting_vision`, `documents_vision_unsupported`, `documents_stage_no_vision`. |
| `messages/zh-CN.json` | modify | Same keys with Chinese copy. |
| `tests/main/llm/pdf-to-images.test.ts` | **create** | Render a fixture text PDF, assert N PNG buffers, PNG signature on each. |
| `tests/main/llm/vision-capability.test.ts` | **create** | `assertVisionCapable` accepts whitelisted models, rejects others, treats `openai-compat` as pass-through. |
| `tests/main/llm/llm-client.test.ts` | modify | Add tests for `extractWithImages`: forwards the right multipart shape; threads `mode: 'json'`. |
| `tests/main/llm/stages/china-utility.test.ts` | modify | Assert `buildVisionMessages()` returns `VisionMessages` whose `userText` includes the Chinese field rules verbatim. |
| `tests/main/services/extraction-service.test.ts` | modify | Three new cases: whitespace text → vision path INSERT; `deepseek-chat` → `VisionUnsupportedError`; stage without `buildVisionMessages` → `StageDoesNotSupportVisionError`. |
| `tests/preload/bridge.test.ts` | modify | Test the new `subscribe` API + push-channel allowlist. |
| `package.json` | modify | Add `pdfjs-dist` (~5.4.x) and `@napi-rs/canvas` (~0.1.x) as direct dependencies. |

---

## Task 1: Add `pdfjs-dist` + `@napi-rs/canvas` deps and verify they load under Node ABI

**Files:**
- Modify: `package.json` (dependencies block)

**Why this matters:** vitest uses Node ABI (`pnpm rebuild:node`); the production app uses Electron ABI (`pnpm predev` runs `electron-rebuild`). `@napi-rs/canvas` ships prebuilds for both — we need to confirm the `require` cycle succeeds in both modes before any code depends on it.

- [ ] **Step 1: Install the new deps**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm add pdfjs-dist@^5.4.296 @napi-rs/canvas@^0.1.74
```
Expected: lockfile updated, packages added under `dependencies`.

- [ ] **Step 2: Verify @napi-rs/canvas loads under Node**

Run (must finish under 5 seconds):
```bash
cd /Users/lxz/ws/personal/carbonbook
node -e "const c = require('@napi-rs/canvas'); const cv = c.createCanvas(10, 10); console.log('OK', cv.width, cv.height);"
```
Expected output: `OK 10 10`

- [ ] **Step 3: Verify pdfjs-dist loads under Node**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
node --input-type=module -e "import('pdfjs-dist/legacy/build/pdf.mjs').then(m => console.log('OK', typeof m.getDocument));"
```
Expected output: `OK function`

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add package.json pnpm-lock.yaml
git commit -m "deps: pdfjs-dist + @napi-rs/canvas for Phase 1c OCR rendering"
```

---

## Task 2: `pdf-to-images.ts` — pure async renderer

**Files:**
- Create: `src/main/llm/pdf-to-images.ts`
- Test: `tests/main/llm/pdf-to-images.test.ts`
- Test fixture: `tests/fixtures/two-page-text.pdf` (will be generated in Step 1)

- [ ] **Step 1: Generate a deterministic 2-page text PDF fixture via Chrome headless**

Chrome's `--print-to-pdf` produces a real, pdfjs-parseable PDF deterministically. Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
mkdir -p tests/fixtures
cat > /tmp/two-page-test.html << 'HTML'
<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: sans-serif; margin: 40px; font-size: 28px; }
  .pb { page-break-after: always; }
</style></head>
<body>
  <h1>Page One</h1><p>Test content for Phase 1c pdfToImages.</p>
  <div class="pb"></div>
  <h1>Page Two</h1><p>Second page so the test asserts pages.length === 2.</p>
</body></html>
HTML

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=tests/fixtures/two-page-text.pdf \
  file:///tmp/two-page-test.html
```
Expected: a file at `tests/fixtures/two-page-text.pdf` exists, ~30-80 KB. Verify:
```bash
file tests/fixtures/two-page-text.pdf
ls -la tests/fixtures/two-page-text.pdf
```
Expected output: file type "PDF document, version 1.4" and a non-zero file size.

If Chrome isn't installed or is at a different path on the implementer's machine, alternatives:
- macOS: `open -a "Google Chrome"` then File → Print → Save as PDF.
- Linux: `chromium --headless ... --print-to-pdf=...`.
- Any platform: use any text editor that can "Save as PDF" with the HTML above, drop the resulting file at `tests/fixtures/two-page-text.pdf`.

The fixture is checked into git (~50KB binary). It's a real PDF with a text layer so pdfjs-dist parses it cleanly — exactly what the test needs.

- [ ] **Step 2: Write the failing test**

Create `tests/main/llm/pdf-to-images.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pdfToImages } from '@main/llm/pdf-to-images';
import { describe, expect, it } from 'vitest';

const FIXTURE = join(__dirname, '../../fixtures/two-page-text.pdf');

describe('pdfToImages', () => {
  it('renders one PNG buffer per page', async () => {
    const bytes = readFileSync(FIXTURE);

    const pages = await pdfToImages(bytes);

    expect(pages.length).toBe(2);
    for (const png of pages) {
      // PNG signature: 89 50 4E 47 0D 0A 1A 0A
      expect(png[0]).toBe(0x89);
      expect(png[1]).toBe(0x50);
      expect(png[2]).toBe(0x4e);
      expect(png[3]).toBe(0x47);
      // Non-trivial buffer — even a blank page at 200 DPI is many KB.
      expect(png.length).toBeGreaterThan(1000);
    }
  });

  it('respects an explicit DPI option', async () => {
    const bytes = readFileSync(FIXTURE);
    const lowDpi = await pdfToImages(bytes, { dpi: 72 });
    const highDpi = await pdfToImages(bytes, { dpi: 200 });
    // Higher DPI → strictly more pixels → bigger PNG. Compare page 1.
    expect(highDpi[0]!.length).toBeGreaterThan(lowDpi[0]!.length);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/pdf-to-images.test.ts --pool=threads
```
Expected: FAIL with module-not-found or `pdfToImages is not a function`.

- [ ] **Step 4: Implement `pdfToImages`**

Create `src/main/llm/pdf-to-images.ts`:
```ts
import { createCanvas, type Canvas } from '@napi-rs/canvas';

export interface PdfToImagesOptions {
  /**
   * Output resolution in dots-per-inch. Defaults to 200 — high enough
   * for vision LLMs to read printed Chinese text reliably, low enough
   * that a 1-page bill stays under ~300 KB after PNG compression.
   * Bump to 300 if a particular document renders unreadable.
   */
  dpi?: number;
}

/**
 * Render every page of a PDF to a PNG buffer.
 *
 * Why this exists: vision LLMs (GPT-4o, Claude 3.5+, DeepSeek-VL, ...)
 * almost universally accept image inputs but not raw PDFs. When
 * `pdf-parse` reports no text layer (the `PdfNotReadableError` case
 * in `ExtractionService`), we need to render the PDF into images and
 * hand them to the vision path.
 *
 * Implementation: we use the legacy ESM build of `pdfjs-dist` because
 * it doesn't require a worker thread setup (the modern build assumes
 * a `pdfjs-dist/build/pdf.worker.mjs` URL that Electron's main process
 * can't trivially expose). For the canvas backend we use
 * `@napi-rs/canvas` — fully Node-native, ships prebuilds for macOS
 * arm64 / x64 + Windows x64 + Linux x64, no system library deps.
 *
 * Memory: each call creates one Canvas per page in series (not
 * parallel) so we don't blow up on a 50-page PDF. `Canvas.toBuffer`
 * returns a PNG; we discard the canvas immediately after.
 *
 * @param bytes — the entire PDF as a Buffer.
 * @param opts.dpi — resolution. Defaults to 200.
 * @returns one PNG buffer per page, in document order.
 */
export async function pdfToImages(
  bytes: Buffer,
  opts: PdfToImagesOptions = {},
): Promise<Buffer[]> {
  const dpi = opts.dpi ?? 200;
  // pdfjs-dist uses a CSS-pixel-per-inch baseline of 72; scale = dpi/72.
  const scale = dpi / 72;

  // Dynamic import keeps pdfjs-dist out of the test bundle when callers
  // don't actually exercise the vision path. The legacy build doesn't
  // need a worker URL setup.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

  // `getDocument` accepts a Uint8Array directly; passing a Node Buffer
  // works (Buffer is a Uint8Array subclass) but we copy to be explicit
  // and avoid any subtle prototype quirks across the pdfjs boundary.
  const data = new Uint8Array(bytes);
  const loadingTask = pdfjs.getDocument({ data });
  const doc = await loadingTask.promise;

  try {
    const pages: Buffer[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas: Canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const ctx = canvas.getContext('2d');
      // @napi-rs/canvas's 2d context is API-compatible with the
      // browser one used by pdfjs — but the cast is needed because
      // the typed shapes are nominally different.
      await page.render({
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      page.cleanup();
      pages.push(canvas.toBuffer('image/png'));
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/pdf-to-images.test.ts --pool=threads
```
Expected: PASS — 2 tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/pdf-to-images.ts tests/main/llm/pdf-to-images.test.ts tests/fixtures/two-page-text.pdf
git commit -m "feat(llm): pdfToImages — render PDF pages to PNG via pdfjs-dist + @napi-rs/canvas"
```

---

## Task 3: `vision-capability.ts` — model gating

**Files:**
- Create: `src/main/llm/vision-capability.ts`
- Test: `tests/main/llm/vision-capability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/llm/vision-capability.test.ts`:
```ts
import {
  assertVisionCapable,
  VISION_CAPABLE_MODELS,
  VisionUnsupportedError,
} from '@main/llm/vision-capability';
import type { ProviderConfig } from '@shared/types';
import { describe, expect, it } from 'vitest';

function cfg(partial: Partial<ProviderConfig> & { provider: ProviderConfig['provider'] }) {
  // Returns a shape that satisfies `ProviderConfig`'s discriminated union for
  // each provider variant. We only assert on `.provider` + `.model` so the
  // other fields are placeholder defaults.
  switch (partial.provider) {
    case 'openai':
      return { provider: 'openai', model: partial.model ?? 'gpt-4o', apiKeyKeyref: 'llm.openai.apikey' } as ProviderConfig;
    case 'anthropic':
      return { provider: 'anthropic', model: partial.model ?? 'claude-sonnet-4-5', apiKeyKeyref: 'llm.anthropic.apikey' } as ProviderConfig;
    case 'azure':
      return {
        provider: 'azure', model: partial.model ?? 'gpt-4o', apiKeyKeyref: 'llm.azure.apikey',
        resourceName: 'r', apiVersion: '2024-08-01-preview',
      } as ProviderConfig;
    case 'deepseek':
      return { provider: 'deepseek', model: partial.model ?? 'deepseek-vl', apiKeyKeyref: 'llm.deepseek.apikey' } as ProviderConfig;
    case 'openai-compat':
      return {
        provider: 'openai-compat', model: partial.model ?? 'anything', apiKeyKeyref: 'llm.openai-compat.apikey',
        baseUrl: 'https://x.example.com', name: 'X',
      } as ProviderConfig;
  }
}

describe('VISION_CAPABLE_MODELS map', () => {
  it('contains every provider kind', () => {
    expect(VISION_CAPABLE_MODELS.openai).toContain('gpt-4o');
    expect(VISION_CAPABLE_MODELS.openai).toContain('gpt-4o-mini');
    expect(VISION_CAPABLE_MODELS.anthropic).toContain('claude-sonnet-4-5');
    expect(VISION_CAPABLE_MODELS.azure).toContain('gpt-4o');
    expect(VISION_CAPABLE_MODELS.deepseek).toContain('deepseek-vl');
    expect(VISION_CAPABLE_MODELS['openai-compat']).toBe('unknown');
  });
});

describe('assertVisionCapable', () => {
  it('passes through for whitelisted OpenAI models', () => {
    expect(() => assertVisionCapable(cfg({ provider: 'openai', model: 'gpt-4o' }))).not.toThrow();
    expect(() => assertVisionCapable(cfg({ provider: 'openai', model: 'gpt-4o-mini' }))).not.toThrow();
  });
  it('passes through for whitelisted Anthropic models', () => {
    expect(() => assertVisionCapable(cfg({ provider: 'anthropic', model: 'claude-sonnet-4-5' }))).not.toThrow();
  });
  it('passes through for whitelisted DeepSeek vision model', () => {
    expect(() => assertVisionCapable(cfg({ provider: 'deepseek', model: 'deepseek-vl' }))).not.toThrow();
  });
  it('passes through for openai-compat regardless of model (unknown backend)', () => {
    expect(() => assertVisionCapable(cfg({ provider: 'openai-compat', model: 'whatever' }))).not.toThrow();
  });
  it('throws VisionUnsupportedError for deepseek-chat', () => {
    expect(() => assertVisionCapable(cfg({ provider: 'deepseek', model: 'deepseek-chat' })))
      .toThrow(VisionUnsupportedError);
  });
  it('throws VisionUnsupportedError for an openai model not in the list', () => {
    expect(() => assertVisionCapable(cfg({ provider: 'openai', model: 'gpt-3.5-turbo' })))
      .toThrow(VisionUnsupportedError);
  });
  it('error carries the offending model + a suggestion string', () => {
    try {
      assertVisionCapable(cfg({ provider: 'deepseek', model: 'deepseek-chat' }));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(VisionUnsupportedError);
      const ve = err as VisionUnsupportedError;
      expect(ve.model).toBe('deepseek-chat');
      expect(ve.suggestion).toContain('deepseek-vl');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/vision-capability.test.ts --pool=threads
```
Expected: FAIL with "Cannot find module '@main/llm/vision-capability'".

- [ ] **Step 3: Implement the module**

Create `src/main/llm/vision-capability.ts`:
```ts
import type { ProviderConfig, ProviderKind } from '@shared/types.js';

/**
 * Models known to accept image inputs alongside text. Used by
 * `ExtractionService` to gate the vision fallback path — if the user's
 * currently-configured model isn't on this list, we surface a
 * `VisionUnsupportedError` toast pointing at Settings instead of
 * silently failing on the actual API call.
 *
 * Naming follows each provider's canonical model id (what the user
 * types into Settings). For `openai-compat` we don't know the backend
 * so we mark it `'unknown'` and let the API itself error if it
 * doesn't support images — better than over-restricting.
 *
 * Keep this list aligned with the suggestion copy in
 * `VisionUnsupportedError.suggestion` so the toast names something
 * the user can actually pick.
 */
export const VISION_CAPABLE_MODELS: Record<ProviderKind, ReadonlyArray<string> | 'unknown'> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  azure: ['gpt-4o', 'gpt-4o-mini'],
  anthropic: [
    'claude-3-5-sonnet',
    'claude-sonnet-4',
    'claude-sonnet-4-5',
    'claude-3-opus',
    'claude-3-haiku',
  ],
  deepseek: ['deepseek-vl'],
  'openai-compat': 'unknown',
};

/**
 * Per-provider suggestion text appended to the user-facing error.
 * Names the most common vision-capable model on each platform so the
 * user has a concrete answer to "what should I switch to?".
 */
const SUGGESTIONS: Record<ProviderKind, string> = {
  openai: 'Switch to gpt-4o or gpt-4o-mini in Settings.',
  azure: 'Switch to a gpt-4o deployment in Settings.',
  anthropic: 'Switch to claude-sonnet-4-5 (or any claude-3.5+) in Settings.',
  deepseek: 'Switch from deepseek-chat to deepseek-vl in Settings.',
  'openai-compat': 'Configure a vision-capable model in Settings.',
};

/**
 * Thrown when an extraction needs to use the vision path but the
 * currently-selected provider+model combination isn't known to accept
 * image inputs. Whitelisted by `sanitize.ts` so the user sees the
 * full message + suggestion as an actionable toast.
 */
export class VisionUnsupportedError extends Error {
  constructor(
    public readonly provider: ProviderKind,
    public readonly model: string,
    public readonly suggestion: string,
  ) {
    super(
      `Selected model "${model}" does not support image input. ` +
        `OCR fallback needs a multimodal model. ${suggestion}`,
    );
    this.name = 'VisionUnsupportedError';
  }
}

/**
 * Validate that a `ProviderConfig` resolves to a vision-capable model.
 * Throws `VisionUnsupportedError` on mismatch. `openai-compat` is
 * deliberately permissive (we don't know the backend's capabilities;
 * the actual API call will error if the model is text-only and we
 * surface that via the existing SchemaMismatchError path).
 */
export function assertVisionCapable(config: ProviderConfig): void {
  const allowed = VISION_CAPABLE_MODELS[config.provider];
  if (allowed === 'unknown') return;
  if (allowed.includes(config.model)) return;
  throw new VisionUnsupportedError(config.provider, config.model, SUGGESTIONS[config.provider]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/vision-capability.test.ts --pool=threads
```
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/vision-capability.ts tests/main/llm/vision-capability.test.ts
git commit -m "feat(llm): vision-capability — static gate for multimodal-capable models"
```

---

## Task 4: Evolve `Stage<T>` interface to declare optional vision support

**Files:**
- Modify: `src/main/llm/stages/types.ts`

**Why this matters:** The spec says `inputType` stays as the **text** capability declaration; vision support is announced by the presence of an optional `buildVisionMessages` method. This task is the type-only change before china-utility implements it.

- [ ] **Step 1: Update the Stage interface**

Open `src/main/llm/stages/types.ts` and replace its contents with:
```ts
import type { z } from 'zod';

/**
 * Text + image parts of a single user-turn message handed to a vision
 * LLM. `ExtractionService` appends the actual image content after
 * `userText` when calling `LLMClient.extractWithImages`; the stage
 * supplies the instruction copy (field rules, output format) but
 * doesn't know how many pages the PDF rendered to.
 *
 * `system` is optional — most stages can fold their instructions into
 * the user turn since AI SDK 6 handles either equivalently across the
 * 5 providers we support. Reserved for stages that benefit from a
 * separate "you are an X" framing.
 */
export type VisionMessages = {
  /** Optional system-turn instruction. */
  system?: string;
  /** User-turn text portion. Images are appended after this by the caller. */
  userText: string;
};

/**
 * A Stage describes one structured-extraction task the AI pipeline can run
 * against a document: it bundles the user-facing identity (`id` / `version` /
 * `description`), the input modality, a zod schema that both *constrains*
 * the model and *parses* its response, and a prompt template.
 *
 * Stages are pure data — no side effects, no state. The `ExtractionService`
 * looks one up by `id`, feeds the document text through `buildPrompt`, and
 * hands `schema` to the LLM client. This makes stages trivial to unit test
 * (schema parse + prompt content checks) and lets us version them without
 * touching the orchestrator.
 *
 * `T` is the zod-inferred shape returned by a successful extraction. The
 * registry stores `Stage<unknown>` to allow heterogeneous stages in one map,
 * but each call site re-narrows via `chinaUtilityStage`'s explicit type.
 *
 * **Vision support (Phase 1c)**: a stage opts in by implementing the
 * optional `buildVisionMessages()` method. Presence of the method is
 * what `ExtractionService` checks — `inputType` continues to describe
 * what `buildPrompt` accepts, not whether vision is available.
 */
export type Stage<T = unknown> = {
  /**
   * Stable identifier including a version suffix (e.g. `china_utility.v1`).
   * Persisted to `extraction.prompt_version` so the cache survives prompt
   * tweaks: bumping to `v2` invalidates every prior `v1` cache entry.
   */
  id: string;
  /** Semver — for changelog display only; the cache key uses `id`. */
  version: string;
  description: string;
  /**
   * Modality of the input string passed to `buildPrompt`. Phase 1b text
   * extraction uses `pdf_text`. Phase 1c **does not** introduce a
   * `pdf_image` value here — vision support is opted into by
   * implementing `buildVisionMessages`. Reserved literals stay for
   * future non-PDF input types (Excel/JSON).
   */
  inputType: 'pdf_text';
  schema: z.ZodType<T>;
  buildPrompt: (input: string) => string;
  /**
   * Phase 1c — image-input path. Optional: stages that don't define
   * this don't support vision fallback, and `ExtractionService` throws
   * `StageDoesNotSupportVisionError` when forced down the vision branch.
   *
   * Returns the text portion of the multipart user message; the caller
   * appends one image part per rendered PDF page (in document order)
   * before handing to `LLMClient.extractWithImages`.
   */
  buildVisionMessages?: () => VisionMessages;
};
```

- [ ] **Step 2: Verify TypeScript still compiles**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean exit (no output).

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/types.ts
git commit -m "feat(stages): Stage interface gains optional buildVisionMessages for Phase 1c"
```

---

## Task 5: `china_utility.v1` implements `buildVisionMessages`

**Files:**
- Modify: `src/main/llm/stages/china-utility.ts`
- Test: `tests/main/llm/stages/china-utility.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/main/llm/stages/china-utility.test.ts` and append the following block at the end of `describe('chinaUtilityStage metadata', ...)`:

```ts
  it('exposes a buildVisionMessages() returning the same field rules as buildPrompt', () => {
    expect(chinaUtilityStage.buildVisionMessages).toBeDefined();
    const messages = chinaUtilityStage.buildVisionMessages?.();
    expect(messages).toBeDefined();
    expect(messages?.userText).toContain('Chinese electricity utility bill');
    // The field mapping rules MUST appear verbatim in both prompts so the
    // model behaves consistently across text and vision paths.
    expect(messages?.userText).toContain('amount_kwh');
    expect(messages?.userText).toContain('用电量');
    expect(messages?.userText).toContain('confidence');
    // No PDF text placeholder — image content is appended by the caller.
    expect(messages?.userText).not.toContain('<bill>');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/china-utility.test.ts --pool=threads
```
Expected: FAIL with `expect(chinaUtilityStage.buildVisionMessages).toBeDefined()` — `buildVisionMessages` is `undefined`.

- [ ] **Step 3: Refactor + add `buildVisionMessages`**

Replace the entirety of `src/main/llm/stages/china-utility.ts` with:
```ts
import { z } from 'zod';
import type { Stage, VisionMessages } from './types.js';

// (existing schema + describe-strings unchanged — copied verbatim)

/**
 * Schema is deliberately PERMISSIVE on data fields because the model needs an
 * honest way to say "I couldn't extract this" — for scanned-only PDFs (no
 * text layer), bills in unfamiliar formats, or non-utility documents the user
 * uploaded by mistake. Earlier strict schema (positive amount_kwh, ISO date
 * regex) forced the model into a corner: it had to either lie (invent
 * plausible numbers) or trigger a `SchemaMismatchError` that gave the user
 * no recoverable signal.
 *
 * Validation contract is now: the SHAPE is strict (every key present, types
 * correct), the VALUES are best-effort. The review UI is responsible for
 * showing `confidence` prominently and warning when fields look empty
 * (amount_kwh=0, dates empty). The Confirm flow then opens ActivityForm
 * pre-filled with whatever was extracted; the user can override any field
 * before committing to activity_data.
 *
 * Phase 1c re-uses the same schema for the vision path — see
 * `buildVisionMessages`. The model has a fair OCR chance now so this
 * permissiveness may be tightened in 1d for `confidence='high'` rows.
 */
export const chinaUtilityExtraction = z.object({
  doc_type: z
    .literal('china_utility')
    .describe('Always the literal "china_utility" — caller has already classified.'),
  supplier_name: z
    .string()
    .describe('Utility company name, e.g. 国网XX供电公司. Empty string if not legible.'),
  account_no: z.string().nullable().describe('User account number (户号), or null.'),
  amount_kwh: z
    .number()
    .min(0)
    .describe('Energy consumption in kWh (度). 0 if not legible — UI will flag.'),
  amount_yuan: z
    .number()
    .min(0)
    .nullable()
    .describe('Total bill amount in CNY (应收合计). Number only, no symbols. null if absent.'),
  period_start: z
    .string()
    .describe('Billing period start as YYYY-MM-DD. Empty string if not legible.'),
  period_end: z
    .string()
    .describe('Billing period end as YYYY-MM-DD. Empty string if not legible.'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe(
      'high: all four key fields (supplier/amount_kwh/period_start/period_end) clearly visible. ' +
        'medium: 1-2 inferred. low: this does not look like a Chinese utility bill, OR PDF text is unreadable.',
    ),
});

export type ChinaUtilityExtraction = z.infer<typeof chinaUtilityExtraction>;

/**
 * Field-mapping + output-format rules shared between `buildPrompt`
 * (text path) and `buildVisionMessages` (image path). Extracting this
 * to a const guarantees the two paths stay aligned — diverging copies
 * would cause the model to behave differently for the same bill
 * depending on which path triggered.
 */
const FIELD_RULES = `Output rules (CRITICAL — DeepSeek and other providers without native JSON
schema mode read these directly):
- Return EXACTLY ONE JSON object, no markdown, no \`\`\`json fences, no prose.
- Every required field must be present. Numeric fields are numbers (not
  strings). Date fields are strings in ISO format "YYYY-MM-DD".
- If a value is genuinely missing on the bill, use null ONLY for the
  fields explicitly marked nullable (account_no, amount_yuan). Never omit
  a key. Never use null for required fields — emit a best-guess instead
  with confidence='low'.

Field mapping (Chinese bills follow regional variations):
- doc_type: always "china_utility" — even if the bill looks unusual,
  the user already classified it; you're confirming + extracting.
- supplier_name: the issuing utility, e.g. "国网北京市电力公司",
  "南方电网XX供电局". Take the most specific company name visible.
- account_no: "户号" / "用户编号" / "客户编号". null if not shown.
- amount_kwh: numeric kWh consumption.
  - "用电量" / "电量" / "实用电量" → kWh value
  - If shown as "度", that IS kWh (1 度 = 1 kWh)
  - If shown as "万度", multiply by 10000
- amount_yuan: total billed amount in CNY.
  - "应收合计" / "本月电费" / "实收金额" / "总金额"
  - Number only (no "¥" / "元"). null if absent.
- period_start / period_end:
  - "计费起止" / "用电期间" / "抄表日期" gives the range.
  - "上次抄表日期" → period_start, "本次抄表日期" → period_end.
  - Format as ISO YYYY-MM-DD. If only year-month shown ("2025-09"),
    assume first/last day of month.
- confidence:
  - "high" if supplier_name, amount_kwh, period_start, period_end are
    all clearly visible and unambiguous.
  - "medium" if one of those was inferred or partially obscured.
  - "low" if the document doesn't look like a Chinese utility bill at
    all, or multiple required fields are guesses.

Example valid response shape (do not copy the values — extract from the
real bill above):
{"doc_type":"china_utility","supplier_name":"国网北京市电力公司","account_no":"1234567890","amount_kwh":523.5,"amount_yuan":312.7,"period_start":"2025-09-01","period_end":"2025-09-30","confidence":"high"}`;

/**
 * v1 China utility stage. Combines classification ("is this a Chinese
 * electricity bill?") and extraction in a single prompt — at Phase 1b
 * volume the cost of two round-trips isn't worth the cleanliness, and the
 * `confidence` enum gives us a soft fallback when the doc looks unfamiliar.
 *
 * Prompt is in English (model performs better at instruction-following in
 * English) while the bill text itself stays Chinese inside the `---` block.
 *
 * Phase 1c: `buildVisionMessages` reuses the same `FIELD_RULES` body so
 * the model behaves identically across text and image inputs.
 */
export const chinaUtilityStage: Stage<ChinaUtilityExtraction> = {
  id: 'china_utility.v1',
  version: '1.0.0',
  description: 'Chinese electricity bill (国网/南方电网 风格) — classify + extract',
  inputType: 'pdf_text',
  schema: chinaUtilityExtraction,
  buildPrompt: (pdfText) => `
You are extracting structured data from a Chinese electricity utility bill (中国电费单).

Bill text (extracted from PDF):
<bill>
${pdfText}
</bill>

${FIELD_RULES}`,
  buildVisionMessages: (): VisionMessages => ({
    userText: `You are extracting structured data from a Chinese electricity utility bill (中国电费单).

The bill is provided as one or more PNG images (one per PDF page) attached to this
message. Look at the images directly — do NOT request OCR text from another tool.

${FIELD_RULES}`,
  }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/stages/china-utility.test.ts --pool=threads
```
Expected: PASS — all previous tests + new one.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/stages/china-utility.ts tests/main/llm/stages/china-utility.test.ts
git commit -m "feat(stages): china_utility.v1 — buildVisionMessages mirrors buildPrompt rules"
```

---

## Task 6: `LLMClient.extractWithImages` — multipart messages call

**Files:**
- Modify: `src/main/llm/llm-client.ts`
- Test: `tests/main/llm/llm-client.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/main/llm/llm-client.test.ts` and append a new `describe` block at the end of the file:

```ts
describe('LLMClient.extractWithImages', () => {
  it('builds a multipart user message with text + image parts and forwards mode=json', async () => {
    const credentials = makeCredentials({ 'llm.openai.apikey': 'sk-vision' });
    const client = new LLMClient({ credentials });
    const schema = z.object({ ok: z.boolean() });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { ok: true } } as never);

    const config: ProviderConfig = {
      provider: 'openai',
      model: 'gpt-4o',
      apiKeyKeyref: 'llm.openai.apikey',
    };
    const imageA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa]);
    const imageB = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xbb]);

    const result = await client.extractWithImages(
      config,
      schema,
      { userText: 'extract fields' },
      [imageA, imageB],
    );

    expect(result).toEqual({ ok: true });
    expect(generateObject).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateObject).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.model).toBe('openai-model:gpt-4o');
    expect(call?.schema).toBe(schema);
    expect(call?.mode).toBe('json');
    // One user-role message with content = [text, image, image].
    const messages = call?.messages as Array<{ role: string; content: Array<{ type: string }> }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toHaveLength(3); // 1 text + 2 images
    expect(messages[0]!.content[0]).toEqual({ type: 'text', text: 'extract fields' });
    expect(messages[0]!.content[1]).toMatchObject({ type: 'image' });
    expect(messages[0]!.content[2]).toMatchObject({ type: 'image' });
  });

  it('includes a system message when VisionMessages.system is set', async () => {
    const credentials = makeCredentials({ 'llm.anthropic.apikey': 'sk-anthropic' });
    const client = new LLMClient({ credentials });
    const schema = z.object({ ok: z.boolean() });
    vi.mocked(generateObject).mockResolvedValueOnce({ object: { ok: true } } as never);

    const config: ProviderConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKeyKeyref: 'llm.anthropic.apikey',
    };
    await client.extractWithImages(
      config,
      schema,
      { system: 'You are an expert OCR.', userText: 'extract' },
      [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    );

    const call = vi.mocked(generateObject).mock.calls[0]?.[0] as Record<string, unknown>;
    const messages = call?.messages as Array<{ role: string; content: unknown }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'system', content: 'You are an expert OCR.' });
    expect(messages[1]!.role).toBe('user');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/llm-client.test.ts --pool=threads
```
Expected: FAIL with `client.extractWithImages is not a function`.

- [ ] **Step 3: Add `extractWithImages` to `LLMClient`**

Open `src/main/llm/llm-client.ts` and update the imports at the top:
```ts
import type { ProviderConfig } from '@shared/types.js';
import type { VisionMessages } from '@main/llm/stages/types.js';
import { generateObject, type LanguageModel, NoObjectGeneratedError } from 'ai';
import { z } from 'zod';
```

Then insert the following method inside the `LLMClient` class, immediately after the existing `extract` method:
```ts
  /**
   * Variant of `extract` for image inputs. Builds a multipart user
   * message — one text part followed by one image part per buffer —
   * and calls AI SDK 6's `generateObject` with `mode: 'json'`.
   *
   * The image parts use AI SDK's `{ type: 'image', image: Buffer }`
   * shape. The SDK is responsible for base64-encoding and selecting
   * the right MIME type per provider; PNG buffers (what `pdfToImages`
   * produces) are universally accepted.
   *
   * Schema validation + error translation matches `extract`:
   * NoObjectGeneratedError → SchemaMismatchError with a raw-text
   * preview.
   */
  async extractWithImages<T>(
    config: ProviderConfig,
    schema: z.ZodType<T>,
    vision: VisionMessages,
    images: Buffer[],
  ): Promise<T> {
    const model = this.getModel(config);

    // AI SDK 6 message shape: each role-message has `content` that's
    // either a string OR an array of typed parts. We always use the
    // array form for the user turn so adding more content types in
    // the future is non-breaking.
    const userContent: Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer }> = [
      { type: 'text', text: vision.userText },
      ...images.map((image) => ({ type: 'image' as const, image })),
    ];

    const messages = vision.system
      ? [
          { role: 'system' as const, content: vision.system },
          { role: 'user' as const, content: userContent },
        ]
      : [{ role: 'user' as const, content: userContent }];

    try {
      const result = await generateObject({
        model,
        schema,
        // biome-ignore lint/suspicious/noExplicitAny: AI SDK's `messages`
        // union is too broad for our narrowed multipart shape.
        messages: messages as any,
        mode: 'json',
      });
      return result.object;
    } catch (err) {
      if (NoObjectGeneratedError.isInstance(err)) {
        throw new SchemaMismatchError(config.provider, err.text, err);
      }
      throw err;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/llm/llm-client.test.ts --pool=threads
```
Expected: PASS — all previous tests + 2 new ones.

- [ ] **Step 5: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/llm/llm-client.ts tests/main/llm/llm-client.test.ts
git commit -m "feat(llm): LLMClient.extractWithImages — multipart messages for vision path"
```

---

## Task 7: `progress.ts` — main→renderer event emitter

**Files:**
- Create: `src/main/ipc/progress.ts`
- Test: `tests/main/ipc/progress.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/ipc/progress.test.ts`:
```ts
import { createProgressEmitter } from '@main/ipc/progress';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

describe('createProgressEmitter', () => {
  it('forwards channel + payload to the resolved window\'s webContents.send', () => {
    const send = vi.fn();
    const fakeWin = { webContents: { send, isDestroyed: () => false } } as unknown as BrowserWindow;
    const emitter = createProgressEmitter(() => fakeWin);

    emitter('extraction:progress', { document_id: 'doc-1', phase: 'vision' });

    expect(send).toHaveBeenCalledWith('extraction:progress', {
      document_id: 'doc-1',
      phase: 'vision',
    });
  });

  it('is a no-op when getWindow returns null', () => {
    // The renderer may have been closed while a long-running vision call
    // is still in flight. Sending to a missing webContents would throw;
    // we swallow that to keep the main pipeline going to completion.
    const emitter = createProgressEmitter(() => null);
    expect(() => emitter('extraction:progress', { document_id: 'x', phase: 'vision' }))
      .not.toThrow();
  });

  it('is a no-op when webContents is destroyed', () => {
    const send = vi.fn();
    const fakeWin = { webContents: { send, isDestroyed: () => true } } as unknown as BrowserWindow;
    const emitter = createProgressEmitter(() => fakeWin);
    emitter('extraction:progress', { document_id: 'x', phase: 'vision' });
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/ipc/progress.test.ts --pool=threads
```
Expected: FAIL with "Cannot find module '@main/ipc/progress'".

- [ ] **Step 3: Implement `progress.ts`**

Create `src/main/ipc/progress.ts`:
```ts
import type { BrowserWindow } from 'electron';
import type { IpcPushTypeMap } from './types.js';

/**
 * One-way push channel from main to renderer. Used during long-running
 * IPC handlers (vision extraction is currently the only one) to nudge
 * the UI with phase changes without making the renderer poll.
 *
 * The factory takes a `getWindow` resolver instead of a `BrowserWindow`
 * directly so the consumer doesn't need to re-thread the window
 * reference each time a new one is created — `window.ts` owns the
 * latest-window slot and the emitter follows it.
 *
 * Gracefully handles:
 *   - getWindow returning null (no window yet, or all closed)
 *   - webContents being destroyed mid-flight (window closed between
 *     the resolver call and the actual `.send`)
 *
 * Both cases are non-errors: the renderer is supposed to be
 * subscriber-of-record; if it's gone, the event is simply discarded.
 */
export type ProgressEmitter = <C extends keyof IpcPushTypeMap>(
  channel: C,
  payload: IpcPushTypeMap[C],
) => void;

export function createProgressEmitter(getWindow: () => BrowserWindow | null): ProgressEmitter {
  return <C extends keyof IpcPushTypeMap>(channel: C, payload: IpcPushTypeMap[C]) => {
    const win = getWindow();
    if (!win) return;
    if (win.webContents.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };
}
```

Note: this references `IpcPushTypeMap` which we add in the next step. The TypeScript error is intentional — it'll resolve after Step 4 below.

- [ ] **Step 4: Add `IpcPushTypeMap` to `src/main/ipc/types.ts`**

Append to the end of `src/main/ipc/types.ts`:
```ts

/**
 * Push channels — main→renderer events fired via `webContents.send`,
 * subscribed via the preload `subscribe` API. Separate from
 * `IpcTypeMap` because these are not request/response: payload only,
 * no return value, no per-call correlation id.
 *
 * Phase 1c only registers `extraction:progress` (signals "switching
 * to vision OCR" mid-extraction). Phase 1d's streamObject will
 * extend the payload to carry partial JSON without a schema break —
 * `phase` becomes a discriminator with more values.
 */
export type IpcPushTypeMap = {
  'extraction:progress': {
    /** Which extraction this event belongs to. */
    document_id: string;
    /** Stage of the pipeline the event was emitted from. */
    phase: 'vision';
  };
};
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/ipc/progress.test.ts --pool=threads
pnpm typecheck
```
Expected: PASS — 3 tests passing; typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/ipc/progress.ts src/main/ipc/types.ts tests/main/ipc/progress.test.ts
git commit -m "feat(ipc): progress emitter for main→renderer push events"
```

---

## Task 8: `window.ts` exposes the latest BrowserWindow + wire emitter in `setupIpc`

**Files:**
- Modify: `src/main/window.ts`
- Modify: `src/main/ipc/setup.ts`
- Modify: `src/main/ipc/context.ts`

- [ ] **Step 1: Add `getMainWindow` to `src/main/window.ts`**

Replace the entirety of `src/main/window.ts` with:
```ts
import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/**
 * Module-level slot for the most-recent main window. Other main-process
 * subsystems (e.g. `progress.ts`) need to push events to "the" renderer
 * without re-threading a `BrowserWindow` reference through every IPC
 * setup call. We cleared the slot on `closed` so a closed-then-not-yet-
 * reopened app correctly returns null.
 */
let currentMainWindow: BrowserWindow | null = null;

/**
 * Returns the most recent `BrowserWindow` created by `createMainWindow`,
 * or null if no window currently exists. Callers should treat null as
 * "renderer is unavailable, skip this event".
 */
export function getMainWindow(): BrowserWindow | null {
  return currentMainWindow;
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'carbonbook',
    ...(isMac && {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 18, y: 16 },
      vibrancy: 'under-window' as const,
      visualEffectState: 'active' as const,
    }),
    ...(isWin && {
      backgroundMaterial: 'mica' as const,
      autoHideMenuBar: true,
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  currentMainWindow = win;
  win.on('closed', () => {
    if (currentMainWindow === win) currentMainWindow = null;
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
```

- [ ] **Step 2: Pass the emitter through `setupIpc` → `createIpcContext`**

Update `src/main/ipc/setup.ts` to construct the production emitter:
```ts
import { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { getAppDb } from '@main/db/connection.js';
import { defaultNow } from '@main/services/base.js';
import { getMainWindow } from '@main/window.js';
import { activityDataHandlers } from './handlers/activity-data.js';
import { documentHandlers } from './handlers/document.js';
import { efLibraryHandlers } from './handlers/ef-library.js';
import { emissionSourceHandlers } from './handlers/emission-source.js';
import { extractionHandlers } from './handlers/extraction.js';
import { organizationHandlers } from './handlers/organization.js';
import { settingsHandlers } from './handlers/settings.js';
import { createIpcContext, type IpcContext } from './context.js';
import { createProgressEmitter } from './progress.js';
import { sanitize } from './sanitize.js';
import type { IpcTypeMap } from './types.js';

let listener: IpcListener<IpcTypeMap> | null = null;

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };
type HandlerFactory = (ctx: IpcContext) => HandlerMap;

const HANDLER_FACTORIES: ReadonlyArray<HandlerFactory> = [
  organizationHandlers,
  efLibraryHandlers,
  emissionSourceHandlers,
  activityDataHandlers,
  settingsHandlers,
  documentHandlers,
  extractionHandlers,
];

export function setupIpc(): void {
  if (listener) return;

  const ctx = createIpcContext(
    { db: getAppDb(), now: defaultNow },
    { progressEmitter: createProgressEmitter(getMainWindow) },
  );
  const l = new IpcListener<IpcTypeMap>();

  for (const factory of HANDLER_FACTORIES) {
    for (const [channel, handler] of Object.entries(factory(ctx))) {
      const wrapped = sanitize(channel, handler as (...a: unknown[]) => unknown);
      // biome-ignore lint/suspicious/noExplicitAny: heterogeneous handler dispatch
      (l.handle as (c: string, h: (...a: any[]) => unknown) => void)(
        channel,
        (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => wrapped(...args),
      );
    }
  }

  listener = l;
}

export function cleanupIpc(): void {
  if (!listener) return;
  listener.dispose();
  listener = null;
}
```

- [ ] **Step 3: Accept the emitter in `createIpcContext`**

Update `src/main/ipc/context.ts` by:

1. Adding the import at the top alongside the others:
```ts
import type { ProgressEmitter } from './progress.js';
```

2. Adding `progressEmitter` to `IpcContextOverrides`:
```ts
export interface IpcContextOverrides {
  credentialService?: CredentialService;
  llmClient?: LLMClient;
  uploadsDir?: string;
  documentService?: DocumentService;
  extractionService?: ExtractionService;
  /**
   * Optional main→renderer push channel emitter. Production wires
   * `createProgressEmitter(getMainWindow)`; tests typically supply a
   * `vi.fn()` so they can assert on emitted events without needing
   * a real Electron BrowserWindow.
   */
  progressEmitter?: ProgressEmitter;
}
```

3. Updating the `extractionService` getter at the bottom to thread the emitter in. Find:
```ts
    get extractionService() {
      if (!extractionServiceInstance) {
        extractionServiceInstance = new ExtractionService({
          ...svc,
          documentService: getDocument(),
          settingsService: getSettings(),
          llmClient: getLlm(),
        });
      }
      return extractionServiceInstance;
    },
```
Replace with:
```ts
    get extractionService() {
      if (!extractionServiceInstance) {
        extractionServiceInstance = new ExtractionService({
          ...svc,
          documentService: getDocument(),
          settingsService: getSettings(),
          llmClient: getLlm(),
          emitProgress: overrides.progressEmitter,
        });
      }
      return extractionServiceInstance;
    },
```

- [ ] **Step 4: Verify TypeScript still compiles**

`emitProgress` is a new field on the `ExtractionService` constructor input that doesn't exist yet — that's expected. The next task adds it. Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: 1 error pointing at `emitProgress` not existing on the ExtractionService constructor signature. **Do not commit yet** — Task 9 below fixes this in the same commit.

(Skip commit; combined into Task 9's commit.)

---

## Task 9: `ExtractionService` — vision branch

**Files:**
- Modify: `src/main/services/extraction-service.ts`
- Test: `tests/main/services/extraction-service.test.ts`

- [ ] **Step 1: Add `StageDoesNotSupportVisionError` + `emitProgress` plumbing**

In `src/main/services/extraction-service.ts`, update the imports at the top:
```ts
import { readFileSync } from 'node:fs';
import { LLMClient } from '@main/llm/llm-client.js';
import { pdfToImages as pdfToImagesDefault } from '@main/llm/pdf-to-images.js';
import { getStage } from '@main/llm/stages/registry.js';
import { assertVisionCapable, VisionUnsupportedError } from '@main/llm/vision-capability.js';
import type { IpcPushTypeMap } from '@main/ipc/types.js';
import type { Extraction, ExtractionStatus } from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type { ServiceContext } from './base.js';
import type { DocumentService } from './document-service.js';
import type { SettingsService } from './settings-service.js';
```

(Note: `VisionUnsupportedError` is re-exported here so the renderer sanitize layer's instanceof check has a single import.)

Add a new error class right after `PdfNotReadableError`:
```ts
/**
 * Thrown when `ExtractionService.run()` switches to the vision branch
 * (because pdf-parse couldn't read the PDF) but the chosen stage
 * doesn't implement `buildVisionMessages`. Currently china_utility.v1
 * is the only stage with vision support; this exists for defensive
 * coding so adding a text-only future stage (e.g. an Excel parser)
 * fails with a clear message instead of a generic crash.
 *
 * Whitelisted by the IPC sanitize layer so the user sees a toast
 * with the stage id rather than a correlation id.
 */
export class StageDoesNotSupportVisionError extends Error {
  constructor(public readonly stageId: string) {
    super(
      `Stage "${stageId}" does not support image input yet. Upload a text-layer ` +
        `PDF or wait for a future version that adds vision support to this stage.`,
    );
    this.name = 'StageDoesNotSupportVisionError';
  }
}
```

Re-export `VisionUnsupportedError` from this file so `sanitize.ts` can import all three error classes from one place. Add immediately under the new class above:
```ts
export { VisionUnsupportedError } from '@main/llm/vision-capability.js';
```

Add the `PdfToImages` injectable type next to the existing `ParsePdf`:
```ts
/**
 * Injected PDF-to-images adapter shape. DI'd so tests can supply a
 * lightweight stub returning canned PNG buffers without touching
 * pdfjs-dist or canvas. Production wires the real `pdfToImages` from
 * `@main/llm/pdf-to-images`.
 */
export type PdfToImages = (bytes: Buffer) => Promise<Buffer[]>;
```

Update the `ExtractionService` constructor to accept the new dependencies. Find the existing class header:
```ts
export class ExtractionService {
  private readonly readFile: (path: string) => Buffer;
  private readonly parsePdf: ParsePdf;

  constructor(
    private readonly ctx: ServiceContext & {
      documentService: DocumentService;
      settingsService: SettingsService;
      llmClient: LLMClient;
      readFile?: (path: string) => Buffer;
      parsePdf?: ParsePdf;
    },
  ) {
    this.readFile = ctx.readFile ?? readFileSync;
    this.parsePdf = ctx.parsePdf ?? parsePdfDefault;
  }
```
Replace with:
```ts
export class ExtractionService {
  private readonly readFile: (path: string) => Buffer;
  private readonly parsePdf: ParsePdf;
  private readonly pdfToImages: PdfToImages;
  private readonly emitProgress?: <C extends keyof IpcPushTypeMap>(
    channel: C,
    payload: IpcPushTypeMap[C],
  ) => void;

  constructor(
    private readonly ctx: ServiceContext & {
      documentService: DocumentService;
      settingsService: SettingsService;
      llmClient: LLMClient;
      /** DI override for `node:fs.readFileSync`. Defaults to readFileSync. */
      readFile?: (path: string) => Buffer;
      /** DI override for PDF parsing. Defaults to `pdf-parse`. */
      parsePdf?: ParsePdf;
      /** DI override for PDF→PNG rendering. Defaults to `@main/llm/pdf-to-images`. */
      pdfToImages?: PdfToImages;
      /**
       * Main→renderer push emitter for `extraction:progress` events.
       * Optional: tests usually omit this, production wires the real
       * one from `createProgressEmitter(getMainWindow)`.
       */
      emitProgress?: <C extends keyof IpcPushTypeMap>(
        channel: C,
        payload: IpcPushTypeMap[C],
      ) => void;
    },
  ) {
    this.readFile = ctx.readFile ?? readFileSync;
    this.parsePdf = ctx.parsePdf ?? parsePdfDefault;
    this.pdfToImages = ctx.pdfToImages ?? pdfToImagesDefault;
    this.emitProgress = ctx.emitProgress;
  }
```

- [ ] **Step 2: Refactor `run()` to fall back to vision on `PdfNotReadableError`**

Find the existing `run()` method's PDF-read + threshold-check region (currently lines ~143-164 of the file):
```ts
    // Read + parse the PDF. The DI'd `readFile` lets tests provide bytes
    // without writing a real file; `parsePdf` lets them skip pdf.js entirely.
    const bytes = this.readFile(doc.storage_path);
    const pdf = await this.parsePdf(bytes);
    const pdfText = pdf.text;

    // ... (the comment block + threshold check + buildPrompt + extract) ...
    if (pdfText.trim().length < 10) {
      throw new PdfNotReadableError(doc.filename);
    }

    const prompt = stage.buildPrompt(pdfText);
    const result = await this.ctx.llmClient.extract(providerConfig.config, stage.schema, prompt);
```

Replace that block (everything from `// Read + parse the PDF.` down to and INCLUDING the `await this.ctx.llmClient.extract(...)` line) with:
```ts
    // Read + parse the PDF. The DI'd `readFile` lets tests provide bytes
    // without writing a real file; `parsePdf` lets them skip pdf.js entirely.
    const bytes = this.readFile(doc.storage_path);
    const pdf = await this.parsePdf(bytes);
    const pdfText = pdf.text;

    // Branch: text path (>=10 chars of extracted text) vs vision path.
    // The threshold of 10 chars reliably distinguishes text-layer PDFs
    // from image-only scans — see the original `PdfNotReadableError`
    // comment in Phase 1b. The vision branch handles every case the
    // text branch can't, throwing typed errors that the renderer
    // surfaces as actionable toasts:
    //   - VisionUnsupportedError: chosen model can't take images
    //   - StageDoesNotSupportVisionError: stage didn't opt into vision
    //   - SchemaMismatchError: model output didn't match schema
    let result: unknown;
    if (pdfText.trim().length >= 10) {
      const prompt = stage.buildPrompt(pdfText);
      result = await this.ctx.llmClient.extract(
        providerConfig.config,
        stage.schema,
        prompt,
      );
    } else {
      // Vision path. Validate prerequisites first so we don't burn
      // 5-10s rendering PDF pages only to find out the model can't
      // accept them.
      assertVisionCapable(providerConfig.config);
      if (!stage.buildVisionMessages) {
        throw new StageDoesNotSupportVisionError(stage.id);
      }

      // Best-effort UX hint: flip the renderer's spinner text from
      // "正在抽取…" to "正在识别图像（需要更长时间）…" so the user
      // knows why this run is slower. No-op if the renderer is closed.
      this.emitProgress?.('extraction:progress', {
        document_id: doc.id,
        phase: 'vision',
      });

      const images = await this.pdfToImages(bytes);
      const vision = stage.buildVisionMessages();
      result = await this.ctx.llmClient.extractWithImages(
        providerConfig.config,
        stage.schema,
        vision,
        images,
      );
    }
```

- [ ] **Step 3: Write the failing tests**

Open `tests/main/services/extraction-service.test.ts` and append the following block immediately before the final `});`:

```ts
  it('falls back to the vision path when pdf-parse returns empty text', async () => {
    h.cleanup();
    h = setupHarness();

    // Override the harness's `parsePdf` to return whitespace + provide a
    // stubbed `pdfToImages`. We re-build the ExtractionService with these
    // injected.
    const parsePdfSpy = vi.fn(async () => ({ text: '   ' }));
    const pdfToImagesSpy = vi.fn(async () => [Buffer.from([0x89, 0x50, 0x4e, 0x47])]);
    const extractWithImagesSpy = vi
      .fn()
      .mockResolvedValue(FAKE_EXTRACTION);
    const llmClient = {
      extract: vi.fn(),
      extractWithImages: extractWithImagesSpy,
    } as unknown as LLMClient;
    const emitProgressSpy = vi.fn();

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-11T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient,
      readFile: () => Buffer.from('pdf-bytes'),
      parsePdf: parsePdfSpy,
      pdfToImages: pdfToImagesSpy,
      emitProgress: emitProgressSpy,
    });

    const doc = uploadFakePdf(h.documentService);

    const ext = await h.extractionService.run({
      document_id: doc.id,
      stage_id: 'china_utility.v1',
    });

    expect(ext.status).toBe('review_needed');
    expect(JSON.parse(ext.parsed_json ?? '')).toEqual(FAKE_EXTRACTION);
    // Vision path actually walked through.
    expect(pdfToImagesSpy).toHaveBeenCalledTimes(1);
    expect(extractWithImagesSpy).toHaveBeenCalledTimes(1);
    expect(llmClient.extract).not.toHaveBeenCalled();
    // Progress event fired with the right doc id + phase.
    expect(emitProgressSpy).toHaveBeenCalledWith('extraction:progress', {
      document_id: doc.id,
      phase: 'vision',
    });
  });

  it('throws VisionUnsupportedError when vision is needed but the model can\'t take images', async () => {
    h.cleanup();
    h = setupHarness();

    // Settings says deepseek-chat — text-only model.
    h.settingsService = {
      getProviderConfigWithKey: vi.fn(() => ({
        config: {
          provider: 'deepseek' as const,
          model: 'deepseek-chat',
          apiKeyKeyref: 'llm.deepseek.apikey' as const,
        },
        apiKey: 'sk-fake',
      })),
    } as unknown as SettingsService;

    const pdfToImagesSpy = vi.fn(async () => [Buffer.from([0x89])]);
    const extractWithImagesSpy = vi.fn();
    const llmClient = {
      extract: vi.fn(),
      extractWithImages: extractWithImagesSpy,
    } as unknown as LLMClient;

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-11T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient,
      readFile: () => Buffer.from('pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: '   ' })),
      pdfToImages: pdfToImagesSpy,
    });

    const doc = uploadFakePdf(h.documentService);

    await expect(
      h.extractionService.run({ document_id: doc.id, stage_id: 'china_utility.v1' }),
    ).rejects.toBeInstanceOf(VisionUnsupportedError);
    // No rendering, no LLM call, no row written.
    expect(pdfToImagesSpy).not.toHaveBeenCalled();
    expect(extractWithImagesSpy).not.toHaveBeenCalled();
    const count = h.db.prepare('SELECT COUNT(*) AS c FROM extraction').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('throws StageDoesNotSupportVisionError when the stage has no buildVisionMessages', async () => {
    h.cleanup();
    h = setupHarness();

    // Register a temporary text-only stage so the test isolates the
    // missing-method case from the china-utility behavior.
    const textOnlyStageId = 'text_only_stage.test.v1';
    const textOnlyStage: Stage<{ ok: boolean }> = {
      id: textOnlyStageId,
      version: '0.0.0',
      description: 'test',
      inputType: 'pdf_text',
      schema: z.object({ ok: z.boolean() }),
      buildPrompt: () => 'noop',
      // intentionally no buildVisionMessages
    };
    registerStage(textOnlyStage);

    h.extractionService = new ExtractionService({
      db: h.db,
      now: () => '2026-05-11T00:00:00.000Z',
      documentService: h.documentService,
      settingsService: h.settingsService,
      llmClient: {
        extract: vi.fn(),
        extractWithImages: vi.fn(),
      } as unknown as LLMClient,
      readFile: () => Buffer.from('pdf-bytes'),
      parsePdf: vi.fn(async () => ({ text: '   ' })),
      pdfToImages: vi.fn(async () => [Buffer.from([0x89])]),
    });

    const doc = uploadFakePdf(h.documentService);

    await expect(
      h.extractionService.run({ document_id: doc.id, stage_id: textOnlyStageId }),
    ).rejects.toBeInstanceOf(StageDoesNotSupportVisionError);
  });
```

The new tests use `Stage`, `z`, `registerStage`, `ExtractionService`, `StageDoesNotSupportVisionError`, and `VisionUnsupportedError`. Update the import block at the top of the test file to include the new symbols. The existing imports look like:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import type { LLMClient } from '@main/llm/llm-client';
import type { ChinaUtilityExtraction } from '@main/llm/stages/china-utility';
import { DocumentService } from '@main/services/document-service';
import { ExtractionService } from '@main/services/extraction-service';
import type { SettingsService } from '@main/services/settings-service';
import type { Document, ProviderConfig } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
```

Replace with:
```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '@main/db/migrate';
import type { LLMClient } from '@main/llm/llm-client';
import type { ChinaUtilityExtraction } from '@main/llm/stages/china-utility';
import { registerStage } from '@main/llm/stages/registry';
import type { Stage } from '@main/llm/stages/types';
import { VisionUnsupportedError } from '@main/llm/vision-capability';
import { DocumentService } from '@main/services/document-service';
import {
  ExtractionService,
  StageDoesNotSupportVisionError,
} from '@main/services/extraction-service';
import type { SettingsService } from '@main/services/settings-service';
import type { Document, ProviderConfig } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
```

If `registerStage` doesn't already exist as a named export from `@main/llm/stages/registry`, add it:

Open `src/main/llm/stages/registry.ts` and ensure it exports a `registerStage` helper. If `registry.ts` only exports `getStage`, add this immediately after `getStage`:
```ts
/**
 * Test helper — registers a stage at runtime so tests can verify the
 * orchestrator's behavior on stages that aren't part of the default
 * registry. Not exported in production code paths.
 */
export function registerStage<T>(stage: Stage<T>): void {
  stageRegistry.set(stage.id, stage);
}
```
(Adjust the body to match how the registry actually stores stages — if it's a `Map`, use `.set(stage.id, stage)`; if it's an object, use `stageRegistry[stage.id] = stage`.)

- [ ] **Step 4: Run tests to verify they fail then pass**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/services/extraction-service.test.ts --pool=threads
```
Expected after step 3: PASS — all 14 existing tests + 3 new ones (17 total).

If any of the 3 new tests fail, debug the implementation in `extraction-service.ts` Step 2 — the most likely culprit is mis-ordered `assertVisionCapable` / stage check / `emitProgress` / `pdfToImages` calls.

- [ ] **Step 5: Run the full vitest suite to confirm no regressions**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
```
Expected: all 290+ tests pass (288 from phase-1b + 3 new extraction-service + 2 new llm-client + 1 new china-utility + 3 new progress + 8 new vision-capability + 2 new pdf-to-images).

- [ ] **Step 6: Commit (combined with Task 8's typecheck-incomplete state)**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/services/extraction-service.ts src/main/llm/stages/registry.ts \
        src/main/window.ts src/main/ipc/setup.ts src/main/ipc/context.ts \
        tests/main/services/extraction-service.test.ts
git commit -m "feat(extraction): vision branch on PdfNotReadableError + progress emitter wiring"
```

---

## Task 10: Sanitize layer — whitelist the two new error classes

**Files:**
- Modify: `src/main/ipc/sanitize.ts`

- [ ] **Step 1: Update the whitelist**

Replace the existing instanceof check block in `src/main/ipc/sanitize.ts`. Find:
```ts
      // Whitelist of user-actionable errors. Their messages are already safe
      // for renderer display (no SQL / FS paths / API keys).
      if (
        err instanceof ProviderNotConfiguredError ||
        err instanceof SchemaMismatchError ||
        err instanceof PdfNotReadableError
      ) {
        // Still log server-side for support / debugging.
        console.error(`[ipc:${channel}] ${err.name}`, err);
        throw new Error(err.message);
      }
```

Replace with:
```ts
      // Whitelist of user-actionable errors. Their messages are already safe
      // for renderer display (no SQL / FS paths / API keys).
      if (
        err instanceof ProviderNotConfiguredError ||
        err instanceof SchemaMismatchError ||
        err instanceof PdfNotReadableError ||
        err instanceof VisionUnsupportedError ||
        err instanceof StageDoesNotSupportVisionError
      ) {
        // Still log server-side for support / debugging.
        console.error(`[ipc:${channel}] ${err.name}`, err);
        throw new Error(err.message);
      }
```

Then add the imports at the top. The existing import block is:
```ts
import { randomUUID } from 'node:crypto';
import { ProviderNotConfiguredError, SchemaMismatchError } from '@main/llm/llm-client.js';
import { PdfNotReadableError } from '@main/services/extraction-service.js';
import { z } from 'zod';
```

Replace with:
```ts
import { randomUUID } from 'node:crypto';
import { ProviderNotConfiguredError, SchemaMismatchError } from '@main/llm/llm-client.js';
import {
  PdfNotReadableError,
  StageDoesNotSupportVisionError,
  VisionUnsupportedError,
} from '@main/services/extraction-service.js';
import { z } from 'zod';
```

- [ ] **Step 2: Verify TypeScript + lint pass**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck && pnpm vitest run tests/main/services/extraction-service.test.ts --pool=threads
```
Expected: clean typecheck; existing tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/main/ipc/sanitize.ts
git commit -m "fix(ipc): whitelist VisionUnsupportedError + StageDoesNotSupportVisionError"
```

---

## Task 11: Preload bridge — `subscribe` API + push-channel allowlist

**Files:**
- Modify: `src/preload/bridge.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/preload/bridge.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/preload/bridge.test.ts` and append a new `describe('createBridge subscribe', ...)` block. The full test additions:

```ts
describe('createBridge subscribe (Phase 1c push channels)', () => {
  it('subscribes via the supplied subscribeFn and returns an unsubscribe function', () => {
    const subscribeFn = vi.fn();
    const bridge = createBridge(vi.fn(), subscribeFn);
    const callback = vi.fn();

    const unsubscribe = bridge.subscribe('extraction:progress', callback);

    expect(subscribeFn).toHaveBeenCalledWith('extraction:progress', expect.any(Function));
    expect(typeof unsubscribe).toBe('function');
  });

  it('rejects subscribe on channels not in the push allowlist', () => {
    const bridge = createBridge(vi.fn(), vi.fn());
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing runtime rejection
      bridge.subscribe('extraction:run' as any, vi.fn()),
    ).toThrow(/not allowed/);
  });

  it('the subscribeFn callback is invoked with the payload only (no Electron event)', () => {
    let capturedInnerHandler: ((event: unknown, payload: unknown) => void) | undefined;
    const subscribeFn = vi.fn((_channel: string, inner: (event: unknown, payload: unknown) => void) => {
      capturedInnerHandler = inner;
      return () => {};
    });
    const bridge = createBridge(vi.fn(), subscribeFn);
    const callback = vi.fn();

    bridge.subscribe('extraction:progress', callback);
    // Simulate Electron firing the event:
    capturedInnerHandler?.({ /* fake IpcRendererEvent */ }, { document_id: 'd', phase: 'vision' });

    expect(callback).toHaveBeenCalledWith({ document_id: 'd', phase: 'vision' });
    // The Electron event itself never reaches the renderer-supplied callback.
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/preload/bridge.test.ts --pool=threads
```
Expected: FAIL — `createBridge` currently only takes one argument.

- [ ] **Step 3: Add `subscribe` to the bridge**

Replace the entirety of `src/preload/bridge.ts` with:
```ts
import type { IpcPushTypeMap, IpcTypeMap } from '@main/ipc/types.js';

export const allowedChannels: ReadonlyArray<keyof IpcTypeMap> = [
  // organization domain
  'org:has-any',
  'org:get-current',
  'org:get-by-id',
  'org:create',
  'org:list-sites',
  'org:create-site',
  'org:list-reporting-periods',
  'org:create-reporting-period',
  'org:complete-onboarding',
  // ef-library domain (read-only catalog)
  'ef:list',
  'ef:get-by-pk',
  'units:list',
  // emission-source domain
  'source:create',
  'source:get-by-id',
  'source:list-by-site',
  'source:list-by-org',
  'source:update',
  'source:delete',
  // activity-data domain
  'activity:create',
  'activity:list-by-period',
  'activity:totals-by-period',
  // settings domain (Phase 1b — LLM provider config)
  'settings:available',
  'settings:get-provider',
  'settings:save-provider',
  'settings:clear-provider',
  'settings:ping-provider',
  // document domain (Phase 1b — uploaded source files)
  'document:upload',
  'document:list',
  'document:get-by-id',
  'document:read-bytes',
  // extraction domain (Phase 1b — AI extraction pipeline)
  'extraction:run',
  'extraction:list-pending',
  'extraction:list-by-document',
  'extraction:list-statuses',
  'extraction:get-by-id',
  'extraction:confirm',
  'extraction:discard',
  // stages domain (Phase 1b — read-only extraction stage registry)
  'stages:list',
];

/**
 * Whitelist of push channels (main→renderer events via webContents.send).
 * Subscribe-side counterpart to `allowedChannels`. Keep aligned with
 * `IpcPushTypeMap` keys in `src/main/ipc/types.ts`.
 */
export const allowedPushChannels: ReadonlyArray<keyof IpcPushTypeMap> = [
  'extraction:progress',
];

export type InvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Preload-side subscribe primitive. Implementations wire to
 * `ipcRenderer.on` + return a cleanup that calls `removeListener`.
 *
 * The handler signature mirrors Electron's: receives the event object
 * (which we never pass through) plus the payload. The bridge translates
 * this to a payload-only callback on the renderer side.
 */
export type SubscribeFn = (
  channel: string,
  handler: (event: unknown, payload: unknown) => void,
) => () => void;

export interface IpcBridge {
  invoke<C extends keyof IpcTypeMap & string>(
    channel: C,
    ...args: Parameters<IpcTypeMap[C]>
  ): Promise<ReturnType<IpcTypeMap[C]>>;
  /**
   * Subscribe to a main→renderer push channel. Returns an unsubscribe
   * function that detaches the listener.
   */
  subscribe<C extends keyof IpcPushTypeMap & string>(
    channel: C,
    callback: (payload: IpcPushTypeMap[C]) => void,
  ): () => void;
}

/**
 * Builds the bridge object exposed to the renderer. Extracted from
 * `src/preload/index.ts` so the channel-allowlist gate can be unit-tested
 * without bundling the preload script through Electron.
 */
export function createBridge(invokeFn: InvokeFn, subscribeFn: SubscribeFn): IpcBridge {
  return {
    invoke<C extends keyof IpcTypeMap & string>(
      channel: C,
      ...args: Parameters<IpcTypeMap[C]>
    ): Promise<ReturnType<IpcTypeMap[C]>> {
      if (!allowedChannels.includes(channel)) {
        return Promise.reject(new Error(`IPC channel not allowed: ${String(channel)}`));
      }
      return invokeFn(channel, ...args) as Promise<ReturnType<IpcTypeMap[C]>>;
    },
    subscribe<C extends keyof IpcPushTypeMap & string>(
      channel: C,
      callback: (payload: IpcPushTypeMap[C]) => void,
    ): () => void {
      if (!allowedPushChannels.includes(channel)) {
        throw new Error(`IPC push channel not allowed: ${String(channel)}`);
      }
      return subscribeFn(channel, (_event, payload) => {
        callback(payload as IpcPushTypeMap[C]);
      });
    },
  };
}
```

- [ ] **Step 4: Wire the real `subscribeFn` in `src/preload/index.ts`**

Replace `src/preload/index.ts` with:
```ts
import { contextBridge, ipcRenderer } from 'electron';
import { createBridge, type IpcBridge } from './bridge.js';

contextBridge.exposeInMainWorld(
  'ipc',
  createBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (channel, handler) => {
      // Wrapping the listener so we hand back a one-shot
      // unsubscribe that calls `removeListener` with the SAME
      // function reference Electron is holding. Returning the raw
      // `on` listener would force callers to track it themselves.
      ipcRenderer.on(channel, handler);
      return () => {
        ipcRenderer.removeListener(channel, handler);
      };
    },
  ),
);

export type { IpcBridge };
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/preload/bridge.test.ts --pool=threads
```
Expected: all bridge tests pass (including the 3 new subscribe tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/preload/bridge.ts src/preload/index.ts tests/preload/bridge.test.ts
git commit -m "feat(preload): subscribe API for main→renderer push channels"
```

---

## Task 12: Renderer `subscribe` helper

**Files:**
- Modify: `src/renderer/lib/ipc.ts`

- [ ] **Step 1: Add `subscribe` to the renderer-side wrapper**

Replace `src/renderer/lib/ipc.ts` with:
```ts
import type { IpcPushTypeMap, IpcTypeMap } from '@main/ipc/types.js';

/**
 * Type-safe wrapper around window.ipc.invoke.
 *
 * Prefer the per-domain wrappers in src/renderer/lib/api/<domain>.ts —
 * they give callers nice function names (e.g. orgApi.create) and let
 * domains evolve independently. This generic invoke is the foundation.
 */
export function invoke<C extends keyof IpcTypeMap>(
  channel: C,
  ...args: Parameters<IpcTypeMap[C]>
): Promise<ReturnType<IpcTypeMap[C]>> {
  if (!window.ipc) {
    throw new Error('window.ipc not available — preload script not loaded?');
  }
  return window.ipc.invoke(channel, ...args);
}

/**
 * Type-safe wrapper around window.ipc.subscribe. Subscribes to a
 * main→renderer push channel and returns an unsubscribe function.
 *
 * Typical use inside a React component:
 *   useEffect(() => subscribe('extraction:progress', (p) => { ... }), [...]);
 * — returning the unsubscribe directly from the effect ensures React
 * runs it on unmount.
 */
export function subscribe<C extends keyof IpcPushTypeMap & string>(
  channel: C,
  callback: (payload: IpcPushTypeMap[C]) => void,
): () => void {
  if (!window.ipc) {
    throw new Error('window.ipc not available — preload script not loaded?');
  }
  return window.ipc.subscribe(channel, callback);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/lib/ipc.ts
git commit -m "feat(renderer): subscribe helper for IPC push channels"
```

---

## Task 13: i18n strings for vision UX

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`

- [ ] **Step 1: Add new keys to en.json**

Open `messages/en.json` and add the following keys. Locate the existing `"documents_extracting": "Extracting…"` line and insert these immediately after it:
```json
  "documents_extracting_vision": "Recognizing image (longer wait)…",
  "documents_vision_unsupported": "Selected model can't read images",
  "documents_stage_no_vision": "Vision input not yet supported for this stage",
```

- [ ] **Step 2: Add new keys to zh-CN.json**

Open `messages/zh-CN.json` and add the same keys after the `"documents_extracting": "正在抽取…"` line:
```json
  "documents_extracting_vision": "正在识别图像（需要更长时间）…",
  "documents_vision_unsupported": "当前模型不支持读取图片",
  "documents_stage_no_vision": "此 stage 暂不支持图像输入",
```

- [ ] **Step 3: Verify paraglide regenerates without warnings**

Paraglide regenerates on the next `pnpm dev` / `pnpm build`. To verify the JSON files are valid quickly:
```bash
cd /Users/lxz/ws/personal/carbonbook
node -e "JSON.parse(require('fs').readFileSync('messages/en.json', 'utf8')); JSON.parse(require('fs').readFileSync('messages/zh-CN.json', 'utf8')); console.log('OK');"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add messages/en.json messages/zh-CN.json
git commit -m "feat(i18n): vision-mode UX strings for Phase 1c"
```

---

## Task 14: `DocumentsUpload` — subscribe + flip spinner text

**Files:**
- Modify: `src/renderer/components/DocumentsUpload.tsx`

- [ ] **Step 1: Update the component to subscribe + track phase**

Replace `src/renderer/components/DocumentsUpload.tsx` with:
```tsx
import { toast } from '@renderer/components/toast';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import { useQueryClient } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Phase 1b — drag-drop upload zone for source PDFs.
 *
 * Two-step pipeline per drop:
 *   1. `document:upload` — write file, dedupe by sha256, return a Document row.
 *   2. `extraction:run` (stage `china_utility.v1`) — parse PDF text → LLM →
 *      `extraction` row with `status='review_needed'`.
 *
 * Phase 1c — when the PDF has no text layer, `extraction:run` falls back
 * to the vision path on the main side and sends an `extraction:progress`
 * event with `{ phase: 'vision' }`. This component subscribes for the
 * current document id and flips the spinner copy from "Extracting…" to
 * "Recognizing image (longer wait)…" so the user knows why the call is
 * taking 10x longer than usual.
 *
 * Status state machine for the visual progress label:
 *   idle → uploading → extracting (→ extracting:vision on progress event) → done → idle
 *
 * Disabled state covers all non-idle states. The progress subscription
 * is scoped to the active upload's document id so a stale "switched
 * to vision" event from a previous file doesn't sneak into the next
 * one.
 */
type UploadState = 'idle' | 'uploading' | 'extracting' | 'done';

const ACCEPT = 'application/pdf';
const STAGE_ID = 'china_utility.v1';

export function DocumentsUpload() {
  const [state, setState] = useState<UploadState>('idle');
  const [visionPhase, setVisionPhase] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();

  // Subscribe to extraction:progress for the current activeDocId. The
  // subscription is per-doc so a slow vision call doesn't leak its
  // phase event into a subsequent upload. We return the unsubscribe
  // directly from the effect so React cleans up on doc change or unmount.
  useEffect(() => {
    if (!activeDocId) return;
    const unsubscribe = subscribe('extraction:progress', (payload) => {
      if (payload.document_id === activeDocId && payload.phase === 'vision') {
        setVisionPhase(true);
      }
    });
    return unsubscribe;
  }, [activeDocId]);

  async function handleFile(file: File): Promise<void> {
    if (state !== 'idle') return;
    if (file.type !== ACCEPT) {
      toast.error(m.documents_upload_failed(), {
        description: m.documents_upload_pdf_only(),
      });
      return;
    }

    setState('uploading');
    setVisionPhase(false);
    let doc: Awaited<ReturnType<typeof documentApi.upload>>;
    try {
      const buffer = await file.arrayBuffer();
      doc = await documentApi.upload({
        filename: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(buffer),
      });
      toast.success(m.documents_upload_success(), { description: file.name });
      await queryClient.invalidateQueries({ queryKey: ['document:list'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_upload_failed(), { description: msg });
      setState('idle');
      return;
    }

    setActiveDocId(doc.id);
    setState('extracting');
    try {
      await extractionApi.run({ document_id: doc.id, stage_id: STAGE_ID });
      toast.success(m.documents_extraction_done(), { description: file.name });
      await queryClient.invalidateQueries({ queryKey: ['document:list'] });
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', doc.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_extraction_failed(), { description: msg });
    } finally {
      setState('done');
      setTimeout(() => {
        setState('idle');
        setActiveDocId(null);
        setVisionPhase(false);
      }, 1200);
    }
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  }

  const disabled = state !== 'idle';
  const label =
    state === 'uploading'
      ? m.documents_uploading()
      : state === 'extracting'
        ? visionPhase
          ? m.documents_extracting_vision()
          : m.documents_extracting()
        : state === 'done'
          ? m.documents_upload_done()
          : m.documents_upload_hint();

  return (
    <label
      htmlFor="documents-upload-input"
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      data-state={state}
      data-dragging={isDragging || undefined}
      className={[
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-sm transition-colors',
        'hover:border-primary/60 hover:bg-muted/50',
        'data-[dragging]:border-primary data-[dragging]:bg-primary/5',
        disabled ? 'pointer-events-none opacity-60' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <UploadCloud className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-xs text-muted-foreground">{m.documents_upload_pdf_only()}</span>
      <input
        ref={inputRef}
        id="documents-upload-input"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={onFileChange}
      />
    </label>
  );
}
```

- [ ] **Step 2: Verify lint + typecheck pass**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck && pnpm lint --max-diagnostics=10
```
Expected: clean typecheck; lint may show 21 pre-existing warnings but **no new errors**.

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/components/DocumentsUpload.tsx
git commit -m "feat(ui): DocumentsUpload flips spinner to 'recognizing image' on vision phase event"
```

---

## Task 15: Document detail page — same spinner flip in `RunExtractionAction`

**Files:**
- Modify: `src/renderer/routes/documents_.$id.tsx`

- [ ] **Step 1: Subscribe + flip pending label**

Open `src/renderer/routes/documents_.$id.tsx`. Update the imports at the top to add `subscribe` from the ipc helper and `useState` from React. The existing imports are:
```ts
import { ExtractionReview } from '@renderer/components/ExtractionReview';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import * as m from '@renderer/paraglide/messages';
import type { Document, Extraction } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo } from 'react';
```

Replace with:
```ts
import { ExtractionReview } from '@renderer/components/ExtractionReview';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import type { Document, Extraction } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
```

Now update the `RunExtractionAction` component. Find its existing body:
```tsx
function RunExtractionAction({
  document,
  discardedHint,
}: {
  document: Document;
  discardedHint?: boolean;
}) {
  const queryClient = useQueryClient();
  const runExtraction = useMutation({
    mutationFn: () => extractionApi.run({ document_id: document.id, stage_id: STAGE_ID }),
    onSuccess: async () => {
      toast.success(m.documents_extraction_done(), { description: document.filename });
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', document.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_extraction_failed(), { description: msg });
    },
  });

  return (
```

Replace with:
```tsx
function RunExtractionAction({
  document,
  discardedHint,
}: {
  document: Document;
  discardedHint?: boolean;
}) {
  const queryClient = useQueryClient();
  const [visionPhase, setVisionPhase] = useState(false);

  // Subscribe while the mutation is in flight — we set visionPhase=true on
  // the matching extraction:progress event, then reset when the mutation
  // settles. Scoping by document id prevents a stale event from a
  // background extraction (e.g. user navigated back to /documents and
  // kicked off another run) from sneaking in.
  const runExtraction = useMutation({
    mutationFn: async () => {
      setVisionPhase(false);
      return extractionApi.run({ document_id: document.id, stage_id: STAGE_ID });
    },
    onSuccess: async () => {
      toast.success(m.documents_extraction_done(), { description: document.filename });
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', document.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_extraction_failed(), { description: msg });
    },
    onSettled: () => {
      setVisionPhase(false);
    },
  });

  useEffect(() => {
    if (!runExtraction.isPending) return;
    return subscribe('extraction:progress', (payload) => {
      if (payload.document_id === document.id && payload.phase === 'vision') {
        setVisionPhase(true);
      }
    });
  }, [runExtraction.isPending, document.id]);

  return (
```

Then update the existing button label expression. Find:
```tsx
        {runExtraction.isPending
          ? m.documents_extraction_running()
          : discardedHint
            ? m.documents_extraction_run_again()
            : m.documents_extraction_run_now()}
```
Replace with:
```tsx
        {runExtraction.isPending
          ? visionPhase
            ? m.documents_extracting_vision()
            : m.documents_extraction_running()
          : discardedHint
            ? m.documents_extraction_run_again()
            : m.documents_extraction_run_now()}
```

- [ ] **Step 2: Verify typecheck + lint pass**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck && pnpm lint --max-diagnostics=10
```
Expected: clean typecheck; no new lint errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add src/renderer/routes/documents_.$id.tsx
git commit -m "feat(ui): document detail RunExtractionAction flips label on vision phase event"
```

---

## Task 16: Full test suite + lint sweep

**Files:** None — verification only.

- [ ] **Step 1: Run the full vitest suite**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads
```
Expected: ≥299 tests passing (288 from phase-1b + 11 new from Phase 1c: 2 pdf-to-images + 8 vision-capability + 3 progress + 2 llm-client + 1 china-utility + 3 extraction-service + 3 bridge — net 22 new, less duplicate counts ≈ 11 net). Concretely, expect "Tests 299 passed (299)" or higher.

If any test fails, fix it before moving on — do not commit a red suite.

- [ ] **Step 2: Run typecheck**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
```
Expected: clean exit (no output).

- [ ] **Step 3: Run lint + format**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm format && pnpm lint --max-diagnostics=80
```
Expected: format may rewrite a few lines (commit them); lint shows only the pre-existing 21 `noNonNullAssertion` warnings and **0 errors**.

If format made changes, commit them:
```bash
cd /Users/lxz/ws/personal/carbonbook
git diff --stat
git add -A
git commit -m "chore: biome format pass for Phase 1c additions"
```

(If `git diff` shows no changes, skip the commit.)

---

## Task 17: Manual smoke verification (user gate before tagging)

**Files:** None — exec-and-observe with the user.

- [ ] **Step 1: Restart `pnpm dev` cleanly**

Tell the user to:
```bash
# in their existing pnpm dev terminal:
Ctrl+C
pnpm dev
```
Main process needs a full restart to pick up the new IPC channels + preload bridge changes. Renderer Cmd+R is **not enough**.

- [ ] **Step 2: Provide a scanned bill PDF for testing**

Ask the user to either:
- supply an actual scanned Chinese utility bill PDF (image-layer only), OR
- generate one by opening `/tmp/fake-utility-bill.html` in Chrome, printing to PDF, then **re-printing that PDF through Preview's "Export As..." > PDF > Quartz Filter > Black & White → 96 dpi** which strips the text layer.

- [ ] **Step 3: Verify the happy path**

Have the user:
1. Confirm Settings shows a vision-capable model (e.g. gpt-4o, claude-sonnet-4-5, deepseek-vl).
2. Drag the scanned PDF into `/documents` upload zone.
3. Observe: spinner shows "正在抽取…" briefly, then flips to "正在识别图像（需要更长时间）…".
4. After 5-15s, extraction completes; toast shows "抽取完成，待审核".
5. New row appears in the list with "待审核" amber chip.
6. Click into the doc detail page — fields populated with supplier/账户号/用电量/etc.
7. Confirm → ActivityForm prefilled → submit → dashboard CO2e increments.

- [ ] **Step 4: Verify the misconfigured-model path**

1. Open Settings, switch to `deepseek-chat` (or any non-vision model), Save.
2. Upload another scanned PDF.
3. Observe: toast surfaces "当前模型 deepseek-chat 不支持图像输入" (the full `VisionUnsupportedError.message`) with the suggestion to switch.

- [ ] **Step 5: Get user sign-off**

Ask the user to confirm both paths work. If anything misbehaves, debug; if both pass, proceed to Task 18.

---

## Task 18: Bump version + tag `phase-1c`

**Files:**
- Modify: `package.json` (version string)

- [ ] **Step 1: Bump the version**

Open `package.json` and change:
```json
  "version": "0.0.1-phase1b",
```
to:
```json
  "version": "0.0.1-phase1c",
```

- [ ] **Step 2: Commit + tag**

```bash
cd /Users/lxz/ws/personal/carbonbook
git add package.json
git commit -m "chore: bump version to 0.0.1-phase1c"

git tag -a phase-1c -m "$(cat <<'EOF'
Phase 1c — OCR fallback (vision-only)

Deliverable verified (user dev smoke):
- Upload scanned (image-layer) Chinese utility bill PDF → automatic
  vision fallback (no PdfNotReadableError dead-end) → china_utility.v1
  fields populated with confidence rating → Confirm flow runs end-to-end
  → dashboard CO2e total increments.
- Mid-flight spinner flips to "正在识别图像（需要更长时间）…" via
  extraction:progress webContents.send.
- Misconfigured non-vision model surfaces actionable
  VisionUnsupportedError toast pointing at Settings.

Scope: vision LLM only (no Tesseract, no streamObject, no PNG caching,
no extra extraction stages). Text path unchanged; PdfNotReadableError
is now caught locally and routed to vision branch (pdfToImages →
stage.buildVisionMessages → LLMClient.extractWithImages).

Infra:
- New deps: pdfjs-dist 5.4 (promoted from transitive) + @napi-rs/canvas
  0.1 for PDF→PNG rendering (200 DPI default).
- vision-capability.ts statically gates the 5 providers; openai-compat
  is permissive.
- Preload bridge gains a subscribe() API + push-channel allowlist for
  main→renderer events (extraction:progress is the first). Reusable
  for Phase 1d streamObject.
- Stage<T> interface gains optional buildVisionMessages?(); inputType
  stays 'pdf_text' as the text-capability declaration.
- ExtractionService.run() catches PdfNotReadableError locally and
  switches to vision branch; cache key unchanged.

299+ vitest tests pass.
EOF
)"
```

- [ ] **Step 3: Verify**

Run:
```bash
cd /Users/lxz/ws/personal/carbonbook
git tag -l "phase-*" && git log --oneline -3
```
Expected:
```
phase-0
phase-1a
phase-1b
phase-1c
```
and the version bump as the most recent commit.

Phase 1c shipped.
