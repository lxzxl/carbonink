vi.mock('@renderer/lib/api/user-ef-library', () => ({
  userEfLibraryApi: {
    pickFile: vi.fn(),
    revalidate: vi.fn(),
    import: vi.fn(),
    discard: vi.fn(),
    list: vi.fn(),
    browse: vi.fn(),
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
import type { EmissionFactor, UserEfLibrary } from '@shared/types';
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

const FACTOR = {
  factor_code: 'DIESEL-1',
  year: 2024,
  source: 'user:内部台账',
  geography: 'CN',
  dataset_version: 'v1',
  scope: 1,
  category: 'fuel.combustion',
  ghg_protocol_path: null,
  input_unit: 'L',
  co2e_kg_per_unit: 2.68,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  biogenic_co2_factor: null,
  name_zh: '内部柴油',
  name_en: 'Internal diesel',
  description_zh: null,
  description_en: null,
  notes: null,
  citation_url: null,
} satisfies EmissionFactor;

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

  it('opens the browse drawer from a library row and lists its factors', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([LIBRARY]);
    vi.mocked(userEfLibraryApi.browse).mockResolvedValue({
      rows: [FACTOR],
      total: 1,
    });
    mount();
    await waitFor(() => expect(screen.getByText('内部台账')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /browse factors|浏览因子/i }));
    await waitFor(() => expect(screen.getByText('内部柴油')).toBeTruthy());
    expect(screen.getByText('DIESEL-1')).toBeTruthy();
    expect(userEfLibraryApi.browse).toHaveBeenCalledWith(
      expect.objectContaining({ library_id: 'lib-1' }),
    );
  });

  it('passes the typed search text to the browse query', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([LIBRARY]);
    vi.mocked(userEfLibraryApi.browse).mockResolvedValue({ rows: [FACTOR], total: 1 });
    mount();
    await waitFor(() => expect(screen.getByText('内部台账')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /browse factors|浏览因子/i }));
    await waitFor(() => expect(screen.getByText('内部柴油')).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText(/search name|搜索名称/i), {
      target: { value: '柴油' },
    });
    await waitFor(() =>
      expect(userEfLibraryApi.browse).toHaveBeenCalledWith(
        expect.objectContaining({ query: '柴油' }),
      ),
    );
  });

  it('distinguishes an empty library from an empty search result', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([LIBRARY]);
    vi.mocked(userEfLibraryApi.browse).mockResolvedValue({ rows: [], total: 0 });
    mount();
    await waitFor(() => expect(screen.getByText('内部台账')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /browse factors|浏览因子/i }));
    await waitFor(() => expect(screen.getByText(/has no factors|该库内没有因子/i)).toBeTruthy());

    fireEvent.change(screen.getByPlaceholderText(/search name|搜索名称/i), {
      target: { value: 'zzz' },
    });
    await waitFor(() => expect(screen.getByText(/no factors match|没有匹配的因子/i)).toBeTruthy());
  });

  it('does not open the browse drawer when the delete button is clicked', async () => {
    vi.mocked(userEfLibraryApi.list).mockResolvedValue([LIBRARY]);
    (window as unknown as { confirm: (msg?: string) => boolean }).confirm = vi.fn(() => false);
    mount();
    await waitFor(() => expect(screen.getByText('内部台账')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /delete library|删除库/i }));
    expect(userEfLibraryApi.browse).not.toHaveBeenCalled();
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
