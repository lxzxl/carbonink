import { ActivityForm } from '@renderer/components/ActivityForm';
import { CONFIDENCE_CLASSES, CONFIDENCE_LABELS, Field } from '@renderer/components/extractions/shared';
import { ChinaUtilityFields } from '@renderer/components/extractions/china-utility/fields';
import { buildChinaUtilityInitialValues } from '@renderer/components/extractions/china-utility/prefill';
import type { ChinaUtilityParsed } from '@renderer/components/extractions/china-utility/types';
import { FuelReceiptFields } from '@renderer/components/extractions/fuel-receipt/fields';
import { buildFuelReceiptInitialValues } from '@renderer/components/extractions/fuel-receipt/prefill';
import type { FuelReceiptParsed } from '@renderer/components/extractions/fuel-receipt/types';
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

// ---------------------------------------------------------------------------
// Per-stage parsed types + parsers
// ---------------------------------------------------------------------------

type FreightParsed = {
  doc_type?: string;
  supplier_name?: string;
  mode?: 'road' | 'rail' | 'sea' | 'air';
  vehicle_class?: string | null;
  weight_kg?: number;
  volume_m3?: number | null;
  distance_km?: number | null;
  origin?: string;
  destination?: string;
  tracking_no?: string | null;
  amount_yuan?: number;
  occurred_at?: string;
  confidence?: 'high' | 'medium' | 'low';
};

type PurchaseParsed = {
  doc_type?: string;
  supplier_name?: string;
  item_description?: string;
  category?: 'raw_material' | 'component' | 'consumable' | 'office_supply' | 'service' | 'other';
  quantity_kg?: number | null;
  amount_yuan?: number;
  occurred_at?: string;
  invoice_no?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};

type TravelParsed = {
  doc_type?: string;
  supplier_name?: string;
  mode?: 'air' | 'rail' | 'taxi';
  passenger_name?: string | null;
  origin?: string;
  destination?: string;
  departure_at?: string;
  arrival_at?: string | null;
  travel_class?: string | null;
  distance_km?: number | null;
  flight_or_train_no?: string | null;
  vehicle_plate?: string | null;
  amount_yuan?: number;
  ticket_no?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};

type StageParsed =
  | { stage: 'china_utility.v1'; data: ChinaUtilityParsed }
  | { stage: 'fuel_receipt.v1'; data: FuelReceiptParsed }
  | { stage: 'freight.v1'; data: FreightParsed }
  | { stage: 'purchase.v1'; data: PurchaseParsed }
  | { stage: 'travel.v1'; data: TravelParsed };

function parseExtraction(raw: string | null, promptVersion: string): StageParsed | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  // The discriminator is the persisted prompt_version, not anything
  // inside parsed_json itself. A malformed extraction (raw text that
  // claims doc_type X but came from stage Y) is still rendered per the
  // stage; the field-block renderer surfaces empty / unexpected values.
  if (promptVersion === 'china_utility.v1') {
    return { stage: 'china_utility.v1', data: obj as ChinaUtilityParsed };
  }
  if (promptVersion === 'fuel_receipt.v1') {
    return { stage: 'fuel_receipt.v1', data: obj as FuelReceiptParsed };
  }
  if (promptVersion === 'freight.v1') {
    return { stage: 'freight.v1', data: obj as FreightParsed };
  }
  if (promptVersion === 'purchase.v1') {
    return { stage: 'purchase.v1', data: obj as PurchaseParsed };
  }
  if (promptVersion === 'travel.v1') {
    return { stage: 'travel.v1', data: obj as TravelParsed };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Per-stage <dl> field blocks
// ---------------------------------------------------------------------------

function FreightFields({ data }: { data: FreightParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_mode()} value={data.mode} />
      <Field label={m.documents_review_field_vehicle_class()} value={data.vehicle_class} />
      <Field
        label={m.documents_review_field_weight_kg()}
        value={typeof data.weight_kg === 'number' ? `${data.weight_kg} kg` : undefined}
      />
      <Field
        label={m.documents_review_field_volume_m3()}
        value={typeof data.volume_m3 === 'number' ? `${data.volume_m3} m³` : undefined}
      />
      <Field
        label={m.documents_review_field_distance_km()}
        value={typeof data.distance_km === 'number' ? `${data.distance_km} km` : undefined}
      />
      <Field label={m.documents_review_field_origin()} value={data.origin} />
      <Field label={m.documents_review_field_destination()} value={data.destination} />
      <Field label={m.documents_review_field_tracking_no()} value={data.tracking_no} />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_occurred_at()} value={data.occurred_at} />
    </dl>
  );
}

function PurchaseFields({ data }: { data: PurchaseParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_item_description()} value={data.item_description} />
      <Field label={m.documents_review_field_category()} value={data.category} />
      <Field
        label={m.documents_review_field_quantity_kg()}
        value={typeof data.quantity_kg === 'number' ? `${data.quantity_kg} kg` : undefined}
      />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_occurred_at()} value={data.occurred_at} />
      <Field label={m.documents_review_field_invoice_no()} value={data.invoice_no} />
    </dl>
  );
}

function TravelFields({ data }: { data: TravelParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_mode()} value={data.mode} />
      <Field label={m.documents_review_field_passenger_name()} value={data.passenger_name} />
      <Field label={m.documents_review_field_origin()} value={data.origin} />
      <Field label={m.documents_review_field_destination()} value={data.destination} />
      <Field label={m.documents_review_field_departure_at()} value={data.departure_at} />
      <Field label={m.documents_review_field_arrival_at()} value={data.arrival_at} />
      <Field label={m.documents_review_field_travel_class()} value={data.travel_class} />
      <Field
        label={m.documents_review_field_distance_km()}
        value={typeof data.distance_km === 'number' ? `${data.distance_km} km` : undefined}
      />
      <Field
        label={m.documents_review_field_flight_or_train_no()}
        value={data.flight_or_train_no}
      />
      <Field label={m.documents_review_field_vehicle_plate()} value={data.vehicle_plate} />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_ticket_no()} value={data.ticket_no} />
    </dl>
  );
}

