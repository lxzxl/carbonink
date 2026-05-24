import { getAppDb } from '@main/db/connection.js';

/**
 * CacheService — clears non-essential data that accumulates over time.
 *
 * Two cache kinds today:
 *
 *   - **extraction-raw**: clears the `raw_response` column on extraction
 *     rows whose status is `parsed`. The raw response is the unparsed
 *     LLM text, kept for debugging an extraction's reasoning. Once the
 *     extraction has been confirmed (parsed_json is committed and an
 *     activity row created), the raw text is dead weight — it's the
 *     single biggest size contributor for a busy user (~10KB per
 *     extraction × N extractions).
 *
 *   - **ef-recommend**: cleared at the same time. Currently lives in
 *     the `extraction` row's raw_response slot for matcher results;
 *     v2 will move it to its own table when this seam grows.
 *
 * After clearing, a `VACUUM` reclaims the file space. VACUUM rewrites
 * the entire database, so it's slow on large dbs (~1s per 100MB) —
 * acceptable for a user-triggered cleanup.
 */

export class CacheService {
  /**
   * Returns the size (in bytes) currently used by the cache categories
   * we're willing to clear. Surfaced in the UI so the user can decide
   * whether the cleanup is worth it.
   */
  getStats(): {
    extraction_raw_bytes: number;
    extraction_raw_count: number;
    db_file_bytes: number;
  } {
    const db = getAppDb();
    const stats = db
      .prepare(
        `SELECT
           COALESCE(SUM(LENGTH(raw_response)), 0) AS bytes,
           COUNT(*) FILTER (WHERE raw_response IS NOT NULL AND status = 'parsed') AS count
         FROM extraction`,
      )
      .get() as { bytes: number; count: number };
    const pageInfo = db.prepare('PRAGMA page_count').get() as { page_count: number };
    const pageSize = db.prepare('PRAGMA page_size').get() as { page_size: number };
    return {
      extraction_raw_bytes: stats.bytes,
      extraction_raw_count: stats.count,
      db_file_bytes: pageInfo.page_count * pageSize.page_size,
    };
  }

  /**
   * Clears `extraction.raw_response` for extractions that have already
   * been confirmed (status='parsed'). Returns the number of rows
   * affected so the renderer can show "Cleared N entries, freed M KB".
   *
   * `VACUUM` is run unconditionally after — without it, the freed space
   * stays inside the database file and doesn't reduce disk usage. This
   * is the user's expected behavior from a "Clear cache" button.
   */
  clearExtractionRawCache(): { rows_cleared: number; bytes_freed: number } {
    const db = getAppDb();
    const beforeStats = this.getStats();
    const result = db
      .prepare(
        `UPDATE extraction
         SET raw_response = NULL
         WHERE raw_response IS NOT NULL AND status = 'parsed'`,
      )
      .run();
    // VACUUM cannot run inside a transaction. better-sqlite3 wraps
    // single statements implicitly, but VACUUM bypasses that — we call
    // exec directly. (Also notes from docs: VACUUM requires no other
    // open transactions, so this must NOT be inside a db.transaction()
    // wrapper.)
    db.exec('VACUUM');
    const afterStats = this.getStats();
    return {
      rows_cleared: result.changes,
      bytes_freed: Math.max(0, beforeStats.db_file_bytes - afterStats.db_file_bytes),
    };
  }
}

let serviceInstance: CacheService | null = null;
export function getCacheService(): CacheService {
  if (!serviceInstance) serviceInstance = new CacheService();
  return serviceInstance;
}
