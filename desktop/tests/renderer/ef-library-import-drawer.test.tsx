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

import { EfLibraryImportDrawer } from '@renderer/components/EfLibraryImportDrawer';
import { toast } from '@renderer/components/toast';
import { userEfLibraryApi } from '@renderer/lib/api/user-ef-library';
import type { EfImportPreview, EfImportSampleRow, EfImportValidation } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

function sampleRow(overrides: Partial<EfImportSampleRow> = {}): EfImportSampleRow {
  return {
    factor_code: 'DIESEL-1',
    year: 2024,
    geography: 'CN',
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
    name_zh: '柴油',
    name_en: 'Diesel',
    description_zh: null,
    description_en: null,
    notes: null,
    biogenic_co2_factor: null,
    citation_url: null,
    ...overrides,
  };
}

const VALIDATION: EfImportValidation = {
  total_rows: 3,
  valid_count: 2,
  error_count: 1,
  warning_count: 0,
  errors: [{ row: 4, code: 'scope_invalid', detail: '9' }],
  warnings: [],
  sample: [sampleRow(), sampleRow({ factor_code: 'GRID-1', name_zh: '电网电力', scope: 2 })],
};

const PREVIEW: EfImportPreview = {
  token: 'tok-1',
  filename: '台账.csv',
  headers: ['名称', '范围', '年份', '单位', '数值'],
  total_rows: 3,
  mapping: { name_zh: 0, scope: 1, year: 2, input_unit: 3, co2e_kg_per_unit: 4 },
  validation: VALIDATION,
};

function mountDrawer(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EfLibraryImportDrawer open={true} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

async function pickFile() {
  vi.mocked(userEfLibraryApi.pickFile).mockResolvedValue({
    canceled: false,
    preview: PREVIEW,
  });
  fireEvent.click(screen.getByRole('button', { name: /choose file|选择文件/i }));
  await waitFor(() => expect(screen.getByText(/台账\.csv/)).toBeTruthy());
}

describe('<EfLibraryImportDrawer>', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the preview after picking a file: counts, errors, sample, prefilled name', async () => {
    mountDrawer();
    await pickFile();

    // Validation counts + coded error row with detail.
    expect(screen.getByText(/2 (valid|条有效)/)).toBeTruthy();
    expect(screen.getByText(/1 (errors?|条错误)/)).toBeTruthy();
    expect(screen.getByText(/(Row 4|第 4 行)/)).toBeTruthy();
    expect(screen.getByText(/scope must be|范围须为/)).toBeTruthy();
    // Sample preview rows.
    expect(screen.getByText('柴油')).toBeTruthy();
    expect(screen.getByText('电网电力')).toBeTruthy();
    // Name prefilled from the filename stem.
    const nameInput = screen.getByLabelText(/library name|库名称/i) as HTMLInputElement;
    expect(nameInput.value).toBe('台账');
  });

  it('revalidates when the mapping changes', async () => {
    mountDrawer();
    await pickFile();
    vi.mocked(userEfLibraryApi.revalidate).mockResolvedValue({
      ...VALIDATION,
      valid_count: 0,
      error_count: 3,
    });

    // Unmap the co2e column (last of the five mapped selects).
    const co2eSelect = screen.getByRole('combobox', {
      name: /co2e \(kg|co2e（kg/i,
    }) as HTMLSelectElement;
    fireEvent.change(co2eSelect, { target: { value: '' } });

    await waitFor(() =>
      expect(userEfLibraryApi.revalidate).toHaveBeenCalledWith({
        token: 'tok-1',
        mapping: { name_zh: 0, scope: 1, year: 2, input_unit: 3 },
      }),
    );
    await waitFor(() => expect(screen.getByText(/0 (valid|条有效)/)).toBeTruthy());
    // Required field unmapped → import disabled.
    const importBtn = screen.getByRole('button', { name: /^(import|导入)$/i }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
  });

  it('imports with the edited name/version and closes on success', async () => {
    const onClose = mountDrawer();
    await pickFile();
    vi.mocked(userEfLibraryApi.import).mockResolvedValue({
      ok: true,
      library: {
        id: 'lib-1',
        name: '我的库',
        source: 'user:我的库',
        version: 'v2',
        source_filename: '台账.csv',
        document_id: 'doc-1',
        factor_count: 2,
        imported_at: '2026-07-12T00:00:00.000Z',
        created_at: '2026-07-12T00:00:00.000Z',
      },
      imported_count: 2,
      skipped_count: 1,
      replaced: false,
    });

    fireEvent.change(screen.getByLabelText(/library name|库名称/i), {
      target: { value: '我的库' },
    });
    fireEvent.change(screen.getByLabelText(/version|版本/i), { target: { value: 'v2' } });
    fireEvent.click(screen.getByRole('button', { name: /^(import|导入)$/i }));

    await waitFor(() =>
      expect(userEfLibraryApi.import).toHaveBeenCalledWith({
        token: 'tok-1',
        name: '我的库',
        version: 'v2',
        allow_replace: false,
        mapping: PREVIEW.mapping,
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('arms the replace confirmation on NameExists and retries with allow_replace', async () => {
    mountDrawer();
    await pickFile();
    vi.mocked(userEfLibraryApi.import).mockResolvedValueOnce({
      ok: false,
      error: { _tag: 'NameExists' },
    });

    fireEvent.click(screen.getByRole('button', { name: /^(import|导入)$/i }));
    await waitFor(() => expect(screen.getByText(/already exists|已存在同名库/)).toBeTruthy());

    vi.mocked(userEfLibraryApi.import).mockResolvedValueOnce({
      ok: true,
      library: {
        id: 'lib-1',
        name: '台账',
        source: 'user:台账',
        version: '2026-07-12',
        source_filename: '台账.csv',
        document_id: 'doc-1',
        factor_count: 2,
        imported_at: '2026-07-12T00:00:00.000Z',
        created_at: '2026-07-12T00:00:00.000Z',
      },
      imported_count: 2,
      skipped_count: 0,
      replaced: true,
    });
    fireEvent.click(screen.getByRole('button', { name: /replace|替换/i }));

    await waitFor(() =>
      expect(userEfLibraryApi.import).toHaveBeenLastCalledWith(
        expect.objectContaining({ allow_replace: true }),
      ),
    );
  });

  it('surfaces file-level parse failures as an error toast', async () => {
    mountDrawer();
    vi.mocked(userEfLibraryApi.pickFile).mockResolvedValue({
      canceled: false,
      error: { _tag: 'EfImportParseFailed', code: 'unsupported_file_type', detail: 'a.txt' },
    });
    fireEvent.click(screen.getByRole('button', { name: /choose file|选择文件/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Still on the pick step.
    expect(screen.getByRole('button', { name: /choose file|选择文件/i })).toBeTruthy();
  });

  it('discards the staged parse when closed without importing', async () => {
    mountDrawer();
    await pickFile();
    vi.mocked(userEfLibraryApi.discard).mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: /^(cancel|取消)$/i }));
    expect(userEfLibraryApi.discard).toHaveBeenCalledWith({ token: 'tok-1' });
  });
});
