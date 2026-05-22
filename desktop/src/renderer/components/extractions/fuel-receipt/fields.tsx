import * as m from '@renderer/paraglide/messages';
import { Field } from '../shared';
import type { FuelReceiptParsed } from './types';

export function FuelReceiptFields({ data }: { data: FuelReceiptParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_fuel_type()} value={data.fuel_type} />
      <Field label={m.documents_review_field_fuel_category()} value={data.fuel_category} />
      <Field
        label={m.documents_review_field_volume_l()}
        value={typeof data.volume_l === 'number' ? `${data.volume_l} L` : undefined}
      />
      <Field
        label={m.documents_review_field_unit_price_yuan()}
        value={typeof data.unit_price_yuan === 'number' ? `¥${data.unit_price_yuan}` : undefined}
      />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_occurred_at()} value={data.occurred_at} />
      <Field label={m.documents_review_field_license_plate()} value={data.license_plate} />
    </dl>
  );
}
