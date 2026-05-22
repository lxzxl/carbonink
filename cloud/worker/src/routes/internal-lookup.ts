import type { Env } from '../index.js';
import { err, json } from '../lib/responses.js';

export async function handleLicenseByEmail(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('X-Activate-Page') !== '1') {
    return err('Unauthorized', 'no', 401);
  }
  const email = new URL(request.url).searchParams.get('email');
  if (!email) return err('BadRequest', 'email required', 400);
  const row = await env.DB.prepare(
    'SELECT l.humanized_key FROM license l JOIN customer c ON l.user_id = c.user_id WHERE c.email = ? ORDER BY l.issued_at DESC LIMIT 1',
  )
    .bind(email)
    .first<{ humanized_key: string }>();
  if (!row) return err('NotFound', 'no license for email', 404);
  return json({ license_key: row.humanized_key });
}
