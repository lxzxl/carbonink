import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import * as m from '@renderer/paraglide/messages';
import { loadDraft, saveDraft } from './wizardState';

export function StepFirstSite() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const form = useForm({
    defaultValues: {
      name_zh: draft.first_site?.name_zh ?? '',
      name_en: draft.first_site?.name_en ?? '',
      address: draft.first_site?.address ?? '',
      country_code: draft.first_site?.country_code ?? draft.company?.country_code ?? 'CN',
    },
    onSubmit: async ({ value }) => {
      saveDraft({ ...draft, first_site: value });
      await navigate({ to: '/onboarding/$step', params: { step: '5' } });
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4 max-w-md">
      <h2 className="text-xl font-semibold">{m.onboarding_step_site_title()}</h2>
      <p className="text-sm text-muted-foreground">{m.onboarding_step_site_body()}</p>

      <form.Field name="name_zh" children={(f) => (
        <div>
          <Label htmlFor="site_name_zh">{m.onboarding_step_site_name_zh()}</Label>
          <Input id="site_name_zh" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
        </div>
      )} />

      <form.Field name="name_en" children={(f) => (
        <div>
          <Label htmlFor="site_name_en">{m.onboarding_step_site_name_en()}</Label>
          <Input id="site_name_en" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
        </div>
      )} />

      <form.Field name="address" children={(f) => (
        <div>
          <Label htmlFor="site_address">{m.onboarding_step_site_address()}</Label>
          <Input id="site_address" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
        </div>
      )} />

      <form.Field name="country_code" children={(f) => (
        <div>
          <Label htmlFor="site_country">{m.onboarding_step_site_country()}</Label>
          <Input id="site_country" value={f.state.value} onChange={(e) => f.handleChange(e.target.value.toUpperCase())} maxLength={3} />
        </div>
      )} />

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => navigate({ to: '/onboarding/$step', params: { step: '3' } })}>
          {m.onboarding_back()}
        </Button>
        <Button type="submit">{m.onboarding_next()}</Button>
      </div>
    </form>
  );
}
