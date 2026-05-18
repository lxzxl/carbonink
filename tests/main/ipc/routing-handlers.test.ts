import { routingHandlers } from '@main/ipc/handlers/routing';
import * as routingSvc from '@main/services/routing';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/services/routing', async () => {
  const actual =
    await vi.importActual<typeof import('@main/services/routing')>('@main/services/routing');
  return {
    ...actual,
    lookup: vi.fn(),
  };
});

function makeCtx() {
  return {
    routingLayer: Layer.empty,
  } as never;
}

describe('routing IPC handlers', () => {
  afterEach(() => vi.clearAllMocks());

  it('routing:lookup returns the lookup result on success', async () => {
    vi.mocked(routingSvc.lookup).mockReturnValue(
      Effect.succeed({ distance_km: 1085, source: 'amap', cached: false }) as never,
    );
    const handlers = routingHandlers(makeCtx());
    const result = await handlers['routing:lookup']!({
      mode: 'driving',
      origin: '北京',
      destination: '上海',
    });
    expect(result).toEqual({
      ok: true,
      distance_km: 1085,
      source: 'amap',
      cached: false,
    });
    expect(routingSvc.lookup).toHaveBeenCalledTimes(1);
  });

  it('routing:lookup maps RoutingErr to wire-shape on failure', async () => {
    vi.mocked(routingSvc.lookup).mockReturnValue(
      Effect.fail({ _tag: 'AmapApiKeyMissing' } as never) as never,
    );
    const handlers = routingHandlers(makeCtx());
    const result = await handlers['routing:lookup']!({
      mode: 'driving',
      origin: 'A',
      destination: 'B',
    });
    expect(result).toMatchObject({
      ok: false,
      error: { _tag: 'AmapApiKeyMissing' },
    });
  });
});
