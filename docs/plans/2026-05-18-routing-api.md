# Routing API for `distance_km` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user fill `distance_km` for freight + travel rows via a "Look up distance" button. AMap Direction API for driving/transit; local haversine on a bundled OpenFlights table for air. Cache results.

**Architecture:** Effect-shaped `RoutingService.lookup(input)` dispatches on `mode` — `air` → pure haversine on bundled `airports.json`; `driving | transit` → AMap HTTP via `Effect.tryPromise + Effect.retry`. `routing_cache` SQLite table for cross-call dedup. Settings UI adds AMap key row reusing the existing credential pattern.

**Tech Stack:** Effect 3.21 (`Context.Tag`, `Layer`, `Effect.retry`, `Data.TaggedError`), `better-sqlite3` (cache table), `node:fetch` (AMap), OpenFlights JSON dataset bundled at build time.

**Spec:** `docs/specs/2026-05-18-routing-api-design.md`

**Baseline:** 517 tests passing on `main` after Phase 2.2c (`9d30ca8`). Target: ~528 tests.

---

## Task 1: Bundled airports table + haversine + tests

**Files:**
- Create: `src/main/services/routing/airports.json` — slim OpenFlights subset (IATA + lat + lng + city + country)
- Create: `scripts/build-airports.mjs` — build-time script that produces airports.json (committed alongside the data)
- Create: `src/main/services/routing/haversine.ts` — `distanceByAirport(originIata, destIata)` pure function
- Create: `src/main/services/routing/errors.ts` — `AirportUnknown` Data.TaggedError (other errors come in T2)
- Create: `tests/main/routing/haversine.test.ts` — 2 unit tests

**Important:** OpenFlights data is too large to fetch and ship inside this single task — instead, **commit a pre-built minimal airports.json directly**. The build script is for documentation / future regeneration; don't run it as part of this task (would require network).

- [ ] **Step 1: Verify state**

```bash
cd /Users/lxz/ws/personal/carbonbook
git branch --show-current
git log --oneline -3
```

Expected: branch `main`, top commit `419516f`.

- [ ] **Step 2: Create the slim airports.json**

Create a minimal `src/main/services/routing/airports.json` containing the **12-15 most common Chinese + international airports** needed for unit tests + demo. Real-world full dataset is a separate operational concern; we ship a starter set in v1 + a build script for the user to expand.

```json
[
  { "iata": "PEK", "lat": 40.0801, "lng": 116.5847, "city": "Beijing", "country": "CN" },
  { "iata": "PVG", "lat": 31.1443, "lng": 121.8083, "city": "Shanghai", "country": "CN" },
  { "iata": "SHA", "lat": 31.1979, "lng": 121.3363, "city": "Shanghai", "country": "CN" },
  { "iata": "CAN", "lat": 23.3924, "lng": 113.2988, "city": "Guangzhou", "country": "CN" },
  { "iata": "SZX", "lat": 22.6393, "lng": 113.8108, "city": "Shenzhen", "country": "CN" },
  { "iata": "CTU", "lat": 30.5785, "lng": 103.9472, "city": "Chengdu", "country": "CN" },
  { "iata": "XIY", "lat": 34.4471, "lng": 108.7516, "city": "Xi'an", "country": "CN" },
  { "iata": "KMG", "lat": 25.1019, "lng": 102.9292, "city": "Kunming", "country": "CN" },
  { "iata": "HGH", "lat": 30.2295, "lng": 120.4347, "city": "Hangzhou", "country": "CN" },
  { "iata": "HKG", "lat": 22.3080, "lng": 113.9185, "city": "Hong Kong", "country": "HK" },
  { "iata": "TPE", "lat": 25.0777, "lng": 121.2329, "city": "Taipei", "country": "TW" },
  { "iata": "NRT", "lat": 35.7647, "lng": 140.3863, "city": "Tokyo", "country": "JP" },
  { "iata": "ICN", "lat": 37.4691, "lng": 126.4505, "city": "Seoul", "country": "KR" },
  { "iata": "JFK", "lat": 40.6398, "lng": -73.7789, "city": "New York", "country": "US" },
  { "iata": "LAX", "lat": 33.9425, "lng": -118.4081, "city": "Los Angeles", "country": "US" },
  { "iata": "LHR", "lat": 51.4700, "lng": -0.4543, "city": "London", "country": "GB" },
  { "iata": "FRA", "lat": 50.0379, "lng": 8.5622, "city": "Frankfurt", "country": "DE" },
  { "iata": "SIN", "lat": 1.3644, "lng": 103.9915, "city": "Singapore", "country": "SG" }
]
```

