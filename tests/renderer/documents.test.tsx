import { Route as DocumentsRoute } from '@renderer/routes/documents';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the IPC wrappers — the route mounts inside a test router with no
// preload bridge, so we intercept at the wrapper layer.
vi.mock('@renderer/lib/ipc', () => ({
  subscribe: vi.fn(() => () => {}),
}));
vi.mock('@renderer/lib/api/document', () => ({
  documentApi: {
    upload: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    readBytes: vi.fn(),
  },
}));
// `/documents` now queries the provider config to decide between upload
// zone and "AI not configured" banner. Mock the wrapper so the route
// thinks DeepSeek is configured in the test environment — otherwise the
// banner mounts and calls `useSettingsDrawer()` outside its provider.
vi.mock('@renderer/lib/api/settings', () => ({
  settingsApi: {
    getProvider: vi.fn(),
    saveProvider: vi.fn(),
    clearProvider: vi.fn(),
    pingProvider: vi.fn(),
    available: vi.fn(),
  },
}));

import { SettingsDrawerProvider } from '@renderer/components/settings-drawer-context';
import { documentApi } from '@renderer/lib/api/document';
import { settingsApi } from '@renderer/lib/api/settings';

const FAKE_PROVIDER_CONFIG = {
  provider: 'deepseek' as const,
  model: 'deepseek-chat',
  apiKeyKeyref: 'llm.deepseek.apikey' as const,
  apiKeyMasked: 'sk-...test',
};

const FAKE_DOC = {
  id: 'doc_01',
  sha256: 'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
  filename: 'bill.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1234,
  storage_path: '/tmp/uploads/ab/abcd...pdf',
  uploaded_at: '2026-05-12T10:00:00.000Z',
  uploaded_by: null,
  doc_type: null,
};

const FAKE_EXTRACTION = {
  id: 'ext_01',
  document_id: FAKE_DOC.id,
  llm_provider: 'openai',
  llm_model: 'gpt-4o-mini',
  prompt_version: 'china_utility.v1',
  raw_response: '{}',
  parsed_json: '{}',
  error_json: null,
  status: 'review_needed' as const,
  reviewed_by_user_at: null,
  cost_usd: null,
  created_at: '2026-05-12T10:00:01.000Z',
};

const documentsComponent: NonNullable<typeof DocumentsRoute.options.component> = (() => {
  const c = DocumentsRoute.options.component;
  if (!c) throw new Error('documents route is missing a component');
  return c;
})();

function buildHarnessWithRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const documentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/documents',
    component: documentsComponent,
  });
  // Stub detail route so the click navigation has a real target. The
  // testid lets nav tests assert "we landed on the detail route" without
  // needing the real PDF preview / extraction list.
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/documents/$id',
    component: () => <p data-testid="detail-stub">detail</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([documentsRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/documents'] }),
  });
  return {
    ui: (
      // SettingsDrawerProvider wraps router because ProviderNotConfiguredBanner
      // (inside DocumentsRoute) calls `useSettingsDrawer()` — without this
      // provider, every render path that hits the banner throws.
      <SettingsDrawerProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </SettingsDrawerProvider>
    ),
    router,
  };
}

function buildHarness() {
  return buildHarnessWithRouter().ui;
}

