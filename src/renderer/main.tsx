import { Toaster } from '@renderer/components/toast';
import { initLocale } from '@renderer/lib/i18n';
import { router } from '@renderer/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

// Show the React Query devtools (the floating 🌴 button in the corner)
// only when running via `pnpm dev`. Production builds skip it entirely.
// Without this gate the palm-tree icon ships to end users — the most
// obvious "this is a web app" tell in carbonbook's current chrome.
// Vite's import.meta.env.DEV is statically replaced at build time so
// the devtools module is tree-shaken out of the prod bundle.
const IS_DEV = import.meta.env.DEV;

initLocale();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Provider order: QueryClient → Router.
//
// CommandPalette MUST live inside RouterProvider — it calls useNavigate()
// internally. Mounting it as a sibling here logs "useRouter must be used
// inside a <RouterProvider>" 2× per render and silently breaks both the
// cmdk nav commands AND in-tree TanStack <Link> click handlers. See
// __root.tsx for the actual <CommandPalette /> mount.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
      {IS_DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>,
);
