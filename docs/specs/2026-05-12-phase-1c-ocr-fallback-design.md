# Phase 1c — OCR fallback (vision-only) design

> Status: design approved through brainstorming session 2026-05-12.
> Next: `writing-plans` produces the implementation plan.

## §1 — Goal & scope

**Goal**: turn 1b's `PdfNotReadableError` dead-end into "automatically fall back to a vision LLM and keep extracting." Users uploading scanned / image-layer Chinese utility bills no longer have to "Print → Save as PDF with OCR" by hand before carbonbook can read the document.

**In scope**:

- Cheap-first routing: try `pdf-parse` (existing 1b text path) first; on `PdfNotReadableError`, switch to a multimodal LLM path.
- Local PDF→PNG rendering via `pdfjs-dist` + `@napi-rs/canvas`, all pages of the PDF in a single LLM call.
- The existing `china_utility.v1` stage gains a `buildVisionMessages()` method; `LLMClient` gains `extractWithImages()`.
- Provider/model capability gating: a static `VISION_CAPABLE_MODELS` map; if the user's chosen model can't take images, the renderer surfaces an actionable error pointing at Settings.
- Mid-flight UX feedback: when the pipeline switches to vision, an `extraction:progress` `webContents.send` event flips the renderer spinner text from "正在抽取…" to "正在识别图像（需要更长时间）…".

**Explicitly OUT of scope** (deferred to Phase 1d / Phase 2):

- Tesseract or any local-only OCR backend.
- `streamObject` progressive field rendering — same IPC `extraction:progress` channel will carry it in 1d.
- On-disk caching of rendered PNGs.
- Additional extraction stages (`fuel_receipt`, `freight`, …).
- EF Matcher v1 (FTS+LLM upgrade).
- Per-upload "force vision" or "text only" mode toggles in the UI.
- Multi-page truncation cap (default: render every page).

**Deliverable**: upload a scanned (image-layer) Chinese utility bill PDF → automatic vision fallback → `china_utility.v1` fields populated with `confidence` rating → Confirm flow runs end-to-end → dashboard CO2e total increments.

## §2 — Architecture

The Stage Registry pattern from 1b stays intact. The change is **inside `ExtractionService.run()`**: a try-catch on `PdfNotReadableError` now routes to a second pipeline branch instead of bubbling the error to the user.

```
                                       ┌────────────────────────────────────┐
                                       │ ExtractionService.run({doc,stage}) │
                                       └────────────────────────────────────┘
                                                       │
                                                       ▼
                                       ┌────────────────────────────────────┐
                                       │  pdf-parse (existing)              │
                                       │  text.trim().length >= 10?         │
                                       └─────────────────┬──────────────────┘
                                            yes ◄────────┴────────► no
                                             │                       │
                                             ▼                       ▼
                                ┌──────────────────────┐  ┌──────────────────────────────┐
                                │ stage.buildPrompt(t) │  │ pdfToImages(bytes, dpi=200)  │
                                │ llm.extract()        │  │ stage.buildVisionMessages()  │
                                │                      │  │ llm.extractWithImages()      │
                                └──────────┬───────────┘  └──────────────┬───────────────┘
                                           │                              │
                                           └──────────────┬───────────────┘
                                                          ▼
                                          ┌────────────────────────────────┐
                                          │ INSERT extraction              │
                                          │ status='review_needed'         │
                                          │ cache key unchanged            │
                                          └────────────────────────────────┘
```

**New components**:

| Module | Responsibility |
|---|---|
| `src/main/llm/pdf-to-images.ts` | Pure function: `(bytes: Buffer, opts?: { dpi?: number }) => Promise<Buffer[]>`. Wraps `pdfjs-dist` + `@napi-rs/canvas`. One PNG buffer per page. Default DPI 200. |
| `src/main/llm/vision-capability.ts` | Static map `VISION_CAPABLE_MODELS: Record<ProviderKind, ReadonlyArray<string> \| 'unknown'>`. Plus `assertVisionCapable(config: ProviderConfig)` that throws a whitelisted `VisionUnsupportedError`. |
| `ExtractionService.run()` | New try-catch around the text path; on `PdfNotReadableError` switches to vision pipeline. Emits an `extraction:progress` event when it switches. |
| `LLMClient.extractWithImages()` | New method. AI SDK 6 `generateObject({ model, schema, messages, mode: 'json' })` with multipart content (text + N image parts). |
| `Stage<T>` interface | Adds optional `buildVisionMessages?(): VisionMessages`. `china_utility.v1` implements it. Stages that don't implement it cause the vision path to throw `StageDoesNotSupportVisionError`. |

**Provider/model gating**:

```ts
// src/main/llm/vision-capability.ts
export const VISION_CAPABLE_MODELS: Record<ProviderKind, ReadonlyArray<string> | 'unknown'> = {
  openai:        ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  azure:         ['gpt-4o', 'gpt-4o-mini'],            // same model set, Azure naming
  anthropic:     ['claude-3-5-sonnet', 'claude-sonnet-4', 'claude-sonnet-4-5',
                  'claude-3-opus', 'claude-3-haiku'],
  deepseek:      ['deepseek-vl'],                       // NOT deepseek-chat
  'openai-compat': 'unknown',                            // user-configured, optimistic try
};
```

