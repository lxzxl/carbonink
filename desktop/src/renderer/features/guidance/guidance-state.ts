/**
 * In-app guidance ("功能性 wizard") — which tours the user has already seen.
 *
 * Storage: renderer localStorage, same layer as `carbonink.theme` and
 * `carbonink.locale`. Deliberately NOT the sqlite `setting` table: guidance
 * progress is a property of the person sitting at this machine, not of a
 * client workspace — switching accounts shouldn't replay the tours.
 *
 *   `carbonink.guidance.seen`     JSON array of TourId
 *   `carbonink.guidance.enabled`  '0' | '1' (default: on)
 *
 * Mutations dispatch `carbonink:guidance-changed` so the Settings section
 * can reflect the state without prop-drilling (mirrors `theme.ts`).
 */

/** Every guidance tour in the app. Order is display order in Settings. */
export const TOUR_IDS = [
  'questionnaires',
  'extraction',
  'answer-review',
  'ef-rebind',
  'report-export',
] as const;

export type TourId = (typeof TOUR_IDS)[number];

const SEEN_KEY = 'carbonink.guidance.seen';
const ENABLED_KEY = 'carbonink.guidance.enabled';
/**
 * Dev-only: ignore every seen flag so tours replay on each visit. Set it
 * from the devtools console (`guidance.always()`), not from the UI —
 * see `dev-tools.ts`.
 */
const DEV_ALWAYS_KEY = 'carbonink.guidance.dev_always';
const GUIDANCE_CHANGED_EVENT = 'carbonink:guidance-changed';
/**
 * Fired only when seen flags are cleared. Mounted tours listen for this
 * so "replay" takes effect on the current screen instead of only after
 * navigating away and back.
 */
const GUIDANCE_RESET_EVENT = 'carbonink:guidance-reset';

function hasStorage(): boolean {
  return typeof localStorage !== 'undefined';
}

/**
 * The master switch. Defaults to ON — a consultant's first run is exactly
 * when the tours pay for themselves.
 *
 * E2E runs are the one place we force it off: an auto-playing overlay
 * would cover every screenshot and eat the clicks of specs that never
 * asked for a tour (see `window.carbonink.suppressGuidance` in preload).
 */
export function isGuidanceEnabled(): boolean {
  if (typeof window !== 'undefined' && window.carbonink?.suppressGuidance) return false;
  if (!hasStorage()) return false;
  return localStorage.getItem(ENABLED_KEY) !== '0';
}

export function setGuidanceEnabled(enabled: boolean): void {
  if (hasStorage()) localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  emitChange();
}

/** Tour ids the user has finished, skipped, or closed. */
export function getSeenTours(): TourId[] {
  if (!hasStorage()) return [];
  const raw = localStorage.getItem(SEEN_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter to known ids so a stale key from a removed tour (or a
    // hand-edited value) can never crash a render.
    return parsed.filter((id): id is TourId =>
      (TOUR_IDS as readonly string[]).includes(id as string),
    );
  } catch {
    return [];
  }
}

export function hasSeenTour(id: TourId): boolean {
  if (isDevReplayAlwaysOn()) return false;
  return getSeenTours().includes(id);
}

/**
 * Dev-only escape hatch: replay every tour on every visit, so working on
 * guidance copy or anchors doesn't mean clearing localStorage after each
 * run. Always false in a production build.
 */
export function isDevReplayAlwaysOn(): boolean {
  if (!import.meta.env.DEV || !hasStorage()) return false;
  return localStorage.getItem(DEV_ALWAYS_KEY) === '1';
}

export function setDevReplayAlways(on: boolean): void {
  if (!import.meta.env.DEV || !hasStorage()) return;
  if (on) {
    localStorage.setItem(DEV_ALWAYS_KEY, '1');
  } else {
    localStorage.removeItem(DEV_ALWAYS_KEY);
  }
  emitChange();
  emitReset();
}

/**
 * Record a tour as seen. Idempotent — replaying a tour from Settings and
 * finishing it again must not duplicate the entry.
 */
export function markTourSeen(id: TourId): void {
  if (!hasStorage()) return;
  const seen = getSeenTours();
  if (seen.includes(id)) return;
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, id]));
  emitChange();
}

/** Clear every seen flag — "replay all guidance" in Settings. */
export function resetGuidance(): void {
  if (hasStorage()) localStorage.removeItem(SEEN_KEY);
  emitChange();
  emitReset();
}

/** Clear one tour's seen flag — the devtools `guidance.replay(id)`. */
export function unmarkTourSeen(id: TourId): void {
  if (!hasStorage()) return;
  const remaining = getSeenTours().filter((seen) => seen !== id);
  localStorage.setItem(SEEN_KEY, JSON.stringify(remaining));
  emitChange();
  emitReset();
}

export function subscribeToGuidanceChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(GUIDANCE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(GUIDANCE_CHANGED_EVENT, handler);
}

/**
 * Subscribe to "seen flags were cleared". Separate from the general
 * change event on purpose: mounted tours must NOT re-evaluate when a
 * tour marks itself seen (that would fire while one is being dismissed).
 */
export function subscribeToGuidanceReset(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(GUIDANCE_RESET_EVENT, handler);
  return () => window.removeEventListener(GUIDANCE_RESET_EVENT, handler);
}

function emitChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUIDANCE_CHANGED_EVENT));
}

function emitReset(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUIDANCE_RESET_EVENT));
}
