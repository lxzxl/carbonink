import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deleteCredentialBlob,
  getCredentialStore,
  resetCredentialStoreForTest,
} from '@main/credentials/safe-storage-backend';
import { app, safeStorage } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The backend module imports `electron`; vi.mock() is hoisted by Vitest, so
// it runs before any `import` statement above — `app.getPath` + `safeStorage`
// resolve to the test doubles below rather than Electron's real ESM module
// (which would crash outside an Electron process).
const fakeBlobs = new Map<Buffer, string>();

vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn(),
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(),
      encryptString: vi.fn((s: string) => {
        const buf = Buffer.from(`enc:${s}`);
        fakeBlobs.set(buf, s);
        return buf;
      }),
      decryptString: vi.fn((b: Buffer) => Buffer.from(b).toString().replace(/^enc:/, '')),
    },
  };
});

let tmpUserData: string;

beforeEach(() => {
  fakeBlobs.clear();
  tmpUserData = mkdtempSync(join(tmpdir(), 'carbonbook-safestorage-'));
  vi.mocked(app.getPath).mockReturnValue(tmpUserData);
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  resetCredentialStoreForTest();
});

afterEach(() => {
  rmSync(tmpUserData, { recursive: true, force: true });
  resetCredentialStoreForTest();
  vi.clearAllMocks();
});

describe('safe-storage-backend.getCredentialStore', () => {
  it('returns the same singleton across calls', () => {
    const a = getCredentialStore();
    const b = getCredentialStore();
    expect(a).toBe(b);
  });

  it('creates the credentials directory under userData on first call', () => {
    getCredentialStore();
    expect(existsSync(join(tmpUserData, 'credentials'))).toBe(true);
  });

  it('writes a 0o600 blob at credentials/{key}.bin on set, reads it back on get', () => {
    const store = getCredentialStore();
    store.set('llm.openai.apikey', 'sk-test-12345');

    const path = join(tmpUserData, 'credentials', 'llm.openai.apikey.bin');
    expect(existsSync(path)).toBe(true);

    // Mode check: low 9 bits should be 0o600 (rw-------). On Windows this
    // assertion is meaningful only loosely; restrict to POSIX.
    if (process.platform !== 'win32') {
      const mode = statSync(path).mode & 0o777;
      expect(mode).toBe(0o600);
    }

    const onDisk = readFileSync(path);
    expect(onDisk.toString()).toBe('enc:sk-test-12345');

    expect(store.get('llm.openai.apikey')).toBe('sk-test-12345');
  });

  it('returns null when no blob exists for the key', () => {
    const store = getCredentialStore();
    expect(store.get('llm.openai.apikey')).toBeNull();
  });
});

describe('safe-storage-backend.deleteCredentialBlob', () => {
  it('removes the on-disk blob; subsequent get returns null', () => {
    const store = getCredentialStore();
    store.set('llm.anthropic.apikey', 'sk-ant-test-abc');

    const path = join(tmpUserData, 'credentials', 'llm.anthropic.apikey.bin');
    expect(existsSync(path)).toBe(true);

    deleteCredentialBlob('llm.anthropic.apikey');
    expect(existsSync(path)).toBe(false);
    expect(store.get('llm.anthropic.apikey')).toBeNull();
  });

  it('is a no-op when the blob does not exist (no throw)', () => {
    expect(() => deleteCredentialBlob('llm.openai.apikey')).not.toThrow();
  });
});
