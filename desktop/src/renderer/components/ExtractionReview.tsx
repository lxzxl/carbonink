import { ActivityForm } from '@renderer/components/ActivityForm';
import { ChinaUtilityFields } from '@renderer/components/extractions/china-utility/fields';
import { buildChinaUtilityInitialValues } from '@renderer/components/extractions/china-utility/prefill';
import { FreightFields } from '@renderer/components/extractions/freight/fields';
import { buildFreightInitialValues } from '@renderer/components/extractions/freight/prefill';
import { FuelReceiptFields } from '@renderer/components/extractions/fuel-receipt/fields';
import { buildFuelReceiptInitialValues } from '@renderer/components/extractions/fuel-receipt/prefill';
import { PurchaseFields } from '@renderer/components/extractions/purchase/fields';
import { buildPurchaseInitialValues } from '@renderer/components/extractions/purchase/prefill';
import { CONFIDENCE_CLASSES, CONFIDENCE_LABELS } from '@renderer/components/extractions/shared';
import { TravelFields } from '@renderer/components/extractions/travel/fields';
import { buildTravelInitialValues } from '@renderer/components/extractions/travel/prefill';
import { parseExtraction } from '@renderer/components/extractions/types';
import { ManualStagePicker } from '@renderer/components/ManualStagePicker';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { activityApi } from '@renderer/lib/api/activity-data';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { extractionApi } from '@renderer/lib/api/extraction';
import { orgApi } from '@renderer/lib/api/organization';
import { formatCo2e } from '@renderer/lib/format';
import { stageLabel } from '@renderer/lib/stage-labels';
import * as m from '@renderer/paraglide/messages';
import type { ActivityData, Document, EmissionSource, Extraction } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

