# Routing API for `distance_km` — Design

**Date:** 2026-05-18
**Phase:** Phase 2 sub-project — fills the routing gap deferred from freight.v1 + travel.v1.
**Status:** Approved by user 2026-05-18; ready for plan.
**Predecessor:** Phase 2.2c export (`9d30ca8`).
**Successor:** TBD — Phase 1d/2 tag candidate.

## Why

`freight.v1` and `travel.v1` both ship with `distance_km: number | null`. When the extraction can't read distance from the document (most freight bills + most travel tickets don't print km), the field is `null`, ActivityForm prefills `amount = 1`, and the resulting kgCO2e is **wrong** — emission factors for transport are per-km. The user has no in-app remedy other than manually looking up the route.

This sub-project closes that gap with a `RoutingService` that takes `(mode, origin, destination)` and returns `{ distance_km, source }`. Two backends:

1. **AMap Web Service API** — for `freight` (truck) and `travel.mode ∈ {rail, taxi}`. AMap's `direction/driving` endpoint covers driving routes; `direction/transit/integrated` covers rail. Excellent China coverage (the only market this app serves). **100,000 calls/day on a free dev key** — orders of magnitude more than a single user needs.
2. **Local haversine on a bundled OpenFlights airports table** — for `travel.mode === 'air'`. International flights don't need routing; great-circle distance from airport lat/lng is the standard convention for air emissions. No API call, no key, no rate limit, ~250 KB asset bundled in the app.

## Scope

**In scope:**
- New `RoutingService` exposed via Effect-returning methods inside the main process.
- Bundled `airports.json` (slim OpenFlights subset: IATA + lat + lng + city + country, ~7500 rows, ~250 KB).
- Migration 013 — `routing_cache` table: `(origin_norm, destination_norm, mode, distance_km, source, fetched_at)`. Primary key `(origin_norm, destination_norm, mode)`. TTL = never for v1 (routes are stable).
- New IPC channel `routing:lookup({ mode, origin, destination }) → Promise<{ distance_km, source, cached }>`.
- ActivityForm: "Look up distance" button next to `distance_km` field, visible when freight / travel modes have non-empty origin/destination + null distance. Click → call IPC → fill field + show source badge ("AMap" or "Haversine, IATA: PEK→JFK").
- Settings UI: AMap key input, reusing the existing LLM provider key pattern in `SettingsService`.
- Effect operators in the service: `Effect.tryPromise + Effect.retry + Data.TaggedError` for AMap calls; plain function for haversine.

