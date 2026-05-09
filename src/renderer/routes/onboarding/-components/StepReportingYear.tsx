import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import * as m from '@renderer/paraglide/messages';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { loadDraft, saveDraft } from './wizardState';

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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4 max-w-md"
    >
      <h2 className="text-xl font-semibold">{m.onboarding_step_year_title()}</h2>
      <p className="text-sm text-muted-foreground">{m.onboarding_step_year_body()}</p>

      <form.Field
        name="reporting_year"
        children={(field) => (
          <div>
            <Label htmlFor="reporting_year">Year</Label>
            <Input
              id="reporting_year"
              type="number"
              min={2020}
              max={2030}
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
            />
          </div>
        )}
      />

      <div className="flex justify-between pt-2">
        <Button
          variant="outline"
          onClick={() => navigate({ to: '/onboarding/$step', params: { step: '1' } })}
        >
          {m.onboarding_back()}
        </Button>
        <Button type="submit">{m.onboarding_next()}</Button>
      </div>
    </form>
  );
}
