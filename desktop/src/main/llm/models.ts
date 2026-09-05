import type { MutableModels } from '@earendil-works/pi-ai';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

/**
 * Process-wide singleton `Models` collection (pi-ai 0.80+ recommended API).
 *
 * Holds every built-in provider (Electron main has no tree-shaking pressure).
 * Auth stays explicit per request: callers pass the keychain-resolved `apiKey`
 * into `models.complete` / `models.stream` — no pi `CredentialStore` is
 * injected, so the OS keychain remains the single credential source and no
 * secret lands in a second store. Reads (`getModel`/`getModels`) are sync
 * against the last-known (bundled static) catalogs.
 */
let collection: MutableModels | undefined;

/** Lazily built singleton; safe to call per IPC request (build is cheap). */
export function getModelsCollection(): MutableModels {
  if (!collection) {
    collection = builtinModels();
  }
  return collection;
}

/** Test-only: drop the singleton so suites start from a clean collection. */
export function resetModelsCollection(): void {
  collection = undefined;
}