**Out of scope (deferred to v2 / Phase 3):**
- Auto-trigger on form open (v1 is explicit click — predictable + auditable).
- Per-mode routing options (avoid tolls, fastest vs shortest). AMap defaults to "fastest by car" which matches our emission-factor assumptions.
- International ground routing (OpenStreetMap / OSRM fallback for routes outside China). If freight has a non-China origin/destination, AMap returns no route, we surface the error, user enters km manually.
- Real-time routing for taxis (using actual GPS trip distance — that's a different problem).
- Bulk routing for a whole questionnaire (one click → fill all distances). Possible v2 if user demand surfaces.

## Design

### File layout

```
src/main/services/routing/
  ├── airports.json              -- bundled, ~250 KB, IATA + lat/lng + city + country
  ├── haversine.ts               -- pure: distanceByAirport(originIATA, destIATA)
  ├── amap-client.ts             -- HTTP client; takes config; returns Effect
  ├── errors.ts                  -- 4 Data.TaggedError classes + RoutingErr union
  ├── tags.ts                    -- 2 Context.Tag classes + buildRoutingLayer helper
  └── index.ts                   -- RoutingService.lookup(input): Effect<Result, RoutingErr, RoutingR>
```

The `routing/` folder mirrors `answer-generation/`'s layout — tags + errors + module functions split into focused files.

### `airports.json` shape

```json
[
  { "iata": "PEK", "lat": 40.0801, "lng": 116.5847, "city": "Beijing", "country": "CN" },
  { "iata": "JFK", "lat": 40.6398, "lng": -73.7789, "city": "New York", "country": "US" },
  ...
]
```

Source: [OpenFlights airports.dat](https://openflights.org/data.html) (ODC-BY 1.0 license, attribution in `docs/research/2026-05-18-routing-data-sources.md`). We strip non-IATA rows + columns we don't need at build time. Build-time script lives at `scripts/build-airports.mjs` — committed alongside the JSON.

### `haversine.ts` — pure backend

```ts
import airports from './airports.json' assert { type: 'json' };

export class AirportUnknown extends Data.TaggedError('AirportUnknown')<{ iata: string }> {}

const byIata = new Map(airports.map((a) => [a.iata, a]));

export function distanceByAirport(
  originIata: string,
  destIata: string,
): { distance_km: number } | { error: AirportUnknown } {
  const o = byIata.get(originIata.toUpperCase());
  const d = byIata.get(destIata.toUpperCase());
  if (!o) return { error: new AirportUnknown({ iata: originIata }) };
  if (!d) return { error: new AirportUnknown({ iata: destIata }) };
  return { distance_km: haversineKm(o.lat, o.lng, d.lat, d.lng) };
}

function haversineKm(lat1, lon1, lat2, lon2): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180)
          * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
```

The haversine math returns integer km (rounded). Emission factors don't care about sub-km precision; the round trip from "Beijing to Shanghai" being 1085 vs 1085.3 km changes the kgCO2e in the 6th decimal.

**IATA parsing from user input:** The form's `origin` / `destination` fields are free-form strings like `"Beijing PEK"` or `"PEK Beijing Capital"` or just `"PEK"` or even `"北京 首都机场"`. The service tries:
1. Extract a 3-letter uppercase pattern via regex `\b[A-Z]{3}\b` — most common case.
2. If not found → return `AirportUnknown({ iata: <whole string> })`. User adds the IATA code manually.

We don't attempt city-name → IATA fuzzy matching in v1. It's tractable (OpenFlights has city names) but error-prone (Tokyo has HND + NRT, Shanghai has PVG + SHA). Force the user to disambiguate by typing the code.

### `amap-client.ts` — HTTP backend, Effect-wrapped

```ts
const AMAP_BASE = 'https://restapi.amap.com/v3';

export interface AmapDeps {
  apiKey: string;
  fetch?: typeof fetch;
}

export class AmapApiKeyMissing  extends Data.TaggedError('AmapApiKeyMissing' )<{}>                              {}
export class AmapApiError       extends Data.TaggedError('AmapApiError'      )<{ cause: unknown }>             {}
export class AmapRateLimited    extends Data.TaggedError('AmapRateLimited'   )<{ retryAfterSec?: number }>     {}
export class AmapRouteNotFound  extends Data.TaggedError('AmapRouteNotFound' )<{ origin: string; dest: string }>{}

export type AmapErr = AmapApiKeyMissing | AmapApiError | AmapRateLimited | AmapRouteNotFound;

export function distanceByAddressAmap(
  deps: AmapDeps,
  mode: 'driving' | 'transit',
  origin: string,
  destination: string,
): Effect.Effect<number, AmapErr, never> {
  if (!deps.apiKey) return Effect.fail(new AmapApiKeyMissing());

  const endpoint = mode === 'driving' ? '/direction/driving' : '/direction/transit/integrated';
  const url = `${AMAP_BASE}${endpoint}?origin=${encodeURIComponent(origin)}` +
              `&destination=${encodeURIComponent(destination)}&key=${deps.apiKey}` +
              (mode === 'transit' ? '&city=' : '');

  return Effect.tryPromise({
    try: async () => {
      const res = await (deps.fetch ?? fetch)(url);
      const body = await res.json() as AmapDirectionResponse;
      if (body.status !== '1') {
        if (body.infocode === '10003' || body.infocode === '10004') {
          throw new AmapRateLimited({});
        }
        if (body.infocode === '20800' /* no route */) {
          throw new AmapRouteNotFound({ origin, dest: destination });
        }
        throw new AmapApiError({ cause: body.info });
      }
      const meters = mode === 'driving'
        ? Number(body.route.paths[0].distance)
        : Number(body.route.transits[0].distance);
      return Math.round(meters / 1000);
    },
    catch: (e): AmapErr =>
      e instanceof AmapRateLimited ? e
      : e instanceof AmapRouteNotFound ? e
      : e instanceof AmapApiError ? e
      : new AmapApiError({ cause: e }),
  }).pipe(
    Effect.retry({
      schedule: Schedule.exponential('200 millis').pipe(Schedule.compose(Schedule.recurs(2))),
      while: (err): err is AmapApiError => err._tag === 'AmapApiError',
    }),
  );
}
```

**Key choices:**
- `mode === 'driving'`: AMap's standard driving endpoint, used for `freight` and `travel.taxi`.
- `mode === 'transit'`: integrated transit endpoint, used for `travel.rail`. AMap returns the best multi-modal route; we use it as a proxy for "rail distance" — close enough for emissions. (Rail-specific endpoints in AMap require enterprise auth.)
- Retry only on `AmapApiError` (network/5xx). `AmapRateLimited` short-circuits — retrying compounds the problem; user sees clear error and waits. `AmapRouteNotFound` short-circuits — retrying won't change geography.
- `200ms` exponential base — AMap's quota is per-second; smaller delay than LLM (which has higher per-call latency).

### `RoutingService.lookup` — the dispatcher

```ts
// src/main/services/routing/index.ts
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
    const apiKey = yield* AmapKeyTag;

    // 1. Cache hit?
    const cached = readCache(db, input);
    if (cached) return { distance_km: cached, source: cached_source, cached: true };

    // 2. Air mode → haversine path
    if (input.mode === 'air') {
      const o = parseIataFromString(input.origin);
      const d = parseIataFromString(input.destination);
      if (!o) return yield* Effect.fail(new AirportUnknown({ iata: input.origin }));
      if (!d) return yield* Effect.fail(new AirportUnknown({ iata: input.destination }));
      const result = distanceByAirport(o, d);
      if ('error' in result) return yield* Effect.fail(result.error);
      writeCache(db, input, result.distance_km, 'haversine');
      return { distance_km: result.distance_km, source: 'haversine' as const, cached: false };
    }

    // 3. Driving / transit → AMap path
    const km = yield* distanceByAddressAmap({ apiKey }, input.mode, input.origin, input.destination);
    writeCache(db, input, km, 'amap');
    return { distance_km: km, source: 'amap' as const, cached: false };
  });
}

export type RoutingErr = AmapErr | AirportUnknown;
```

The dispatch is mode-based:
- `air` → local table (free, instant)
- `driving` | `transit` → AMap (key required)

Caching happens AFTER successful lookup, regardless of backend. Cache misses fall through to the backend.

### `routing_cache` migration

```sql
-- 013_routing_cache.sql
CREATE TABLE routing_cache (
  origin_norm      TEXT NOT NULL,
  destination_norm TEXT NOT NULL,
  mode             TEXT NOT NULL CHECK(mode IN ('driving', 'transit', 'air')),
  distance_km      INTEGER NOT NULL,
  source           TEXT NOT NULL CHECK(source IN ('amap', 'haversine')),
  fetched_at       TEXT NOT NULL,
  PRIMARY KEY (origin_norm, destination_norm, mode)
);
```

Normalization: `origin_norm = origin.trim().toLowerCase()`. Cheap and good enough. The cache is single-user, single-machine; we're not worried about cross-user pollution.

### IPC channel

```ts
'routing:lookup': (input: RoutingLookupInput) => Promise<
  | { ok: true; distance_km: number; source: 'amap' | 'haversine'; cached: boolean }
  | { ok: false; error: { _tag: string; message: string } }
>;
```

The handler runs `Effect.runPromise(lookup(input).pipe(Effect.provide(ctx.routingLayer)))` inside a `try/catch` that maps `RoutingErr` to the discriminated `{ ok: false, error }` shape. Errors surface as toasts in the UI; no exception bubbles to the renderer.

### Settings UI

The existing Settings page exposes LLM provider key inputs. Add **one more row** for AMap key — same `SettingsService.put('routing.amap.apikey', value)` pattern. No new pattern needed; ~10 lines of UI change.

Credential storage: routing.amap.apikey reuses the credential store. AMap key never appears in `process.env` or hardcoded constants.

### ActivityForm integration

`distance_km` field already exists in the form for freight + travel. Next to it, add:

```
[ distance_km input ]   [Look up distance ▾]   ✓ AMap (1085 km, fresh)
                                                   or
                                                ✓ Haversine PEK→JFK (10,985 km)
```

The button is:
- **Visible** when (a) mode allows routing (freight always; travel.mode ∈ {air, rail, taxi}) AND (b) origin + destination are non-empty.
- **Disabled** while lookup is in flight.
- **On success**: fills the distance_km field; shows source badge.
- **On error**: toast with the error message ("AMap API key not set — open Settings" / "Airport unknown: 'XYZ'" / etc.). Field stays empty; user can retry or enter manually.

i18n keys (4):
- `routing_lookup_button` — "Look up distance" / "查询距离"
- `routing_lookup_running` — "Looking up…" / "查询中…"
- `routing_lookup_done_amap` — "AMap: {km} km" / "高德：{km} km"
- `routing_lookup_done_haversine` — "Haversine: {km} km" / "大圆距离：{km} km"

## Decision points

| Decision | Choice | Why |
|---|---|---|
| Backends | AMap (driving/transit) + local haversine (air) | Best China coverage + no extra dependency for air |
| Airport data | Bundled OpenFlights JSON | Offline, instant, no rate limit, ~250 KB acceptable |
| Cache | SQLite `routing_cache` table | Survives restart; (origin, dest, mode) PK |
| Cache TTL | None | Routes don't change; over-caching is the conservative direction |
| Trigger | Explicit button in ActivityForm | Predictable + auditable; auto-fetch on form open is v2 |
| Bulk lookup | Out of scope | One row at a time; bulk = future |
| Retry policy | Exponential 200ms, recurs(2), only on `AmapApiError` | Same shape as LLM retry; not on rate-limit or no-route |
| Settings UI | One new row, reuse SettingsService.put | Existing pattern; no refactor |
| IATA detection | Regex `\b[A-Z]{3}\b` | Forces user to disambiguate ambiguous city names |
| Effect | Yes, for AMap path | HTTP + retry + typed errors is the canonical Effect use case |
| City-name fuzzy match | Out of scope | Ambiguous (Tokyo has 2 airports); v2 if needed |

## Risk + rollback

**Risk 1 — AMap response shape drift.** The endpoint has been stable for years, but body shape parsing (`body.route.paths[0].distance`) is a single point of failure. The error mapping returns `AmapApiError` if parse throws; user retries; we add a fixture-based test if a bug surfaces.

**Risk 2 — Free-key rate limits.** 100k/day = >1100/min spike capacity. A heavy user generating 50 freight bills/day → 50 calls → 0.05% of quota. Realistic stress is 0.1-1%. Not a concern.

**Risk 3 — IATA detection misses non-standard inputs.** "北京首都机场" without "PEK" → no match → `AirportUnknown`. User sees error and types the code. Acceptable v1 behavior.

**Risk 4 — Cross-machine cache invalidation.** Not applicable — single-user desktop app, cache is per-machine.

**Rollback:** Migration 013 is reversible by manual `DROP TABLE routing_cache` (we don't run down-migrations in this app, but the table is purely additive — removing the IPC handler + UI button leaves an unused table, no breakage). All 4 service files + IPC handler + ActivityForm button are revertable via `git revert`.

## Closeout criteria

- `RoutingService.lookup(input)` returns `{ distance_km, source, cached }` for any valid mode + origin + destination.
- Migration 013 adds `routing_cache` table.
- `airports.json` bundled (~250 KB) with build script.
- IPC channel `routing:lookup` wired.
- ActivityForm shows "Look up distance" button for freight + travel rows with null `distance_km`.
- Settings UI has AMap key input.
- 4 i18n keys added.
- 517 → ~528 tests (+11: 2 haversine, 3 AMap client, 2 service, 1 handler, 1 button smoke, 1 cache + 1 migration check).
- `pnpm typecheck` + biome clean.
