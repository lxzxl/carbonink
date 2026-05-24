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
      throw new Error(
        'Linux is not supported in carbonink v1 (per spec §1, §2). Use macOS or Windows.',
      );
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
