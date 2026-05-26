import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

/**
 * Single merged Astro site — serves everything except `/api/*`.
 *
 * Topology after the 3-site merge:
 *   carbonink.xyz/api/*  → carbonink-cloud-api (separate worker, backend)
 *   carbonink.xyz/*      → this worker (marketing + activate + account)
 *
 * Hybrid output: `output: 'server'` means default-SSR, but every page
 * that doesn't need request-time data opts back into prerender via
 * `export const prerender = true`. The marketing static pages
 * (`/`, `/pricing`, `/download`, `/privacy`, + their `/en/*`
 * mirrors) all prerender; activate / account / login serve via
 * SSR. Net effect — marketing pages are still CDN-cached HTML; the
 * portal pages get the request context they need.
 */
export default defineConfig({
  // `site` is required for @astrojs/sitemap to emit absolute URLs +
  // for canonical-link generation elsewhere. Don't set `base` — we
  // serve from the apex.
  site: 'https://carbonink.xyz',
  output: 'server',
  adapter: cloudflare(),
  integrations: [
    mdx(),
    // Sitemap is the single fastest way to get a brand-new domain
    // indexed by Google. Emits `/sitemap-index.xml` (referencing
    // per-locale sitemap files) so submitting it via Google Search
    // Console exposes every prerendered marketing page at once.
    //
    // SSR pages (activate / account / admin / login) are
    // automatically excluded — the integration only walks
    // prerendered routes. Explicit `filter` keeps it that way even
    // if a stray prerender flag flips later.
    //
    // `i18n` makes the sitemap emit hreflang relationships between
    // zh-CN and en mirror pages so Google understands `/pricing` and
    // `/en/pricing` are the same content in two languages.
    sitemap({
      filter: (page) => {
        // Block portal / auth / admin surfaces from the sitemap —
        // they're either SSR-only, behind auth, or internal.
        const path = new URL(page).pathname;
        if (path.startsWith('/activate')) return false;
        if (path.startsWith('/account')) return false;
        if (path.startsWith('/admin')) return false;
        if (path.includes('/login')) return false;
        if (path.startsWith('/en/activate')) return false;
        if (path.startsWith('/en/account')) return false;
        if (path.includes('/en/login')) return false;
        return true;
      },
      i18n: {
        defaultLocale: 'zh-CN',
        locales: {
          'zh-CN': 'zh-CN',
          en: 'en',
        },
      },
    }),
  ],
  vite: { plugins: [tailwindcss()] },
  i18n: {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
