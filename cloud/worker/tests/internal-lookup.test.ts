import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import { seedLicense } from './_fixtures.js';

async function lookup(email: string, withHeader = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (withHeader) headers['X-Activate-Page'] = '1';
  const req = new Request(
    `https://carbonbook.app/api/v1/internal/license-by-email?email=${encodeURIComponent(email)}`,
    { headers },
  );
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('GET /v1/internal/license-by-email', () => {
  it('rejects requests without the X-Activate-Page header', async () => {
    const res = await lookup('u@example.com', false);
    expect(res.status).toBe(401);
  });

  it('returns the most recent license_key for a known email', async () => {
    await seedLicense({
      userId: 'usr_byemail',
      licenseId: 'lic_byemail',
      humanizedKey: 'cbk-2345b-2345b-2345b-2345b',
    });
    // The seeded customer email is `usr_byemail@example.com` per _fixtures.ts default.
    const res = await lookup('usr_byemail@example.com');
    expect(res.status).toBe(200);
    const body = await res.json<{ license_key: string }>();
    expect(body.license_key).toBe('cbk-2345b-2345b-2345b-2345b');
  });

  it('returns 404 for an unknown email', async () => {
    const res = await lookup('missing@example.com');
    expect(res.status).toBe(404);
  });
});
