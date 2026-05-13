import * as m from '@renderer/paraglide/messages';
import { Field } from '../shared';
import type { PurchaseParsed } from './types';

export function PurchaseFields({ data }: { data: PurchaseParsed }) {
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
