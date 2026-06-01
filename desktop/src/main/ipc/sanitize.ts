import { randomUUID } from 'node:crypto';
import { VisionUnsupportedError } from '@main/llm/vision-capability.js';
import {
  PdfNotReadableError,
  StageDoesNotSupportVisionError,
} from '@main/services/extraction-service.js';
import { z } from 'zod';

/**
 * Wraps an IPC handler so we never leak raw error messages
 * (better-sqlite3 SQL fragments, file paths, etc.) across the IPC boundary.
 *
 * Error class handling, in order:
 * - `ZodError` → reformatted into actionable field-path list.
 * - Whitelisted user-actionable errors (PdfNotReadable / VisionUnsupported /
 *   StageDoesNotSupportVision / LicenseReadOnly) → passthrough; their
 *   messages are already safe for renderer display.
 * - Everything else → fresh correlation id; full error logged server-side
 *   and the renderer sees `IPC handler <channel> failed [<id>]`.
 *
 * AiClient tagged errors (`AiAuthError`, `AiSchemaMismatch`, etc.) are NOT
 * whitelisted here: handlers that surface them (`answer.ts`, `settings.ts`)
 * map them to plain `Error` instances with localized messages before
 * throwing — so they never reach this catch.
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
      // Whitelist of user-actionable errors. Their messages are already safe
      // for renderer display (no SQL / FS paths / API keys).
      if (
        err instanceof PdfNotReadableError ||
        err instanceof VisionUnsupportedError ||
        err instanceof StageDoesNotSupportVisionError
      ) {
        // Still log server-side for support / debugging.
        console.error(`[ipc:${channel}] ${err.name}`, err);
        throw new Error(err.message);
      }
      const id = randomUUID();
      console.error(`[ipc:${channel}] ${id}`, err);
      throw new Error(`IPC handler ${channel} failed [${id}]`);
    }
  };
}
