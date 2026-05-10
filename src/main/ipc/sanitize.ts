import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Wraps an IPC handler so we never leak raw error messages
 * (better-sqlite3 SQL fragments, file paths, etc.) across the IPC boundary.
 *
 * - Zod errors are reformatted into a short, actionable list of field paths.
 * - All other errors get a fresh correlation id; the full error is logged
 *   server-side and the renderer only sees `IPC handler <channel> failed [<id>]`.
 *
 * The returned wrapper is intentionally typed as `(...args: unknown[])` rather
 * than mirroring the input handler's signature: callers (the IPC dispatcher
 * loop in `setup.ts`) iterate over a heterogeneous handler map and apply this
 * uniformly, so the per-channel typing is enforced at the IpcTypeMap boundary
 * — not here.
 */
export function sanitize(
  channel: string,
  fn: (...args: unknown[]) => unknown,
): (...args: unknown[]) => Promise<unknown> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const detail = err.issues
          .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
          .join('; ');
        throw new Error(`Invalid input for ${channel}: ${detail}`);
      }
      const id = randomUUID();
      console.error(`[ipc:${channel}] ${id}`, err);
      throw new Error(`IPC handler ${channel} failed [${id}]`);
    }
  };
}
