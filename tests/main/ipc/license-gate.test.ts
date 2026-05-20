import {
  LicenseReadOnlyError,
  READ_ONLY_BLOCKED_CHANNELS,
  licenseGate,
} from '@main/ipc/license-gate';
import type { LicenseService } from '@main/services/license-service';
import type { LicenseState, LicenseStateView } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';

function svcReturning(state: LicenseState): LicenseService {
  const view: LicenseStateView = {
    state,
    claims: null,
    device_id: 'd1',
    last_verified_at: null,
    consecutive_offline_days: 0,
    reason: 'test',
  };
  return { getState: vi.fn(() => view) } as unknown as LicenseService;
}

describe('licenseGate', () => {
  const BLOCKED = 'activity:create' as const;
  const NEVER_BLOCKED = 'activity:list-by-period' as const;

  it('passes through when state is "active"', () => {
    const inner = vi.fn((x: number) => x * 2);
    const wrapped = licenseGate(BLOCKED, svcReturning('active'), inner as never);
    expect((wrapped as (n: number) => number)(7)).toBe(14);
    expect(inner).toHaveBeenCalledOnce();
  });

  it('passes through when state is "grace" (writes still allowed in grace)', () => {
    const inner = vi.fn(() => 'ok');
    const wrapped = licenseGate(BLOCKED, svcReturning('grace'), inner as never);
    expect((wrapped as () => string)()).toBe('ok');
  });

  it('passes through when state is "unverified" (treat as pre-license, allow)', () => {
    const inner = vi.fn(() => 'ok');
    const wrapped = licenseGate(BLOCKED, svcReturning('unverified'), inner as never);
    expect((wrapped as () => string)()).toBe('ok');
  });

  it('throws LicenseReadOnlyError when state="expired" + channel blocked', () => {
    const inner = vi.fn();
    const wrapped = licenseGate(BLOCKED, svcReturning('expired'), inner as never);
    expect(() => (wrapped as () => void)()).toThrow(LicenseReadOnlyError);
    expect(inner).not.toHaveBeenCalled();
  });

  it('throws LicenseReadOnlyError when state="revoked" + channel blocked', () => {
    const inner = vi.fn();
    const wrapped = licenseGate(BLOCKED, svcReturning('revoked'), inner as never);
    try {
      (wrapped as () => void)();
      throw new Error('expected LicenseReadOnlyError');
    } catch (e) {
      expect(e).toBeInstanceOf(LicenseReadOnlyError);
      expect((e as LicenseReadOnlyError).state).toBe('revoked');
      expect((e as LicenseReadOnlyError)._tag).toBe('LicenseReadOnlyError');
    }
    expect(inner).not.toHaveBeenCalled();
  });

  it('passes through when channel is NOT in the blocked set (even if state=expired)', () => {
    const inner = vi.fn(() => ['row1', 'row2']);
    const wrapped = licenseGate(NEVER_BLOCKED, svcReturning('expired'), inner as never);
    expect((wrapped as () => string[])()).toEqual(['row1', 'row2']);
    expect(inner).toHaveBeenCalledOnce();
  });

  it('does not call licenseService.getState() for never-blocked channels (fast path)', () => {
    const svc = svcReturning('expired');
    const inner = vi.fn(() => 0);
    const wrapped = licenseGate(NEVER_BLOCKED, svc, inner as never);
    (wrapped as () => number)();
    expect(svc.getState).not.toHaveBeenCalled();
  });

  it('READ_ONLY_BLOCKED_CHANNELS covers all expected write paths', () => {
    // Spot-check the canonical list. This guards against accidental
    // deletions during refactoring — the spec §10 list is the source of
    // truth and this set must mirror it.
    const required: ReadonlyArray<string> = [
      'activity:create',
      'activity:rebind-ef',
      'extraction:run',
      'extraction:classify-and-run',
      'questionnaire:create',
      'answer:save',
      'answer:generate',
      'report:generate',
      'ef:recommend',
      'document:upload',
    ];
    for (const channel of required) {
      expect(
        READ_ONLY_BLOCKED_CHANNELS.has(channel as never),
        `expected '${channel}' to be in READ_ONLY_BLOCKED_CHANNELS`,
      ).toBe(true);
    }
  });

  it('READ_ONLY_BLOCKED_CHANNELS excludes read-only / export channels', () => {
    const excluded: ReadonlyArray<string> = [
      'activity:list-by-period',
      'source:list-by-org',
      'ef:list',
      'audit:list',
      'settings:save-provider', // user can fix a broken AI key without re-licensing
      'license:get-state',
      'license:set-jwt',
      'license:clear',
      'report:export-pdf',
      'report:export-xlsx',
      'answer:export-to-xlsx',
      'questionnaire:export-pdf',
      'document:read-bytes',
    ];
    for (const channel of excluded) {
      expect(
        READ_ONLY_BLOCKED_CHANNELS.has(channel as never),
        `expected '${channel}' to NOT be in READ_ONLY_BLOCKED_CHANNELS`,
      ).toBe(false);
    }
  });
});