For `'openai-compat'` we don't know the backend, so we don't pre-gate — we let the API call attempt the request and surface the model's error if vision isn't supported.

## §3 — Data flow / sequence

1. **Upload**: `DocumentsUpload` posts PDF bytes via `document:upload`, gets back the doc, then fires `extraction:run`.
2. **Main process — `ExtractionService.run()`**:
   1. Cache check (unchanged): `(sha256, prompt_version, provider, model)` → hit returns existing row.
   2. `parsePdf(bytes)` → returns text.
   3. **If `text.trim().length >= 10`** (text path, unchanged 1b behavior):
      - `stage.buildPrompt(text)` → `llm.extract(config, schema, prompt)` → INSERT.
   4. **Else `PdfNotReadableError` is caught locally**:
      - **Gate**: `assertVisionCapable(providerConfig)` throws `VisionUnsupportedError` if the user's model isn't in `VISION_CAPABLE_MODELS`. The renderer's existing `sanitize` whitelist passes this through to a toast: "当前模型 {model} 不支持图像输入。请到设置切换到 gpt-4o / claude-sonnet-4-5 / deepseek-vl 等多模态模型后重试。"
      - **Gate**: `stage.buildVisionMessages` must be defined; otherwise throw `StageDoesNotSupportVisionError`.
      - **Emit progress**: `getRendererWebContents()?.send('extraction:progress', { document_id, phase: 'vision' })` — best-effort, no-op if renderer is closed.
      - `pdfToImages(bytes)` → `Buffer[]` (one PNG per page, base64 will be created at message-build time).
      - `stage.buildVisionMessages()` → `VisionMessages` (text instructions + placeholder for images).
      - `llm.extractWithImages(config, schema, messages, images)` → structured object.
      - INSERT with `prompt_version='china_utility.v1'` (unchanged), `raw_response = JSON.stringify(result)` (same as text path).

3. **Renderer**:
   - `DocumentsUpload` subscribes to `extraction:progress` (via the new preload bridge channel) for the current doc id, flips its spinner text on `phase: 'vision'`.
   - Same subscription on the document-detail page's `RunExtractionAction`.

4. **Error paths**:
   - `VisionUnsupportedError` → toast with actionable copy.
   - `StageDoesNotSupportVisionError` → toast: "{stage.id} 暂不支持图像输入，请上传文本层 PDF 或等待后续版本。" (1c only ships china_utility with vision, so this is defensive.)
   - Vision API call fails → existing `SchemaMismatchError` / `NoObjectGeneratedError` path. User sees the LLM's raw response preview and can discard / retry / switch model.

## §4 — Interface deltas

### `Stage<T>` (src/main/llm/stages/types.ts)

```ts
export type VisionMessages = {
  /** Top-level system / instruction text. */
  system?: string;
  /** User turn text content. Images are appended after this. */
  userText: string;
};

export interface Stage<T> {
  id: string;
  version: string;
  description: string;
  /** Phase 1b — text-layer PDF path. */
  inputType: 'pdf_text';
  schema: z.ZodSchema<T>;
  buildPrompt(input: string): string;
  /**
   * Phase 1c — image-input path. Optional: stages that don't define
   * this don't support vision fallback. Returns the text portion of
   * the multipart user message; ExtractionService appends image
   * parts before calling LLMClient.extractWithImages().
   */
  buildVisionMessages?(): VisionMessages;
}
```

`inputType: 'pdf_text'` stays as the **text capability** declaration. We are NOT renaming it to a union — vision support is announced via the presence of `buildVisionMessages`. This keeps the field meaning stable: "what input type does `buildPrompt` accept?"

### `LLMClient` (src/main/llm/llm-client.ts)

```ts
extract<T>(config: ProviderConfig, schema: ZodSchema<T>, prompt: string): Promise<T>;

extractWithImages<T>(
  config: ProviderConfig,
  schema: ZodSchema<T>,
  messages: VisionMessages,
  images: Buffer[],     // each will be base64-encoded into an image content part
): Promise<T>;
```

Internally `extractWithImages` constructs the multipart `messages: [{role: 'user', content: [{type:'text', text: userText}, ...imageParts]}]` and calls AI SDK 6's `generateObject({ model, schema, messages, mode: 'json' })`.

### IPC additions

- **No new invoke channel.** Existing `extraction:run` covers both branches.
- **New push event**: `extraction:progress` — `main → renderer` via `webContents.send`. Payload: `{ document_id: string, phase: 'vision' }`. Phase 1c only emits `'vision'`; payload kept open so Phase 1d streamObject can extend without a schema break.

### Preload bridge (src/preload/bridge.ts)

