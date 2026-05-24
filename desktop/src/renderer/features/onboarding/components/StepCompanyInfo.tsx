import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import * as m from '@renderer/paraglide/messages';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell } from './WizardShell';
import { loadDraft, saveDraft } from './wizardState';

/**
 * Reasonable Asia/Pacific defaults plus the West-Coast standards a Chinese
 * carbonink user is most likely to encounter (CDP / supply-chain
 * questionnaires from US/EU customers). Kept short — the input below
 * accepts any ISO-3166 code as a fallback.
 */
const COMMON_COUNTRIES = [
  { code: 'CN', label_zh: '中国', label_en: 'China' },
  { code: 'HK', label_zh: '香港 SAR', label_en: 'Hong Kong SAR' },
  { code: 'TW', label_zh: '台湾', label_en: 'Taiwan' },
  { code: 'JP', label_zh: '日本', label_en: 'Japan' },
  { code: 'KR', label_zh: '韩国', label_en: 'South Korea' },
  { code: 'SG', label_zh: '新加坡', label_en: 'Singapore' },
  { code: 'US', label_zh: '美国', label_en: 'United States' },
  { code: 'GB', label_zh: '英国', label_en: 'United Kingdom' },
  { code: 'DE', label_zh: '德国', label_en: 'Germany' },
];

export function StepCompanyInfo() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const form = useForm({
    defaultValues: {
      name_zh: draft.company?.name_zh ?? '',
      name_en: draft.company?.name_en ?? '',
      industry: draft.company?.industry ?? '',
      country_code: draft.company?.country_code ?? 'CN',
      boundary_kind: (draft.company?.boundary_kind ?? 'operational_control') as
        | 'equity_share'
        | 'operational_control',
    },
    onSubmit: async ({ value }) => {
      saveDraft({ ...draft, company: value });
      await navigate({ to: '/onboarding/$step', params: { step: '2' } });
    },
  });

  const formId = 'onboarding-company-form';

  return (
    <WizardShell
      step={1}
      title={m.onboarding_step_company_title()}
      subtitle={m.onboarding_step_company_subtitle()}
      footer={
        <div className="flex justify-end">
          <Button type="submit" form={formId}>
            {m.onboarding_next()}
          </Button>
        </div>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        // Group spacing: `space-y-6` between groups, tighter `space-y-1.5`
        // label↔input inside the field component itself.
        className="space-y-6"
      >
        {/* Group 1: company name (zh + en) — paired siblings sharing
         * one hint. Tight gap-3 between the two name fields signals
         * they're alternates, not independent inputs. */}
        <div className="space-y-3">
          <FieldRow>
            <Field label={m.onboarding_step_company_name_zh()}>
              <form.Field
                name="name_zh"
                children={(field) => (
                  <Input
                    id="name_zh"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="碳墨示例有限公司"
                  />
                )}
              />
            </Field>
            <Field label={m.onboarding_step_company_name_en()}>
              <form.Field
                name="name_en"
                children={(field) => (
                  <Input
                    id="name_en"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="CarbonInk Demo Co."
                  />
                )}
              />
            </Field>
          </FieldRow>
          <p className="text-xs text-muted-foreground">{m.onboarding_step_company_name_hint()}</p>
        </div>

        {/* Group 2: industry + country side-by-side. Industry is freeform
         * (no enum in v1); country is a select with common codes. */}
        <FieldRow>
          <Field label={m.onboarding_step_company_industry()}>
            <form.Field
              name="industry"
              children={(field) => (
                <Input
                  id="industry"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="科技 / Technology"
                />
              )}
            />
          </Field>
          <Field label={m.onboarding_step_company_country()}>
            <form.Field
              name="country_code"
              validators={{
                onChange: ({ value }) => (value.length >= 2 ? undefined : m.required_field()),
              }}
              children={(field) => (
                <select
                  id="country_code"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {COMMON_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label_zh} · {c.label_en}
                    </option>
                  ))}
                </select>
              )}
            />
          </Field>
        </FieldRow>
      </form>
    </WizardShell>
  );
}

/**
 * Field — label + input slot with tight 6px gap. The previous markup had
 * label and input rendered as siblings without an enforced gap, so the
 * label visually fused with the input above it. Naming this primitive
 * makes the spacing intentional and discoverable.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // The label's `htmlFor` connection is handled by the caller (matching
  // `Input.id`). Keeping that flexible because some `Field` consumers
  // wrap a `<select>` or a checkbox group.
  return (
    <div className="space-y-1.5 flex-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Two columns on ≥ sm, stack on smaller. Pair siblings naturally with
 * `gap-4`. Single-child rows render single-column on every breakpoint.
 */
function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>;
}