/**
 * Right pane of the document review page — renders the AI-extracted fields
 * for a single `Extraction`, plus Confirm/Discard actions.
 *
 * Phase 1d introduced per-stage field rendering. The component switches on
 * `extraction.prompt_version` to pick:
 *   - which parser interprets `parsed_json`
 *   - which `<Field>` rows to render
 *   - which `buildXxxInitialValues` produces the ActivityForm prefill
 *
 * Adding a 3rd stage (freight/purchase/travel) means: add a parser, add a
 * Field-block renderer, add an initial-values builder, add a switch arm.
 * When this file grows past ~400 LOC, refactor per-stage parts to their
 * own files under `src/renderer/components/extractions/<stage>/`. For now
 * 2 stages share this file because the surface is still small.
 *
 * Confirm flow:
 *   1. User picks emission_source + EF in the embedded ActivityForm.
 *   2. ActivityForm submits → `activityApi.create` returns the new row.
 *   3. `onSubmitSuccess` fires `extractionApi.confirm({ id })` to flip the
 *      extraction to `parsed` status.
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

export function ExtractionReview({ extraction, document }: ExtractionReviewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showStagePicker, setShowStagePicker] = useState(false);

  const parsed = useMemo(
    () => parseExtraction(extraction.parsed_json, extraction.prompt_version),
    [extraction.parsed_json, extraction.prompt_version],
  );

  const matcherHint = {
    extraction_id: extraction.id,
    stage_id: extraction.prompt_version,
  };

  // Humanized stage label via the i18n map used elsewhere in the app
  // (documents list, extractions). Previously this rendered the raw
  // English description from the stages registry ("Chinese electricity
  // bill (国网/南方电网 风格) — classify + extract") which exposed
  // internal prompt-engineering language to users. Now: "电费账单",
  // "加油发票", etc. matching the documents-list chip labels.
  const stageHuman = stageLabel(extraction.prompt_version);

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

  // Reverse lookup: when this extraction has already been confirmed,
  // find the activity row that was created from it so we can deep-link
  // to the user's actual entry (with row highlight) instead of dropping
  // them on the flat /activities list. Only runs when status is 'parsed'
  // — the only state in which a linked activity could exist.
  const linkedActivityQuery = useQuery({
    queryKey: ['activity:find-by-extraction', extraction.id],
    queryFn: () => activityApi.findByExtraction({ extraction_id: extraction.id }),
    enabled: extraction.status === 'parsed',
  });

  const discardMutation = useMutation({
    mutationFn: () => extractionApi.discard({ id: extraction.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['extraction:list-by-document', document.id],
      });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
      await queryClient.invalidateQueries({ queryKey: ['extraction:list-statuses'] });
      toast.success(m.documents_review_discard_success());
      navigate({ to: '/documents' });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_review_discard_failed(), { description: msg });
    },
  });

  const requestDiscard = () => {
    if (window.confirm(m.documents_review_discard_confirm())) {
      discardMutation.mutate();
    }
  };

  const handleSubmitSuccess = async () => {
    try {
      await extractionApi.confirm({ id: extraction.id });
      toast.success(m.documents_review_confirm_success());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.documents_review_confirm_failed(), { description: msg });
    }
    await queryClient.invalidateQueries({
      queryKey: ['extraction:list-by-document', document.id],
    });
    await queryClient.invalidateQueries({ queryKey: ['extraction:list-pending'] });
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

  const confidence = parsed.data.confidence ?? 'medium';
  const confidenceClass = CONFIDENCE_CLASSES[confidence];
  const confidenceLabel = CONFIDENCE_LABELS[confidence]();

  // Warning when the model selected "other" because it couldn't confidently
  // bucket the document — fires for fuel_receipt's fuel_category AND
  // purchase's category. The user MUST override before this gets to
  // ActivityForm because the EF lookup needs a known category. The message
  // is category-specific so the user knows which field needs attention.
  const showCategoryOtherWarning =
    (parsed.stage === 'fuel_receipt.v1' && parsed.data.fuel_category === 'other') ||
    (parsed.stage === 'purchase.v1' && parsed.data.category === 'other');
  const categoryOtherWarningMessage =
    parsed.stage === 'purchase.v1'
      ? m.documents_review_purchase_category_other_warning()
      : m.documents_review_fuel_category_other_warning();

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
        {/* Round 4 humanize:
         *   - Stage chip now shows the i18n'd label ("电费账单") instead
         *     of the registry's verbose English description.
         *   - LLM provider/model chip removed entirely — the user doesn't
         *     need to know we used deepseek-v4-flash; they need to know
         *     "did the AI understand this?" which the confidence chip
         *     answers.
         *   - Confidence stays, with the existing color coding. Raw
         *     prompt_version available on hover via `title` for debugging. */}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            className="rounded border border-border bg-background px-2 py-0.5"
            title={extraction.prompt_version}
          >
            {stageHuman}
          </span>
          <span className={`rounded border px-2 py-0.5 font-medium ${confidenceClass}`}>
            {m.documents_review_confidence()}: {confidenceLabel}
          </span>
        </div>

        {parsed.stage === 'china_utility.v1' ? (
          <ChinaUtilityFields data={parsed.data} />
        ) : parsed.stage === 'fuel_receipt.v1' ? (
          <FuelReceiptFields data={parsed.data} />
        ) : parsed.stage === 'freight.v1' ? (
          <FreightFields data={parsed.data} />
        ) : parsed.stage === 'purchase.v1' ? (
          <PurchaseFields data={parsed.data} />
        ) : (
          <TravelFields data={parsed.data} />
        )}

        {showCategoryOtherWarning && (
          <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {categoryOtherWarningMessage}
          </div>
        )}
      </div>

      {extraction.status === 'parsed' ? (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
          <p className="font-medium">{m.documents_review_already_confirmed_title()}</p>
          <p className="mt-1 text-muted-foreground">
            {m.documents_review_already_confirmed_body()}
          </p>
          {linkedActivityQuery.data ? (
            // Inline preview of the linked activity — show the user
            // what they actually created without making them navigate.
            // Highlight-deep-link kept as a secondary affordance for
            // users who want the row in context (e.g. to delete it or
            // edit metadata).
            <LinkedActivityCard
              activity={linkedActivityQuery.data}
              sourceName={
                sourcesQuery.data?.find(
                  (s) => s.id === linkedActivityQuery.data?.emission_source_id,
                )?.name ?? null
              }
            />
          ) : (
            // Fallback: extraction is parsed but findByExtraction missed
            // (legacy extraction confirmed before extraction_id was
            // wired up, or activity manually deleted). Plain list link
            // — no highlight target to aim at.
            <Link
              to="/activities"
              className="mt-3 inline-block text-sm text-[color:var(--color-primary)] hover:underline"
            >
              {m.documents_review_view_activities_link()}
            </Link>
          )}
        </div>
      ) : !showForm && !showStagePicker ? (
        <div className="flex flex-wrap items-center gap-2">
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
          <button
            type="button"
            onClick={() => setShowStagePicker(true)}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            {m.documents_review_switch_stage()}
          </button>
        </div>
      ) : showStagePicker ? (
        <ManualStagePicker
          documentId={extraction.document_id}
          discardExtractionId={extraction.id}
          defaultStageId={extraction.prompt_version}
          onConfirmed={() => setShowStagePicker(false)}
          onCancel={() => setShowStagePicker(false)}
        />
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
          initialValues={
            parsed.stage === 'china_utility.v1'
              ? buildChinaUtilityInitialValues(parsed.data, document.filename, matcherHint)
              : parsed.stage === 'fuel_receipt.v1'
                ? buildFuelReceiptInitialValues(parsed.data, document.filename, matcherHint)
                : parsed.stage === 'freight.v1'
                  ? buildFreightInitialValues(parsed.data, document.filename, matcherHint)
                  : parsed.stage === 'purchase.v1'
                    ? buildPurchaseInitialValues(parsed.data, document.filename, matcherHint)
                    : buildTravelInitialValues(parsed.data, document.filename, matcherHint)
          }
        />
      )}
    </div>
  );
}

/**
 * Inline card showing the activity row created from this extraction.
 * Renders the same key fields a user would see on /activities (source
 * name + amount/unit + computed CO₂e + occurred date), so the
 * "already confirmed" panel becomes useful at-a-glance rather than
 * "trust me, an activity exists somewhere".
 *
 * The secondary deep-link button (with ?highlight) is for users who
 * want to see the row in its list context (e.g. to delete or rebind
 * the EF). The card itself doesn't navigate — the user reads, then
 * decides if they need to jump.
 */
function LinkedActivityCard({
  activity,
  sourceName,
}: {
  activity: ActivityData;
  sourceName: string | null;
}) {
  return (
    <div className="mt-3 rounded-md border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-foreground">
          {sourceName ?? activity.emission_source_id}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {activity.occurred_at_start.slice(0, 10)}
        </span>
      </div>
      <div className="mt-1 text-foreground">
        <span className="tabular-nums">
          {activity.amount} {activity.unit}
        </span>
        <span className="mx-1.5 text-muted-foreground">→</span>
        <span className="font-medium tabular-nums">
          {formatCo2e(activity.computed_co2e_kg)} kg CO₂e
        </span>
      </div>
      <Link
        to="/activities"
        search={{ highlight: activity.id }}
        className="mt-2 inline-block text-xs text-[color:var(--color-primary)] hover:underline"
      >
        {m.documents_review_view_activity_link()}
      </Link>
    </div>
  );
}
