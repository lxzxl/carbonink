import { z } from 'zod';
import { optionalString } from './_helpers.js';

export const siteCreateInputBase = z.object({
  organization_id: z.string(),
  name_zh: optionalString({ max: 255 }),
  name_en: optionalString({ max: 255 }),
  address: optionalString({ max: 500 }),
  country_code: z.string().min(2).max(3),
});

export const siteCreateInput = siteCreateInputBase.refine(
  (v) => v.name_zh || v.name_en,
  { message: 'At least one of name_zh / name_en is required' },
);

export const site = z.object({
  id: z.string(),
  organization_id: z.string(),
  name_zh: z.string().nullable(),
  name_en: z.string().nullable(),
  address: z.string().nullable(),
  country_code: z.string(),
  is_active: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Site = z.infer<typeof site>;
export type SiteCreateInput = z.infer<typeof siteCreateInput>;
