import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import * as m from '@renderer/paraglide/messages';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { COMMON_COUNTRIES, INDUSTRIES } from '../lookups';
import { WizardShell } from './WizardShell';
import { loadDraft, saveDraft } from './wizardState';

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
    // Form-level guard: backend schema in `shared/schemas/organization.ts`
    // requires at least one of `name_zh`/`name_en`. Catching this client-
    // side keeps the user from clicking through 4 more steps only to hit
    // the final `org:complete-onboarding` rejection at step 5. The inline
    // hint already explains the rule; this validator enforces it.
    validators: {
      onSubmit: ({ value }) => {
        if (!value.name_zh.trim() && !value.name_en.trim()) {
          return m.onboarding_step_company_name_hint();
        }
        return undefined;
      },
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
            <Field htmlFor="name_zh" label={m.onboarding_step_company_name_zh()}>
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
            <Field htmlFor="name_en" label={m.onboarding_step_company_name_en()}>
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
          {/* Hint flips red when the form-level validator has fired
           * (user clicked Next without filling either name). Same copy
           * doubles as the inline guidance and the error message —
           * avoids defining a separate "you need at least one" error
           * that the user has already read above. */}
          <form.Subscribe
            selector={(state) => state.errorMap.onSubmit}
            children={(error) => (
              <p className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                {m.onboarding_step_company_name_hint()}
              </p>
            )}
          />
        </div>

        {/* Group 2: industry + country side-by-side. Industry is freeform
         * (no enum in v1); country is a select with common codes. */}
        <FieldRow>
          <Field htmlFor="industry" label={m.onboarding_step_company_industry()}>
            <form.Field
              name="industry"
              children={(field) => (
                // Native select matches the country selector style for
                // the row; the placeholder option is non-selectable
                // (empty value + disabled) so the picker shows "请选择"
                // until the user makes a choice, but the field is still
                // optional at submit time. If a user truly doesn't see
                // a fit, `other` is the bottom entry.
                <select
                  id="industry"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="" disabled>
                    {m.onboarding_step_company_industry_placeholder()}
                  </option>
                  {INDUSTRIES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label_zh} · {opt.label_en}
                    </option>
                  ))}
                </select>
              )}
            />
          </Field>
          <Field htmlFor="country_code" label={m.onboarding_step_company_country()}>
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
 *
 * `htmlFor` is required so `<label>` associates with the input by id —
 * Testing Library's `getByLabelText` relies on this association, and
 * native form behavior (click-label-focuses-input) does too.
 */
function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 flex-1">
      <Label htmlFor={htmlFor}>{label}</Label>
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
