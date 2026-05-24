import { Toaster } from '@renderer/components/toast';
import { currentLocale, initLocale, subscribeToLocaleChange } from '@renderer/lib/i18n';
import { initTheme } from '@renderer/lib/theme';
import { router } from '@renderer/router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

// React Query devtools removed entirely (Round 3 hotfix). Previously
// gated behind `import.meta.env.DEV` but the floating palm-tree button
// was distracting even in dev. Vitest covers query behavior; if a
// production query bug needs interactive inspection, re-add the import
// temporarily.

initLocale();
initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Expose the router on `window` so E2E specs can drive in-app navigation
// without depending on the sidebar (which has icon-mode/collapsed-mode
// variants we don't want to thread through tests). Also useful for ad-hoc
// debugging from the Electron devtools console.
//
// No security concern: contextIsolation + preload-bridge model already
// gates *real* privileged APIs; this is a renderer-only object that the
// renderer already has full access to.
(window as unknown as { __router: typeof router }).__router = router;

/**
 * `LocaleProvider` exists to force a React re-render of the routed tree
 * when the user switches the UI language at runtime.
 *
 * Paraglide's `m.foo()` functions read the current locale on every call,
 * so the translations themselves are fresh — but React has no way to
 * know a global ref changed. Without this provider, switching language
 * in Settings would silently do nothing until the next reload.
 *
 * Implementation: a `useState` holding the current locale, plus a
 * subscriber on the custom `carbonink:locale-changed` event dispatched
 * by `setLocale()` in `lib/i18n.ts`. When the state changes, the
 * provider re-renders → its child (RouterProvider) re-renders → all
 * downstream `m.foo()` calls re-resolve. The provider doesn't expose
 * the locale via context because no descendant needs to read it
 * (`m.foo()` reads from paraglide's runtime, not React); the state
 * exists solely to trigger the re-render cascade.
 */
function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState(currentLocale());
  useEffect(() => subscribeToLocaleChange((next) => setLocaleState(next)), []);
  // `key` forces RouterProvider to remount on locale change. This is
  // heavier than a normal re-render — every `useQuery` refetches and
  // every form loses uncommitted state — but the user is on Settings
  // when they switch and re-fetching a few queries is cheap.
  // Without `key`, RouterProvider's internal memoization holds onto
  // stale translations even though the function references update.
  return <div key={locale}>{children}</div>;
}

// Provider order: Locale → QueryClient → Router.
//
// CommandPalette MUST live inside RouterProvider — it calls useNavigate()
// internally. Mounting it as a sibling here logs "useRouter must be used
// inside a <RouterProvider>" 2× per render and silently breaks both the
// cmdk nav commands AND in-tree TanStack <Link> click handlers. See
// __root.tsx for the actual <CommandPalette /> mount.
createRoot(root).render(
  <StrictMode>
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </LocaleProvider>
  </StrictMode>,
);
