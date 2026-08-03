import {
  type GuidanceDevTools,
  getSeenTours,
  hasSeenTour,
  installGuidanceDevTools,
  markTourSeen,
  setDevReplayAlways,
} from '@renderer/features/guidance';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The devtools escape hatch. A tour plays once and then never again —
 * right for users, tedious when you are writing one, so `window.guidance`
 * exists in dev builds to clear the flags without digging through
 * localStorage.
 *
 * (vitest runs with `import.meta.env.DEV` true, same as `pnpm dev`.)
 */
function tools(): GuidanceDevTools {
  const installed = (window as unknown as { guidance?: GuidanceDevTools }).guidance;
  if (!installed) throw new Error('guidance devtools not installed');
  return installed;
}

describe('guidance devtools', () => {
  beforeEach(() => {
    localStorage.clear();
    window.carbonink = { suppressGuidance: false };
    installGuidanceDevTools();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('installs nothing in a production build', () => {
    Reflect.deleteProperty(window, 'guidance');
    vi.stubEnv('DEV', false);

    installGuidanceDevTools();

    expect((window as unknown as { guidance?: GuidanceDevTools }).guidance).toBeUndefined();
  });

  it('never overrides seen flags in a production build', () => {
    markTourSeen('extraction');
    setDevReplayAlways(true);
    vi.stubEnv('DEV', false);

    expect(hasSeenTour('extraction')).toBe(true);
  });

  it('reports what is enabled, seen and always-on', () => {
    markTourSeen('extraction');
    const status = tools().status();
    expect(status.enabled).toBe(true);
    expect(status.seen).toEqual(['extraction']);
    expect(status.alwaysReplay).toBe(false);
    expect(status.tours).toContain('ef-rebind');
  });

  it('replays one tour without touching the others', () => {
    markTourSeen('extraction');
    markTourSeen('report-export');

    tools().replay('extraction');

    expect(hasSeenTour('extraction')).toBe(false);
    expect(hasSeenTour('report-export')).toBe(true);
  });

  it('replays everything when called with no argument', () => {
    markTourSeen('extraction');
    markTourSeen('report-export');

    tools().replay();

    expect(getSeenTours()).toEqual([]);
  });

  it('rejects an unknown tour id instead of silently doing nothing', () => {
    markTourSeen('extraction');

    const message = tools().replay('not-a-tour' as never);

    expect(message).toContain('unknown tour');
    expect(hasSeenTour('extraction')).toBe(true);
  });

  it('always-on ignores seen flags until switched back off', () => {
    markTourSeen('extraction');

    tools().always();
    expect(hasSeenTour('extraction')).toBe(false);
    // The flag itself is untouched — this only overrides the reading.
    expect(getSeenTours()).toEqual(['extraction']);

    tools().always(false);
    expect(hasSeenTour('extraction')).toBe(true);
  });

  it('leaves no always-replay state behind for the next screen', () => {
    setDevReplayAlways(true);
    setDevReplayAlways(false);
    expect(tools().status().alwaysReplay).toBe(false);
  });
});
