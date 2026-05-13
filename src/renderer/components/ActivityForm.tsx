import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { activityApi } from '@renderer/lib/api/activity-data';
import { efApi } from '@renderer/lib/api/ef-library';
import { efMatcherApi } from '@renderer/lib/api/ef-matcher';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import type { ActivityData, EmissionFactor, EmissionSource, MatcherResult, ReportingPeriod } from '@shared/types';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Inline create form for an ActivityData row. Mounted by /activities.
 *
 * Flow:
 *   1. User picks an emission source (dropdown).
 *   2. Once a source is chosen, we auto-query `efApi.list({ category, scope })`
 *      to surface candidate EFs. The user picks one as a radio — the five
 *      composite-PK fields (factor_code / year / source / geography /
 *      dataset_version) are stored on the form together so submit knows the
 *      pin target unambiguously.
 *   3. User enters amount + unit. Free text on unit (supports aliases like
 *      "度", "公里"). Cross-family conversion (e.g. kg gasoline ↔ L) is
 *      opt-in via the `fuel_code` dropdown; we don't predict-and-warn in the
 *      UI (Phase 1a) — the service throws DimensionMismatchError if the user
 *      gets it wrong, and sonner surfaces it.
 *   4. Submit. Service pins the EF snapshot + computes co2e_kg.
 *
 * Site_id is not a form field. The service derives it from the chosen
 * emission_source (see ActivityDataService.create); a separate site picker
 * here would risk drifting from the source's actual site.
 *
 * Phase 1a fuel codes are hardcoded (the 5 we seeded in migration 007).
 * Phase 1c can swap this for a dynamic endpoint without changing the form.
 *
 * Labels are looked up via paraglide; if a new fuel_code appears in the DB
 * before its label is added we fall back to the raw code so the option is
 * still pickable (the alternative — hiding it — silently drops a valid
 * conversion and would be harder to debug).
 */
const FUEL_CODES = ['gasoline', 'diesel', 'natural_gas', 'lpg', 'coal_anthracite'] as const;
const FUEL_CODE_LABELS: Record<(typeof FUEL_CODES)[number], () => string> = {
  gasoline: m.fuel_gasoline,
  diesel: m.fuel_diesel,
  natural_gas: m.fuel_natural_gas,
  lpg: m.fuel_lpg,
  coal_anthracite: m.fuel_coal_anthracite,
};

/**
 * Subset of fields that can be prefilled from outside (e.g. an AI extraction
 * result). We intentionally keep this narrow — `emission_source_id` and the
 * five `ef_*` composite-PK fields stay user-driven so the EF citation never
 * gets pinned without an explicit human pick. Phase 1c may widen this once
 * source/EF auto-suggest lands.
 */
export type ActivityFormInitialValues = Partial<{
  reporting_period_id: string;
  occurred_at_start: string;
  occurred_at_end: string;
  amount: string;
  unit: string;
  fuel_code: string;
  notes: string;
  matcherHint?: { extraction_id: string; stage_id: string };
}>;

export interface ActivityFormProps {
  organizationId: string;
  sources: EmissionSource[];
  onCancel: () => void;
  /**
   * Legacy callback fired after the activity row is created. Optional now
   * that `onSubmitSuccess` exists — keeping both lets the Phase 1a
   * /activities caller (which only needs to close the form) stay unchanged.
   */
  onSuccess?: () => void;
  /**
   * Phase 1b — receives the freshly-created `ActivityData` row so the caller
   * can chain a side effect (e.g. mark an extraction as confirmed, navigate
   * to a different page). Fires AFTER `onSuccess`.
   */
  onSubmitSuccess?: (activity: ActivityData) => void;
  /**
   * Prefill the form with values from outside (e.g. AI extraction). Merged
   * over the natural defaults; the user can still edit any field before
   * submit. The EF radio is never prefilled — see the type comment above.
   */
  initialValues?: ActivityFormInitialValues;
}

