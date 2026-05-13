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
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { extractionApi } from '@renderer/lib/api/extraction';
import { orgApi } from '@renderer/lib/api/organization';
import { stagesApi } from '@renderer/lib/api/stages';
import * as m from '@renderer/paraglide/messages';
import type { Document, EmissionSource, Extraction } from '@shared/types';
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

  const parsed = useMemo(
    () => parseExtraction(extraction.parsed_json, extraction.prompt_version),
    [extraction.parsed_json, extraction.prompt_version],
  );

  // Stage description for the chip — falls back to the raw id if the
  // stages:list query hasn't resolved yet or the stage isn't registered.
  const stagesQuery = useQuery({
    queryKey: ['stages:list'],
    queryFn: stagesApi.list,
    staleTime: Infinity,
  });
  const stageDescription =
    stagesQuery.data?.find((s) => s.id === extraction.prompt_version)?.description ??
    extraction.prompt_version;

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
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            className="rounded border border-border bg-background px-2 py-0.5"
            title={extraction.prompt_version}
          >
            {m.documents_review_stage()}: {stageDescription}
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
          initialValues={
            parsed.stage === 'china_utility.v1'
              ? buildChinaUtilityInitialValues(parsed.data, document.filename)
              : parsed.stage === 'fuel_receipt.v1'
                ? buildFuelReceiptInitialValues(parsed.data, document.filename)
                : parsed.stage === 'freight.v1'
                  ? buildFreightInitialValues(parsed.data, document.filename)
                  : parsed.stage === 'purchase.v1'
                    ? buildPurchaseInitialValues(parsed.data, document.filename)
                    : buildTravelInitialValues(parsed.data, document.filename)
          }
        />
      )}
    </div>
  );
}
