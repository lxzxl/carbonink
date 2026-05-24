import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const STABLE_MAC_YML = `version: 0.5.0
files:
  - url: https://releases.carbonink.xyz/darwin-arm64/0.5.0/carbonink-0.5.0-arm64.dmg
    sha512: deadbeef
    size: 84629184
releaseDate: '2026-06-01T00:00:00Z'
`;

async function get(path: string): Promise<Response> {
  const req = new Request(`https://carbonink.xyz/api${path}`);
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe('GET /v1/updates/:channel/:file', () => {
  beforeEach(async () => {
    await env.RELEASES.put('updates/stable/latest-mac.yml', STABLE_MAC_YML);
  });

  it('serves latest-mac.yml as text/yaml', async () => {
    const res = await get('/v1/updates/stable/latest-mac.yml');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/yaml/);
    expect(res.headers.get('Cache-Control')).toMatch(/max-age=300/);
    expect(await res.text()).toBe(STABLE_MAC_YML);
  });

  it('returns 404 when the manifest is missing', async () => {
    const res = await get('/v1/updates/beta/latest.yml');
    expect(res.status).toBe(404);
  });

  it('rejects unknown channels with 400', async () => {
    const res = await get('/v1/updates/internal/latest.yml');
    expect(res.status).toBe(400);
  });

  it('rejects unknown filenames with 400', async () => {
    const res = await get('/v1/updates/stable/latest-linux.yml');
    expect(res.status).toBe(400);
  });
});
