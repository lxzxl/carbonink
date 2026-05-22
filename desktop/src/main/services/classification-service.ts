import type { LLMClient } from '@main/llm/llm-client.js';
import type { ClassifyAndRunResult, ProviderConfig } from '@shared/types.js';
import type { Database } from 'better-sqlite3';
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
 * Orchestrates the lazy classify-and-run pipeline:
 *   1. Read document; if doc_type already set → skip to step 4.
 *   2. Read PDF + parse text (+ render to images if no text layer).
 *   3. Call LLMClient.classifyDocument; apply confidence threshold.
 *   4. If classified: write doc_type back, route to ExtractionService.run.
 *   5. Otherwise: return { status: 'classify_failed' }; renderer prompts
 *      for manual stage pick.
 *
 * Any failure mode (missing doc, parse error, LLM throw, low confidence)
 * collapses to classify_failed. The renderer never sees an exception from
 * this service — only the discriminated-union result.
 */
export class ClassificationService {
  constructor(
    private readonly deps: {
      db: Database;
      llmClient: LLMClient;
      extractionService: ExtractionService;
      documentService: DocumentService;
      config: ProviderConfig;
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

      let result: { doc_type: string | null; confidence: number };
      try {
        result = await this.deps.llmClient.classifyDocument(this.deps.config, parsedText, images);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[classify] LLM call failed:', err instanceof Error ? err.message : err);
        return { status: 'classify_failed' };
      }

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
