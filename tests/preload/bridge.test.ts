import { allowedChannels, createBridge } from '@preload/bridge';
import { describe, expect, it, vi } from 'vitest';

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

  it('allowlist covers exactly the channels registered in the main process', () => {
    // If a new channel is added to IpcTypeMap, this test reminds the author to
    // also register it here. We rely on an explicit list rather than codegen so
    // adding a channel is a deliberate two-place change.
    expect(allowedChannels).toEqual([
      // organization domain
      'org:has-any',
      'org:get-current',
      'org:get-by-id',
      'org:create',
      'org:list-sites',
      'org:create-site',
      'org:list-reporting-periods',
      'org:create-reporting-period',
      'org:complete-onboarding',
      // ef-library domain
      'ef:list',
      'ef:get-by-pk',
      'units:list',
      // emission-source domain
      'source:create',
      'source:get-by-id',
      'source:list-by-site',
      'source:list-by-org',
      'source:update',
      'source:delete',
      // activity-data domain
      'activity:create',
      'activity:list-by-period',
      'activity:totals-by-period',
      // settings domain (Phase 1b)
      'settings:available',
      'settings:get-provider',
      'settings:save-provider',
      'settings:clear-provider',
      'settings:ping-provider',
      // document domain (Phase 1b)
      'document:upload',
      'document:list',
      'document:get-by-id',
      'document:read-bytes',
      // extraction domain (Phase 1b)
      'extraction:run',
      'extraction:list-pending',
      'extraction:list-by-document',
      'extraction:list-statuses',
      'extraction:get-by-id',
      'extraction:confirm',
      'extraction:discard',
      // stages domain (Phase 1b)
      'stages:list',
    ]);
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
    capturedInnerHandler?.({ /* fake IpcRendererEvent */ }, { document_id: 'd', phase: 'vision' });

    expect(callback).toHaveBeenCalledWith({ document_id: 'd', phase: 'vision' });
    // The Electron event itself never reaches the renderer-supplied callback.
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
