import { z } from 'zod';

export const wizardDraft = z.object({
  company: z
    .object({
      name_zh: z.string().optional(),
      name_en: z.string().optional(),
      industry: z.string().optional(),
      country_code: z.string().min(2),
      boundary_kind: z.enum(['equity_share', 'operational_control']),
    })
    .optional(),
  reporting_year: z.number().int().min(2020).max(2030).optional(),
  first_site: z
    .object({
      name_zh: z.string().optional(),
      name_en: z.string().optional(),
      address: z.string().optional(),
      country_code: z.string().min(2),
    })
    .optional(),
  ai_provider_kind: z.enum(['byot', 'oauth', 'compat', 'skip']).optional(),
});
export type WizardDraft = z.infer<typeof wizardDraft>;

const STORAGE_KEY = 'carbonink.onboarding.draft';

export function loadDraft(): WizardDraft {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return wizardDraft.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveDraft(d: WizardDraft): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

export function clearDraft(): void {
  localStorage.removeItem(STORAGE_KEY);
}