Total: 18 airports, ~3 KB. Good enough for v1; user can add more by editing the file (or running the build script if they want the full ~7500-row OpenFlights set).

- [ ] **Step 3: Create the build script (documentation)**

`scripts/build-airports.mjs`:

```js
#!/usr/bin/env node
// Build script for airports.json. Run with --network when you want the full
// OpenFlights set; otherwise the committed JSON in src/main/services/routing/
// is the runtime data.
//
// Usage:
//   node scripts/build-airports.mjs > src/main/services/routing/airports.json
//
// Source: https://openflights.org/data.html (ODC-BY 1.0)
//
// CSV columns: id, name, city, country, IATA, ICAO, lat, lng, alt, tz_offset, dst, tz_name, type, source

import { writeFileSync } from 'node:fs';

const SOURCE = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';

const res = await fetch(SOURCE);
const csv = await res.text();
const rows = csv.split('\n').filter(Boolean);

const airports = [];
for (const row of rows) {
  // Naive CSV split — OpenFlights data has quoted-comma values; use a real CSV parser in production.
  const cols = row.match(/(?:[^,"]+|"[^"]*")+/g) ?? [];
  const iata = cols[4]?.replace(/"/g, '');
  if (!iata || iata === '\\N' || iata.length !== 3) continue;
  const lat = Number(cols[6]);
  const lng = Number(cols[7]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  airports.push({
    iata,
    lat: Math.round(lat * 10000) / 10000,
    lng: Math.round(lng * 10000) / 10000,
    city: cols[2]?.replace(/"/g, ''),
    country: cols[3]?.replace(/"/g, ''),
  });
}

writeFileSync(process.stdout.fd, JSON.stringify(airports, null, 2));
console.error(`Wrote ${airports.length} airports`);
```

This script is documentation — we don't run it in CI or as part of this task. Commit it alongside the JSON.

- [ ] **Step 4: Create errors.ts**

```ts
// src/main/services/routing/errors.ts
import { Data } from 'effect';

export class AirportUnknown extends Data.TaggedError('AirportUnknown')<{ iata: string }> {}

// AMap errors come in T2.
```

- [ ] **Step 5: Write failing tests for haversine**

```ts
// tests/main/routing/haversine.test.ts
import { distanceByAirport, parseIataFromString } from '@main/services/routing/haversine';
import { describe, expect, it } from 'vitest';

describe('distanceByAirport', () => {
  it('computes great-circle distance between PEK and JFK', () => {
    const result = distanceByAirport('PEK', 'JFK');
    if ('error' in result) throw new Error('expected ok');
    // PEK → JFK is ~11,000 km. Allow ±3% for haversine vs WGS84 rounding.
    expect(result.distance_km).toBeGreaterThan(10700);
    expect(result.distance_km).toBeLessThan(11300);
  });

  it('returns AirportUnknown error for unknown IATA', () => {
    const result = distanceByAirport('PEK', 'ZZZ');
    if (!('error' in result)) throw new Error('expected error');
    expect(result.error._tag).toBe('AirportUnknown');
    expect(result.error.iata).toBe('ZZZ');
  });
});

describe('parseIataFromString', () => {
  it('extracts IATA from "Beijing PEK"', () => {
    expect(parseIataFromString('Beijing PEK')).toBe('PEK');
  });

  it('extracts IATA from "PEK"', () => {
    expect(parseIataFromString('PEK')).toBe('PEK');
  });

  it('returns null for "Beijing" (no IATA)', () => {
    expect(parseIataFromString('Beijing')).toBeNull();
  });
});
```

- [ ] **Step 6: Run, confirm fail**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run tests/main/routing/haversine.test.ts --pool=threads 2>&1 | tail -15
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement haversine.ts**

