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
