import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';
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
  output: 'server',
  adapter: cloudflare(),
  integrations: [mdx()],
  vite: { plugins: [tailwindcss()] },
  i18n: {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