```ts
// src/main/services/routing/haversine.ts
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
```

**Note on `import ... with { type: 'json' }`:** TypeScript 5+ supports this import attribute. If your `tsconfig.json` doesn't have `"resolveJsonModule": true` set, add it. Most likely it already is (the repo imports JSON elsewhere).

**Tooling check:** `airports.json` must be picked up by electron-vite's build. The default Vite resolver handles JSON imports automatically. If `pnpm typecheck` complains about the JSON shape, you may need a `.d.ts` declaration or to cast `airports as Airport[]`. Look at how `parser.ts` or other code in `src/main/` handles bundled data; mirror that pattern.

- [ ] **Step 8: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/routing/haversine.test.ts --pool=threads 2>&1 | tail -10
```

Expected: typecheck clean, 5/5 tests pass.

- [ ] **Step 9: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/routing/ scripts/build-airports.mjs tests/main/routing/
git commit -m "feat(routing): airports.json + haversine + parseIataFromString — air-mode distance backend"
git branch --show-current
```

Expected: 522 tests passing (517 + 5), branch `main`.

---

## Task 2: AMap client + Effect.retry + tests

**Files:**
- Create: `src/main/services/routing/amap-client.ts`
- Modify: `src/main/services/routing/errors.ts` — add 4 AMap typed errors + `AmapErr` union
- Create: `tests/main/routing/amap-client.test.ts` — 3 unit tests (happy / rate-limit / retry-then-fail)

- [ ] **Step 1: Add typed errors**

Append to `src/main/services/routing/errors.ts`:

```ts
export class AmapApiKeyMissing extends Data.TaggedError('AmapApiKeyMissing')<{}> {}
export class AmapApiError extends Data.TaggedError('AmapApiError')<{ cause: unknown }> {}
export class AmapRateLimited extends Data.TaggedError('AmapRateLimited')<{ retryAfterSec?: number }> {}
export class AmapRouteNotFound extends Data.TaggedError('AmapRouteNotFound')<{ origin: string; dest: string }> {}

export type AmapErr = AmapApiKeyMissing | AmapApiError | AmapRateLimited | AmapRouteNotFound;
export type RoutingErr = AmapErr | AirportUnknown;
```

- [ ] **Step 2: Write 3 failing tests**

```ts
// tests/main/routing/amap-client.test.ts
import { distanceByAddressAmap } from '@main/services/routing/amap-client';
import { Effect, Exit, Cause, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

function failureTag<A>(exit: Exit.Exit<A, unknown>): string | null {
  if (Exit.isSuccess(exit)) return null;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) return null;
  return (failure.value as { _tag?: string })._tag ?? null;
}

const VALID_AMAP_BODY = {
  status: '1',
  info: 'OK',
  infocode: '10000',
  route: { paths: [{ distance: '12345' }] },
};

describe('distanceByAddressAmap', () => {
  it('happy path: returns km from driving response', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => VALID_AMAP_BODY,
    });
    const result = await Effect.runPromise(
      distanceByAddressAmap({ apiKey: 'k', fetch: fakeFetch as never }, 'driving', 'Beijing', 'Shanghai'),
    );
    expect(result).toBe(12); // 12345m → 12 km rounded
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it('AmapRateLimited on infocode 10003 (no retry)', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      json: async () => ({ status: '0', infocode: '10003', info: 'DAILY_QUERY_OVER_LIMIT' }),
    });
    const exit = await Effect.runPromiseExit(
      distanceByAddressAmap({ apiKey: 'k', fetch: fakeFetch as never }, 'driving', 'A', 'B'),
    );
    expect(failureTag(exit)).toBe('AmapRateLimited');
    expect(fakeFetch).toHaveBeenCalledTimes(1); // no retry
  });

  it('retries AmapApiError up to 2 times then surfaces', async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error('network'));
    const exit = await Effect.runPromiseExit(
      distanceByAddressAmap({ apiKey: 'k', fetch: fakeFetch as never }, 'driving', 'A', 'B'),
    );
    expect(failureTag(exit)).toBe('AmapApiError');
    expect(fakeFetch).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
```

- [ ] **Step 3: Implement amap-client.ts**

