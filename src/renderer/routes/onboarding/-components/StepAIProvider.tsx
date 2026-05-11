import { Button } from '@renderer/components/ui/button';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { clearDraft, loadDraft } from './wizardState';

export function StepAIProvider() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const completeOnboarding = useMutation({
    mutationFn: orgApi.completeOnboarding,
  });

  const finish = async (kind: 'byot' | 'skip') => {
    setSubmitting(true);
    setError(null);
    try {
      if (!draft.company || !draft.first_site || !draft.reporting_year) {
        setError('Wizard state incomplete; please restart from step 1.');
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
      localStorage.setItem('carbonbook.onboarding.ai_provider_kind', kind);
      clearDraft();
      await queryClient.invalidateQueries({ queryKey: ['org:has-any'] });
      await navigate({ to: '/' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <h2 className="text-xl font-semibold">{m.onboarding_step_ai_title()}</h2>
      <p className="text-sm text-muted-foreground">{m.onboarding_step_ai_body()}</p>

      <div className="space-y-2">
        <Button className="w-full" disabled={submitting} onClick={() => finish('byot')}>
          {m.onboarding_step_ai_byot()}
        </Button>
        <Button
          className="w-full"
          variant="outline"
          disabled={submitting}
          onClick={() => finish('skip')}
        >
          {m.onboarding_step_ai_skip()}
        </Button>
      </div>

      {submitting && <p className="text-sm text-muted-foreground">{m.onboarding_creating()}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-start pt-2">
        <Button
          variant="outline"
          disabled={submitting}
          onClick={() => navigate({ to: '/onboarding/$step', params: { step: '4' } })}
        >
          {m.onboarding_back()}
        </Button>
      </div>
    </div>
  );
}
