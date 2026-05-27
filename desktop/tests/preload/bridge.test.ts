import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allowedChannels, allowedPushChannels, createBridge } from '@preload/bridge';
import { describe, expect, it, vi } from 'vitest';

/**
 * Parse channel name literals out of an interface body declared in
 * `desktop/src/main/ipc/types.ts`. The interface body shape is:
 *
 *     export interface IpcTypeMap {
 *       'org:has-any': () => boolean;
 *       'org:get-by-id': (input: { id: string }) => Organization | null;
 *       // ...
 *     }
 *
 * We need a regex that matches the outer interface's `{ ... }` block but
 * stops at the matching closing brace (string types inside the interface
 * may contain `{`/`}` — e.g. a return type `=> { ok: true }`). Easiest
 * reliable approach: walk the file from the interface opener and track
 * brace depth.
 */
function extractInterfaceChannelKeys(src: string, typeName: string): string[] {
  // Accept either `export interface Name {` or `export type Name = {`.
  const headerRe = new RegExp(
    `export\\s+(?:interface\\s+${typeName}|type\\s+${typeName}\\s*=)\\s*\\{`,
  );
  const m = headerRe.exec(src);
  if (!m) {
    throw new Error(`Could not find 'export interface/type ${typeName} = {' in types.ts`);
  }
  const headerIdx = m.index;
  const bodyStart = src.indexOf('{', headerIdx) + 1;
  let depth = 1;
  let i = bodyStart;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth === 0) break;
    i += 1;
  }
  const body = src.slice(bodyStart, i);

  // Channel property declarations are at the OUTER level of the body —
  // i.e. depth-1 within `body`. Walk body again, only capturing
  // `'channel:name':` at depth 0.
  const keys: string[] = [];
  let d = 0;
  let j = 0;
  const propRe = /'([a-z][a-z0-9_:-]+)'\s*:/y;
  while (j < body.length) {
    const ch = body[j];
    if (ch === '{') {
      d += 1;
      j += 1;
      continue;
    }
    if (ch === '}') {
      d -= 1;
      j += 1;
      continue;
    }
    if (d === 0) {
      propRe.lastIndex = j;
      const m = propRe.exec(body);
      if (m?.[1]) {
        keys.push(m[1]);
        j = propRe.lastIndex;
        continue;
      }
    }
    j += 1;
  }
  return keys;
}

// vitest's `import.meta.url` isn't a `file:` URL in all loader configs, so
// we resolve via `process.cwd()` — vitest sets cwd to the package root
// (`desktop/`) when invoked through `pnpm --filter carbonink test`.
const TYPES_SRC = readFileSync(resolve(process.cwd(), 'src/main/ipc/types.ts'), 'utf8');

