import type { Env } from '../index.js';
import { err } from '../lib/responses.js';

const ALLOWED_CHANNELS = new Set(['stable', 'beta']);
const ALLOWED_FILES = new Set(['latest.yml', 'latest-mac.yml']);

export async function handleUpdates(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 4) return err('NotFound', 'invalid update path', 404);
  const [, , channel, file] = segments as [string, string, string, string];
  if (!ALLOWED_CHANNELS.has(channel)) return err('BadRequest', `unknown channel '${channel}'`, 400);
  if (!ALLOWED_FILES.has(file)) return err('BadRequest', `unknown manifest file '${file}'`, 400);

  const obj = await env.RELEASES.get(`updates/${channel}/${file}`);
  if (!obj) return err('NotFound', 'no manifest published for this channel', 404);

  const body = await obj.text();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
