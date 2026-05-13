import type { IpcContext } from '@main/ipc/context';
import { efMatcherHandlers } from '@main/ipc/handlers/ef-matcher';
import { describe, expect, it, vi } from 'vitest';

function makeCtx() {
  return {
    efMatcherService: {
      recommend: vi.fn().mockResolvedValue({ recommended: [], ranked_full: [] }),
    },
  } as unknown as IpcContext;
}

describe('ef:recommend handler', () => {
  it('zod-rejects malformed input (missing extraction_id)', async () => {
    const ctx = makeCtx();
    const handlers = efMatcherHandlers(ctx);
    await expect(
      handlers['ef:recommend']!({ emission_source_id: 's1' } as never),
    ).rejects.toThrow();
  });

  it('zod-rejects malformed input (missing emission_source_id)', async () => {
    const ctx = makeCtx();
    const handlers = efMatcherHandlers(ctx);
    await expect(handlers['ef:recommend']!({ extraction_id: 'e1' } as never)).rejects.toThrow();
  });

  it('delegates to service on valid input', async () => {
    const ctx = makeCtx();
    const handlers = efMatcherHandlers(ctx);
    const result = await handlers['ef:recommend']!({
      extraction_id: 'e1',
      emission_source_id: 's1',
    });
    expect(ctx.efMatcherService.recommend).toHaveBeenCalledWith({
      extraction_id: 'e1',
      emission_source_id: 's1',
    });
    expect(result).toEqual({ recommended: [], ranked_full: [] });
  });
});
