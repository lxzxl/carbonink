import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { FuelReceiptParsed } from './types';

/**
 * Fuel receipt prefill: amount in liters, single-day event (start =
 * end), supplier + plate in notes. Fueling has no period — both date
 * bounds collapse to `occurred_at`.
 */
export function buildFuelReceiptInitialValues(
  data: FuelReceiptParsed,
  filename: string,
  matcherHint?: { extraction_id: string; stage_id: string },
): ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.license_plate) notesParts.push(`Plate: ${data.license_plate}`);
  if (data.fuel_type) notesParts.push(`Fuel: ${data.fuel_type}`);
  const out: ActivityFormInitialValues = {
    unit: 'L',
    notes: notesParts.join(' · '),
  };
  if (data.occurred_at) {
    out.occurred_at_start = data.occurred_at;
    out.occurred_at_end = data.occurred_at;
  }
  if (typeof data.volume_l === 'number') out.amount = String(data.volume_l);
  if (matcherHint) out.matcherHint = matcherHint;
  return out;
}
