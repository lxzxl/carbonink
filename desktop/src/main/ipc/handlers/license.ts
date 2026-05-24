import { app } from 'electron';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const setJwtInput = z.object({ jwt: z.string().min(1) });
const activateWithKeyInput = z.object({ license_key: z.string().min(1) });

/**
 * Cloud API base. Hardcoded to prod for now — local dev hits the live
 * deployed worker (same one the activation email points at), which is
 * fine because /activate is idempotent per (license_key, device_id) and
 * licenses issued during dev are real-but-disposable trial licenses.
 *
 * Override via CARBONINK_API_BASE for an e2e harness pointing at a
 * locally-running `wrangler dev` worker; the runtime hook in
 * `desktop/tests/e2e/_setup.ts` sets this for the E2E suite.
 */
const API_BASE = process.env.CARBONINK_API_BASE ?? 'https://carbonink.xyz/api';

/**
 * Pass-through to LicenseService. The only nontrivial logic is mapping
 * thrown Errors into a discriminated `{ ok: false, error: { _tag } }` shape
 * so the renderer can render distinct UIs (forged signature vs malformed
 * input vs schema gap) without parsing error message strings.
 */
export function licenseHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'license:get-state': () => ctx.licenseService.getState(),
    'license:set-jwt': (input) => {
      const { jwt } = setJwtInput.parse(input);
      try {
        ctx.licenseService.setJwt(jwt);
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Tag mapping mirrors the three throw sites in LicenseService.verifyAndDecode:
        //   - "Malformed JWT: expected 3 dot-separated segments."
        //   - "License JWT body is not valid JSON."
        //   - "License JWT signature failed verification."
        //   - everything else (zod schema failures) → BadSchema
        const tag = /signature/i.test(msg)
          ? 'BadSignature'
          : /malformed|3 dot-separated|not valid JSON/i.test(msg)
            ? 'Malformed'
            : 'BadSchema';
        return {
          ok: false,
          error: {
            _tag: tag as 'BadSignature' | 'BadSchema' | 'Malformed',
            message: msg,
          },
        };
      }
    },
    'license:activate-with-key': async (input) => {
      const { license_key } = activateWithKeyInput.parse(input);
      // device_id was minted on first launch and stored in
      // license_local_state; getState() surfaces it without recomputing.
      const { device_id } = ctx.licenseService.getState();
      const app_version = app.getVersion();
      const os =
        process.platform === 'darwin'
          ? 'darwin'
          : process.platform === 'win32'
            ? 'win32'
            : 'linux';

      let res: Response;
      try {
        res = await fetch(`${API_BASE}/v1/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ license_key, device_id, app_version, os }),
        });
      } catch (e) {
        return {
          ok: false,
          error: {
            _tag: 'Network' as const,
            message: e instanceof Error ? e.message : String(e),
          },
        };
      }

      if (!res.ok) {
        // Worker returns `{ error: { _tag, message } }` for known cases.
        // Try to surface the worker's tag; fall back to HTTP-status mapping
        // (404 → KeyNotFound, 409 → DeviceCapReached, 429 → RateLimited).
        const body = (await res.json().catch(() => null)) as {
          error?: { _tag?: string; message?: string };
        } | null;
        const workerTag = body?.error?._tag;
        const tag =
          workerTag === 'NotFound' || res.status === 404
            ? ('KeyNotFound' as const)
            : workerTag === 'DeviceCapReached' || res.status === 409
              ? ('DeviceCapReached' as const)
              : workerTag === 'RateLimited' || res.status === 429
                ? ('RateLimited' as const)
                : ('Server' as const);
        return {
          ok: false,
          error: {
            _tag: tag,
            message: body?.error?.message ?? `HTTP ${res.status}`,
            status: res.status,
          },
        };
      }

      const payload = (await res.json().catch(() => null)) as { jwt?: string } | null;
      if (!payload?.jwt || typeof payload.jwt !== 'string') {
        return {
          ok: false,
          error: {
            _tag: 'Server' as const,
            message: 'Activate response missing `jwt` field.',
            status: res.status,
          },
        };
      }

      try {
        ctx.licenseService.setJwt(payload.jwt);
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const tag = /signature/i.test(msg)
          ? ('BadSignature' as const)
          : ('Malformed' as const);
        return { ok: false, error: { _tag: tag, message: msg } };
      }
    },
    'license:clear': () => ctx.licenseService.clearJwt(),
  };
}
