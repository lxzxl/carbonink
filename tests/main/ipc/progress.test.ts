import { createProgressEmitter } from '@main/ipc/progress';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';

describe('createProgressEmitter', () => {
  it('forwards channel + payload to the resolved window\'s webContents.send', () => {
    const send = vi.fn();
    const fakeWin = { webContents: { send, isDestroyed: () => false } } as unknown as BrowserWindow;
    const emitter = createProgressEmitter(() => fakeWin);

    emitter('extraction:progress', { document_id: 'doc-1', phase: 'vision' });

    expect(send).toHaveBeenCalledWith('extraction:progress', {
      document_id: 'doc-1',
      phase: 'vision',
    });
  });

  it('is a no-op when getWindow returns null', () => {
    // The renderer may have been closed while a long-running vision call
    // is still in flight. Sending to a missing webContents would throw;
    // we swallow that to keep the main pipeline going to completion.
    const emitter = createProgressEmitter(() => null);
    expect(() => emitter('extraction:progress', { document_id: 'x', phase: 'vision' }))
      .not.toThrow();
  });

  it('is a no-op when webContents is destroyed', () => {
    const send = vi.fn();
    const fakeWin = { webContents: { send, isDestroyed: () => true } } as unknown as BrowserWindow;
    const emitter = createProgressEmitter(() => fakeWin);
    emitter('extraction:progress', { document_id: 'x', phase: 'vision' });
    expect(send).not.toHaveBeenCalled();
  });
});
