# Phase 0 Task 20: safeStorage 凭证适配器（macOS + Windows abort 兜底）

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 2860-3002.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 20: safeStorage 凭证适配器（macOS + Windows abort 兜底）

**Files:**
- Create: `src/main/credentials/safe-storage.ts`
- Create: `tests/main/credentials/safe-storage.test.ts`

per spec §2 Tech Stack：v1 覆盖 macOS Keychain + Windows Credential Manager；safeStorage 不可用时 abort（Linux 不发行）。

- [ ] **Step 1: 写失败测试 tests/main/credentials/safe-storage.test.ts**

```ts
import { describe, expect, it, vi } from 'vitest';
import { CredentialStore, type SafeStorageLike } from '@main/credentials/safe-storage';

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
      writeBlob: (k, b) => { blobs.set(k, b); },
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
    expect(() =>
      new CredentialStore({
        safeStorage: makeFakeSafeStorage(true),
        readBlob: () => null,
        writeBlob: () => undefined,
        platform: 'linux',
      }),
    ).toThrow(/Linux is not supported/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test tests/main/credentials/safe-storage.test.ts`
Expected: FAIL ("Cannot find module '@main/credentials/safe-storage'")

- [ ] **Step 3: 写 src/main/credentials/safe-storage.ts**

```ts
export interface SafeStorageLike {
  isEncryptionAvailable: () => boolean;
  encryptString: (s: string) => Buffer;
  decryptString: (b: Buffer) => string;
}

export interface CredentialStoreOptions {
  safeStorage: SafeStorageLike;
  readBlob: (key: string) => Buffer | null;
  writeBlob: (key: string, blob: Buffer) => void;
  platform: NodeJS.Platform;
}

/**
 * CredentialStore wraps Electron's safeStorage to persist secrets in OS keystore.
 *
 * Per spec §2 Tech Stack:
 *   - v1 supports macOS (Keychain) + Windows (Credential Manager only).
 *   - Linux is not in roadmap; constructor throws on linux.
 *   - If safeStorage encryption is unavailable (e.g. headless macOS without keychain),
 *     all set/get throw to surface misconfiguration early.
 */
export class CredentialStore {
  constructor(private readonly opts: CredentialStoreOptions) {
    if (opts.platform === 'linux') {
      throw new Error('Linux is not supported in carbonbook v1 (per spec §1, §2). Use macOS or Windows.');
    }
  }

  set(key: string, plaintext: string): void {
    if (!this.opts.safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption unavailable — cannot persist credential.');
    }
    const blob = this.opts.safeStorage.encryptString(plaintext);
    this.opts.writeBlob(key, blob);
  }

  get(key: string): string | null {
    if (!this.opts.safeStorage.isEncryptionAvailable()) {
      throw new Error('safeStorage encryption unavailable — cannot read credential.');
    }
    const blob = this.opts.readBlob(key);
    if (!blob) return null;
    return this.opts.safeStorage.decryptString(blob);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test tests/main/credentials/safe-storage.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/credentials/ tests/main/credentials/
git commit -m "Phase 0/Task 20: CredentialStore (safeStorage adapter, mac+win only)"
```

---

