import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import * as m from '@renderer/paraglide/messages';
import { loadDraft, saveDraft } from './wizardState';

type Boundary = 'equity_share' | 'operational_control';

export function StepBoundary() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const [selected, setSelected] = useState<Boundary>(
    draft.company?.boundary_kind ?? 'operational_control',
  );

  const submit = () => {
    saveDraft({ ...draft, company: { ...draft.company!, boundary_kind: selected } });
    navigate({ to: '/onboarding/$step', params: { step: '4' } });
  };

  return (
    <div className="space-y-4 max-w-xl">
      <h2 className="text-xl font-semibold">{m.onboarding_step_boundary_title()}</h2>
      <p className="text-sm text-muted-foreground">{m.onboarding_step_boundary_body()}</p>

      <div className="space-y-2">
        <button
          type="button"
          className={`w-full rounded-md border p-4 text-left ${selected === 'operational_control' ? 'border-primary bg-primary/5' : 'border-border'}`}
          onClick={() => setSelected('operational_control')}
        >
          <strong>Operational Control</strong>
          <p className="mt-1 text-sm text-muted-foreground">{m.onboarding_step_boundary_operational_control()}</p>
        </button>

        <button
          type="button"
          className={`w-full rounded-md border p-4 text-left ${selected === 'equity_share' ? 'border-primary bg-primary/5' : 'border-border'}`}
          onClick={() => setSelected('equity_share')}
        >
          <strong>Equity Share</strong>
          <p className="mt-1 text-sm text-muted-foreground">{m.onboarding_step_boundary_equity_share()}</p>
        </button>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => navigate({ to: '/onboarding/$step', params: { step: '2' } })}>
          {m.onboarding_back()}
        </Button>
        <Button onClick={submit}>{m.onboarding_next()}</Button>
      </div>
    </div>
  );
}
