import type { Database } from 'better-sqlite3';
import { Effect } from 'effect';
import { distanceByAddressAmap } from './amap-client.js';
import { AirportUnknown, type RoutingErr } from './errors.js';
import { distanceByAirport, parseIataFromString } from './haversine.js';
import { AmapKeyTag, DbTag, type RoutingR } from './tags.js';

export * from './errors.js';
export * from './tags.js';

export interface RoutingLookupInput {
  mode: 'driving' | 'transit' | 'air';
  origin: string;
  destination: string;
}

export interface RoutingLookupResult {
  distance_km: number;
  source: 'amap' | 'haversine';
  cached: boolean;
}

export function lookup(
  input: RoutingLookupInput,
): Effect.Effect<RoutingLookupResult, RoutingErr, RoutingR> {
  return Effect.gen(function* () {
    const db = yield* DbTag;
    const amapKey = yield* AmapKeyTag;

    const cached = readCache(db, input);
    if (cached) {
      return { distance_km: cached.distance_km, source: cached.source, cached: true };
    }

    if (input.mode === 'air') {
      const oIata = parseIataFromString(input.origin);
      if (!oIata) return yield* Effect.fail(new AirportUnknown({ iata: input.origin }));
      const dIata = parseIataFromString(input.destination);
      if (!dIata) return yield* Effect.fail(new AirportUnknown({ iata: input.destination }));
      const result = distanceByAirport(oIata, dIata);
      if ('error' in result) return yield* Effect.fail(result.error);
      writeCache(db, input, result.distance_km, 'haversine');
      return { distance_km: result.distance_km, source: 'haversine' as const, cached: false };
    }

    const km = yield* distanceByAddressAmap(
      { apiKey: amapKey },
      input.mode,
      input.origin,
      input.destination,
    );
    writeCache(db, input, km, 'amap');
    return { distance_km: km, source: 'amap' as const, cached: false };
  });
}

function normKey(input: RoutingLookupInput): {
  origin_norm: string;
  destination_norm: string;
  mode: string;
} {
  return {
    origin_norm: input.origin.trim().toLowerCase(),
    destination_norm: input.destination.trim().toLowerCase(),
    mode: input.mode,
  };
}

function readCache(
  db: Database,
  input: RoutingLookupInput,
): { distance_km: number; source: 'amap' | 'haversine' } | null {
  const k = normKey(input);
  const row = db
    .prepare(
      `SELECT distance_km, source FROM routing_cache WHERE origin_norm = ? AND destination_norm = ? AND mode = ?`,
    )
    .get(k.origin_norm, k.destination_norm, k.mode) as
    | { distance_km: number; source: 'amap' | 'haversine' }
    | undefined;
  return row ?? null;
}

function writeCache(
  db: Database,
  input: RoutingLookupInput,
  distance_km: number,
  source: 'amap' | 'haversine',
): void {
  const k = normKey(input);
  db.prepare(
    `INSERT OR REPLACE INTO routing_cache (origin_norm, destination_norm, mode, distance_km, source, fetched_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    k.origin_norm,
    k.destination_norm,
    k.mode,
    distance_km,
    source,
    new Date().toISOString(),
  );
}
