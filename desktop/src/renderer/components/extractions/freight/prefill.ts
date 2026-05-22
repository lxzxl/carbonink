import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { FreightParsed } from './types';

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
export function buildFreightInitialValues(
  data: FreightParsed,
  filename: string,
  matcherHint?: { extraction_id: string; stage_id: string },
): ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.origin || data.destination) {
    notesParts.push(`${data.origin ?? '?'} → ${data.destination ?? '?'}`);
  }
  if (data.mode) notesParts.push(`Mode: ${data.mode}`);
  if (data.tracking_no) notesParts.push(`Tracking: ${data.tracking_no}`);
  const out: ActivityFormInitialValues = {
    unit: 'kg',
    notes: notesParts.join(' · '),
  };
  if (data.occurred_at) {
    out.occurred_at_start = data.occurred_at;
    out.occurred_at_end = data.occurred_at;
  }
  if (typeof data.weight_kg === 'number') out.amount = String(data.weight_kg);
  if (matcherHint) out.matcherHint = matcherHint;
  if (data.origin && data.destination) {
    out.routingHint = { stage: 'freight', origin: data.origin, destination: data.destination };
  }
  return out;
}
