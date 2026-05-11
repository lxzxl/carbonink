import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import { CredentialStore } from './safe-storage.js';

/**
 * Electron-backed CredentialStore singleton.
 *
 * Wires Phase 0's DI-shaped `CredentialStore` to the real Electron `safeStorage`
 * API + a filesystem blob backing store at `<userData>/credentials/{key}.bin`.
 *
 * Why a singleton: every IPC handler that touches credentials should share the
 * same store instance — re-creating the directory + readBlob/writeBlob closures
 * per call is wasteful and risks racing on mkdirSync on first boot. The store
 * itself is stateless past construction, so a module-level singleton is safe.
 *
 * Why 0o600 on blobs: even though the bytes are already safeStorage-encrypted
 * (and thus useless without the keychain unlock), restricting to owner R/W is
 * defense in depth — an attacker reading the file as a different OS user gets
 * neither the ciphertext nor the metadata that the user has an OpenAI key
 * configured.
 *
 * Note: `<userData>/credentials/` is created lazily on first call (the dir does
 * not exist on a fresh install). `mkdirSync(..., { recursive: true })` is a
 * no-op when the directory already exists, so this is safe to re-enter.
 */
let singleton: CredentialStore | null = null;

export function getCredentialStore(): CredentialStore {
  if (singleton) return singleton;

  const dir = join(app.getPath('userData'), 'credentials');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  singleton = new CredentialStore({
    safeStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s: string) => safeStorage.encryptString(s),
      decryptString: (b: Buffer) => safeStorage.decryptString(b),
    },
    readBlob: (key: string) => {
      const path = join(dir, `${key}.bin`);
      if (!existsSync(path)) return null;
      return readFileSync(path);
    },
    writeBlob: (key: string, blob: Buffer) => {
      const path = join(dir, `${key}.bin`);
      writeFileSync(path, blob, { mode: 0o600 });
    },
    platform: process.platform,
  });
  return singleton;
}

/**
 * Delete the on-disk blob for a key. Used by `CredentialService.delete`; lives
 * here (not on `CredentialStore`) because the deletion is filesystem-specific
 * and the Phase 0 abstraction intentionally only knows set/get.
 */
export function deleteCredentialBlob(key: string): void {
  const dir = join(app.getPath('userData'), 'credentials');
  const path = join(dir, `${key}.bin`);
  if (existsSync(path)) unlinkSync(path);
}

/**
 * Test-only: reset the singleton so `vi.mock('electron', ...)` setups can be
 * re-applied per test without process-wide state leaking between cases.
 */
export function resetCredentialStoreForTest(): void {
  singleton = null;
}
