import { SupplierPicker } from '@renderer/components/inbound/SupplierPicker';
import { Main } from '@renderer/components/layout/main';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Label } from '@renderer/components/ui/label';
import { inboundQuestionnaireApi } from '@renderer/lib/api/inbound-questionnaire';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import type { ReportingPeriod } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * `/supplier-disclosures/new` — Cat 1 supplier disclosure wizard.
 *
 * Four steps stacked vertically on one screen (no multi-page flow —
 * the form is short enough to fit). The user picks:
 *  1. A supplier (existing dropdown or create-new inline).
 *  2. A reporting period (defaults to the org's active period).
 *  3. A template (v2.0: only Cat 1 supplier disclosure, locked).
 *  4. Which questions to include (defaults: all checked).
 *
 * Submit calls `inbound-create-draft` IPC; on success the user lands
 * on the new questionnaire's detail page in status='draft' where the
 * "Export blank xlsx" button is available.
 */
export const Route = createFileRoute('/supplier-disclosures/new')({
  component: NewSupplierDisclosureRoute,
});

// Cat 1 v1.0 template positions + metadata, hard-coded to avoid a
// round-trip just for the question list. Kept in sync with the
// canonical definition in `desktop/src/main/services/inbound-templates/cat1.ts`.
// Labels are message FUNCTIONS (not eager strings) so a locale switch
// re-renders them.
const CAT1_QUESTIONS = [
  { position: 'meta.1', label: () => m.inbound_q_meta1(), kind: 'metadata' as const },
  { position: 'meta.2', label: () => m.inbound_q_meta2(), kind: 'metadata' as const },
  { position: 'meta.3', label: () => m.inbound_q_meta3(), kind: 'metadata' as const },
  { position: 'tier1.1', label: () => m.inbound_q_tier1_1(), kind: 'tier1' as const },
  { position: 'tier2.1', label: () => m.inbound_q_tier2_1(), kind: 'tier2' as const },
  { position: 'tier2.2', label: () => m.inbound_q_tier2_2(), kind: 'tier2' as const },
  { position: 'tier2.3', label: () => m.inbound_q_tier2_3(), kind: 'tier2' as const },
];

function NewSupplierDisclosureRoute(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: () => orgApi.getCurrent(),
  });
  const orgId = orgQuery.data?.id ?? '';

  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgId }),
    enabled: orgId !== '',
  });
  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const activePeriod = periods.find((p: ReportingPeriod) => p.is_active === 1) ?? periods[0];

  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [includedPositions, setIncludedPositions] = useState<Set<string>>(
    new Set(CAT1_QUESTIONS.map((q) => q.position)),
  );

  // Adopt the active period as the default once data arrives.
  if (periodId === null && activePeriod) {
    setPeriodId(activePeriod.id);
  }

  function togglePosition(position: string): void {
    setIncludedPositions((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: () => {
      if (!supplierId) throw new Error(m.inbound_new_supplier_required());
      if (!periodId) throw new Error(m.inbound_new_period_required());
      return inboundQuestionnaireApi.createDraft({
        supplier_id: supplierId,
        reporting_period_id: periodId,
        template_kind: 'cat1_supplier_disclosure',
        included_question_positions: Array.from(includedPositions),
      });
    },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
      toast.success(m.inbound_created_toast({ count: String(r.question_count) }));
      void navigate({ to: '/supplier-disclosures/$id', params: { id: r.questionnaire_id } });
    },
    onError: (err) => {
      toast.error(m.inbound_create_failed(), {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const canSubmit =
    supplierId !== null &&
    periodId !== null &&
    includedPositions.size > 0 &&
    !createMutation.isPending;

  return (
    <div className="h-full overflow-auto">
      <Main className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void navigate({ to: '/supplier-disclosures' })}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            {m.inbound_back()}
          </Button>
          <h1 className="text-2xl font-semibold">{m.inbound_new_title()}</h1>
        </div>

        <p className="text-sm text-muted-foreground">{m.inbound_new_intro()}</p>

        <div className="rounded-md border border-border bg-card p-6 space-y-6">
          {/* Step 1: supplier */}
          <SupplierPicker
            value={supplierId}
            onChange={setSupplierId}
            disabled={createMutation.isPending}
          />

          {/* Step 2: reporting period */}
          <div className="space-y-2">
            <Label htmlFor="period-select">{m.inbound_period_label()}</Label>
            <select
              id="period-select"
              value={periodId ?? ''}
              onChange={(e) => setPeriodId(e.target.value)}
              disabled={createMutation.isPending || periodsQuery.isLoading}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="" disabled>
                {periodsQuery.isLoading ? m.loading() : m.inbound_period_placeholder()}
              </option>
              {periods.map((p: ReportingPeriod) => (
                <option key={p.id} value={p.id}>
                  {p.year} ({p.granularity}){p.is_active === 1 ? m.inbound_period_current() : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Step 3: template (locked in v2.0) */}
          <div className="space-y-2">
            <Label htmlFor="template-select">{m.inbound_template_label()}</Label>
            <select
              id="template-select"
              value="cat1_supplier_disclosure"
              disabled
              className="flex h-9 w-full rounded-md border border-input bg-muted/50 px-3 py-1 text-sm opacity-70 disabled:cursor-not-allowed"
            >
              <option value="cat1_supplier_disclosure">{m.inbound_template_cat1_option()}</option>
            </select>
            <p className="text-xs text-muted-foreground">{m.inbound_template_note()}</p>
          </div>

          {/* Step 4: question subset */}
          <div className="space-y-3">
            <Label>{m.inbound_questions_label()}</Label>
            <div className="space-y-2 rounded-md border border-border bg-background/50 p-3">
              {CAT1_QUESTIONS.map((q) => (
                <label key={q.position} className="flex items-start gap-3 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={includedPositions.has(q.position)}
                    onChange={() => togglePosition(q.position)}
                    disabled={createMutation.isPending}
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <div className="flex-1">
                    <div className="font-medium">{q.label()}</div>
                    <div className="text-xs text-muted-foreground">
                      <code className="font-mono">{q.position}</code>
                      {q.kind === 'tier1' && ' · Tier 1 (per-unit PCF)'}
                      {q.kind === 'tier2' && ' · Tier 2 (allocated emissions)'}
                      {q.kind === 'metadata' && m.inbound_q_required_meta()}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            {includedPositions.size === 0 && (
              <p className="text-xs text-destructive">{m.inbound_min_one_question()}</p>
            )}
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <Button type="button" onClick={() => createMutation.mutate()} disabled={!canSubmit}>
              {createMutation.isPending ? m.inbound_creating() : m.inbound_create_draft()}
            </Button>
            <span className="text-xs text-muted-foreground">{m.inbound_create_next_hint()}</span>
          </div>
        </div>
      </Main>
    </div>
  );
}
