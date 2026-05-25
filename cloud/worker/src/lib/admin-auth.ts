import type { Env } from '../index.js';
import { err } from './responses.js';
import { requireSession } from './session.js';

/**
 * Admin gate — reuses the existing magic-link session, just adds a
 * single comparison against `env.ADMIN_EMAIL`.
 *
 * Single-admin model (the project owner). Multi-admin would need a
 * D1 `admin` table; not worth the schema for one user.
 *
 * Returns the admin's email string on success, or a 401/403 Response
 * that the route handler should return as-is.
 *
 * Why not Cloudflare Access: free tier covers it but adds an external
 * Zero Trust dependency to deploy. Magic-link auth already exists;
 * comparing one env var is cheaper than introducing a new control
 * plane.
 */
export async function requireAdmin(request: Request, env: Env): Promise<string | Response> {
  const adminEmail = env.ADMIN_EMAIL;
  if (!adminEmail) {
    // Fail closed — without an admin email configured, no one is admin.
    // Surfaces during deploy if ADMIN_EMAIL var is missing from
    // wrangler.toml / dashboard.
    return err('Internal', 'admin not configured', 500);
  }

  const claims = await requireSession(request, env.SESSION_PRIVATE_KEY_HEX);
  if (claims instanceof Response) return claims;

  if (claims.email !== adminEmail) {
    return err('Forbidden', 'admin only', 403);
  }
  return claims.email;
}
