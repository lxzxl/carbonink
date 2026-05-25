import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { orgApi } from '@renderer/lib/api/organization';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { WizardShell } from './WizardShell';
import { clearDraft, loadDraft } from './wizardState';

export function StepAIProvider() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const [submitting, setSubmitting] = useState(false);

  const queryClient = useQueryClient();
  const completeOnboarding = useMutation({
    mutationFn: orgApi.completeOnboarding,
  });

  const finish = async (kind: 'byot' | 'skip') => {
    setSubmitting(true);
    try {
      if (!draft.company || !draft.first_site || !draft.reporting_year) {
        toast.error('Failed to complete onboarding', {
          description: 'Wizard state incomplete; please restart from step 1.',
        });
        return;
      }
      // Defensive: catch the same name-empty case before the IPC hop.
      // Steps 1 and 4 already validate this, but a backup makes the
      // failure mode obvious if a user somehow lands here with stale
      // localStorage (e.g. they opened the wizard in two windows or
      // ran the app before this validator existed).
      const companyHasName =
        (draft.company.name_zh ?? '').trim() || (draft.company.name_en ?? '').trim();
      const siteHasName =
        (draft.first_site.name_zh ?? '').trim() || (draft.first_site.name_en ?? '').trim();
      if (!companyHasName) {
        toast.error('Company name required', {
          description: 'Go back to step 1 and enter a Chinese or English company name.',
        });
        await navigate({ to: '/onboarding/$step', params: { step: '1' } });
        return;
      }
      if (!siteHasName) {
        toast.error('Site name required', {
          description: 'Go back to step 4 and enter a Chinese or English site name.',
        });
        await navigate({ to: '/onboarding/$step', params: { step: '4' } });
        return;
      }
      await completeOnboarding.mutateAsync({
        organization: {
          name_zh: draft.company.name_zh,
          name_en: draft.company.name_en,
          industry: draft.company.industry,
          country_code: draft.company.country_code,
          boundary_kind: draft.company.boundary_kind,
        },
        first_site: {
          name_zh: draft.first_site.name_zh,
          name_en: draft.first_site.name_en,
          address: draft.first_site.address,
          country_code: draft.first_site.country_code,
        },
        reporting_period: {
          year: draft.reporting_year,
          granularity: 'annual',
        },
      });
      localStorage.setItem('carbonink.onboarding.ai_provider_kind', kind);
      clearDraft();
      await queryClient.invalidateQueries({ queryKey: ['org:has-any'] });
      await navigate({ to: '/' });
    } catch (e) {
      toast.error(m.onboarding_complete_failed(), {
        description: friendlyErrorDescription(e),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WizardShell
      step={5}
      title={m.onboarding_step_ai_title()}
      subtitle={m.onboarding_step_ai_subtitle()}
      footer={
        <div className="flex justify-between items-center">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => navigate({ to: '/onboarding/$step', params: { step: '4' } })}
          >
            {m.onboarding_back()}
          </Button>
          {submitting && <p className="text-sm text-muted-foreground">{m.onboarding_creating()}</p>}
        </div>
      }
    >
      {/* Two stacked CTAs — the "primary" one (BYO key) is filled, the
       * "skip" is outline. Wide buttons for the last-mile call to action
       * since this step ends the wizard. */}
      <div className="space-y-3">
        <Button
          type="button"
          className="w-full justify-start h-auto py-3 px-4"
          disabled={submitting}
          onClick={() => finish('byot')}
        >
          <span className="text-left">{m.onboarding_step_ai_byot()}</span>
        </Button>
        <Button
          type="button"
          className="w-full justify-start h-auto py-3 px-4"
          variant="outline"
          disabled={submitting}
          onClick={() => finish('skip')}
        >
          <span className="text-left">{m.onboarding_step_ai_skip()}</span>
        </Button>
      </div>
    </WizardShell>
  );
}