describe('preload bridge', () => {
  it('forwards allowed channels to the underlying invoke', async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const bridge = createBridge(invoke, vi.fn());
    const result = await bridge.invoke('org:has-any');
    expect(result).toBe(true);
    expect(invoke).toHaveBeenCalledWith('org:has-any');
  });

  it('forwards args verbatim for channels that take input', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const bridge = createBridge(invoke, vi.fn());
    await bridge.invoke('org:get-by-id', { id: 'org_123' });
    expect(invoke).toHaveBeenCalledWith('org:get-by-id', { id: 'org_123' });
  });

  it('rejects channels not in the allowlist (does not even call ipc)', async () => {
    const invoke = vi.fn();
    const bridge = createBridge(invoke, vi.fn());
    await expect(
      // Force an off-list channel through; the runtime guard is what we're testing.
      (bridge as unknown as { invoke: (c: string) => Promise<unknown> }).invoke('evil:channel'),
    ).rejects.toThrow(/IPC channel not allowed: evil:channel/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('allowlist covers every channel declared in IpcTypeMap', () => {
    // Hand-duplicated lists rot (this test caught its own rot once — the
    // v2.0 inbound channels landed in IpcTypeMap and the bridge allowlist
    // but the test list never got the update, and so a renderer call to
    // `supplier:create` exploded at runtime).
    //
    // Driving the check off types.ts means a single place (the interface)
    // is the source of truth. Adding a channel to IpcTypeMap forces an
    // allowlist update; renaming or removing one is caught the same way.
    const declared = extractInterfaceChannelKeys(TYPES_SRC, 'IpcTypeMap');
    expect(declared.length).toBeGreaterThan(50); // sanity: parser found things
    // Treat allowedChannels as a plain string[] for inclusion checks —
    // its typed `keyof IpcTypeMap` element type is too strict for the
    // string keys we parsed out of source.
    const allowedSet = new Set<string>(allowedChannels as readonly string[]);
    const missing = declared.filter((k) => !allowedSet.has(k));
    expect(missing).toEqual([]);
  });

  it('allowlist contains no duplicates', () => {
    expect(new Set(allowedChannels).size).toBe(allowedChannels.length);
  });

  it('allowlist contains no stale entries (every channel still declared)', () => {
    const declared = new Set(extractInterfaceChannelKeys(TYPES_SRC, 'IpcTypeMap'));
    const stale = allowedChannels.filter((k) => !declared.has(k));
    expect(stale).toEqual([]);
  });
});

describe('push allowlist', () => {
  it('push allowlist covers every channel declared in IpcPushTypeMap', () => {
    // Mirror of the IpcTypeMap coverage check, against the push type map.
    const declared = extractInterfaceChannelKeys(TYPES_SRC, 'IpcPushTypeMap');
    expect(declared.length).toBeGreaterThan(0);
    const allowedSet = new Set<string>(allowedPushChannels as readonly string[]);
    const missing = declared.filter((k) => !allowedSet.has(k));
    expect(missing).toEqual([]);
  });

  it('push allowlist contains no stale entries', () => {
    const declared = new Set(extractInterfaceChannelKeys(TYPES_SRC, 'IpcPushTypeMap'));
    const stale = allowedPushChannels.filter((k) => !declared.has(k));
    expect(stale).toEqual([]);
  });
});

describe('createBridge subscribe (Phase 1c push channels)', () => {
  it('subscribes via the supplied subscribeFn and returns an unsubscribe function', () => {
    const subscribeFn = vi.fn();
    const bridge = createBridge(vi.fn(), subscribeFn);
    const callback = vi.fn();

    const unsubscribe = bridge.subscribe('extraction:progress', callback);

    expect(subscribeFn).toHaveBeenCalledWith('extraction:progress', expect.any(Function));
    expect(typeof unsubscribe).toBe('function');
  });

  it('rejects subscribe on channels not in the push allowlist', () => {
    const bridge = createBridge(vi.fn(), vi.fn());
    expect(() =>
      // biome-ignore lint/suspicious/noExplicitAny: testing runtime rejection
      bridge.subscribe('extraction:run' as any, vi.fn()),
    ).toThrow(/not allowed/);
  });

  it('the subscribeFn callback is invoked with the payload only (no Electron event)', () => {
    let capturedInnerHandler: ((event: unknown, payload: unknown) => void) | undefined;
    const subscribeFn = vi.fn(
      (_channel: string, inner: (event: unknown, payload: unknown) => void) => {
        capturedInnerHandler = inner;
        return () => {};
      },
    );
    const bridge = createBridge(vi.fn(), subscribeFn);
    const callback = vi.fn();

    bridge.subscribe('extraction:progress', callback);
    // Simulate Electron firing the event:
    capturedInnerHandler?.(
      {
        /* fake IpcRendererEvent */
      },
      { document_id: 'd', phase: 'vision' },
    );

    expect(callback).toHaveBeenCalledWith({ document_id: 'd', phase: 'vision' });
    // The Electron event itself never reaches the renderer-supplied callback.
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