A separate `subscribe(channel, callback)` API for `main → renderer` push events. The existing `invoke(channel, args)` is request/response; we need a complementary `ipcRenderer.on()` wrapper guarded by an allowlist of push channels (initial allowlist: `['extraction:progress']`).

### New error classes (whitelisted in `sanitize.ts`)

- `VisionUnsupportedError(model: string, suggestion: string)` — `name: 'VisionUnsupportedError'`.
- `StageDoesNotSupportVisionError(stageId: string)` — `name: 'StageDoesNotSupportVisionError'`.

## §5 — UX delta from 1b

| Place | Before (1b) | After (1c) |
|---|---|---|
| `DocumentsUpload` while extracting | "正在抽取…" | Same. On `extraction:progress` `phase: 'vision'` → flips to "正在识别图像（需要更长时间）…" |
| Document detail page `[开始抽取]` button | "正在抽取…" while pending | Same flip on `phase: 'vision'`. |
| Scanned-PDF result | `PdfNotReadableError` toast — user blocked, has to re-export as text PDF | Automatic vision fallback. User sees extracted fields on success; on failure sees the actual model error (existing 1b paths). |
| Provider misconfigured for vision | N/A | `VisionUnsupportedError` toast pointing at Settings drawer with a list of vision-capable model names per provider. |

The documents-list status chip behavior from the previous round (Phase 1b late patches) is unchanged.

## §6 — Testing

### Unit tests (vitest, no real LLM)

1. **`pdf-to-images.test.ts`** — feed a fixture text PDF, assert N PNG buffers come out, each non-empty, valid PNG signature.
2. **`vision-capability.test.ts`** — `assertVisionCapable` accepts each whitelisted model, rejects unsupported ones, treats `'openai-compat'` as pass-through.
3. **`extraction-service.test.ts`** — three new cases:
   - PDF whose `parsePdf` returns `'   '` (whitespace) AND `buildVisionMessages` is defined → service calls `llm.extractWithImages` (verified via spy), INSERTs row with status `review_needed`.
   - Same setup but provider model is `deepseek-chat` → throws `VisionUnsupportedError`, no INSERT.
   - Same setup but stage has no `buildVisionMessages` → throws `StageDoesNotSupportVisionError`, no INSERT.
4. **`llm-client.test.ts`** — new case: `extractWithImages` builds the right multipart message shape (verify via mocked `generateObject`).
5. **`china-utility.test.ts`** — assert `buildVisionMessages()` returns a `VisionMessages` whose `userText` includes the Chinese-bill field-mapping rules verbatim.
6. **Preload bridge `subscribe`** — channels outside the allowlist reject; allowlisted channel returns an unsubscribe callback.

### Integration smoke (existing harness)

The existing `tests/main/services/extraction-service.test.ts` integration harness gets one extra case with a fake `parsePdf` returning empty text and a fake `pdfToImages` returning two stub buffers. Assert end-to-end the row lands as `review_needed` with parsed JSON.

### Manual smoke (user verification before tagging `phase-1c`)

- Upload a scanned bill PDF (image layer only) → automatic vision path → row appears in list with "待审核" chip → detail page shows extracted fields → Confirm → dashboard CO2e ticks up.
- Switch model to `deepseek-chat` in Settings, upload same scanned PDF → see "当前模型不支持图像输入" toast pointing to Settings.

Target: full vitest suite stays green (290+ tests after the new ones).

## §7 — Risks & open questions

| Risk | Mitigation |
|---|---|
| `@napi-rs/canvas` prebuilds don't match user's Electron arch | Test on macOS arm64 + Windows x64 in CI before tagging; fall back to documented `electron-rebuild` step if needed |
| pdfjs-dist Node-side rendering quirks (font rendering, embedded subsets) | Default DPI 200 leaves headroom; if a real bill renders garbled, bump to 300 DPI per-call |
| Large multi-page PDFs blow context window | YAGNI for 1c (electricity bills are 1-2 pages). Log token count from AI SDK; if any single page exceeds a soft cap, surface in toast and let user discard. Phase 1d adds page-cap policy if it bites. |
| OpenAI-compat provider with non-vision backend silently succeeds-then-errors | The provider's own error bubbles via existing `SchemaMismatchError` / `NoObjectGeneratedError` paths. Document this gap in the SettingsDrawer help text. |
| Renderer closed during long vision call leaks main-side state | `webContents.send` to a destroyed contents is a no-op (Electron handles); no extra cleanup needed |

## §8 — Out-of-scope work explicitly deferred

- **Phase 1d**: `streamObject` partial-JSON UI (reuses `extraction:progress` channel), on-disk PNG cache, additional stages (`fuel_receipt.v1`, `freight.v1`), Tesseract offline OCR alternative, page-cap policy for multi-page PDFs, per-upload "force vision" UI toggle.
- **Phase 2**: EF Matcher FTS+LLM v1, questionnaire pipeline.

These are listed so the writing-plans skill knows the boundary — anything not in §1 In-scope is a hard "no" for 1c.
