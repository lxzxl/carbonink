import { readFileSync } from 'node:fs';
import { listStages } from '@main/llm/stages/registry.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

/**
 * Narrow input schemas. We zod-parse at the IPC boundary so even a
 * compromised preload can't smuggle wild values past us. `document:upload`
 * intentionally does NOT zod-validate the `bytes: Uint8Array` field — Zod's
 * `z.instanceof(Uint8Array)` is fragile across V8 realms (preload vs main
 * may hand us a Uint8Array whose constructor doesn't `===` ours), so we do
 * a single hand-rolled `instanceof` check inside the handler. The
 * `IpcTypeMap` already guarantees the shape at the type level; the runtime
 * check is defense in depth.
 */
const uploadMetaInput = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
});

const idInput = z.object({ id: z.string().min(1) });

/**
 * Phase 1b document + stages IPC handlers.
 *
 * `document:upload` converts the renderer-friendly `Uint8Array` to a
 * `Buffer` (zero-copy: same underlying ArrayBuffer) before handing off to
 * `DocumentService.uploadFile`. The service does the sha256 + dedupe +
 * filesystem write + row insert in one shot.
 *
 * `stages:list` reads from the in-memory `stageRegistry` directly — there's
 * no service method for this because stages are pure data, not state.
 * Returning `{ id, version, description }` (not the full Stage, which
 * includes a zod schema + function) keeps the response IPC-serializable.
 */
export function documentHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'document:upload': (input) => {
      const meta = uploadMetaInput.parse({ filename: input.filename, mimeType: input.mimeType });
      // Defense in depth: even though `IpcTypeMap` requires Uint8Array here,
      // a compromised preload could ship anything. Reject early with a
      // legible error rather than letting `Buffer.from` coerce something
      // unexpected (e.g. a plain object) into garbage bytes.
      if (!(input.bytes instanceof Uint8Array)) {
        throw new Error('document:upload bytes must be a Uint8Array');
      }
      // `Buffer.from(Uint8Array)` aliases the underlying ArrayBuffer — no
      // copy. The service expects a Buffer (Node's BufferStream-friendly
      // subclass of Uint8Array), so this conversion is the only adaptation
      // layer between renderer-friendly types and Node-native APIs.
      return ctx.documentService.uploadFile({
        filename: meta.filename,
        mimeType: meta.mimeType,
        bytes: Buffer.from(input.bytes),
      });
    },
    'document:list': () => ctx.documentService.listAll(),
    'document:get-by-id': (input) => ctx.documentService.getById(idInput.parse(input).id),

    'document:read-bytes': (input) => {
      // Resolve the document row first so we never expose arbitrary file
      // paths over IPC — the renderer hands us an `id` we look up, and the
      // `storage_path` is read out of the database row we own. A missing row
      // throws (the sanitize wrapper maps it to a generic IPC error); the
      // renderer surfaces this as "Document not found" in the review page.
      const id = idInput.parse(input).id;
      const doc = ctx.documentService.getById(id);
      if (!doc) throw new Error(`Document not found: ${id}`);
      // `readFileSync` returns a Node `Buffer`, which is a `Uint8Array`
      // subclass — but Electron's structured-clone path doesn't reliably
      // preserve the Buffer prototype across process boundaries (the
      // renderer would see a plain Uint8Array anyway). Convert explicitly so
      // the type matches `IpcTypeMap` and the downstream `new Blob([bytes])`
      // call doesn't trip on any Buffer-specific behavior.
      const buf = readFileSync(doc.storage_path);
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },

    'stages:list': () =>
      listStages().map((s) => ({
        id: s.id,
        version: s.version,
        description: s.description,
      })),
  };
}
