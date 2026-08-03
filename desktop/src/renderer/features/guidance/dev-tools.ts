import {
  getSeenTours,
  isDevReplayAlwaysOn,
  isGuidanceEnabled,
  resetGuidance,
  setDevReplayAlways,
  TOUR_IDS,
  type TourId,
  unmarkTourSeen,
} from './guidance-state';

/**
 * Devtools console helpers for working on guidance tours.
 *
 * A tour plays once and then never again — correct for users, tedious
 * when you are the one writing it, since every run means digging the
 * seen flag out of localStorage. These give the same escape hatch from
 * the console:
 *
 *   guidance.status()               what's enabled / seen / always-on
 *   guidance.replay()               clear every seen flag
 *   guidance.replay('ef-rebind')    clear one
 *   guidance.always()               replay on every visit (dev only)
 *   guidance.always(false)          back to play-once
 *
 * `replay()` takes effect on the screen you are already on — mounted
 * tours listen for the reset. Dev builds only; `installGuidanceDevTools`
 * is a no-op in production.
 */

export interface GuidanceDevTools {
  status: () => {
    enabled: boolean;
    seen: TourId[];
    alwaysReplay: boolean;
    tours: readonly TourId[];
  };
  replay: (id?: TourId) => string;
  always: (on?: boolean) => string;
}

export function installGuidanceDevTools(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;

  const tools: GuidanceDevTools = {
    status: () => ({
      enabled: isGuidanceEnabled(),
      seen: getSeenTours(),
      alwaysReplay: isDevReplayAlwaysOn(),
      tours: TOUR_IDS,
    }),
    replay: (id) => {
      if (id === undefined) {
        resetGuidance();
        return 'guidance: all tours will play again';
      }
      if (!(TOUR_IDS as readonly string[]).includes(id)) {
        return `guidance: unknown tour "${id}" — one of ${TOUR_IDS.join(', ')}`;
      }
      unmarkTourSeen(id);
      return `guidance: "${id}" will play again`;
    },
    always: (on = true) => {
      setDevReplayAlways(on);
      return on
        ? 'guidance: replaying on every visit (dev only) — guidance.always(false) to stop'
        : 'guidance: back to play-once';
    },
  };

  (window as unknown as { guidance: GuidanceDevTools }).guidance = tools;
}
