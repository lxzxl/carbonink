import { allowedChannels, createBridge } from '@preload/bridge';
import { describe, expect, it, vi } from 'vitest';

describe('preload bridge', () => {
  it('forwards allowed channels to the underlying invoke', async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const bridge = createBridge(invoke);
    const result = await bridge.invoke('org:has-any');
    expect(result).toBe(true);
    expect(invoke).toHaveBeenCalledWith('org:has-any');
  });

  it('forwards args verbatim for channels that take input', async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    const bridge = createBridge(invoke);
    await bridge.invoke('org:get-by-id', { id: 'org_123' });
    expect(invoke).toHaveBeenCalledWith('org:get-by-id', { id: 'org_123' });
  });

  it('rejects channels not in the allowlist (does not even call ipc)', async () => {
    const invoke = vi.fn();
    const bridge = createBridge(invoke);
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
      'org:has-any',
      'org:get-by-id',
      'org:create',
      'org:list-sites',
      'org:create-site',
      'org:list-reporting-periods',
      'org:create-reporting-period',
      'org:complete-onboarding',
    ]);
  });
});
