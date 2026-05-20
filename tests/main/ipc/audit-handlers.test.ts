import { auditHandlers } from '@main/ipc/handlers/audit';
import type { IpcContext } from '@main/ipc/context';
import { describe, expect, it, vi } from 'vitest';

function makeCtx() {
  return {
    auditEventService: {
      list: vi.fn().mockReturnValue([
        { id: 'aud-1', event_kind: 'activity_rebind_ef', payload: '{}', occurred_at: '2026-05-20T00:00:00Z' },
      ]),
    },
  } as unknown as IpcContext;
}

describe('audit handlers', () => {
  it('audit:list passes filters through to service.list', () => {
    const ctx = makeCtx();
    const handlers = auditHandlers(ctx);
    const result = handlers['audit:list']!({
      event_kinds: ['activity_rebind_ef'],
      since: '2026-05-01T00:00:00Z',
      limit: 100,
    });
    expect(result).toHaveLength(1);
    expect(ctx.auditEventService.list).toHaveBeenCalledWith({
      event_kinds: ['activity_rebind_ef'],
      since: '2026-05-01T00:00:00Z',
      limit: 100,
    });
  });

  it('audit:list passes empty input through cleanly', () => {
    const ctx = makeCtx();
    const handlers = auditHandlers(ctx);
    const result = handlers['audit:list']!({});
    expect(result).toHaveLength(1);
    expect(ctx.auditEventService.list).toHaveBeenCalledWith({});
  });
});
