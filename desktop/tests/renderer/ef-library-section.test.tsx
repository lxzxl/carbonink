vi.mock('@renderer/lib/api/user-ef-library', () => ({
  userEfLibraryApi: {
    pickFile: vi.fn(),
    revalidate: vi.fn(),
    import: vi.fn(),
    discard: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    saveTemplate: vi.fn(),
  },
}));
vi.mock('@renderer/components/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { EfLibrarySection } from '@renderer/components/settings/EfLibrarySection';
import { toast } from '@renderer/components/toast';
import { userEfLibraryApi } from '@renderer/lib/api/user-ef-library';
import type { UserEfLibrary } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const LIBRARY: UserEfLibrary = {
  id: 'lib-1',
  name: '内部台账',
  source: 'user:内部台账',
  version: 'v1',
  source_filename: 'factors.csv',
  document_id: 'doc-1',
  factor_count: 42,
  imported_at: '2026-07-12T08:00:00.000Z',
  created_at: '2026-07-12T08:00:00.000Z',
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EfLibrarySection />
    </QueryClientProvider>,
  );
}

describe('<EfLibrarySection>', () => {
  // happy-dom doesn't implement window.confirm — assign a stub directly
  // (same pattern as documents-review.test.tsx) and restore after each test.
  const originalConfirm = window.confirm;

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    (window as unknown as { confirm: typeof window.confirm }).confirm = originalConfirm;
  });

  it('lists imported libraries with version, count, date and source namespace', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([LIBRARY]);
    mount();
    await waitFor(() => expect(screen.getByText('内部台账')).toBeTruthy());
    expect(screen.getByText('user:内部台账')).toBeTruthy();
    expect(screen.getByText(/v1 · 42 .*2026-07-12.*factors\.csv/)).toBeTruthy();
  });

  it('shows the empty state when nothing is imported', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([]);
    mount();
    await waitFor(() =>
      expect(screen.getByText(/no imported libraries|还没有导入过因子库/i)).toBeTruthy(),
    );
  });

  it('deletes a library after confirmation', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([LIBRARY]);
    vi.mocked(userEfLibraryApi.delete).mockResolvedValue({
      ok: true,
      deleted_factor_count: 42,
    });
    (window as unknown as { confirm: (msg?: string) => boolean }).confirm = vi.fn(() => true);
    mount();
    await waitFor(() => expect(screen.getByText('内部台账')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /delete library|删除库/i }));
    // TanStack v5 passes a context object as mutationFn's second argument.
    await waitFor(() =>
      expect(userEfLibraryApi.delete).toHaveBeenCalledWith({ id: 'lib-1' }, expect.anything()),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('does not delete when the confirmation is declined', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([LIBRARY]);
    (window as unknown as { confirm: (msg?: string) => boolean }).confirm = vi.fn(() => false);
    mount();
    await waitFor(() => expect(screen.getByText('内部台账')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /delete library|删除库/i }));
    expect(userEfLibraryApi.delete).not.toHaveBeenCalled();
  });

  it('opens the import drawer from the import button', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /import library|导入因子库/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /choose file|选择文件/i })).toBeTruthy(),
    );
  });

  it('saves the template and toasts the target path', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([]);
    vi.mocked(userEfLibraryApi.saveTemplate).mockResolvedValue({
      ok: true,
      path: '/tmp/carbonink-ef-template.xlsx',
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /download template|下载模板/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
