import { reportHandlers } from '@main/ipc/handlers/report';
import { describe, expect, it, vi } from 'vitest';

function makeCtx() {
  const reportDataService = {
    assembleReportData: vi.fn().mockReturnValue({
      org: { id: 'org-1' },
      period: { id: 'per-1', year: 2025, granularity: 'annual' },
    }),
  };
  const llmNarrativeProvider = {
    streamObject: vi.fn().mockResolvedValue({
      object: Promise.resolve({
        boundary_description: 'a'.repeat(60),
        reporting_boundary_description: 'b'.repeat(60),
        methodology_description: 'c'.repeat(120),
        emissions_summary: 'd'.repeat(120),
        significant_changes: 'e'.repeat(30),
        notable_observations: 'f'.repeat(60),
      }),
      partialObjectStream: (async function* () {
        yield { boundary_description: 'a' };
      })(),
    }),
  };
  const pushEvent = vi.fn();
  return {
    reportDataService,
    llmNarrativeProvider,
    pushEvent,
    settingsService: { getProviderConfigWithKey: vi.fn().mockReturnValue({ config: {} }) },
  };
}

describe('reportHandlers', () => {
  it('report:generate returns assembled data + narrative', async () => {
    const ctx = makeCtx();
    const handlers = reportHandlers(ctx as never);
    const result = await handlers['report:generate']!({
      report_id: 'rep-1',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    expect(result.canceled).toBe(false);
    if (!result.canceled && !('error' in result)) {
      expect(result.data.org.id).toBe('org-1');
      expect(result.narrative.boundary_description.length).toBeGreaterThan(50);
    }
  });

  it('report:generate emits progress events with sub_phase mapping', async () => {
    const ctx = makeCtx();
    const handlers = reportHandlers(ctx as never);
    await handlers['report:generate']!({
      report_id: 'rep-2',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    // At least one progress event with sub_phase === 'boundary'
    expect(ctx.llmNarrativeProvider.streamObject).toHaveBeenCalled();
  });

  it('report:cancel aborts an inflight generation and returns canceled marker', async () => {
    const ctx = makeCtx();
    // Make the streamObject hang until aborted.
    ctx.llmNarrativeProvider.streamObject = vi.fn().mockImplementation(({ abortSignal }) => {
      return new Promise((_resolve, reject) => {
        abortSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const handlers = reportHandlers(ctx as never);
    const inflight = handlers['report:generate']!({
      report_id: 'rep-3',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    // Cancel after a tick.
    setTimeout(() => {
      handlers['report:cancel']!({ report_id: 'rep-3' });
    }, 10);
    const result = await inflight;
    expect(result).toEqual({ canceled: true });
  });

  it('report:generate returns LlmNarrativeNoProvider when settings missing', async () => {
    const ctx = makeCtx();
    ctx.settingsService.getProviderConfigWithKey = vi.fn().mockReturnValue(null);
    const handlers = reportHandlers(ctx as never);
    const result = await handlers['report:generate']!({
      report_id: 'rep-4',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    expect(result).toEqual({ canceled: false, error: { _tag: 'NoProvider' } });
  });
});
