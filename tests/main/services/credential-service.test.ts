import { CredentialStore, type SafeStorageLike } from '@main/credentials/safe-storage';
import { CredentialService, maskSecret } from '@main/services/credential-service';
import { describe, expect, it, vi } from 'vitest';

function makeFakeSafeStorage(available: boolean): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => Buffer.from(b).toString().replace(/^enc:/, ''),
  };
}

function makeService(opts: { available?: boolean } = {}) {
  const available = opts.available ?? true;
  const blobs = new Map<string, Buffer>();
  const store = new CredentialStore({
    safeStorage: makeFakeSafeStorage(available),
    readBlob: (k) => blobs.get(k) ?? null,
    writeBlob: (k, b) => {
      blobs.set(k, b);
    },
    platform: 'darwin',
  });
  const deleteBlob = vi.fn((k: string) => {
    blobs.delete(k);
  });
  const isAvailable = vi.fn(() => available);
  const service = new CredentialService({ store, deleteBlob, isAvailable });
  return { service, blobs, deleteBlob, isAvailable };
}

describe('maskSecret', () => {
  it('masks an OpenAI-style key keeping the sk- head and last 4', () => {
    expect(maskSecret('sk-test12345')).toBe('sk-...2345');
  });

  it('masks an Anthropic-style key keeping the sk- head and last 4', () => {
    expect(maskSecret('sk-ant-api01-abcdef')).toBe('sk-...cdef');
  });

  it('masks a key with no recognizable prefix (just "...last4")', () => {
    expect(maskSecret('abcd1234efgh')).toBe('...efgh');
  });

  it('redacts short secrets entirely (< 8 chars)', () => {
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('abc1234')).toBe('*******');
  });

  it('returns asterisks of the original length for short input (no length leak via mask shape)', () => {
    expect(maskSecret('a')).toBe('*');
    expect(maskSecret('')).toBe('');
  });
});

describe('CredentialService.set', () => {
  it('persists allowed-prefix keys via the underlying store', () => {
    const { service } = makeService();
    service.set('llm.openai.apikey', 'sk-test-12345');
    expect(service.get('llm.openai.apikey')).toBe('sk-test-12345');
  });

  it.each([
    'llm.openai.apikey',
    'llm.anthropic.apikey',
    'llm.azure.apikey',
    'llm.deepseek.apikey',
    'llm.openai-compat.apikey',
  ])('accepts allowlisted prefix %s', (key) => {
    const { service } = makeService();
    expect(() => service.set(key, 'sk-anything')).not.toThrow();
  });

  it.each([
    'random.token',
    'llm.unknown.apikey',
    'oauth.google.token',
    '',
    'sk-openai',
  ])('rejects non-allowlisted key %s', (key) => {
    const { service } = makeService();
    expect(() => service.set(key, 'sk-anything')).toThrow(/not in allowlist/);
  });
});

describe('CredentialService.get', () => {
  it('returns null when no value is stored', () => {
    const { service } = makeService();
    expect(service.get('llm.openai.apikey')).toBeNull();
  });

  it('rejects non-allowlisted keys', () => {
    const { service } = makeService();
    expect(() => service.get('random.token')).toThrow(/not in allowlist/);
  });
});

describe('CredentialService.getMasked', () => {
  it('returns the masked form for a stored key', () => {
    const { service } = makeService();
    service.set('llm.openai.apikey', 'sk-test-prod-987654');
    expect(service.getMasked('llm.openai.apikey')).toBe('sk-...7654');
  });

  it('returns null when nothing is stored', () => {
    const { service } = makeService();
    expect(service.getMasked('llm.openai.apikey')).toBeNull();
  });
});

describe('CredentialService.delete', () => {
  it('calls the injected deleteBlob and the value disappears', () => {
    const { service, deleteBlob } = makeService();
    service.set('llm.openai.apikey', 'sk-test-99999');
    service.delete('llm.openai.apikey');
    expect(deleteBlob).toHaveBeenCalledWith('llm.openai.apikey');
    expect(service.get('llm.openai.apikey')).toBeNull();
  });

  it('rejects non-allowlisted keys', () => {
    const { service, deleteBlob } = makeService();
    expect(() => service.delete('random.token')).toThrow(/not in allowlist/);
    expect(deleteBlob).not.toHaveBeenCalled();
  });
});

describe('CredentialService.isAvailable', () => {
  it('returns true when the backend reports available', () => {
    const { service } = makeService({ available: true });
    expect(service.isAvailable()).toBe(true);
  });

  it('returns false when the backend reports unavailable', () => {
    const { service } = makeService({ available: false });
    expect(service.isAvailable()).toBe(false);
  });
});
