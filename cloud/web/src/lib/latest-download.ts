/**
 * Resolve the marketing "Download" buttons to the latest GitHub Release
 * asset at request time, so the site never hard-codes a version and a
 * fresh release is picked up with zero rebuild.
 *
 * Why a worker redirect (not a static `releases/latest/download/<name>`
 * link): electron-builder artifact names embed the version
 * (`CarbonInk-1.2.3-arm64.dmg`), so there is no stable filename to link
 * to. We query the GitHub API for the latest release and 302 to the
 * matching asset's `browser_download_url`.
 *
 * Rate limit: GitHub's unauthenticated API is 60 req/hr per IP, and a
 * Worker shares one egress IP across every visitor — a click storm would
 * blow through it. So we cache the *resolved URL* (a tiny 200 body) in
 * the edge cache for 10 min, which bounds API calls to ~6/hr/asset. The
 * actual redirect is rebuilt fresh each call from the cached URL (the CF
 * Cache API is finicky about storing 3xx responses directly).
 */

const REPO = 'lxzxl/carbonink';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const CACHE_TTL_S = 600; // 10 min

// Match a release asset filename to a platform/arch key. Names come from
// electron-builder: mac → `CarbonInk-<ver>-arm64.dmg` (Apple Silicon) and
// `CarbonInk-<ver>.dmg` (Intel, no arch token); win → `CarbonInk Setup
// <ver>.exe`. `.blockmap` siblings end in `.blockmap`, so the extension
// test excludes them.
const MATCHERS: Record<string, (name: string) => boolean> = {
  'mac-arm64': (n) => n.endsWith('.dmg') && /arm64/i.test(n),
  'mac-x64': (n) => n.endsWith('.dmg') && !/arm64/i.test(n),
  'win-x64': (n) => n.endsWith('.exe'),
};

interface GithubRelease {
  assets?: Array<{ name: string; browser_download_url: string }>;
}

async function fetchLatestAssetUrl(key: string): Promise<string | null> {
  const match = MATCHERS[key];
  if (!match) return null;
  // GitHub requires a User-Agent or it 403s unauthenticated requests.
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'carbonink-web', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  const release = (await res.json()) as GithubRelease;
  const asset = (release.assets ?? []).find((a) => match(a.name));
  return asset?.browser_download_url ?? null;
}

/**
 * Build a 302 to the latest installer for `key` (`mac-arm64` | `mac-x64`
 * | `win-x64`). Falls back to the releases page if the asset can't be
 * resolved (e.g. no release yet, or GitHub is down) so the user always
 * lands somewhere useful instead of a 404.
 */
export async function redirectToLatest(key: string): Promise<Response> {
  // `caches` is a Workers global; absent under `astro dev` (Node) — guard
  // so dev/preview just hit the API directly without caching.
  const cache = (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(`https://dl.carbonink.xyz/_latest/${key}`);

  let target: string | null = null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) target = (await hit.text()) || null;
  }

  if (!target) {
    target = await fetchLatestAssetUrl(key);
    if (target && cache) {
      await cache.put(
        cacheKey,
        new Response(target, { headers: { 'Cache-Control': `public, max-age=${CACHE_TTL_S}` } }),
      );
    }
  }

  if (!target) {
    return new Response(null, { status: 302, headers: { Location: RELEASES_PAGE } });
  }
  return new Response(null, {
    status: 302,
    headers: { Location: target, 'Cache-Control': `public, max-age=${CACHE_TTL_S}` },
  });
}
