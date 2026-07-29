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
const GUIDANCE_CHANGED_EVENT = 'carbonink:guidance-changed';

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
  return getSeenTours().includes(id);
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
}

export function subscribeToGuidanceChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(GUIDANCE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(GUIDANCE_CHANGED_EVENT, handler);
}

function emitChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUIDANCE_CHANGED_EVENT));
}
