import { ActivityForm } from '@renderer/components/ActivityForm';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { extractionApi } from '@renderer/lib/api/extraction';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import type { Document, EmissionSource, Extraction } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

/**
 * Right pane of the document review page — renders the AI-extracted fields
 * for a single `Extraction`, plus Confirm/Discard actions.
 *
 * The schema we render here is the `china_utility.v1` stage's parsed output
 * (the only stage in Phase 1b). We pick fields out of the JSON dynamically
 * because the `Extraction` row only carries the serialized JSON string; the
 * concrete shape lives in `src/main/llm/stages/china-utility.ts`. If parsing
 * fails we surface a generic error rather than crashing the page — the
 * Extraction row may still be intact (the LLM returned garbage, but the row
 * exists) and the user should be able to discard it cleanly.
 *
 * Confirm flow:
 *   1. User picks emission_source + EF in the embedded ActivityForm.
 *   2. ActivityForm submits → `activityApi.create` returns the new row.
 *   3. `onSubmitSuccess` fires `extractionApi.confirm({ id })` to flip the
 *      extraction to `parsed` status. These are two non-atomic IPC calls —
 *      if the confirm step fails after activity creation, the activity row
 *      stays (correct) and the user sees a toast. Phase 1c can fold both
 *      into a single transaction if the failure becomes common.
 *   4. Navigate to / (dashboard) so the user sees their emission total tick
 *      up immediately.
 *
 * Discard flow:
 *   `extractionApi.discard({ id })` flips status → 'rejected', clears
 *   parsed_json. Navigate back to /documents.
 */
export interface ExtractionReviewProps {
  extraction: Extraction;
  document: Document;
}

type ChinaUtilityParsed = {
  doc_type?: string;
  supplier_name?: string;
  account_no?: string | null;
  amount_kwh?: number;
  amount_yuan?: number | null;
  period_start?: string;
  period_end?: string;
  confidence?: 'high' | 'medium' | 'low';
};

function parseExtraction(raw: string | null): ChinaUtilityParsed | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj as ChinaUtilityParsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Color-code the confidence badge per the design spec — high = primary
 * accent (good), medium = muted warning, low = destructive. We keep the
 * mapping tight to design tokens (no raw hex) so a future theme swap
 * (Phase 1c+) carries through automatically.
 */
