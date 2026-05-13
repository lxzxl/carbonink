import { Field } from '../shared';
import * as m from '@renderer/paraglide/messages';
import type { TravelParsed } from './types';

export function TravelFields({ data }: { data: TravelParsed }) {
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
