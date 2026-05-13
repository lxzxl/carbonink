export type ChinaUtilityParsed = {
  doc_type?: string;
  supplier_name?: string;
  account_no?: string | null;
  amount_kwh?: number;
  amount_yuan?: number | null;
  period_start?: string;
  period_end?: string;
  confidence?: 'high' | 'medium' | 'low';
};
