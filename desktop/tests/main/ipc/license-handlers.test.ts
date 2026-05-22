import type { IpcContext } from '@main/ipc/context';
import { licenseHandlers } from '@main/ipc/handlers/license';
import type { LicenseService } from '@main/services/license-service';
import { describe, expect, it, vi } from 'vitest';

/**
 * Pure handler tests — IpcContext is a hand-built object containing only
 * the LicenseService methods this handler touches. No DB, no Keychain.
 * The cross-cutting service is exercised by `license-service.test.ts`.
 */

function ctxWith(serviceShim: Partial<LicenseService>): IpcContext {
  // The rest of IpcContext is unused by the license handlers; an unsafe
  // cast keeps these tests focused.
  return { licenseService: serviceShim as LicenseService } as unknown as IpcContext;
}

describe('license IPC handlers', () => {
  it('license:get-state delegates to LicenseService.getState', () => {
    const view = {
      state: 'active' as const,
      claims: null,
      device_id: 'd1',
      last_verified_at: null,
      consecutive_offline_days: 0,
      reason: 'ok',
    };
    const getState = vi.fn(() => view);
    const handlers = licenseHandlers(ctxWith({ getState }));
    const result = handlers['license:get-state']!();
    expect(getState).toHaveBeenCalledOnce();
    expect(result).toEqual(view);
  });

  it('license:set-jwt returns { ok: true } on success', () => {
    const setJwt = vi.fn(() => undefined);
    const handlers = licenseHandlers(ctxWith({ setJwt }));
    const result = handlers['license:set-jwt']!({ jwt: 'a.b.c' });
    expect(setJwt).toHaveBeenCalledWith('a.b.c');
    expect(result).toEqual({ ok: true });
  });

  it('license:set-jwt maps signature failure → BadSignature tag', () => {
    const setJwt = vi.fn(() => {
      throw new Error('License JWT signature failed verification.');
    });
    const handlers = licenseHandlers(ctxWith({ setJwt }));
    const result = handlers['license:set-jwt']!({ jwt: 'bad.token.x' });
    expect(result).toMatchObject({ ok: false });
    if (result && 'error' in result) {
      expect(result.error._tag).toBe('BadSignature');
    }
  });

  it('license:set-jwt maps malformed input → Malformed tag', () => {
    const setJwt = vi.fn(() => {
      throw new Error('Malformed JWT: expected 3 dot-separated segments.');
    });
    const handlers = licenseHandlers(ctxWith({ setJwt }));
    const result = handlers['license:set-jwt']!({ jwt: 'not.three.parts.toomany' });
    expect(result).toMatchObject({ ok: false });
    if (result && 'error' in result) {
      expect(result.error._tag).toBe('Malformed');
    }
  });

  it('license:set-jwt maps zod schema failure → BadSchema tag', () => {
    const setJwt = vi.fn(() => {
      throw new Error('Required at "expires_at"');
    });
    const handlers = licenseHandlers(ctxWith({ setJwt }));
    const result = handlers['license:set-jwt']!({ jwt: 'h.b.s' });
    expect(result).toMatchObject({ ok: false });
    if (result && 'error' in result) {
      expect(result.error._tag).toBe('BadSchema');
    }
  });

  it('license:clear delegates to LicenseService.clearJwt', () => {
    const clearJwt = vi.fn();
    const handlers = licenseHandlers(ctxWith({ clearJwt }));
    handlers['license:clear']!();
    expect(clearJwt).toHaveBeenCalledOnce();
  });
});
