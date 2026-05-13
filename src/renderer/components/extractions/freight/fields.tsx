import { Field } from '../shared';
import * as m from '@renderer/paraglide/messages';
import type { FreightParsed } from './types';

export function FreightFields({ data }: { data: FreightParsed }) {
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
