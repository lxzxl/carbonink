import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

describe('health endpoint', () => {
  it('GET /health returns 200 with status ok', async () => {
    const req = new Request('https://carbonink.xyz/api/health');
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe('ok');
  });

  it('unknown route returns 404', async () => {
    const req = new Request('https://carbonink.xyz/api/nope');
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
  });
});
