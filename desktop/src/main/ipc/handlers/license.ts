import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const setJwtInput = z.object({ jwt: z.string().min(1) });

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
    'license:clear': () => ctx.licenseService.clearJwt(),
  };
}
