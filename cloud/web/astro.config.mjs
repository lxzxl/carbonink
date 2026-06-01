import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/**
 * Static Astro marketing site — serves all of `carbonink.xyz/*`.
 *
 * Every page is prerendered (`export const prerender = true`) to
 * CDN-cached HTML: `/`, `/download`, `/privacy` + their `/zh/`
 * mirrors. There are no SSR / portal pages anymore — the open-source
 * pivot retired the activate / account / admin flows and the `/api/*`
 * backend. `output: 'server'` is kept only because the Cloudflare
 * adapter emits the Static-Assets worker entry from it; with every
 * route prerendered the net effect is a fully static site.
 */
export default defineConfig({
  // `site` is required for @astrojs/sitemap to emit absolute URLs +
  // for canonical-link generation elsewhere. Don't set `base` — we
  // serve from the apex.
  site: 'https://carbonink.xyz',
  // Legacy /en/* redirects live in `public/_redirects` (CF splat
  // syntax) — Astro's `redirects` config mistranslates `[...rest]`
  // into a broken `/en/*/index.html` target for the Cloudflare
  // adapter, so we hand-write the rule instead.
  output: 'server',
  adapter: cloudflare(),
  integrations: [
    mdx(),
    // Sitemap is the single fastest way to get a brand-new domain
    // indexed by Google. Emits `/sitemap-index.xml` (referencing
    // per-locale sitemap files) so submitting it via Google Search
    // Console exposes every prerendered marketing page at once.
    //
    // The retired portal/auth surfaces (activate / account / admin /
    // login) no longer exist; the `filter` below stays as a defensive
    // guard so they never leak into the sitemap if a stub ever returns.
    //
    // `i18n` makes the sitemap emit hreflang relationships between the
    // en (apex) and zh (`/zh/`) mirror pages so Google understands
    // `/download` and `/zh/download` are the same content in two
    // languages.
    sitemap({
      filter: (page) => {
        // Block portal / auth / admin surfaces from the sitemap —
        // they're either SSR-only, behind auth, or internal.
        const path = new URL(page).pathname;
        if (path.startsWith('/activate')) return false;
        if (path.startsWith('/account')) return false;
        if (path.startsWith('/admin')) return false;
        if (path.includes('/login')) return false;
        if (path.startsWith('/zh/activate')) return false;
        if (path.startsWith('/zh/account')) return false;
        if (path.includes('/zh/login')) return false;
        return true;
      },
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: 'en',
          'zh-CN': 'zh',
        },
      },
      // `lastmod` (= build time) + `changefreq` tells Google how
      // often we ship updates and when this URL last changed. Both
      // are scheduling hints — Google ignores them when its own
      // crawl-history disagrees, but on a fresh domain with no
      // history they meaningfully nudge the first-pass priority.
      //
      // `priority` is per-URL (0.0–1.0); we put `1.0` on the two
      // home pages and `0.7` on the rest so Google's "first crawl"
      // budget lands on / + /en/ ahead of /privacy/. Without these
      // every URL defaults to 0.5 and the crawler treats them
      // equally.
      serialize: (item) => {
        item.lastmod = new Date().toISOString();
        item.changefreq = 'monthly';
        const path = new URL(item.url).pathname;
        item.priority = path === '/' || path === '/zh/' ? 1.0 : 0.7;
        return item;
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
  i18n: {
    // English is the default locale — served unprefixed at the apex
    // (`/`, `/download/`, …). Chinese lives under `/zh/` via the custom
    // `path` mapping (locale code stays `zh-CN`; the URL segment is the
    // shorter `zh`). `prefixDefaultLocale: false` keeps en at the root.
    defaultLocale: 'en',
    locales: ['en', { path: 'zh', codes: ['zh-CN'] }],
    routing: { prefixDefaultLocale: false },
  },
});
