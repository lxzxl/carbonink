import type { LicenseActiveRecord } from '@carbonbook-cloud/shared';
import type { Env } from '../index.js';

/**
 * Daily sweep: for every license whose `revoked_at` has passed but is
 * not yet flipped, set `revoked = 1` in D1 and `revoked: true` in KV,
 * and append to the REVOCATION_SET list.
 */
export async function runRevocationSweep(
  env: Env,
  nowSeconds: number,
): Promise<{ flipped: string[] }> {
  const rows = await env.DB.prepare(
    'SELECT license_id FROM license WHERE revoked = 0 AND revoked_at IS NOT NULL AND revoked_at <= ?',
  )
    .bind(nowSeconds)
    .all<{ license_id: string }>();

  const flipped: string[] = [];
  for (const row of rows.results ?? []) {
    await env.DB.prepare('UPDATE license SET revoked = 1 WHERE license_id = ?')
      .bind(row.license_id)
      .run();
    const raw = await env.LICENSE_ACTIVE.get(`la:${row.license_id}`);
    if (raw) {
      const rec = JSON.parse(raw) as LicenseActiveRecord;
      rec.revoked = true;
      await env.LICENSE_ACTIVE.put(`la:${row.license_id}`, JSON.stringify(rec));
    }
    flipped.push(row.license_id);
  }

  if (flipped.length > 0) {
    const existing = await env.REVOCATION_SET.get('list');
    const set = existing
      ? (JSON.parse(existing) as { license_ids: string[] })
      : { license_ids: [] };
    const merged = Array.from(new Set([...set.license_ids, ...flipped]));
    await env.REVOCATION_SET.put(
      'list',
      JSON.stringify({ license_ids: merged, updated_at: nowSeconds }),
    );
  }
  return { flipped };
}