const CONFIDENCE_CLASSES: Record<'high' | 'medium' | 'low', string> = {
  high: 'border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/10 text-[color:var(--color-primary)]',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  low: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const CONFIDENCE_LABELS: Record<'high' | 'medium' | 'low', () => string> = {
  high: m.documents_review_confidence_high,
  medium: m.documents_review_confidence_medium,
  low: m.documents_review_confidence_low,
};

export function ExtractionReview({ extraction, document }: ExtractionReviewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const parsed = useMemo(() => parseExtraction(extraction.parsed_json), [extraction.parsed_json]);

  // Pull org + sources for the embedded ActivityForm. We lift these here so
  // the form gets the same data shape /activities uses; ActivityForm itself
  // is data-source agnostic (it just consumes the `sources` prop).
  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: orgApi.getCurrent,
  });
  const orgId = orgQuery.data?.id;

  const sourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', orgId],
    queryFn: () => sourceApi.listByOrg({ organization_id: orgId ?? '' }),
    enabled: !!orgId,
  });

  const discardMutation = useMutation({
    mutationFn: () => extractionApi.discard({ id: extraction.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', document.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
      // /documents list chip depends on this — without it the row keeps
      // showing the old "review needed" chip until a full refetch.
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
      toast.success(m.documents_review_discard_success());
      navigate({ to: '/documents' });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_review_discard_failed(), { description: msg });
    },
  });

  // Shared discard handler for both the happy-path button and the
  // parse-error fallback. `window.confirm` is the same guardrail the user
  // sees in the normal review path — clicking 丢弃 with no prompt was
  // accidental-tap-prone, especially in the parse-error branch where the
  // button is the only action.
  const requestDiscard = () => {
    if (window.confirm(m.documents_review_discard_confirm())) {
      discardMutation.mutate();
    }
  };

  // We don't pre-confirm the extraction — it stays `review_needed` until
  // the user actually submits the ActivityForm. Phase 1c may swap this for
  // a single atomic IPC call; for now the two-step is good enough.
  const handleSubmitSuccess = async () => {
    try {
      await extractionApi.confirm({ id: extraction.id });
      toast.success(m.documents_review_confirm_success());
    } catch (err) {
      // The activity_data row already exists — surface the failure but
      // don't roll back. The user can manually mark the extraction
      // confirmed later if needed.
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_review_confirm_failed(), { description: msg });
    }
    await queryClient.invalidateQueries({
      queryKey: ['extraction:list-by-document', document.id],
    });
    await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
    // Same rationale as the discard path: /documents list chip reads from
    // this query, so confirmation needs to invalidate it too — otherwise
    // the user lands on /dashboard, comes back to /documents, and the row
    // still shows "Needs review".
    await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
    navigate({ to: '/' });
  };

  if (!parsed) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {m.documents_review_parse_error()}
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            onClick={requestDiscard}
            disabled={discardMutation.isPending}
          >
            {m.documents_review_discard()}
          </Button>
        </div>
      </div>
    );
  }

  const confidence = parsed.confidence ?? 'medium';
  const confidenceClass = CONFIDENCE_CLASSES[confidence];
  const confidenceLabel = CONFIDENCE_LABELS[confidence]();

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded border border-border bg-background px-2 py-0.5 font-mono">
            {m.documents_review_stage()}: {extraction.prompt_version}
          </span>
          <span className="rounded border border-border bg-background px-2 py-0.5">
            {m.documents_review_provider()}: {extraction.llm_provider} · {extraction.llm_model}
          </span>
          <span
            className={`rounded border px-2 py-0.5 font-medium ${confidenceClass}`}
            title={`${m.documents_review_confidence()}: ${confidenceLabel}`}
          >
            {m.documents_review_confidence()}: {confidenceLabel}
          </span>
        </div>

        <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
          <Field label={m.documents_review_field_supplier()} value={parsed.supplier_name} />
          <Field label={m.documents_review_field_account()} value={parsed.account_no} />
          <Field
            label={m.documents_review_field_amount_kwh()}
            value={typeof parsed.amount_kwh === 'number' ? `${parsed.amount_kwh} kWh` : undefined}
          />
          <Field
            label={m.documents_review_field_amount_yuan()}
            value={typeof parsed.amount_yuan === 'number' ? `¥${parsed.amount_yuan}` : undefined}
          />
          <Field label={m.documents_review_field_period_start()} value={parsed.period_start} />
          <Field label={m.documents_review_field_period_end()} value={parsed.period_end} />
        </dl>
      </div>

      {extraction.status === 'parsed' ? (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
          <p className="font-medium">{m.documents_review_already_confirmed_title()}</p>
          <p className="mt-1 text-muted-foreground">
            {m.documents_review_already_confirmed_body()}
          </p>
          <Link
            to="/activities"
            className="mt-3 inline-block text-sm text-[color:var(--color-primary)] hover:underline"
          >
            {m.documents_review_view_activities_link()}
          </Link>
        </div>
      ) : !showForm ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setShowForm(true)}>
            {m.documents_review_confirm()}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={requestDiscard}
            disabled={discardMutation.isPending}
          >
            {m.documents_review_discard()}
          </Button>
        </div>
      ) : orgQuery.isLoading || sourcesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{m.loading()}</p>
      ) : !orgId ? (
        <p className="text-sm text-destructive">{m.documents_review_load_failed()}</p>
      ) : (
        <ActivityForm
          organizationId={orgId}
          sources={sourcesQuery.data ?? []}
          onCancel={() => setShowForm(false)}
          onSubmitSuccess={() => {
            void handleSubmitSuccess();
          }}
          initialValues={buildInitialValues(parsed, document.filename)}
        />
      )}
    </div>
  );
}

/**
 * Build the `initialValues` payload, omitting fields we don't have so the
 * `Partial` shape stays compatible with `exactOptionalPropertyTypes` (which
 * rejects `{ amount: undefined }` even on a Partial type).
 */
function buildInitialValues(
  parsed: ChinaUtilityParsed,
  filename: string,
): import('@renderer/components/ActivityForm').ActivityFormInitialValues {
  const out: import('@renderer/components/ActivityForm').ActivityFormInitialValues = {
    unit: 'kWh',
    notes: `Auto-extracted from: ${filename}`,
  };
  if (parsed.period_start) out.occurred_at_start = parsed.period_start;
  if (parsed.period_end) out.occurred_at_end = parsed.period_end;
  if (typeof parsed.amount_kwh === 'number') out.amount = String(parsed.amount_kwh);
  return out;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  const display = value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{display}</dd>
    </>
  );
}
