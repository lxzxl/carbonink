export type FreightParsed = {
  doc_type?: string;
  supplier_name?: string;
  mode?: 'road' | 'rail' | 'sea' | 'air';
  vehicle_class?: string | null;
  weight_kg?: number;
  volume_m3?: number | null;
  distance_km?: number | null;
  origin?: string;
  destination?: string;
  tracking_no?: string | null;
  amount_yuan?: number;
  occurred_at?: string;
  confidence?: 'high' | 'medium' | 'low';
};
