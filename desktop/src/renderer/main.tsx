import { Toaster } from '@renderer/components/toast';
import { initLocale } from '@renderer/lib/i18n';
import { router } from '@renderer/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

// React Query devtools removed entirely (Round 3 hotfix). Previously
// gated behind `import.meta.env.DEV` but the floating palm-tree button
// was distracting even in dev. Vitest covers query behavior; if a
// production query bug needs interactive inspection, re-add the import
// temporarily.

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
    </QueryClientProvider>
  </StrictMode>,
);
