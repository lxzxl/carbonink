import airports from './airports.json' with { type: 'json' };
import { AirportUnknown } from './errors.js';

const byIata = new Map(airports.map((a) => [a.iata, a]));

export function distanceByAirport(
  originIata: string,
  destIata: string,
): { distance_km: number } | { error: AirportUnknown } {
  const o = byIata.get(originIata.toUpperCase());
  if (!o) return { error: new AirportUnknown({ iata: originIata }) };
  const d = byIata.get(destIata.toUpperCase());
  if (!d) return { error: new AirportUnknown({ iata: destIata }) };
  return { distance_km: haversineKm(o.lat, o.lng, d.lat, d.lng) };
}

export function parseIataFromString(s: string): string | null {
  const m = s.match(/\b[A-Z]{3}\b/);
  return m ? m[0] : null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
