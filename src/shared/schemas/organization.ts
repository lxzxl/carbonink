import { z } from 'zod';
import { optionalString } from './_helpers.js';

export const organizationKindEnum = z.enum(['equity_share', 'operational_control']);

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
  created_at: z.string(),
  updated_at: z.string(),
});

export type Organization = z.infer<typeof organization>;
export type OrganizationCreateInput = z.infer<typeof organizationCreateInput>;
