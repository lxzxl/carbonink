import { EfPicker } from '@renderer/components/EfPicker';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { activityApi } from '@renderer/lib/api/activity-data';
import { orgApi } from '@renderer/lib/api/organization';
import { routingApi } from '@renderer/lib/api/routing';
import { granularityLabel } from '@renderer/lib/format';
import * as m from '@renderer/paraglide/messages';
import type { ActivityData, EmissionSource, ReportingPeriod } from '@shared/types';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

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
  /**
   * Routing API hint — present for freight + travel extractions when origin
   * and destination are known. The ActivityForm uses this to show a "Look up
   * distance" button that calls `routingApi.lookup` and, on success, fills
   * `amount` (for travel rows where amount = distance_km) and displays a
   * source badge ("AMap: 1085 km" / "Haversine: 10978 km").
   */
  routingHint?: {
    /** 'freight' → driving mode; 'travel' → derived from travelMode. */
    stage: 'freight' | 'travel';
    origin: string;
    destination: string;
    /**
     * Only meaningful for travel rows. Maps to routing mode:
     *   air → 'air'  |  rail → 'transit'  |  taxi → 'driving'
     */
    travelMode?: 'air' | 'rail' | 'taxi';
  };
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

/** Maps freight/travel stage + travel mode to a routing API mode. */
function inferRoutingMode(
  stage: 'freight' | 'travel',
  travelMode?: 'air' | 'rail' | 'taxi',
): 'driving' | 'transit' | 'air' {
  if (stage === 'freight') return 'driving';
  if (travelMode === 'air') return 'air';
  if (travelMode === 'rail') return 'transit';
  // taxi or unknown → driving
  return 'driving';
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

  // ── Routing lookup ──────────────────────────────────────────────────────────
  // Enabled for freight + travel rows that have origin + destination in the
  // initial values. On success, fills `amount` (for travel rows where amount
  // IS the distance in km) and shows a source badge.
  const routingHint = initialValues?.routingHint;
  const canLookup = !!routingHint?.origin && !!routingHint?.destination && !!routingHint.stage;
  const [lookupResult, setLookupResult] = useState<{
    distance_km: number;
    source: 'amap' | 'haversine';
  } | null>(null);

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

  // Routing lookup mutation — fires on explicit button click. On success:
  // - updates `lookupResult` state (source badge display)
  // - for travel rows, also fills `amount` with the returned distance_km
  //   (since travel rows use distance as their emission quantity)
  const lookupMutation = useMutation({
    mutationFn: () => {
      if (!routingHint) throw new Error('No routing hint available');
      const mode = inferRoutingMode(routingHint.stage, routingHint.travelMode);
      return routingApi.lookup({
        mode,
        origin: routingHint.origin,
        destination: routingHint.destination,
      });
    },
    onSuccess: (result) => {
      if (result.ok) {
        setLookupResult({ distance_km: result.distance_km, source: result.source });
        // For travel rows, amount IS the distance — fill it automatically.
        // For freight rows, the user sees the badge and can copy manually.
        if (routingHint?.stage === 'travel') {
          form.setFieldValue('amount', String(result.distance_km));
        }
      } else {
        toast.error(result.error.message);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
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
  // the user picks a source.
  const selectedSourceId = useStore(form.store, (s) => s.values.emission_source_id);
  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  // Subscribe to the 5 composite-PK ef_* fields so submit-button disabled state
  // reactively follows form state.
  const selectedEfKey = useStore(form.store, (s) =>
    [
      s.values.ef_factor_code,
      s.values.ef_year,
      s.values.ef_source,
      s.values.ef_geography,
      s.values.ef_dataset_version,
    ].join('|'),
  );
  // selectedEf is truthy when an EF has actually been selected (all 5 PK fields are non-empty/non-zero).
  const selectedEf = form.state.values.ef_factor_code ? { key: selectedEfKey } : null;

  const matcherHintRef = initialValues?.matcherHint;

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

      {/* Routing lookup — shown for freight + travel rows when origin +
       * destination are known. Click → call routingApi.lookup → fill amount
       * (travel only) + show source badge. */}
      {canLookup && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => lookupMutation.mutate()}
            disabled={lookupMutation.isPending}
          >
            {lookupMutation.isPending ? m.routing_lookup_running() : m.routing_lookup_button()}
          </Button>
          {lookupResult && (
            <span className="text-xs text-muted-foreground">
              {lookupResult.source === 'amap'
                ? m.routing_lookup_done_amap({ km: lookupResult.distance_km })
                : m.routing_lookup_done_haversine({ km: lookupResult.distance_km })}
            </span>
          )}
        </div>
      )}

      {/* EF Picker — handles both Recommended (if matcherHint provided) and Browse panes.
       * The component manages the queries and state internally.
       * We pass the source's scope to filter the EF list. */}
      <EfPicker
        selectedSourceId={selectedSourceId}
        currentEfPk={
          selectedEf
            ? {
                factor_code: form.state.values.ef_factor_code,
                year: form.state.values.ef_year,
                source: form.state.values.ef_source,
                geography: form.state.values.ef_geography,
                dataset_version: form.state.values.ef_dataset_version,
              }
            : null
        }
        scopeFilter={selectedSource?.scope}
        matcherHint={matcherHintRef ?? undefined}
        onChange={(pk, row) => {
          if (pk && row) {
            form.setFieldValue('ef_factor_code', pk.factor_code);
            form.setFieldValue('ef_year', pk.year);
            form.setFieldValue('ef_source', pk.source);
            form.setFieldValue('ef_geography', pk.geography);
            form.setFieldValue('ef_dataset_version', pk.dataset_version);
            // Pre-fill the unit field with the EF's input_unit if the user hasn't
            // typed one yet — same-family is the common path, so this saves a step.
            if (!form.state.values.unit) {
              form.setFieldValue('unit', row.input_unit);
            }
          }
        }}
      />

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
