import { z } from 'zod';
import { optionalString } from './_helpers.js';

export const organizationKindEnum = z.enum([
  'equity_share',
  'financial_control',
  'operational_control',
]);

export const organizationCreateInput = z
  .object({
    name_zh: optionalString({ max: 255 }),
    name_en: optionalString({ max: 255 }),
    industry: optionalString({ max: 100 }),
    country_code: z.string().min(2).max(3),
    boundary_kind: organizationKindEnum,
  })
  .refine((v) => v.name_zh || v.name_en, {
    message: 'At least one of name_zh / name_en is required',
  });

export const organization = z.object({
  id: z.string(),
  name_zh: z.string().nullable(),
  name_en: z.string().nullable(),
  industry: z.string().nullable(),
  country_code: z.string(),
  boundary_kind: organizationKindEnum,
  responsible_person_name: z.string().nullable(),
  responsible_person_role: z.string().nullable(),
  base_year_period_id: z.string().nullable(),
  recalc_threshold_pct: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Organization = z.infer<typeof organization>;
export type OrganizationCreateInput = z.infer<typeof organizationCreateInput>;
