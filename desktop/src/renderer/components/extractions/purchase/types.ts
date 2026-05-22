export type PurchaseParsed = {
  doc_type?: string;
  supplier_name?: string;
  item_description?: string;
  category?: 'raw_material' | 'component' | 'consumable' | 'office_supply' | 'service' | 'other';
  quantity_kg?: number | null;
  amount_yuan?: number;
  occurred_at?: string;
  invoice_no?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};
