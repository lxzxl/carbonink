import { CredentialStore, type SafeStorageLike } from '@main/credentials/safe-storage';
import { describe, expect, it } from 'vitest';

function makeFakeSafeStorage(available: boolean): SafeStorageLike {
  const store = new Map<Buffer, Buffer>();
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => {
      const buf = Buffer.from(`enc:${s}`);
      store.set(buf, buf);
      return buf;
    },
    decryptString: (b: Buffer) => Buffer.from(b).toString().replace(/^enc:/, ''),
  };
}

describe('CredentialStore', () => {
  it('throws when safeStorage encryption not available', () => {
    const store = new CredentialStore({
      safeStorage: makeFakeSafeStorage(false),
      readBlob: () => null,
      writeBlob: () => undefined,
      platform: 'darwin',
    });
    expect(() => store.set('llm.openai.apikey', 'sk-test')).toThrow(/safeStorage/i);
  });

  it('encrypts and decrypts roundtrip', () => {
    const blobs = new Map<string, Buffer>();
    const store = new CredentialStore({
      safeStorage: makeFakeSafeStorage(true),
      readBlob: (k) => blobs.get(k) ?? null,
      writeBlob: (k, b) => {
        blobs.set(k, b);
      },
      platform: 'darwin',
    });
    store.set('llm.openai.apikey', 'sk-test-12345');
    expect(store.get('llm.openai.apikey')).toBe('sk-test-12345');
  });

  it('returns null for missing keys', () => {
    const store = new CredentialStore({
      safeStorage: makeFakeSafeStorage(true),
      readBlob: () => null,
      writeBlob: () => undefined,
      platform: 'darwin',
    });
    expect(store.get('llm.openai.apikey')).toBeNull();
  });

  it('refuses to operate on linux platform', () => {
    expect(
      () =>
        new CredentialStore({
          safeStorage: makeFakeSafeStorage(true),
          readBlob: () => null,
          writeBlob: () => undefined,
          platform: 'linux',
        }),
    ).toThrow(/Linux is not supported/);
  });
});
