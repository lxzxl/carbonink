import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * `guides` — the SEO content layer (see docs/plans/2026-07-03-seo-phase1.md).
 *
 * Files live at `src/content/guides/{en,zh}/<slug>.mdx`; the locale is the
 * first path segment of the entry id. Guides MUST ship in en+zh pairs with
 * the same slug — Base.astro derives hreflang alternates mechanically from
 * the URL, so a missing mirror would advertise a 404 to Google.
 *
 * `related` holds bare slugs (no locale prefix); GuideLayout resolves them
 * within the entry's own locale.
 */
const guides = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    related: z.array(z.string()).default([]),
  }),
});

export const collections = { guides };
