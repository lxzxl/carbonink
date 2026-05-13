import type { ActivityFormInitialValues } from '@renderer/components/ActivityForm';
import type { ChinaUtilityParsed } from './types';

export function buildChinaUtilityInitialValues(
  data: ChinaUtilityParsed,
  filename: string,
): ActivityFormInitialValues {
  const out: ActivityFormInitialValues = {
    unit: 'kWh',
    notes: `Auto-extracted from: ${filename}`,
  };
  if (data.period_start) out.occurred_at_start = data.period_start;
  if (data.period_end) out.occurred_at_end = data.period_end;
  if (typeof data.amount_kwh === 'number') out.amount = String(data.amount_kwh);
  return out;
}
