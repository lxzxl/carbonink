import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ModelsStore,
  ModelsStoreEntry,
  ModelsStoreOperationOptions,
} from '@earendil-works/pi-ai';

/**
 * File-backed `ModelsStore` for pi-ai dynamic model catalogs.
 *
 * One JSON file per provider under `<userData>/dynamic-models/<provider>.json`.
 * Stores pi's `ModelsStoreEntry` verbatim (`{models, checkedAt, lastModified?,
 * etag?}`) so the cache stays forward-compatible with pi-native refresh.
 *
 * Failure contract: corrupt/missing files read as a miss (`undefined`), never
 * a throw — the catalog layer falls back to the bundled static catalog.
 * Writes are atomic (tmp file + rename) so a crash mid-write can't leave a
 * half-written catalog behind.
 */
export class FileModelsStore implements ModelsStore {
  /** Cache directory — also used by boot seeding to enumerate providers. */
  readonly dir: string;

  constructor(userDataDir: string) {
    this.dir = join(userDataDir, 'dynamic-models');
  }

  private pathFor(providerId: string): string {
    // Provider ids are pi-ai slugs ([a-z0-9-]); strip anything else so the
    // id can't escape the cache dir via `../`.
    const safe = providerId.replace(/[^a-z0-9-]/gi, '_');
    return join(this.dir, `${safe}.json`);
  }

  async read(
    providerId: string,
    _options?: ModelsStoreOperationOptions,
  ): Promise<ModelsStoreEntry | undefined> {
    let raw: string;
    try {
      raw = readFileSync(this.pathFor(providerId), 'utf-8');
    } catch {
      return undefined;
    }
    try {
      const parsed = JSON.parse(raw) as ModelsStoreEntry;
      if (!parsed || !Array.isArray(parsed.models)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }

  async write(
    providerId: string,
    entry: ModelsStoreEntry,
    _options?: ModelsStoreOperationOptions,
  ): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const target = this.pathFor(providerId);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry), 'utf-8');
    renameSync(tmp, target);
  }

  async delete(providerId: string, _options?: ModelsStoreOperationOptions): Promise<void> {
    try {
      rmSync(this.pathFor(providerId), { force: true });
    } catch {
      // Missing file is the desired end state — ignore.
    }
  }
}
