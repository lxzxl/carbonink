import {
  getSeenTours,
  hasSeenTour,
  isGuidanceEnabled,
  markTourSeen,
  resetGuidance,
  setGuidanceEnabled,
  subscribeToGuidanceChange,
  TOUR_IDS,
} from '@renderer/features/guidance';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guidance bookkeeping — the "play once, then never again" contract that
 * keeps the tours from becoming noise.
 */
describe('guidance state', () => {
  beforeEach(() => {
    localStorage.clear();
    window.carbonink = { suppressGuidance: false };
  });

  it('is enabled by default', () => {
    expect(isGuidanceEnabled()).toBe(true);
  });

  it('honors the master switch', () => {
    setGuidanceEnabled(false);
    expect(isGuidanceEnabled()).toBe(false);
    setGuidanceEnabled(true);
    expect(isGuidanceEnabled()).toBe(true);
  });

  it('stays off under E2E regardless of the stored preference', () => {
    setGuidanceEnabled(true);
    window.carbonink = { suppressGuidance: true };
    expect(isGuidanceEnabled()).toBe(false);
  });

  it('records a tour as seen exactly once', () => {
    expect(hasSeenTour('questionnaires')).toBe(false);
    markTourSeen('questionnaires');
    markTourSeen('questionnaires');
    expect(hasSeenTour('questionnaires')).toBe(true);
    expect(getSeenTours()).toEqual(['questionnaires']);
  });

  it('tracks tours independently', () => {
    markTourSeen('extraction');
    expect(hasSeenTour('extraction')).toBe(true);
    for (const id of TOUR_IDS.filter((t) => t !== 'extraction')) {
      expect(hasSeenTour(id)).toBe(false);
    }
  });

  it('replays everything after a reset', () => {
    markTourSeen('ef-rebind');
    markTourSeen('report-export');
    resetGuidance();
    expect(getSeenTours()).toEqual([]);
  });

  it('survives a corrupt or stale stored value', () => {
    localStorage.setItem('carbonink.guidance.seen', 'not json');
    expect(getSeenTours()).toEqual([]);
    // An id from a tour that no longer exists must not leak out typed.
    localStorage.setItem('carbonink.guidance.seen', '["questionnaires","retired-tour"]');
    expect(getSeenTours()).toEqual(['questionnaires']);
  });

  it('notifies subscribers on every mutation', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeToGuidanceChange(handler);
    markTourSeen('answer-review');
    setGuidanceEnabled(false);
    resetGuidance();
    expect(handler).toHaveBeenCalledTimes(3);
    unsubscribe();
    markTourSeen('extraction');
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
