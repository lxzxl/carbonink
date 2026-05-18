import { runMigrations } from '@main/db/migrate';
import * as routingSvc from '@main/services/routing';
import { AmapKeyTag, DbTag } from '@main/services/routing/tags';
import { distanceByAddressAmap } from '@main/services/routing/amap-client';
import Database from 'better-sqlite3';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
