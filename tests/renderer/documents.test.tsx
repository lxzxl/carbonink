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
vi.mock('@renderer/lib/api/document', () => ({
  documentApi: {
    upload: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    readBytes: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/extraction', () => ({
  extractionApi: {
    run: vi.fn(),
    listPending: vi.fn(),
    listByDocument: vi.fn(),
    getById: vi.fn(),
    confirm: vi.fn(),
    discard: vi.fn(),
  },
}));

import { documentApi } from '@renderer/lib/api/document';
import { extractionApi } from '@renderer/lib/api/extraction';

const FAKE_DOC = {
  id: 'doc_01',
  sha256: 'abcd1234ef567890abcd1234ef567890abcd1234ef567890abcd1234ef567890',
  filename: 'bill.pdf',
  mime_type: 'application/pdf',
  size_bytes: 1234,
  storage_path: '/tmp/uploads/ab/abcd...pdf',
  uploaded_at: '2026-05-12T10:00:00.000Z',
  uploaded_by: null,
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

function buildHarness() {
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
  // Stub detail route — needed for `useNavigate({ to: '/documents/$id' })`
  // type registration so the click navigation in the list compiles. The
  // component body is irrelevant for these tests; we only assert the call
  // path, not the destination render.
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/documents/$id',
    component: () => <p data-testid="detail-stub">detail</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([documentsRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/documents'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe('/documents route', () => {
  beforeEach(() => {
    vi.mocked(documentApi.list).mockResolvedValue([]);
    vi.mocked(documentApi.upload).mockReset();
    vi.mocked(extractionApi.run).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the page heading and the upload zone', async () => {
    render(buildHarness());
    // Heading from m.nav_documents(): "Documents" (en) / "文档" (zh).
    expect(await screen.findByRole('heading', { name: /Documents|文档/ })).toBeTruthy();
    // Upload-zone instructional text (works in either locale).
    expect(screen.getByText(/Drop a PDF here|把 PDF 拖到这里/)).toBeTruthy();
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

  it('uploads a file then fires extraction:run for the returned doc', async () => {
    // Empty list initially; the upload should trigger an invalidate and
    // the second `list` call returns the freshly-uploaded doc.
    vi.mocked(documentApi.list).mockResolvedValueOnce([]).mockResolvedValue([FAKE_DOC]);
    vi.mocked(documentApi.upload).mockResolvedValue(FAKE_DOC);
    vi.mocked(extractionApi.run).mockResolvedValue(FAKE_EXTRACTION);

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
    await waitFor(() => {
      expect(extractionApi.run).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(extractionApi.run).mock.calls[0]?.[0]).toEqual({
      document_id: FAKE_DOC.id,
      stage_id: 'china_utility.v1',
    });

    // The list query should have been invalidated, so the row eventually
    // appears.
    await waitFor(() => {
      expect(screen.queryByText('bill.pdf')).toBeTruthy();
    });
  });
});
