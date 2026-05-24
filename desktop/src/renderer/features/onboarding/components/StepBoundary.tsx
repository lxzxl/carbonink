import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { useNavigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { WizardShell } from './WizardShell';
import { loadDraft, saveDraft } from './wizardState';

type Boundary = 'equity_share' | 'operational_control';

/**
 * Cards as radio-like choices. Each card has:
 *   - A bold label (matches the GHG Protocol terminology — English term
 *     is recognized industry-wide, so we keep it).
 *   - A muted body explaining when to use it.
 *   - A check mark on the right when selected.
 *
 * Selected state mirrors the company-info form's primary-bg accent so the
 * wizard reads as one design system, not a stitch of components.
 */
const OPTIONS: Array<{
  value: Boundary;
  label: string;
  body: () => string;
}> = [
  {
    value: 'operational_control',
    label: 'Operational Control',
    body: () => m.onboarding_step_boundary_operational_control(),
  },
  {
    value: 'equity_share',
    label: 'Equity Share',
    body: () => m.onboarding_step_boundary_equity_share(),
  },
];

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
    <WizardShell
      step={3}
      title={m.onboarding_step_boundary_title()}
      subtitle={m.onboarding_step_boundary_subtitle()}
      footer={
        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/onboarding/$step', params: { step: '2' } })}
          >
            {m.onboarding_back()}
          </Button>
          <Button type="button" onClick={submit}>
            {m.onboarding_next()}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {OPTIONS.map((opt) => {
          const isSelected = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(opt.value)}
              className={cn(
                'w-full rounded-lg border p-4 text-left transition-all',
                'flex items-start gap-3',
                isSelected
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-border hover:border-foreground/30 hover:bg-foreground/[0.02]',
              )}
            >
              <div className="flex-1 space-y-1">
                <div className="font-medium text-foreground">{opt.label}</div>
                <p className="text-sm text-muted-foreground leading-relaxed">{opt.body()}</p>
              </div>
              {/* Trailing check — only visible when selected. Visual
               * confirmation without competing for attention on
               * the unselected card. */}
              <div
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background',
                )}
              >
                {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
              </div>
            </button>
          );
        })}
      </div>
    </WizardShell>
  );
}
