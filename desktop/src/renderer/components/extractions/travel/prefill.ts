import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { TravelParsed } from './types';

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
export function buildTravelInitialValues(
  data: TravelParsed,
  filename: string,
  matcherHint?: { extraction_id: string; stage_id: string },
): ActivityFormInitialValues {
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
  const out: ActivityFormInitialValues = {
    unit,
    notes: notesParts.join(' · '),
  };
  if (data.departure_at) {
    const datePart = data.departure_at.split('T')[0] ?? data.departure_at;
    out.occurred_at_start = datePart;
    out.occurred_at_end = datePart;
  }
  out.amount = typeof data.distance_km === 'number' ? String(data.distance_km) : '1';
  if (matcherHint) out.matcherHint = matcherHint;
  if (data.origin && data.destination) {
    const hint: NonNullable<typeof out.routingHint> = {
      stage: 'travel',
      origin: data.origin,
      destination: data.destination,
    };
    if (data.mode) hint.travelMode = data.mode;
    out.routingHint = hint;
  }
  return out;
}
