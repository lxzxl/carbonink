import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getTour, TOUR_IDS } from '@renderer/features/guidance';
import { describe, expect, it } from 'vitest';

/**
 * Anchor guard.
 *
 * A tour whose selector no longer matches anything doesn't fail loudly —
 * it just never plays again (the runtime deliberately stays silent when
 * no anchor resolves). That's the failure mode a page re-layout will
 * cause, so pin every selector against the renderer source: each
 * `data-tour="…"` a tour points at must still be written somewhere.
 */

const RENDERER_SRC = resolve(__dirname, '../../src/renderer');

function collectSource(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Generated paraglide output and the route tree carry no anchors —
    // and `features/guidance` has to be excluded or the tour definitions
    // would satisfy their own selectors (the string lives there too).
    if (entry === 'paraglide' || entry === 'routeTree.gen.ts' || entry === 'guidance') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      collectSource(path, acc);
    } else if (path.endsWith('.tsx') || path.endsWith('.ts') || path.endsWith('.css')) {
      acc.push(readFileSync(path, 'utf8'));
    }
  }
  return acc;
}

const SOURCE = collectSource(RENDERER_SRC).join('\n');

describe('guidance anchors', () => {
  it.each(TOUR_IDS)('every %s step points at an anchor that still exists', (tourId) => {
    for (const step of getTour(tourId).steps) {
      const dataTour = step.target.match(/^\[data-tour="([^"]+)"\]$/)?.[1];
      if (dataTour) {
        expect(SOURCE, `${tourId}: data-tour="${dataTour}"`).toContain(`data-tour="${dataTour}"`);
        continue;
      }
      // The one non-`data-tour` anchor: a semantic class the report
      // preview (and the PDF renderer) already own.
      const className = step.target.match(/^\.([\w-]+)$/)?.[1];
      expect(className, `${tourId}: unrecognized selector ${step.target}`).toBeDefined();
      expect(SOURCE, `${tourId}: .${className}`).toContain(className as string);
    }
  });
});
