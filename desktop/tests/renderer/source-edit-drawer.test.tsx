vi.mock('@renderer/lib/api/emission-source', () => ({
  sourceApi: {
    update: vi.fn(),
  },
}));
vi.mock('@renderer/components/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { SourceEditDrawer } from '@renderer/components/SourceEditDrawer';
import { sourceApi } from '@renderer/lib/api/emission-source';
import type { EmissionSource } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const FAKE_SOURCE: EmissionSource = {
  id: 'src-1',
  site_id: 'site-1',
  name: 'Boiler #1',
  scope: 1,
  category: 'fuel.stationary',
  ghg_protocol_path: null,
  default_ef_query: null,
  template_origin: null,
  is_active: true,
};

describe('<SourceEditDrawer>', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('saves only the changed fields when name is edited', async () => {
    // Echo a sensible "updated" row back so the mutation's onSuccess runs
    // without blowing up on undefined.
    vi.mocked(sourceApi.update).mockResolvedValue({
      ...FAKE_SOURCE,
      name: 'Boiler #1 (renamed)',
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <SourceEditDrawer source={FAKE_SOURCE} open={true} onClose={onClose} />
      </QueryClientProvider>,
    );

    // Drawer mounts pre-populated from `source`.
    const nameInput = (await screen.findByLabelText(/^Name$|^名称$/i)) as HTMLInputElement;
    expect(nameInput.value).toBe('Boiler #1');

    // Change only the name; leave scope/category/is_active untouched.
    fireEvent.change(nameInput, { target: { value: 'Boiler #1 (renamed)' } });

    // Click Save. There are two buttons in the footer (Cancel + Save) —
    // disambiguate by name.
    const saveBtn = screen.getByRole('button', { name: /^Save$|^保存$/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(sourceApi.update).toHaveBeenCalled());

    const args = vi.mocked(sourceApi.update).mock.calls[0]?.[0];
    expect(args?.id).toBe('src-1');
    expect(args?.name).toBe('Boiler #1 (renamed)');
    // Optimistic diff: untouched fields must NOT be in the patch.
    expect(args?.scope).toBeUndefined();
    expect(args?.category).toBeUndefined();
    expect(args?.is_active).toBeUndefined();
  });
});
