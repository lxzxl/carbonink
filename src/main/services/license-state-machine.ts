import type { LicenseJwtClaims, LicenseState } from '@shared/types.js';

export type ComputeLicenseStateInput = {
  /** Parsed JWT claims, or null when no license has ever been activated. */
  claims: LicenseJwtClaims | null;
  /** Current time, unix seconds. Injected for testability. */
  now: number;
  /** Unix seconds of the last successful cloud /verify, or null. */
  lastVerifiedAt: number | null;
  /** Counter of consecutive offline ping failures (in days). */
  consecutiveOfflineDays: number;
  /** Whether the last successful /verify returned `revoked: true`. */
  revoked: boolean;
};

export type ComputeLicenseStateResult = {
  state: LicenseState;
  /** Short human-readable explanation; surfaced in diagnostics / logs. */
  reason: string;
};

/**
 * Pure 4-state (5 with `unverified`) machine from design spec §10.
 * Priority order (highest first):
 *   1. revoked      → cloud said so, dominates everything else
 *   2. unverified   → no JWT at all
 *   3. expired      → either past grace_until OR offline > 30 days
 *   4. grace        → past expires_at but within grace_until
 *   5. active       → default healthy state
 *
 * Boundary: `now === expires_at` is treated as `grace` (the second after
 * the expiry moment). §10 says "active: now < expires_at" — strict.
 *
 * No I/O. Inject `now`, `lastVerifiedAt`, `consecutiveOfflineDays`,
 * `revoked` from the caller (LicenseService). This module exists so the
 * state mapping is a single function the team can audit in isolation.
 */
export function computeLicenseState(input: ComputeLicenseStateInput): ComputeLicenseStateResult {
  const { claims, now, consecutiveOfflineDays, revoked } = input;

  if (revoked) {
    return { state: 'revoked', reason: 'Cloud /verify returned revoked=true.' };
  }

  if (claims == null) {
    return {
      state: 'unverified',
      reason: 'No license JWT has been activated on this device.',
    };
  }

  // Offline-too-long trumps the time-based check. If the cloud hasn't been
  // reachable in over 30 days we can't trust the JWT's validity claims.
  if (consecutiveOfflineDays > 30) {
    return {
      state: 'expired',
      reason: `Offline for ${consecutiveOfflineDays} consecutive days (limit: 30).`,
    };
  }

  if (now >= claims.grace_until) {
    return {
      state: 'expired',
      reason: `Past grace period (now=${now}, grace_until=${claims.grace_until}).`,
    };
  }

  if (now >= claims.expires_at) {
    const daysRemaining = Math.max(0, Math.floor((claims.grace_until - now) / 86400));
    return {
      state: 'grace',
      reason: `In grace period — ${daysRemaining} day(s) until full expiry.`,
    };
  }

  return { state: 'active', reason: 'License is active.' };
}
