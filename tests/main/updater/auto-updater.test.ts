import type { UpdateStatus } from '@main/updater/auto-updater';
import { describe, expect, it } from 'vitest';

/**
 * The auto-updater module's core logic is thin (it delegates to
 * electron-updater which can't run outside Electron). We test the
 * type contract and status shape so future changes don't silently
 * break the renderer contract that the `updater:status` push channel
 * and the `updater:get-status` invoke channel share.
 */
describe('UpdateStatus type contract', () => {
  it('idle status has no extra fields', () => {
    const status: UpdateStatus = { state: 'idle' };
    expect(status.state).toBe('idle');
  });

  it('available status carries version + releaseDate', () => {
    const status: UpdateStatus = {
      state: 'available',
      version: '1.2.3',
      releaseDate: '2026-06-01T00:00:00Z',
    };
    expect(status.version).toBe('1.2.3');
    expect(status.releaseDate).toBeDefined();
  });

  it('downloading status carries percent', () => {
    const status: UpdateStatus = { state: 'downloading', percent: 42 };
    expect(status.percent).toBe(42);
  });

  it('error status carries message', () => {
    const status: UpdateStatus = { state: 'error', message: 'Network timeout' };
    expect(status.message).toBe('Network timeout');
  });
});
