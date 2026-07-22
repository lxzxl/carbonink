import { reportHandlers } from '@main/ipc/handlers/report';
import { runAiObject } from '@main/llm/run-ai';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@main/llm/run-ai', () => ({
  runAiObject: vi.fn(),
}));

const FAKE_NARRATIVE = {
  boundary_description: 'a'.repeat(60),
  reporting_boundary_description: 'b'.repeat(60),
  methodology_description: 'c'.repeat(120),
  emissions_summary: 'd'.repeat(120),
  significant_changes: 'e'.repeat(30),
  notable_observations: 'f'.repeat(60),
};

function makeCtx() {
  const reportDataService = {
    assembleReportData: vi.fn().mockReturnValue({
      org: { id: 'org-1' },
      period: { id: 'per-1', year: 2025, granularity: 'annual' },
      language: 'zh-CN',
    }),
  };
  const pushEvent = vi.fn();
  const credentialService = {
    get: vi.fn(() => 'sk-fake'),
    set: vi.fn(),
    getMasked: vi.fn(),
    delete: vi.fn(),
    isAvailable: vi.fn().mockReturnValue(true),
  };
  return {
    reportDataService,
    pushEvent,
    credentialService,
    settingsService: {
      getProviderConfigWithKey: vi.fn().mockReturnValue({
        config: {
          provider: 'openai' as const,
          model: 'gpt-4o-mini',
        },
        apiKey: 'sk-fake',
      }),
    },
  };
}

describe('reportHandlers', () => {
  it('report:generate returns assembled data + narrative', async () => {
    vi.mocked(runAiObject).mockResolvedValue(FAKE_NARRATIVE);
    const ctx = makeCtx();
    const handlers = reportHandlers(ctx as never);
    const result = await handlers['report:generate']?.({
      report_id: 'rep-1',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    expect(result).toBeDefined();
    expect(result?.canceled).toBe(false);
    if (result && !result.canceled && !('error' in result)) {
      expect(result.data.org.id).toBe('org-1');
      expect(result.narrative.boundary_description.length).toBeGreaterThan(50);
    }
  });

  it('report:generate calls runAiObject with the configured provider', async () => {
    vi.mocked(runAiObject).mockResolvedValue(FAKE_NARRATIVE);
    const ctx = makeCtx();
    const handlers = reportHandlers(ctx as never);
    await handlers['report:generate']?.({
      report_id: 'rep-2',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    expect(runAiObject).toHaveBeenCalled();
  });

  it('report:cancel aborts an inflight generation and returns canceled marker', async () => {
    const ctx = makeCtx();
    // runAiObject resolves successfully but only AFTER report:cancel fires.
    // The post-call abort check inside generateReportNarrative then
    // throws LlmNarrativeCanceled, which the handler maps to {canceled: true}.
    let resolveCall: (() => void) | undefined;
    const pendingCall = new Promise<typeof FAKE_NARRATIVE>((resolve) => {
      resolveCall = () => resolve(FAKE_NARRATIVE);
    });
    vi.mocked(runAiObject).mockReturnValue(pendingCall);
    const handlers = reportHandlers(ctx as never);
    const inflight = handlers['report:generate']?.({
      report_id: 'rep-3',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    // Cancel after a tick, then let runAiObject resolve so the
    // post-call abort check inside generateReportNarrative fires.
    setTimeout(() => {
      handlers['report:cancel']?.({ report_id: 'rep-3' });
      resolveCall?.();
    }, 10);
    const result = await inflight;
    expect(result).toEqual({ canceled: true });
  });

  it('report:generate returns NoProvider error when settings missing', async () => {
    const ctx = makeCtx();
    ctx.settingsService.getProviderConfigWithKey = vi.fn().mockReturnValue(null);
    const handlers = reportHandlers(ctx as never);
    const result = await handlers['report:generate']?.({
      report_id: 'rep-4',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    expect(result).toEqual({ canceled: false, error: { _tag: 'NoProvider' } });
  });
});

const FAKE_TCFD = {
  governance: 'g'.repeat(120),
  strategy: 's'.repeat(120),
  risk_management: 'r'.repeat(120),
  metrics_targets: 'm'.repeat(150),
};

describe('reportHandlers — TCFD (spec 2026-07-22)', () => {
  it('report:generate-tcfd returns assembled data + four-pillar narrative', async () => {
    vi.mocked(runAiObject).mockResolvedValue(FAKE_TCFD);
    const ctx = makeCtx();
    const handlers = reportHandlers(ctx as never);
    const result = await handlers['report:generate-tcfd']?.({
      report_id: 'tcfd-1',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    expect(result?.canceled).toBe(false);
    if (result && !result.canceled && !('error' in result)) {
      expect(result.data.org.id).toBe('org-1');
      expect(result.narrative.metrics_targets.length).toBeGreaterThan(100);
    }
    // Progress rode the shared report:progress channel.
    expect(ctx.pushEvent).toHaveBeenCalledWith(
      'report:progress',
      expect.objectContaining({ report_id: 'tcfd-1', phase: 'assembling' }),
    );
  });

  it('report:generate-tcfd returns NoProvider when settings missing', async () => {
    const ctx = makeCtx();
    ctx.settingsService.getProviderConfigWithKey = vi.fn().mockReturnValue(null);
    const handlers = reportHandlers(ctx as never);
    const result = await handlers['report:generate-tcfd']?.({
      report_id: 'tcfd-2',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    expect(result).toEqual({ canceled: false, error: { _tag: 'NoProvider' } });
  });

  it('report:cancel aborts an in-flight TCFD generation via the shared map', async () => {
    let resolveCall: (() => void) | undefined;
    vi.mocked(runAiObject).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCall = () => resolve(FAKE_TCFD);
        }),
    );
    const ctx = makeCtx();
    const handlers = reportHandlers(ctx as never);
    const inflight = handlers['report:generate-tcfd']?.({
      report_id: 'tcfd-3',
      reporting_period_id: 'per-1',
      language: 'zh-CN',
    });
    setTimeout(() => {
      handlers['report:cancel']?.({ report_id: 'tcfd-3' });
      resolveCall?.();
    }, 10);
    const result = await inflight;
    expect(result).toEqual({ canceled: true });
  });
});
