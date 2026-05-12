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