```ts
// src/main/services/routing/amap-client.ts
import { Effect, Schedule } from 'effect';
import {
  AmapApiError,
  AmapApiKeyMissing,
  AmapRateLimited,
  AmapRouteNotFound,
  type AmapErr,
} from './errors.js';

const AMAP_BASE = 'https://restapi.amap.com/v3';
const RETRY_SCHEDULE = Schedule.exponential('200 millis').pipe(Schedule.compose(Schedule.recurs(2)));

interface AmapDirectionResponse {
  status: '0' | '1';
  info: string;
  infocode: string;
  route?: { paths?: { distance: string }[]; transits?: { distance: string }[] };
}

export interface AmapDeps {
  apiKey: string;
  fetch?: typeof fetch;
}

export function distanceByAddressAmap(
  deps: AmapDeps,
  mode: 'driving' | 'transit',
  origin: string,
  destination: string,
): Effect.Effect<number, AmapErr, never> {
  if (!deps.apiKey) return Effect.fail(new AmapApiKeyMissing());

  const endpoint = mode === 'driving' ? '/direction/driving' : '/direction/transit/integrated';
  const url =
    `${AMAP_BASE}${endpoint}?origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}&key=${deps.apiKey}` +
    (mode === 'transit' ? '&city=' : '');

  return Effect.tryPromise({
    try: async (): Promise<number> => {
      const res = await (deps.fetch ?? fetch)(url);
      const body = (await res.json()) as AmapDirectionResponse;
      if (body.status !== '1') {
        if (body.infocode === '10003' || body.infocode === '10004') {
          throw new AmapRateLimited({});
        }
        if (body.infocode === '20800') {
          throw new AmapRouteNotFound({ origin, dest: destination });
        }
        throw new AmapApiError({ cause: body.info });
      }
      const meters =
        mode === 'driving'
          ? Number(body.route?.paths?.[0]?.distance)
          : Number(body.route?.transits?.[0]?.distance);
      if (!Number.isFinite(meters)) {
        throw new AmapApiError({ cause: 'unexpected response shape' });
      }
      return Math.round(meters / 1000);
    },
    catch: (e): AmapErr =>
      e instanceof AmapApiKeyMissing
        ? e
        : e instanceof AmapRateLimited
          ? e
          : e instanceof AmapRouteNotFound
            ? e
            : e instanceof AmapApiError
              ? e
              : new AmapApiError({ cause: e }),
  }).pipe(
    Effect.retry({
      schedule: RETRY_SCHEDULE,
      while: (err): err is AmapApiError => err._tag === 'AmapApiError',
    }),
  );
}
```

- [ ] **Step 4: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/routing/amap-client.test.ts --pool=threads 2>&1 | tail -10
```

Expected: typecheck clean, 3/3 tests pass.

The 3rd test waits ~600ms total (200ms + 400ms exponential delays). Acceptable.

- [ ] **Step 5: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/services/routing/amap-client.ts src/main/services/routing/errors.ts tests/main/routing/amap-client.test.ts
git commit -m "feat(routing): AMap client — Effect.retry + 4 typed errors for driving/transit"
git branch --show-current
```

Expected: 525 tests passing (522 + 3).

---

## Task 3: Migration + RoutingService dispatcher + tags/Layer + 2 service tests

**Files:**
- Create: `src/main/db/migrations/013_routing_cache.sql`
- Modify: `src/main/db/migrate.ts` if migrations are registered there
- Create: `src/main/services/routing/tags.ts` — Context.Tag classes + buildRoutingLayer
- Create: `src/main/services/routing/index.ts` — `RoutingService.lookup(input)` + cache helpers
- Create: `tests/main/routing/routing-service.test.ts` — 2 tests (cache hit + dispatch on mode)

- [ ] **Step 1: Add migration 013**

```sql
-- src/main/db/migrations/013_routing_cache.sql
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

If `src/main/db/migrate.ts` enumerates migrations explicitly (rather than picking up `*.sql` automatically), add `013_routing_cache.sql` to the list. Read the existing migration registration to confirm.

- [ ] **Step 2: Tags + Layer**

```ts
// src/main/services/routing/tags.ts
import type { Database } from 'better-sqlite3';
import { Context, Layer } from 'effect';

