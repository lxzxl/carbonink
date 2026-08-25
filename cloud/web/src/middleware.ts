import { defineMiddleware } from 'astro:middleware';

/**
 * Agent-facing 404 bodies.
 *
 * The site's hard rule: a nonexistent path ALWAYS returns a real 404
 * status — never a 200 with app shell — so crawlers and agents can
 * trust that the code means what it says. `pages/404.astro` covers
 * browsers; this middleware gives non-HTML clients a short markdown
 * body pointing at the machine-readable indexes instead of markup:
 *
 * - `Accept` without `text/html` (curl's wildcard accept, most agent
 *   harnesses, or no header at all) → `text/markdown`.
 * - `.md` / `.txt` suffixed paths → markdown regardless of Accept —
 *   an agent asking for a doc-shaped path wants text.
 *
 * Only runs on requests that already missed Static Assets (asset hits
 * short-circuit before the worker is invoked), so the hot path pays
 * nothing. Status stays 404 either way; `Vary: Accept` keeps any
 * downstream cache from mixing the two bodies for one URL.
 */
const markdown404 = (path: string): string => `# 404 — Not Found

\`${path}\` does not exist on carbonink.xyz — the marketing site of
CarbonInk (碳墨), free open-source (MIT) carbon accounting software
for macOS & Windows that runs fully offline.

Start from these instead:

- https://carbonink.xyz/llms.txt — product summary written for AI assistants
- https://carbonink.xyz/sitemap-index.xml — every public page
- https://carbonink.xyz/guides/ — how-to guides (中文: https://carbonink.xyz/zh/guides/)
- https://github.com/lxzxl/carbonink — source code

This response always carries HTTP status 404; if a URL is not in the
sitemap, it does not exist.
`;

function prefersMarkdown(pathname: string, request: Request): boolean {
  if (/\.(md|txt)$/.test(pathname)) return true;
  const accept = request.headers.get('accept');
  return !accept?.includes('text/html');
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Capture BEFORE next(): routing rewrites context.url to `/404/` for
  // not-found handling, and the body must echo the URL the client asked
  // for, not Astro's internal fallback path.
  const requestedPath = context.url.pathname;
  const response = await next();
  if (response.status !== 404 || !prefersMarkdown(requestedPath, context.request)) {
    return response;
  }
  return new Response(markdown404(requestedPath), {
    status: 404,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Vary: 'Accept',
      'X-Robots-Tag': 'noindex',
    },
  });
});