describe('/documents route', () => {
  beforeEach(() => {
    vi.mocked(documentApi.list).mockResolvedValue([]);
    vi.mocked(documentApi.upload).mockReset();
    // Default: provider IS configured, so the upload zone (not the
    // "AI not configured" banner) renders.
    vi.mocked(settingsApi.getProvider).mockResolvedValue(FAKE_PROVIDER_CONFIG);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the page heading and the upload zone', async () => {
    render(buildHarness());
    // Heading from m.nav_documents(): "Documents" (en) / "文档" (zh).
    expect(await screen.findByRole('heading', { name: /Documents|文档/ })).toBeTruthy();
    // Upload-zone instructional text (works in either locale). Use findByText
    // so we wait for the provider query to resolve — getByText is sync and
    // races against the "Loading…" placeholder while settings:get-provider
    // is in-flight.
    expect(await screen.findByText(/Drop a PDF here|把 PDF 拖到这里/)).toBeTruthy();
  });

  it('shows the empty state when there are no documents', async () => {
    render(buildHarness());
    expect(await screen.findByText(/No documents yet|还没有文档/)).toBeTruthy();
  });

  it('renders rows after documents:list resolves', async () => {
    vi.mocked(documentApi.list).mockResolvedValue([FAKE_DOC]);
    render(buildHarness());
    // Filename appears in the row.
    expect(await screen.findByText('bill.pdf')).toBeTruthy();
    // First 8 chars of the sha column.
    expect(screen.getByText(FAKE_DOC.sha256.slice(0, 8))).toBeTruthy();
  });

  it('uploads a file and invalidates the document list query', async () => {
    // Empty list initially; the upload should trigger an invalidate and
    // the second `list` call returns the freshly-uploaded doc.
    vi.mocked(documentApi.list).mockResolvedValueOnce([]).mockResolvedValue([FAKE_DOC]);
    vi.mocked(documentApi.upload).mockResolvedValue(FAKE_DOC);

    render(buildHarness());
    // Wait for the empty state to settle so the next render is the post-load
    // state (the file input ref is mounted from the start, but waiting here
    // keeps the assertion ordering predictable).
    await screen.findByText(/No documents yet|还没有文档/);

    // Construct a minimal PDF File. `arrayBuffer` is the only method our
    // upload path uses — happy-dom supplies it out of the box.
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'bill.pdf', {
      type: 'application/pdf',
    });
    const input = document.getElementById('documents-upload-input') as HTMLInputElement;
    expect(input).toBeTruthy();

    // Use `act` so React state updates triggered by the async upload flush
    // before we make assertions.
    await act(async () => {
      fireEvent.change(input, { target: { files: [pdf] } });
    });

    await waitFor(() => {
      expect(documentApi.upload).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(documentApi.upload).mock.calls[0]?.[0]).toMatchObject({
      filename: 'bill.pdf',
      mimeType: 'application/pdf',
    });

    // The list query should have been invalidated, so the row eventually
    // appears.
    await waitFor(() => {
      expect(screen.queryByText('bill.pdf')).toBeTruthy();
    });
  });

  it('navigates to /documents/$id when the row "Open" link is clicked', async () => {
    vi.mocked(documentApi.list).mockResolvedValue([FAKE_DOC]);
    const { ui, router } = buildHarnessWithRouter();
    render(ui);

    // Wait for the row to render.
    await screen.findByText('bill.pdf');

    // Click the per-row "Open" link (its accessible name includes the
    // filename — see ActivityForm doc-row Link).
    const openLink = screen.getByLabelText(/bill\.pdf/);
    await act(async () => {
      fireEvent.click(openLink);
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/documents/${FAKE_DOC.id}`);
    });
    // Detail stub should now be rendered.
    expect(screen.getByTestId('detail-stub')).toBeTruthy();
  });

  it('navigates to /documents/$id when the row itself is clicked', async () => {
    vi.mocked(documentApi.list).mockResolvedValue([FAKE_DOC]);
    const { ui, router } = buildHarnessWithRouter();
    render(ui);

    await screen.findByText('bill.pdf');

    // Click the filename cell — the row-level onClick should catch it
    // (the inner Link has stopPropagation, so we click a non-link cell).
    const filenameCell = screen.getByText('bill.pdf');
    await act(async () => {
      fireEvent.click(filenameCell);
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/documents/${FAKE_DOC.id}`);
    });
  });

  it('displays "未分类" chip when doc_type is null', async () => {
    vi.mocked(documentApi.list).mockResolvedValue([FAKE_DOC]);
    render(buildHarness());

    // Wait for the row to render and check that the unclassified label appears
    const unclassifiedChip = await screen.findByText(/未分类|Not classified/);
    expect(unclassifiedChip).toBeTruthy();
  });

  it('displays the doc_type label when doc_type is set', async () => {
    const docWithType = {
      ...FAKE_DOC,
      doc_type: 'fuel_receipt.v1',
    };
    vi.mocked(documentApi.list).mockResolvedValue([docWithType]);
    render(buildHarness());

    // The label map should translate 'fuel_receipt.v1' to '加油发票'
    const fuelReceiptChip = await screen.findByText('加油发票');
    expect(fuelReceiptChip).toBeTruthy();
  });
});
