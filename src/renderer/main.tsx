import { CommandPalette } from '@renderer/components/command-palette';
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

// SettingsDrawerProvider wraps both router and CommandPalette so the gear
// button in Sidebar (inside the route tree) and the cmdk "Open Settings"
// command (sibling of RouterProvider) both consume the same open state.
// The drawer itself is mounted by __root.tsx (Task 8) so it can render
// alongside the rest of the route's chrome.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SettingsDrawerProvider>
        <RouterProvider router={router} />
        <CommandPalette />
        <Toaster />
        <ReactQueryDevtools initialIsOpen={false} />
      </SettingsDrawerProvider>
    </QueryClientProvider>
  </StrictMode>,
);
