import { AiClientTag } from '@main/llm/ai-client.js';
import type { AiErr } from '@main/llm/errors.js';
import type { ClassifyAndRunResult } from '@shared/types.js';
import type { Database } from 'better-sqlite3';
import { Effect, Exit, type Layer } from 'effect';
import { z } from 'zod';
import type { DocumentService } from './document-service.js';
import type { ExtractionService } from './extraction-service.js';

/**
 * Minimum confidence score (inclusive) for the LLM classification to be
 * accepted. Results below this threshold collapse to `classify_failed` so
 * the renderer can prompt the user to pick a stage manually.
 */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Injected PDF-to-images adapter shape. Matches the shape already defined
 * in extraction-service.ts (kept in sync by convention, not re-exported
 * from there to keep deps unidirectional).
 */
type PdfToImages = (bytes: Buffer) => Promise<Buffer[]>;

/**
 * Schema + prompt for the doc_type classification step. Lifted from
 * `LLMClient.classifyDocument` so the AiClient stays a thin conduit —
 * services own their prompts. Confidence threshold lives at the
 * orchestration layer (CONFIDENCE_THRESHOLD above).
 */
const classifySchema = z.object({
  doc_type: z.enum([
    'china_utility.v1',
    'fuel_receipt.v1',
    'freight.v1',
    'purchase.v1',
    'travel.v1',
    'unknown',
  ]),
  confidence: z.number().min(0).max(1),
});

type ClassifyRaw = z.infer<typeof classifySchema>;

function buildClassifyPrompt(text: string): string {
  return `你是一名碳核算助理。请判断下面这份单据属于以下哪一类。如果不能确定（80% 以下），请返回 "unknown"。

类型清单：
- china_utility.v1: 中国电费缴费通知单 / 电网账单 (供电公司、户号、用电量 kWh、计费周期、应缴电费)
- fuel_receipt.v1: 加油发票 / 燃油票 (加油站、油品类型、升数、单价、车牌号)
- freight.v1: 货物运输发票 / 物流单 (承运方、运输方式、起运地、到达地、货物重量、运费)
- purchase.v1: 采购发票 / 增值税发票 (销售方、商品名称、数量、金额)
- travel.v1: 差旅票据 / 机票 / 高铁票 / 出租车票 (承运方、旅客、出发地、目的地、舱位)

<document>
${text || '(no parsed text — see attached images)'}
</document>

返回 JSON: { doc_type: <类型 ID 或 "unknown">, confidence: <0..1 的浮点数> }`;
}

/**
 * Effect-returning core: build prompt + call AiClient. Wrapped by
 * `classifyAndRun` which provides the AiClient layer and collapses any
 * AiErr to the `classify_failed` shape.
 *
 * Exposed as a free function (rather than a class method) so consumers
 * compose with `Effect.provide(aiLayer)` the same way they do for
 * answer-generation. Returns `{doc_type: null, confidence: 0}` when there
 * is no text and no images — the LLM isn't worth calling in that case.
 */
export function classify(args: {
  parsedText: string | null;
  images: Buffer[];
}): Effect.Effect<{ doc_type: string | null; confidence: number }, AiErr, AiClientTag> {
  return Effect.gen(function* () {
    const text = (args.parsedText ?? '').trim();
    if (!text && args.images.length === 0) {
      return { doc_type: null, confidence: 0 };
    }
    const ai = yield* AiClientTag;
    const prompt = buildClassifyPrompt(text);
    // AiClient.generateObject accepts an optional `images` arg; the pi-ai
    // wiring will use it once vision support lands (tracked in Task 8). For
    // text-layer PDFs (the common path) we send only the prompt and the
    // model returns a valid classification today.
    const result: ClassifyRaw = yield* ai.generateObject({
      schema: classifySchema,
      prompt,
      ...(args.images.length > 0 ? { images: args.images } : {}),
    });
    return {
      doc_type: result.doc_type === 'unknown' ? null : result.doc_type,
      confidence: result.confidence,
    };
  });
}

/**
 * Orchestrates the lazy classify-and-run pipeline:
 *   1. Read document; if doc_type already set → skip to step 4.
 *   2. Read PDF + parse text (+ render to images if no text layer).
 *   3. Run `classify` Effect against the injected AiClient layer; apply
 *      confidence threshold.
 *   4. If classified: write doc_type back, route to ExtractionService.run.
 *   5. Otherwise: return { status: 'classify_failed' }; renderer prompts
 *      for manual stage pick.
 *
 * Any failure mode (missing doc, parse error, AiErr, low confidence)
 * collapses to classify_failed. The renderer never sees an exception from
 * this service — only the discriminated-union result. This collapse-to-
 * classify_failed semantics is why we keep `classifyAndRun` as a
 * Promise-returning method instead of propagating typed errors through
 * IPC: the renderer has no UI for distinguishing "LLM timeout" vs "low
 * confidence" — both surface the same manual stage-picker affordance.
 */
export class ClassificationService {
  constructor(
    private readonly deps: {
      db: Database;
      aiLayer: Layer.Layer<AiClientTag>;
      extractionService: ExtractionService;
      documentService: DocumentService;
      readFile: (path: string) => Buffer;
      parsePdf: (buf: Buffer) => Promise<{ text: string }>;
      pdfToImages?: PdfToImages;
    },
  ) {}

  async classifyAndRun(documentId: string): Promise<ClassifyAndRunResult> {
    const doc = this.deps.documentService.getById(documentId);
    if (!doc) {
      return { status: 'classify_failed' };
    }

    let docType: string | null = doc.doc_type;

    if (!docType) {
      // Need to classify. Read + parse the PDF.
      let parsedText = '';
      let images: Buffer[] = [];
      try {
        const buf = this.deps.readFile(doc.storage_path);
        const parsed = await this.deps.parsePdf(buf);
        parsedText = parsed.text ?? '';
        if (!parsedText.trim() && this.deps.pdfToImages) {
          images = await this.deps.pdfToImages(buf);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[classify] PDF read/parse failed:', err instanceof Error ? err.message : err);
        return { status: 'classify_failed' };
      }

      // Run the Effect at the orchestration boundary. Any AiErr collapses
      // to classify_failed — see the class doc above for the rationale.
      // `runPromiseExit` (not `runPromise`) avoids throwing across the
      // boundary; we inspect `Exit` and log the failure tag for triage.
      const exit = await Effect.runPromiseExit(
        classify({ parsedText, images }).pipe(Effect.provide(this.deps.aiLayer)),
      );
      if (Exit.isFailure(exit)) {
        // eslint-disable-next-line no-console
        console.warn('[classify] AI call failed; collapsing to classify_failed');
        return { status: 'classify_failed' };
      }
      const result = exit.value;

      if (!result.doc_type || result.confidence < CONFIDENCE_THRESHOLD) {
        return { status: 'classify_failed' };
      }

      docType = result.doc_type;
      this.deps.documentService.updateDocType(documentId, docType);
    }

    // doc_type is now set (cached on the row OR freshly classified).
    const extraction = await this.deps.extractionService.run({
      document_id: documentId,
      stage_id: docType,
    });

    return { status: 'classified', extraction, doc_type: docType };
  }
}
