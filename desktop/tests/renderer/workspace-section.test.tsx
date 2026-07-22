vi.mock('@renderer/lib/api/workspace', () => ({
  workspaceApi: {
    list: vi.fn(),
    getActive: vi.fn(),
    create: vi.fn(),
    rename: vi.fn(),
    switch: vi.fn(),
  },
}));
vi.mock('@renderer/components/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { WorkspaceSection } from '@renderer/components/settings/WorkspaceSection';
import { toast } from '@renderer/components/toast';
import { workspaceApi } from '@renderer/lib/api/workspace';
import type { Workspace } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT: Workspace = {
  id: 'w-default',
  name: '默认账套',
  file: 'app.sqlite',
  created_at: '2026-01-01T00:00:00.000Z',
};
const CLIENT: Workspace = {
  id: 'w-client',
  name: '客户甲',
  file: 'workspace-abc.sqlite',
  created_at: '2026-07-22T00:00:00.000Z',
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <WorkspaceSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(workspaceApi.list).mockResolvedValue([DEFAULT, CLIENT]);
  vi.mocked(workspaceApi.getActive).mockResolvedValue(DEFAULT);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('<WorkspaceSection>', () => {
  it('lists workspaces, marks the active one, offers switch only elsewhere', async () => {
    mount();
    await screen.findByText('默认账套');
    expect(screen.getByText(/当前|active/i)).toBeTruthy();
    // One switch button — the non-active row's.
    expect(screen.getAllByRole('button', { name: /切换|switch/i })).toHaveLength(1);
  });

  it('creates a workspace and clears the input', async () => {
    vi.mocked(workspaceApi.create).mockResolvedValue({ ok: true, workspace: CLIENT });
    mount();
    await screen.findByText('默认账套');
    const input = screen.getByPlaceholderText(/新账套名称|new workspace name/i);
    fireEvent.change(input, { target: { value: '客户乙' } });
    fireEvent.click(screen.getByRole('button', { name: /新建账套|new workspace/i }));
    await waitFor(() => expect(workspaceApi.create).toHaveBeenCalledWith({ name: '客户乙' }));
    expect(toast.success).toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('renames through the inline editor', async () => {
    vi.mocked(workspaceApi.rename).mockResolvedValue({ ok: true });
    mount();
    await screen.findByText('客户甲');
    fireEvent.click(screen.getAllByRole('button', { name: /重命名|rename/i })[1] as HTMLElement);
    const editor = screen.getByDisplayValue('客户甲');
    fireEvent.change(editor, { target: { value: '客户甲（2026）' } });
    fireEvent.click(screen.getByRole('button', { name: /保存|save/i }));
    await waitFor(() =>
      expect(workspaceApi.rename).toHaveBeenCalledWith({ id: 'w-client', name: '客户甲（2026）' }),
    );
  });

  it('switches only after the confirm dialog is accepted', async () => {
    vi.mocked(workspaceApi.switch).mockResolvedValue({ ok: true });
    const confirmSpy = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirmSpy);
    mount();
    await screen.findByText('客户甲');
    fireEvent.click(screen.getByRole('button', { name: /切换|switch/i }));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('客户甲'));
    expect(workspaceApi.switch).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /切换|switch/i }));
    await waitFor(() => expect(workspaceApi.switch).toHaveBeenCalledWith({ id: 'w-client' }));
  });

  it('surfaces InvalidName as an error toast', async () => {
    vi.mocked(workspaceApi.create).mockResolvedValue({ ok: false, error: 'InvalidName' });
    mount();
    await screen.findByText('默认账套');
    fireEvent.change(screen.getByPlaceholderText(/新账套名称|new workspace name/i), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: /新建账套|new workspace/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
