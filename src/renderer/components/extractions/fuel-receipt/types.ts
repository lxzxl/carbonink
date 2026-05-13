export type FuelReceiptParsed = {
  doc_type?: string;
  supplier_name?: string;
  fuel_type?: string;
  fuel_category?:
    | 'gasoline'
    | 'diesel'
    | 'lpg'
    | 'cng'
    | 'jet_fuel'
    | 'marine_fuel'
    | 'biofuel'
    | 'other';
  volume_l?: number;
  unit_price_yuan?: number | null;
  amount_yuan?: number;
  occurred_at?: string;
  license_plate?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};
