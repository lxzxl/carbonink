import { computeLicenseState } from '@main/services/license-state-machine';
import type { LicenseJwtClaims } from '@shared/types';
import { describe, expect, it } from 'vitest';

/**
 * Pure-function tests for the license state machine. No DB, no Keychain,
 * no signature work. Just the (claims × time × offline-counter × revoked)
 * → state mapping from design spec §10.
 */

const NOW = Math.floor(Date.parse('2026-06-01T00:00:00Z') / 1000);

function makeClaims(overrides: Partial<LicenseJwtClaims> = {}): LicenseJwtClaims {
  return {
    iss: 'carbonink.xyz',
    license_id: 'lic_test',
    user_id: 'usr_test',
    plan: 'base@2026-q2',
    features: ['inventory', 'questionnaire', 'iso14064'],
    devices_max: 1,
    issued_at: NOW - 86400 * 30,
    expires_at: NOW + 86400 * 30, // 30 days away
    grace_until: NOW + 86400 * 60, // 60 days away (expires + 30)
    revocation_check_after: NOW + 86400 * 7,
    ...overrides,
  };
}

describe('computeLicenseState', () => {
  it('returns "active" when now < expires_at and not offline-stuck', () => {
    const r = computeLicenseState({
      claims: makeClaims(),
      now: NOW,
      lastVerifiedAt: NOW - 86400,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    expect(r.state).toBe('active');
  });

  it('returns "grace" when expires_at <= now < grace_until', () => {
    const r = computeLicenseState({
      claims: makeClaims({ expires_at: NOW - 86400, grace_until: NOW + 86400 * 29 }),
      now: NOW,
      lastVerifiedAt: NOW - 86400,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    expect(r.state).toBe('grace');
  });

  it('returns "expired" when now >= grace_until', () => {
    const r = computeLicenseState({
      claims: makeClaims({
        expires_at: NOW - 86400 * 35,
        grace_until: NOW - 86400 * 5,
      }),
      now: NOW,
      lastVerifiedAt: NOW - 86400 * 5,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    expect(r.state).toBe('expired');
  });

  it('returns "expired" when consecutiveOfflineDays > 30 regardless of expires_at', () => {
    const r = computeLicenseState({
      claims: makeClaims(),
      now: NOW,
      lastVerifiedAt: NOW - 86400 * 35,
      consecutiveOfflineDays: 35,
      revoked: false,
    });
    expect(r.state).toBe('expired');
  });

  it('returns "revoked" any time revoked === true (overrides everything)', () => {
    const r = computeLicenseState({
      claims: makeClaims(),
      now: NOW,
      lastVerifiedAt: NOW - 86400,
      consecutiveOfflineDays: 0,
      revoked: true,
    });
    expect(r.state).toBe('revoked');
  });

  it('returns "unverified" when claims === null', () => {
    const r = computeLicenseState({
      claims: null,
      now: NOW,
      lastVerifiedAt: null,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    expect(r.state).toBe('unverified');
  });

  it('attaches a non-empty reason string to every result', () => {
    const cases: Array<Parameters<typeof computeLicenseState>[0]> = [
      {
        claims: null,
        now: NOW,
        lastVerifiedAt: null,
        consecutiveOfflineDays: 0,
        revoked: false,
      },
      {
        claims: makeClaims(),
        now: NOW,
        lastVerifiedAt: NOW,
        consecutiveOfflineDays: 0,
        revoked: true,
      },
      {
        claims: makeClaims({ expires_at: NOW - 86400, grace_until: NOW + 86400 }),
        now: NOW,
        lastVerifiedAt: NOW,
        consecutiveOfflineDays: 0,
        revoked: false,
      },
    ];
    for (const c of cases) {
      const r = computeLicenseState(c);
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('boundary: now === expires_at is treated as "grace" (the second after expiry)', () => {
    const r = computeLicenseState({
      claims: makeClaims({ expires_at: NOW, grace_until: NOW + 86400 * 30 }),
      now: NOW,
      lastVerifiedAt: NOW,
      consecutiveOfflineDays: 0,
      revoked: false,
    });
    // §10 "active": now < expires_at — strict. At the boundary it's grace.
    expect(r.state).toBe('grace');
  });

  it('revoked beats expired (priority order test)', () => {
    const r = computeLicenseState({
      claims: makeClaims({
        expires_at: NOW - 86400 * 100,
        grace_until: NOW - 86400 * 70,
      }),
      now: NOW,
      lastVerifiedAt: NOW - 86400 * 70,
      consecutiveOfflineDays: 70,
      revoked: true,
    });
    expect(r.state).toBe('revoked');
  });
});