export class DbTag extends Context.Tag('routing/Db')<DbTag, Database>() {}
export class AmapKeyTag extends Context.Tag('routing/AmapKey')<AmapKeyTag, string>() {}

export type RoutingR = DbTag | AmapKeyTag;

export interface RoutingDeps {
  db: Database;
  amapKey: string;
}

export function buildRoutingLayer(deps: RoutingDeps): Layer.Layer<RoutingR> {
  return Layer.mergeAll(
    Layer.succeed(DbTag, deps.db),
    Layer.succeed(AmapKeyTag, deps.amapKey),
  );
}
```

- [ ] **Step 3: Service**

```ts
// src/main/services/routing/index.ts
import type { Database } from 'better-sqlite3';
import { Effect } from 'effect';
import { distanceByAddressAmap } from './amap-client.js';
import { type AirportUnknown, type AmapErr, type RoutingErr } from './errors.js';
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
      if (!oIata) return yield* Effect.fail(new AirportUnknown_local(input.origin));
      const dIata = parseIataFromString(input.destination);
      if (!dIata) return yield* Effect.fail(new AirportUnknown_local(input.destination));
      const result = distanceByAirport(oIata, dIata);
      if ('error' in result) return yield* Effect.fail(result.error);
      writeCache(db, input, result.distance_km, 'haversine');
      return { distance_km: result.distance_km, source: 'haversine' as const, cached: false };
    }

    const km = yield* distanceByAddressAmap({ apiKey: amapKey }, input.mode, input.origin, input.destination);
    writeCache(db, input, km, 'amap');
    return { distance_km: km, source: 'amap' as const, cached: false };
  });
}

import { AirportUnknown } from './errors.js';
const AirportUnknown_local = (iata: string): AirportUnknown =>
  new (AirportUnknown as unknown as new (args: { iata: string }) => AirportUnknown)({ iata });

function normKey(input: RoutingLookupInput): { origin_norm: string; destination_norm: string; mode: string } {
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
  ).run(k.origin_norm, k.destination_norm, k.mode, distance_km, source, new Date().toISOString());
}
```

**Cleanup needed:** the `AirportUnknown_local` helper is messy. Simplify by re-importing `AirportUnknown` from `./errors` at the top of the file and just `new AirportUnknown({ iata })` directly. The duplicated import is fine; the helper trick is overkill.

Cleaner version:

```ts
import { AirportUnknown, type AmapErr, type RoutingErr } from './errors.js';

// ... inside lookup gen body:
const oIata = parseIataFromString(input.origin);
if (!oIata) return yield* Effect.fail(new AirportUnknown({ iata: input.origin }));
```

That's the version to ship. Remove the `AirportUnknown_local` indirection.

- [ ] **Step 4: Write 2 service tests**

```ts
// tests/main/routing/routing-service.test.ts
import { runMigrations } from '@main/db/migrate';
import * as routingSvc from '@main/services/routing';
import { AmapKeyTag, DbTag } from '@main/services/routing/tags';
import { distanceByAddressAmap } from '@main/services/routing/amap-client';
import Database from 'better-sqlite3';
import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/services/routing/amap-client', async () => {
  const actual = await vi.importActual<typeof import('@main/services/routing/amap-client')>(
    '@main/services/routing/amap-client',
  );
  return { ...actual, distanceByAddressAmap: vi.fn() };
});

function setup() {
  const db = new Database(':memory:');
  runMigrations(db);
  const testLayer = Layer.mergeAll(
    Layer.succeed(DbTag, db),
    Layer.succeed(AmapKeyTag, 'fake-key'),
  );
  return { db, testLayer };
}

afterEach(() => vi.clearAllMocks());