// ---------------------------------------------------------------------------
// ActivityForm prefill builders (per stage)
// ---------------------------------------------------------------------------

/**
 * Freight prefill: amount in kg (raw, not tonne-km — distance is
 * usually null at this stage and EF Matcher Phase 1.5 will convert to
 * tonne-km), single-day event (start = end), supplier + endpoints +
 * mode + tracking_no in notes.
 *
 * The `unit='kg'` choice + per-kg freight EFs (Phase 1 manual EF
 * Matcher path) gives a non-zero CO2e on Confirm even when distance
 * is unknown. Once Phase 1.5 EF Matcher lands, this builder switches
 * to `amount = weight_kg * distance_km / 1000, unit='tonne-km'`.
 */
function buildFreightInitialValues(
  data: FreightParsed,
  filename: string,
): import('@renderer/components/ActivityForm').ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.origin || data.destination) {
    notesParts.push(`${data.origin ?? '?'} → ${data.destination ?? '?'}`);
  }
  if (data.mode) notesParts.push(`Mode: ${data.mode}`);
  if (data.tracking_no) notesParts.push(`Tracking: ${data.tracking_no}`);
  const out: import('@renderer/components/ActivityForm').ActivityFormInitialValues = {
    unit: 'kg',
    notes: notesParts.join(' · '),
  };
  if (data.occurred_at) {
    out.occurred_at_start = data.occurred_at;
    out.occurred_at_end = data.occurred_at;
  }
  if (typeof data.weight_kg === 'number') out.amount = String(data.weight_kg);
  return out;
}

/**
 * Purchase prefill: dual-track based on whether quantity_kg is known.
 *
 * If the invoice gave an explicit weight (`quantity_kg > 0`), prefill
 * `amount=String(quantity_kg)` with `unit='kg'` — EF Matcher will pick
 * a per-kg EF (e.g. embodied CO2e of steel per kg).
 *
 * If `quantity_kg` is null OR 0 (service invoices, count-based units,
 * unreadable weight), prefill `amount=String(amount_yuan)` with
 * `unit='CNY'` — EF Matcher (Phase 1.5) will pick a per-currency EF
 * (e.g. CO2e per ¥1 of office supplies / consulting services).
 *
 * Single-day event (purchase = invoice issue date), so
 * occurred_at_start = end.
 */
function buildPurchaseInitialValues(
  data: PurchaseParsed,
  filename: string,
): import('@renderer/components/ActivityForm').ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.item_description) notesParts.push(`Items: ${data.item_description}`);
  if (data.category) notesParts.push(`Category: ${data.category}`);
  if (data.invoice_no) notesParts.push(`Invoice: ${data.invoice_no}`);

  const hasWeight = typeof data.quantity_kg === 'number' && data.quantity_kg > 0;
  const out: import('@renderer/components/ActivityForm').ActivityFormInitialValues = {
    unit: hasWeight ? 'kg' : 'CNY',
    notes: notesParts.join(' · '),
  };
  if (data.occurred_at) {
    out.occurred_at_start = data.occurred_at;
    out.occurred_at_end = data.occurred_at;
  }
  if (hasWeight) {
    out.amount = String(data.quantity_kg);
  } else if (typeof data.amount_yuan === 'number') {
    out.amount = String(data.amount_yuan);
  }
  return out;
}

/**
 * Travel prefill: dual-track based on mode.
 *
 * Air / rail use 'passenger-km' as the unit (per-passenger emissions
 * regardless of the vehicle's other passengers). Taxi uses 'vehicle-km'
 * (the emission belongs to the vehicle, not divided across passengers).
 *
 * `amount` defaults to `distance_km` when known, else 1. The "amount=1"
 * default lets the user immediately commit a placeholder activity_data
 * row and have something show on the dashboard; once Phase 1.5 EF
 * Matcher's routing API fills the real distance, the amount can be
 * recalculated.
 *
 * `occurred_at_start = occurred_at_end = departure_at date portion`
 * (strip the time component because activity_data uses dates).
 */
function buildTravelInitialValues(
  data: TravelParsed,
  filename: string,
): import('@renderer/components/ActivityForm').ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.mode) notesParts.push(`Mode: ${data.mode}`);
  if (data.origin || data.destination) {
    notesParts.push(`${data.origin ?? '?'} → ${data.destination ?? '?'}`);
  }
  if (data.travel_class) notesParts.push(`Class: ${data.travel_class}`);
  if (data.flight_or_train_no) notesParts.push(`No: ${data.flight_or_train_no}`);
  if (data.vehicle_plate) notesParts.push(`Plate: ${data.vehicle_plate}`);
  if (data.ticket_no) notesParts.push(`Ticket: ${data.ticket_no}`);

  const unit = data.mode === 'taxi' ? 'vehicle-km' : 'passenger-km';
  const out: import('@renderer/components/ActivityForm').ActivityFormInitialValues = {
    unit,
    notes: notesParts.join(' · '),
  };
  // departure_at can be "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD" or empty;
  // strip to date portion only for activity_data.
  if (data.departure_at) {
    const datePart = data.departure_at.split('T')[0] ?? data.departure_at;
    out.occurred_at_start = datePart;
    out.occurred_at_end = datePart;
  }
  out.amount = typeof data.distance_km === 'number' ? String(data.distance_km) : '1';
  return out;
}
