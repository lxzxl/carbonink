export type TravelParsed = {
  doc_type?: string;
  supplier_name?: string;
  mode?: 'air' | 'rail' | 'taxi';
  passenger_name?: string | null;
  origin?: string;
  destination?: string;
  departure_at?: string;
  arrival_at?: string | null;
  travel_class?: string | null;
  distance_km?: number | null;
  flight_or_train_no?: string | null;
  vehicle_plate?: string | null;
  amount_yuan?: number;
  ticket_no?: string | null;
  confidence?: 'high' | 'medium' | 'low';
};
