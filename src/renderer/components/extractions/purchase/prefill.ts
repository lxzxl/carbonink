import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { PurchaseParsed } from './types';

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
export function buildPurchaseInitialValues(
  data: PurchaseParsed,
  filename: string,
): ActivityFormInitialValues {
  const notesParts = [`Auto-extracted from: ${filename}`];
  if (data.supplier_name) notesParts.push(`Supplier: ${data.supplier_name}`);
  if (data.item_description) notesParts.push(`Items: ${data.item_description}`);
  if (data.category) notesParts.push(`Category: ${data.category}`);
  if (data.invoice_no) notesParts.push(`Invoice: ${data.invoice_no}`);

  const hasWeight = typeof data.quantity_kg === 'number' && data.quantity_kg > 0;
  const out: ActivityFormInitialValues = {
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
