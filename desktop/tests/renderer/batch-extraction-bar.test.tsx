vi.mock('@renderer/lib/api/extraction', () => ({
  extractionApi: {
    batchRun: vi.fn(),
    batchCancel: vi.fn(),
    batchStatus: vi.fn(),
  },
}));
vi.mock('@renderer/lib/ipc', () => ({
  subscribe: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('@renderer/components/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { BatchExtractionBar } from '@renderer/components/BatchExtractionBar';
import { toast } from '@renderer/components/toast';
import { extractionApi } from '@renderer/lib/api/extraction';
import { subscribe } from '@renderer/lib/ipc';
import type { BatchExtractionProgress } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let pushHandler: ((p: BatchExtractionProgress) => void) | null = null;
let queryClient: QueryClient;

function progressOf(partial: Partial<BatchExtractionProgress>): BatchExtractionProgress {
  return {
    total: 3,
    done: 0,
    ok_count: 0,
    failed_count: 0,
    running: true,
    canceled: false,
    current_document_ids: [],
    failed: [],
    ...partial,
  };
}

function mount(pendingDocIds: string[] = ['d1', 'd2', 'd3']) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BatchExtractionBar pendingDocIds={pendingDocIds} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  pushHandler = null;
  vi.mocked(subscribe).mockImplementation((_channel, cb) => {
    pushHandler = cb as (p: BatchExtractionProgress) => void;
    return () => {
      pushHandler = null;
    };
  });
  vi.mocked(extractionApi.batchStatus).mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<BatchExtractionBar>', () => {
  it('renders the count button and starts a run with the pending pool', async () => {
    vi.mocked(extractionApi.batchRun).mockResolvedValue({ ok: true, total: 3 });
    mount();
    const button = await screen.findByRole('button', { name: /批量识别|recognize all/i });
    expect(button.textContent).toContain('3');
    fireEvent.click(button);
    await vi.waitFor(() =>
      expect(extractionApi.batchRun).toHaveBeenCalledWith({ document_ids: ['d1', 'd2', 'd3'] }),
    );
  });

  it('renders nothing when there is no pool and no prior batch', () => {
    const { container } = mount([]);
    expect(container.textContent).toBe('');
  });

  it('shows live N/M progress and cancels via the api', async () => {
    vi.mocked(extractionApi.batchCancel).mockResolvedValue({ ok: true });
    mount();
    await screen.findByRole('button', { name: /批量识别|recognize all/i });
    act(() => pushHandler?.(progressOf({ done: 1, current_document_ids: ['d2'] })));
    expect(screen.getByText(/识别中 1\/3|recognizing 1\/3/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /取消|cancel/i }));
    expect(extractionApi.batchCancel).toHaveBeenCalled();
  });

  it('on the terminal event: summary toast, invalidated statuses, failure list', async () => {
    mount();
    await screen.findByRole('button', { name: /批量识别|recognize all/i });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => pushHandler?.(progressOf({ done: 1 })));
    act(() =>
      pushHandler?.(
        progressOf({
          running: false,
          done: 3,
          ok_count: 2,
          failed_count: 1,
          failed: [{ document_id: 'd3', filename: 'bill-march.pdf', reason: 'classify_failed' }],
        }),
      ),
    );

    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/成功 2|2 ok/));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['extraction:list-statuses'] });
    expect(screen.getByText('bill-march.pdf', { exact: false })).toBeTruthy();
    expect(screen.getByText(/无法自动识别|could not auto-classify/i)).toBeTruthy();
  });

  it('surfaces BatchAlreadyRunning as an error toast', async () => {
    vi.mocked(extractionApi.batchRun).mockResolvedValue({
      ok: false,
      error: { _tag: 'BatchAlreadyRunning' },
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /批量识别|recognize all/i }));
    await vi.waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/已有批量识别|already running/i),
      ),
    );
  });
});
