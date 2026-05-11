import { invoke } from '../ipc.js';

/**
 * Per-domain renderer wrapper for the `document:*` IPC channels.
 *
 * Phase 1b — uploaded source files (PDFs at MVP). The bytes payload is a
 * `Uint8Array` rather than a Node `Buffer` so the renderer side doesn't
 * have to import any Node-only types; Electron's structured-clone handles
 * Uint8Array natively across the IPC boundary, and the main-process
 * handler converts to a Buffer before persisting.
 *
 * Typical call path from a drop zone:
 *   const buf = await file.arrayBuffer();
 *   const doc = await documentApi.upload({
 *     filename: file.name,
 *     mimeType: file.type,
 *     bytes: new Uint8Array(buf),
 *   });
 */
export const documentApi = {
  upload: (input: { filename: string; mimeType: string; bytes: Uint8Array }) =>
    invoke('document:upload', input),
  list: () => invoke('document:list'),
  getById: (input: { id: string }) => invoke('document:get-by-id', input),
};
