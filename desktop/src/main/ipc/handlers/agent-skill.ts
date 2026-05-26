import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

/**
 * Wrap a service-returning promise so renderer-side callers can branch on a
 * discriminated `{ ok: true | false }` union rather than catching thrown
 * exceptions across the IPC boundary. Mirrors the pattern used by
 * `handlers/mcp.ts` for `mcp:configure` / `mcp:remove`.
 */
function wrapResult<T>(
  p: Promise<T>,
): Promise<{ ok: true; result: T } | { ok: false; error: 'io_error'; message?: string }> {
  return p.then(
    (result) => ({ ok: true as const, result }),
    (e: unknown) => ({
      ok: false as const,
      error: 'io_error' as const,
      message: e instanceof Error ? e.message : String(e),
    }),
  );
}

export function agentSkillHandlers(ctx: IpcContext): { [K in keyof IpcTypeMap]?: IpcTypeMap[K] } {
  return {
    'skill:detect': () => ctx.agentSkillService.detect(),
    'skill:install': () => wrapResult(ctx.agentSkillService.install()),
    'skill:update': () => wrapResult(ctx.agentSkillService.update()),
    'skill:remove': () => wrapResult(ctx.agentSkillService.remove()),
  };
}
