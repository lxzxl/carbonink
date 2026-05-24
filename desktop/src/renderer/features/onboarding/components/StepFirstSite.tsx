import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import * as m from '@renderer/paraglide/messages';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell } from './WizardShell';
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

  const formId = 'onboarding-site-form';

  return (
    <WizardShell
      step={4}
      title={m.onboarding_step_site_title()}
      subtitle={m.onboarding_step_site_subtitle()}
      footer={
        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/onboarding/$step', params: { step: '3' } })}
          >
            {m.onboarding_back()}
          </Button>
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
        className="space-y-5"
      >
        {/* Name pair (zh + en) — same paired pattern as the company step
         * for visual consistency across the wizard. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="site_name_zh">{m.onboarding_step_site_name_zh()}</Label>
            <form.Field
              name="name_zh"
              children={(f) => (
                <Input
                  id="site_name_zh"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder="北京总部"
                />
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site_name_en">{m.onboarding_step_site_name_en()}</Label>
            <form.Field
              name="name_en"
              children={(f) => (
                <Input
                  id="site_name_en"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  placeholder="Beijing HQ"
                />
              )}
            />
          </div>
        </div>

        {/* Address: full width — typically a long string, deserves its
         * own row. */}
        <div className="space-y-1.5">
          <Label htmlFor="site_address">{m.onboarding_step_site_address()}</Label>
          <form.Field
            name="address"
            children={(f) => (
              <Input
                id="site_address"
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value)}
                placeholder="北京市朝阳区某某路 1 号"
              />
            )}
          />
        </div>

        {/* Country: narrow, half-width — mirrors how the company step
         * lays country alongside industry rather than full-row. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="site_country">{m.onboarding_step_site_country()}</Label>
            <form.Field
              name="country_code"
              children={(f) => (
                <Input
                  id="site_country"
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value.toUpperCase())}
                  maxLength={3}
                  className="max-w-[140px]"
                />
              )}
            />
          </div>
        </div>
      </form>
    </WizardShell>
  );
}
