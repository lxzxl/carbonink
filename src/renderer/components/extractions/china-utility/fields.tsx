import * as m from '@renderer/paraglide/messages';
import { Field } from '../shared';
import type { ChinaUtilityParsed } from './types';

export function ChinaUtilityFields({ data }: { data: ChinaUtilityParsed }) {
  return (
    <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-4">
      <Field label={m.documents_review_field_supplier()} value={data.supplier_name} />
      <Field label={m.documents_review_field_account()} value={data.account_no} />
      <Field
        label={m.documents_review_field_amount_kwh()}
        value={typeof data.amount_kwh === 'number' ? `${data.amount_kwh} kWh` : undefined}
      />
      <Field
        label={m.documents_review_field_amount_yuan()}
        value={typeof data.amount_yuan === 'number' ? `¥${data.amount_yuan}` : undefined}
      />
      <Field label={m.documents_review_field_period_start()} value={data.period_start} />
      <Field label={m.documents_review_field_period_end()} value={data.period_end} />
    </dl>
  );
}