describe('RoutingService.lookup', () => {
  it('air mode → haversine; second call returns cached:true', async () => {
    const { testLayer, db } = setup();
    const result1 = await Effect.runPromise(
      routingSvc.lookup({ mode: 'air', origin: 'PEK', destination: 'JFK' }).pipe(Effect.provide(testLayer)),
    );
    expect(result1.source).toBe('haversine');
    expect(result1.cached).toBe(false);
    expect(result1.distance_km).toBeGreaterThan(10700);

    const result2 = await Effect.runPromise(
      routingSvc.lookup({ mode: 'air', origin: 'PEK', destination: 'JFK' }).pipe(Effect.provide(testLayer)),
    );
    expect(result2.cached).toBe(true);
    expect(result2.distance_km).toBe(result1.distance_km);

    const rows = db.prepare(`SELECT * FROM routing_cache`).all();
    expect(rows.length).toBe(1);
  });

  it('driving mode calls AMap client; result cached', async () => {
    const { testLayer, db } = setup();
    vi.mocked(distanceByAddressAmap).mockReturnValue(Effect.succeed(1234) as never);
    const result = await Effect.runPromise(
      routingSvc.lookup({ mode: 'driving', origin: '北京', destination: '上海' }).pipe(Effect.provide(testLayer)),
    );
    expect(result.distance_km).toBe(1234);
    expect(result.source).toBe('amap');
    expect(result.cached).toBe(false);
    expect(distanceByAddressAmap).toHaveBeenCalledTimes(1);

    const cached = db.prepare(`SELECT distance_km FROM routing_cache`).get() as { distance_km: number };
    expect(cached.distance_km).toBe(1234);
  });
});
```

- [ ] **Step 5: Verify**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck 2>&1 | tail -10
pnpm vitest run tests/main/routing/ --pool=threads 2>&1 | tail -10
```

Expected: typecheck clean, all routing tests pass.

- [ ] **Step 6: Full suite + commit**

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm vitest run --pool=threads 2>&1 | tail -5
git add src/main/db/migrations/013_routing_cache.sql src/main/services/routing/index.ts src/main/services/routing/tags.ts tests/main/routing/routing-service.test.ts
git add -u src/main/db/migrate.ts 2>/dev/null || true
git commit -m "feat(routing): RoutingService.lookup + routing_cache migration — Effect-based dispatcher"
git branch --show-current
```

Expected: 527 tests passing (525 + 2).

---

## Task 4: IPC channel + renderer client + handler test

**Files:**
- Modify: `src/main/ipc/types.ts` — add `routing:lookup` channel
- Modify: `src/main/ipc/context.ts` — add `routingLayer` (lazy, like `answerLayer`)
- Create: `src/main/ipc/handlers/routing.ts` — handler that runs Effect + maps errors to wire shape
- Modify: `src/main/ipc/setup.ts` — register routingHandlers
- Modify: `src/preload/bridge.ts` — allowlist
- Modify: `tests/preload/bridge.test.ts` — allowlist assertion
- Create: `src/renderer/lib/api/routing.ts` — `routingApi.lookup(input)`
- Create: `tests/main/ipc/routing-handlers.test.ts` — 1 happy-path test

The handler maps `RoutingErr` (a union of typed errors) to a discriminated `{ ok, error }` wire shape, same pattern as `answer:generate-all-unanswered`.

```ts
'routing:lookup': (input: RoutingLookupInput) => Promise<
  | { ok: true; distance_km: number; source: 'amap' | 'haversine'; cached: boolean }
  | { ok: false; error: { _tag: string; message: string } }
>;
```

Handler:

```ts
// src/main/ipc/handlers/routing.ts
import { Effect } from 'effect';
import { z } from 'zod';
import * as routingSvc from '@main/services/routing';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const input = z.object({
  mode: z.enum(['driving', 'transit', 'air']),
  origin: z.string().min(1),
  destination: z.string().min(1),
});