export function ActivityForm({
  organizationId,
  sources,
  onCancel,
  onSuccess,
  onSubmitSuccess,
  initialValues,
}: ActivityFormProps) {
  const queryClient = useQueryClient();

  const periodsQuery = useQuery<ReportingPeriod[]>({
    queryKey: ['org:list-reporting-periods', organizationId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: organizationId }),
  });
  const periods = periodsQuery.data ?? [];
  const defaultPeriodId = periods[0]?.id ?? '';
  const defaultPeriodYear = periods[0]?.year;

  const createActivity = useMutation({
    mutationFn: activityApi.create,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({
        queryKey: ['activity:list-by-period', created.reporting_period_id],
      });
      await queryClient.invalidateQueries({
        queryKey: ['activity:totals-by-period', created.reporting_period_id],
      });
      toast.success(m.activities_create_success());
      // Legacy "close the form" callback fires first so the form's local
      // state collapses before the caller navigates away or runs side
      // effects. `onSubmitSuccess` is the Phase 1b extension point (e.g.
      // chain `extractionApi.confirm` after a review-page submit).
      onSuccess?.();
      onSubmitSuccess?.(created);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.activities_create_failed(), { description: msg });
    },
  });

  // Default occurred_at_* to the picked period's full year. We compute this
  // outside the form's defaultValues because both depend on data that arrives
  // async — the form is mounted before periodsQuery resolves.
  const defaultStart = defaultPeriodYear ? `${defaultPeriodYear}-01-01` : '';
  const defaultEnd = defaultPeriodYear ? `${defaultPeriodYear}-12-31` : '';

  const form = useForm({
    defaultValues: {
      emission_source_id: '',
      reporting_period_id: initialValues?.reporting_period_id ?? defaultPeriodId,
      occurred_at_start: initialValues?.occurred_at_start ?? defaultStart,
      occurred_at_end: initialValues?.occurred_at_end ?? defaultEnd,
      amount: initialValues?.amount ?? '', // store as string so the input stays controlled even when empty
      unit: initialValues?.unit ?? '',
      // EF composite PK — filled when the user picks an EF radio. Never
      // prefilled from `initialValues` so the citation always reflects an
      // explicit human choice.
      ef_factor_code: '',
      ef_year: 0,
      ef_source: '',
      ef_geography: '',
      ef_dataset_version: '',
      fuel_code: initialValues?.fuel_code ?? '',
      notes: initialValues?.notes ?? '',
    },
    onSubmit: async ({ value }) => {
      const amount = Number(value.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error(m.activities_create_failed(), {
          description: 'Amount must be a positive number.',
        });
        return;
      }
      await createActivity.mutateAsync({
        emission_source_id: value.emission_source_id,
        reporting_period_id: value.reporting_period_id,
        occurred_at_start: value.occurred_at_start,
        occurred_at_end: value.occurred_at_end,
        amount,
        unit: value.unit,
        ef_factor_code: value.ef_factor_code,
        ef_year: value.ef_year,
        ef_source: value.ef_source,
        ef_geography: value.ef_geography,
        ef_dataset_version: value.ef_dataset_version,
        fuel_code: value.fuel_code || undefined,
        notes: value.notes || undefined,
      });
    },
  });

  // Once periods load, populate the period + default date range. Idempotent;
  // only writes when the field is still at its empty initial value, so a user
  // who has already edited the dates won't have their input clobbered.
  useEffect(() => {
    if (defaultPeriodId && form.state.values.reporting_period_id === '') {
      form.setFieldValue('reporting_period_id', defaultPeriodId);
    }
    if (defaultStart && form.state.values.occurred_at_start === '') {
      form.setFieldValue('occurred_at_start', defaultStart);
    }
    if (defaultEnd && form.state.values.occurred_at_end === '') {
      form.setFieldValue('occurred_at_end', defaultEnd);
    }
  }, [defaultPeriodId, defaultStart, defaultEnd, form]);

  // Subscribe to emission_source_id so the parent component re-renders when
  // the user picks a source. Reading `form.state.values.x` synchronously here
  // would NOT subscribe — only the <form.Field> for that name would re-render,
  // leaving the EF candidate query stuck on the initial empty state.
  const selectedSourceId = useStore(form.store, (s) => s.values.emission_source_id);
  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  // EF candidate query — only enabled once a source is chosen. We pass
  // category when the source has one set; if not (e.g. a generic source row),
  // fall back to scope-only filtering. Both branches AND on the scope itself
  // so we never surface a Scope 2 EF for a Scope 1 source.
  const efQuery = useQuery<EmissionFactor[]>({
    queryKey: ['ef:list', selectedSource?.category ?? null, selectedSource?.scope ?? null],
    queryFn: () => {
      // Type narrowing: the query is `enabled` only when selectedSource
      // exists, so this branch is unreachable, but the queryFn signature
      // still must be sound for `exactOptionalPropertyTypes`.
      if (!selectedSource) return Promise.resolve([]);
      return efApi.list(
        selectedSource.category
          ? { category: selectedSource.category, scope: selectedSource.scope }
          : { scope: selectedSource.scope },
      );
    },
    enabled: !!selectedSource,
  });
  const efs = efQuery.data ?? [];

  // Matcher query — only fires when a matcherHint was passed AND a source is
  // selected. On LLM failure (reject) we intentionally fall back to the full
  // EF list silently (retry: false keeps the UI clean).
  const matcherHintRef = initialValues?.matcherHint;
  const matcherQuery = useQuery({
    queryKey: ['ef:recommend', matcherHintRef?.extraction_id ?? '', selectedSourceId ?? ''],
    // efMatcherApi.recommend() is typed as Promise<Promise<MatcherResult>> due to
    // the IPC type-map declaring its return as Promise<MatcherResult>, but at
    // runtime window.ipc.invoke resolves the outer promise only. We cast to the
    // actual settled shape so TanStack Query's generic is correct.
    queryFn: (): Promise<MatcherResult> =>
      efMatcherApi.recommend({
        extraction_id: matcherHintRef!.extraction_id,
        emission_source_id: selectedSourceId!,
      }) as unknown as Promise<MatcherResult>,
    enabled: !!matcherHintRef && !!selectedSourceId,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  // Build a stable key for radio rendering / matching (composite PK joined).
  const efKey = (ef: EmissionFactor) =>
    `${ef.factor_code}|${ef.year}|${ef.source}|${ef.geography}|${ef.dataset_version}`;

  // Subscribe to the 5 composite-PK ef_* fields so the EF radio "checked"
  // state + submit-button disabled state both reactively follow form state.
  // Without subscription, pickEf() would mutate state but radio visuals stay
  // unchecked (same trap as emission_source_id above).
  const selectedEfKey = useStore(form.store, (s) =>
    [
      s.values.ef_factor_code,
      s.values.ef_year,
      s.values.ef_source,
      s.values.ef_geography,
      s.values.ef_dataset_version,
    ].join('|'),
  );
  const selectedEf = efs.find((ef) => efKey(ef) === selectedEfKey);

  const pickEf = (ef: EmissionFactor) => {
    form.setFieldValue('ef_factor_code', ef.factor_code);
    form.setFieldValue('ef_year', ef.year);
    form.setFieldValue('ef_source', ef.source);
    form.setFieldValue('ef_geography', ef.geography);
    form.setFieldValue('ef_dataset_version', ef.dataset_version);
    // Pre-fill the unit field with the EF's input_unit if the user hasn't
    // typed one yet — same-family is the common path, so this saves a step.
    if (!form.state.values.unit) {
      form.setFieldValue('unit', ef.input_unit);
    }
  };

  const noSources = sources.length === 0;
  const noPeriods = !periodsQuery.isLoading && periods.length === 0;

  // Bail out before rendering the form body if there's no usable input data.
  // Showing the full form with a disabled submit + inline error is confusing
  // (users try to fill it in and can't figure out why submit stays grey).
  // Only render the prerequisite-missing message + a back button.
  if (noSources || noPeriods) {
    return (
      <div className="space-y-4 max-w-2xl mt-4 rounded-md border border-border bg-muted/30 p-4">
        {noSources && <p className="text-sm text-destructive">{m.activities_form_no_sources()}</p>}
        {noPeriods && <p className="text-sm text-destructive">{m.activities_form_no_periods()}</p>}
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.sources_cancel_button()}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-4 max-w-2xl mt-4 rounded-md border border-border bg-muted/30 p-4"
    >
      <form.Field
        name="emission_source_id"
        validators={{
          onChange: ({ value }) => (value ? undefined : m.required_field()),
        }}
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="activity-source">{m.activities_form_source()}</Label>
            <select
              id="activity-source"
              value={field.state.value}
              onChange={(e) => {
                field.handleChange(e.target.value);
                // Reset EF when source changes — old candidate may not be
                // valid under the new (category, scope) filter, and silently
                // submitting a stale EF would pin a misleading citation.
                form.setFieldValue('ef_factor_code', '');
                form.setFieldValue('ef_year', 0);
                form.setFieldValue('ef_source', '');
                form.setFieldValue('ef_geography', '');
                form.setFieldValue('ef_dataset_version', '');
                form.setFieldValue('unit', '');
              }}
              className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
            >
              <option value="">{m.activities_form_source_placeholder()}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — Scope {s.scope}
                  {s.category ? ` · ${s.category}` : ''}
                </option>
              ))}
            </select>
            {field.state.meta.errors[0] && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      />

      <form.Field
        name="reporting_period_id"
        validators={{
          onChange: ({ value }) => (value ? undefined : m.required_field()),
        }}
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="activity-period">{m.activities_form_period()}</Label>
            <select
              id="activity-period"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
            >
              <option value="">{m.activities_form_period_placeholder()}</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.year} · {p.granularity}
                </option>
              ))}
            </select>
            {field.state.meta.errors[0] && (
              <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
            )}
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-3">
        <form.Field
          name="occurred_at_start"
          validators={{
            onChange: ({ value }) => (value ? undefined : m.required_field()),
          }}
          children={(field) => (
            <div className="space-y-1">
              <Label htmlFor="activity-start">{m.activities_form_occurred_start()}</Label>
              <Input
                id="activity-start"
                type="date"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] && (
                <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
              )}
            </div>
          )}
        />
        <form.Field
          name="occurred_at_end"
          validators={{
            onChange: ({ value }) => (value ? undefined : m.required_field()),
          }}
          children={(field) => (
            <div className="space-y-1">
              <Label htmlFor="activity-end">{m.activities_form_occurred_end()}</Label>
              <Input
                id="activity-end"
                type="date"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] && (
                <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
              )}
            </div>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <form.Field
          name="amount"
          validators={{
            onChange: ({ value }) => {
              if (!value) return m.required_field();
              const n = Number(value);
              if (!Number.isFinite(n) || n <= 0) return m.required_field();
              return undefined;
            },
          }}
          children={(field) => (
            <div className="space-y-1">
              <Label htmlFor="activity-amount">{m.activities_form_amount()}</Label>
              <Input
                id="activity-amount"
                type="number"
                step="any"
                min="0"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] && (
                <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
              )}
            </div>
          )}
        />
        <form.Field
          name="unit"
          validators={{
            onChange: ({ value }) => (value.trim().length > 0 ? undefined : m.required_field()),
          }}
          children={(field) => (
            <div className="space-y-1">
              <Label htmlFor="activity-unit">{m.activities_form_unit()}</Label>
              <Input
                id="activity-unit"
                value={field.state.value}
                placeholder={m.activities_form_unit_placeholder()}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              {field.state.meta.errors[0] && (
                <p className="text-xs text-destructive">{String(field.state.meta.errors[0])}</p>
              )}
            </div>
          )}
        />
      </div>

      {/* Recommended for this document — only shown when matcherHint is
       * present AND a source is selected AND the LLM either returned results
       * or is still loading. On LLM failure the block stays hidden and the
       * full EF list below remains the sole picker. */}
      {matcherHintRef &&
        selectedSourceId &&
        (matcherQuery.isLoading ||
          (matcherQuery.data?.recommended?.length ?? 0) > 0) && (
          <div className="rounded-md border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/5 p-3">
            <h4 className="text-sm font-medium">{m.ef_matcher_recommended_heading()}</h4>
            {matcherQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">{m.ef_matcher_loading()}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {matcherQuery.data?.recommended.map((rec) => (
                  <li key={efKey(rec.ef)} className="text-sm">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="ef"
                        className="mt-1"
                        checked={selectedEfKey === efKey(rec.ef)}
                        onChange={() => pickEf(rec.ef)}
                      />
                      <span>
                        <span className="font-medium">
                          ⭐ {rec.ef.name_zh ?? rec.ef.name_en ?? rec.ef.factor_code}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {rec.ef.co2e_kg_per_unit} kgCO₂e/{rec.ef.input_unit}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          <span>{m.ef_matcher_reasoning_label()}</span>{' '}
                          <span>{rec.reasoning_zh}</span>
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

      {/* EF Matcher: auto-filtered by (source.category, source.scope).
       * Radio-per-candidate keeps the picker scannable when there are 1–10
       * EFs (the Phase 1a catalog size). We can swap for a typeahead later
       * when the EF library grows. */}
      <fieldset className="space-y-2 rounded-md border border-border bg-background/40 p-3">
        <legend className="px-1 text-sm font-medium">
          {matcherHintRef && selectedSourceId
            ? m.ef_matcher_all_candidates()
            : m.activities_form_ef()}
        </legend>
        {!selectedSource ? (
          <p className="text-xs text-muted-foreground">
            {m.activities_form_ef_pick_source_first()}
          </p>
        ) : efQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">{m.activities_form_ef_loading()}</p>
        ) : efs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{m.activities_form_ef_none()}</p>
        ) : (
          <div className="space-y-1">
            {efs.map((ef) => {
              const key = efKey(ef);
              const isSelected = selectedEfKey === key;
              return (
                <label
                  key={key}
                  className="flex items-start gap-2 text-sm cursor-pointer rounded px-1 py-1 hover:bg-muted/40"
                >
                  <input
                    type="radio"
                    name="ef"
                    className="mt-1"
                    checked={isSelected}
                    onChange={() => pickEf(ef)}
                  />
                  <span className="flex-1">
                    <span className="font-medium">
                      {ef.name_zh ?? ef.name_en ?? ef.factor_code}
                    </span>
                    <span className="text-muted-foreground">
                      {' '}
                      · {ef.geography} · {ef.year} · {ef.co2e_kg_per_unit} kg CO2e/{ef.input_unit}
                    </span>
                  </span>
                </label>
              );
            })}
            {selectedEf && (
              <p className="mt-2 text-xs text-muted-foreground">
                {m.activities_form_ef_selected()}:{' '}
                {selectedEf.name_zh ?? selectedEf.name_en ?? selectedEf.factor_code} (
                {selectedEf.co2e_kg_per_unit} kg CO2e/{selectedEf.input_unit})
              </p>
            )}
          </div>
        )}
      </fieldset>

      <form.Field
        name="fuel_code"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="activity-fuel">{m.activities_form_fuel()}</Label>
            <select
              id="activity-fuel"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
            >
              <option value="">{m.activities_form_fuel_none()}</option>
              {FUEL_CODES.map((f) => (
                <option key={f} value={f}>
                  {FUEL_CODE_LABELS[f]?.() ?? f}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{m.activities_form_fuel_hint()}</p>
          </div>
        )}
      />

      <form.Field
        name="notes"
        children={(field) => (
          <div className="space-y-1">
            <Label htmlFor="activity-notes">{m.activities_form_notes()}</Label>
            <textarea
              id="activity-notes"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
            />
          </div>
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={createActivity.isPending}
        >
          {m.sources_cancel_button()}
        </Button>
        <Button type="submit" disabled={createActivity.isPending || !selectedEf}>
          {createActivity.isPending ? m.activities_form_submitting() : m.activities_form_submit()}
        </Button>
      </div>
    </form>
  );
}
