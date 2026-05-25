import { z } from 'zod';

// ---- /v1/activate ----
export const activateRequestSchema = z.object({
  license_key: z
    .string()
    .regex(
      /^cik-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/i,
    ),
  device_id: z.string().min(1),
  app_version: z.string().min(1),
  os: z.string().min(1),
});

export const activateSuccessSchema = z.object({
  jwt: z.string(),
  claims: z.object({
    iss: z.string(),
    license_id: z.string(),
    user_id: z.string(),
    plan: z.string(),
    features: z.array(z.string()),
    devices_max: z.number(),
    issued_at: z.number(),
    expires_at: z.number(),
    grace_until: z.number(),
    revocation_check_after: z.number(),
  }),
});

// ---- /v1/verify ----
export const verifyRequestSchema = z.object({
  license_id: z.string().min(1),
  device_id: z.string().min(1),
  app_version: z.string().min(1),
  os: z.string().min(1),
});

// ---- /v1/trial-signup ----
export const trialSignupRequestSchema = z.object({
  email: z.string().email(),
  country_hint: z.string().max(2).optional(),
  device_id: z.string().min(1),
  app_version: z.string().min(1),
});

// ---- /v1/license-request ----
// Marketing site CTA: user expresses interest in early access without
// going through trial-signup (no device yet — they haven't installed).
// Logged to D1 so we can manually issue license keys + reach out.
// Lang is captured for follow-up email tone; source for funnel
// attribution (pricing page vs. account page).
export const licenseRequestSchema = z.object({
  email: z.string().email(),
  source: z.enum(['pricing-page', 'account-page', 'home', 'other']).optional(),
  lang: z.enum(['zh-CN', 'en']).optional(),
});
export type LicenseRequest = z.infer<typeof licenseRequestSchema>;

// ---- Shared JWT claim shape ----
export const jwtClaimsSchema = z.object({
  iss: z.string().min(1),
  license_id: z.string().min(1),
  user_id: z.string().min(1),
  plan: z.string().min(1),
  features: z.array(z.string()).min(1),
  devices_max: z.number().int().positive(),
  issued_at: z.number().int().nonnegative(),
  expires_at: z.number().int().nonnegative(),
  grace_until: z.number().int().nonnegative(),
  support_until: z.number().int().nonnegative().optional(),
  revocation_check_after: z.number().int().nonnegative(),
});

export type ActivateRequest = z.infer<typeof activateRequestSchema>;
export type VerifyRequest = z.infer<typeof verifyRequestSchema>;
export type TrialSignupRequest = z.infer<typeof trialSignupRequestSchema>;
