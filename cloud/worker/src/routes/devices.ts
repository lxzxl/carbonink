import type { LicenseActiveRecord } from '@carbonbook-cloud/shared';
import type { Env } from '../index.js';
import { err, json } from '../lib/responses.js';
import { requireSession } from '../lib/session.js';

export async function handleDeactivateDevice(request: Request, env: Env): Promise<Response> {
  const session = await requireSession(request, env.SESSION_PRIVATE_KEY_HEX);
  if (session instanceof Response) return session;

  // Path: /v1/devices/<device_id>/deactivate
  const segments = new URL(request.url).pathname.split('/').filter(Boolean);
  const deviceId = segments[2];
  if (!deviceId) return err('BadRequest', 'missing device_id', 400);

  const row = await env.DB.prepare(
    `SELECT d.license_id FROM device d
     JOIN license l ON d.license_id = l.license_id
     WHERE d.device_id = ? AND l.user_id = ?`,
  )
    .bind(deviceId, session.sub)
    .first<{ license_id: string }>();
  if (!row) return err('NotFound', 'device not found for this account', 404);

  // Update KV BEFORE D1: a stale D1 row after a partial failure is far less
  // serious than a still-active KV record for a "deactivated" device (which
  // would let `/verify` keep accepting it until the next refresh).
  const raw = await env.LICENSE_ACTIVE.get(`la:${row.license_id}`);
  if (raw) {
    const rec = JSON.parse(raw) as LicenseActiveRecord;
    rec.device_ids = rec.device_ids.filter((d) => d !== deviceId);
    await env.LICENSE_ACTIVE.put(`la:${row.license_id}`, JSON.stringify(rec));
  }

  await env.DB.prepare('DELETE FROM device WHERE device_id = ? AND license_id = ?')
    .bind(deviceId, row.license_id)
    .run();

  return json({ ok: true });
}
