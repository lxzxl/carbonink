import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import * as m from '@renderer/paraglide/messages';
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
      boundary_kind: (draft.company?.boundary_kind ?? 'operational_control') as 'equity_share' | 'operational_control',
    },
    onSubmit: async ({ value }) => {
      saveDraft({ ...draft, company: value });
      await navigate({ to: '/onboarding/$step', params: { step: '2' } });
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4 max-w-md">
      <h2 className="text-xl font-semibold">{m.onboarding_step_company_title()}</h2>

      <form.Field
        name="name_zh"
        children={(field) => (
          <div>
            <Label htmlFor="name_zh">{m.onboarding_step_company_name_zh()}</Label>
            <Input id="name_zh" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </div>
        )}
      />

      <form.Field
        name="name_en"
        children={(field) => (
          <div>
            <Label htmlFor="name_en">{m.onboarding_step_company_name_en()}</Label>
            <Input id="name_en" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </div>
        )}
      />

      <form.Field
        name="industry"
        children={(field) => (
          <div>
            <Label htmlFor="industry">{m.onboarding_step_company_industry()}</Label>
            <Input id="industry" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </div>
        )}
      />

      <form.Field
        name="country_code"
        validators={{ onChange: ({ value }) => (value.length >= 2 ? undefined : m.required_field()) }}
        children={(field) => (
          <div>
            <Label htmlFor="country_code">{m.onboarding_step_company_country()}</Label>
            <Input id="country_code" value={field.state.value} onChange={(e) => field.handleChange(e.target.value.toUpperCase())} maxLength={3} />
          </div>
        )}
      />

      <div className="flex justify-end pt-2">
        <Button type="submit">{m.onboarding_next()}</Button>
      </div>
    </form>
  );
}
