import { SettingsDrawerProvider } from '@renderer/components/settings-drawer-context';
import { Toaster } from '@renderer/components/toast';
import { initLocale } from '@renderer/lib/i18n';
import { router } from '@renderer/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

initLocale();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Provider order: QueryClient → SettingsDrawer (Context) → Router.
// SettingsDrawerProvider wraps Router so consumers inside the route tree
// (Sidebar's gear button AND CommandPalette, which now lives in __root.tsx)
// can both call useSettingsDrawer().
//
// CommandPalette MUST live inside RouterProvider — it calls useNavigate()
// internally. Mounting it as a sibling here logs "useRouter must be used
// inside a <RouterProvider>" 2× per render and silently breaks both the
// cmdk nav commands AND in-tree TanStack <Link> click handlers (the
// /documents row "click does nothing" bug surfaced at phase-1b smoke).
// See __root.tsx for the actual <CommandPalette /> mount.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsDrawerProvider>
        <RouterProvider router={router} />
        <Toaster />
        <ReactQueryDevtools initialIsOpen={false} />
      </SettingsDrawerProvider>
    </QueryClientProvider>
  </StrictMode>,
);
