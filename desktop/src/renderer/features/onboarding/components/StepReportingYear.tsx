import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { WizardShell } from './WizardShell';
import { loadDraft, saveDraft } from './wizardState';

/**
 * Quick-pick chips for the three most-likely years: two years ago, last
 * year, current year. Most users come in to report on the year that just
 * ended — but a baseline-year setup may want one earlier, and a forward-
 * looking inventory may want the current year. Three options keep the
 * choice space tight without forcing manual typing.
 */
function buildQuickYears(now: Date): number[] {
  const current = now.getFullYear();
  return [current - 2, current - 1, current];
}

export function StepReportingYear() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const form = useForm({
    defaultValues: {
      reporting_year: draft.reporting_year ?? new Date().getFullYear() - 1,
    },
    onSubmit: async ({ value }) => {
      saveDraft({ ...draft, reporting_year: value.reporting_year });
      await navigate({ to: '/onboarding/$step', params: { step: '3' } });
    },
  });

  const formId = 'onboarding-year-form';
  const quickYears = buildQuickYears(new Date());

  return (
    <WizardShell
      step={2}
      title={m.onboarding_step_year_title()}
      subtitle={m.onboarding_step_year_subtitle()}
      footer={
        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/onboarding/$step', params: { step: '1' } })}
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
      >
        <form.Field
          name="reporting_year"
          children={(field) => (
            <div className="space-y-4">
              {/* Quick-pick chips. Selected state matches the stepper's
               * primary-bg "current" dot so the affordance reads as
               * "current selection", not "active hover". */}
              <div className="flex flex-wrap gap-2">
                {quickYears.map((y) => {
                  const isSelected = field.state.value === y;
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => field.handleChange(y)}
                      className={cn(
                        'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card hover:bg-foreground/5',
                      )}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>

              {/* Manual fallback for baseline years outside the 3-year
               * window. Smaller / muted label + narrow input — clearly
               * secondary to the chip row above. */}
              <div className="space-y-1.5">
                <Label htmlFor="reporting_year_input" className="text-xs text-muted-foreground">
                  {m.onboarding_step_year_title()}
                </Label>
                <Input
                  id="reporting_year_input"
                  type="number"
                  min={2020}
                  max={2030}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                  className="max-w-[140px]"
                />
              </div>
            </div>
          )}
        />
      </form>
    </WizardShell>
  );
}