export function routingHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'routing:lookup': async (raw) => {
      const parsed = input.parse(raw);
      const exit = await Effect.runPromiseExit(
        routingSvc.lookup(parsed).pipe(Effect.provide(ctx.routingLayer)),
      );
      if (exit._tag === 'Success') {
        return { ok: true, ...exit.value };
      }
      // Map typed error to wire shape
      const failure = Cause.failureOption(exit.cause);
      // ...
    },
  };
}
```

(Pattern follows the answer-handlers.test.ts approach from Phase 2.2b T4 / Effect Step 3 T3.)

**Context wiring:** add `routingLayer` lazy getter on `IpcContext`. Reads `db` (already on ctx) + `routing.amap.apikey` from settings (similar to how `providerConfig` reads from settings). If the key is missing, expose `''` as the AMap key — the service then fails with `AmapApiKeyMissing` on the first call, surfaced to UI as a clear error toast.

- [ ] Detailed implementation: mirror T3 of Effect Step 3 (`0b017a4`) which built `answer:generate-all-unanswered` with the same `Either.match`-to-wire-shape pattern.

- [ ] **Commit:**

```bash
git commit -m "feat(ipc): routing:lookup channel + handler + renderer client"
```

Expected: ~528 tests.

---

## Task 5: ActivityForm integration + Settings UI for AMap key + i18n + smoke test

**Files:**
- Modify: `src/renderer/components/ActivityForm.tsx` — add "Look up distance" button next to distance_km field (visible only for freight + travel rows with null distance_km)
- Modify: `src/renderer/routes/settings.*` — add AMap key input row
- Modify: `messages/en.json` + `messages/zh-CN.json` — 4 i18n keys
- Modify or create: `tests/renderer/activity-form.test.tsx` — 1 smoke test for the button

**ActivityForm integration:** Find the `distance_km` field in ActivityForm. Conditionally render a sibling button. On click → `routingApi.lookup({ mode, origin, destination })`. On success → fill the form's `distance_km` field + show source badge. On error → toast.

`mode` mapping:
- freight extraction → `'driving'`
- travel.mode === 'air' → `'air'`
- travel.mode === 'rail' → `'transit'`
- travel.mode === 'taxi' → `'driving'`

i18n keys:
- `routing_lookup_button` — "Look up distance" / "查询距离"
- `routing_lookup_running` — "Looking up…" / "查询中…"
- `routing_lookup_done_amap` — "AMap: {km} km" / "高德：{km} km"
- `routing_lookup_done_haversine` — "Haversine: {km} km" / "大圆距离：{km} km"

**Settings UI:** Find the existing LLM provider key input in Settings. Duplicate the row for `routing.amap.apikey`. Label: "AMap API key" / "高德 API key". Help text: link to https://lbs.amap.com/dev/ in plain text.

- [ ] **Commit:**

```bash
git commit -m "feat(ui): Look up distance button on ActivityForm + AMap key setting"
```

---

## Task 6: Sweep + verification

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm typecheck
pnpm format 2>&1 | tail -3
pnpm exec biome check --write 2>&1 | tail -3
pnpm vitest run --pool=threads 2>&1 | tail -5
git status
git add -A
git commit -m "chore: biome sweep for routing API" || true
git log --oneline -10
```

Target: ~528 tests, typecheck + biome clean.

---

## Closeout

Routing API lands on `main`:

- `RoutingService.lookup({ mode, origin, destination })` returns `{ distance_km, source, cached }`.
- `air` mode → local haversine on 18 bundled airports (extendable via build script).
- `driving | transit` → AMap with Effect.retry + 4 typed errors.
- Migration 013 adds `routing_cache` table (PK on `origin_norm, destination_norm, mode`).
- "Look up distance" button on ActivityForm for freight + travel rows.
- Settings UI exposes AMap key input (free dev key, 100k/day).
- ~528 tests, typecheck + lint clean.

Closes the `distance_km` gap deferred from freight.v1 + travel.v1. The data is no longer null for routable rows; kgCO2e for transport is now accurate.

**Two interview-grade insights this lands:**

1. **HTTP-bound Effect operators reuse the same retry/typed-error patterns as LLM.** The exponential schedule + `while` filter on `_tag` works identically for "transient API error" whether it's an LLM call or a routing call. The pattern generalizes — Effect's operators are domain-agnostic.

2. **Backend dispatch on input mode is a clean Effect.gen pattern.** A single `lookup(input)` function reads two Tags (DbTag for cache, AmapKeyTag for AMap), checks cache, and dispatches to one of two backends based on `input.mode`. Each backend has different `R` requirements (haversine: none; AMap: AmapKeyTag), and Effect's type system enforces they're all satisfied by the dispatcher's `RoutingR`.

**Next:** the queue is empty after this lands. Good place to tag a release or kick off MCP brainstorming.
