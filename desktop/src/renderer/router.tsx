import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

/**
 * Router configuration — memory history.
 *
 * Why memory history (not browser, not hash):
 *
 *   In production, Electron's `BrowserWindow.loadFile` puts the renderer at
 *   `file:///abs/path/to/out/renderer/index.html`. None of our route paths
 *   match that pathname, so default browser history sees nothing to render
 *   and `<Outlet />` paints empty — the screen is blank white.
 *
 *   Hash history (`file:///...index.html#/`) almost works, but Electron's
 *   navigation layer treats `replaceState`/`pushState` on `file://` URLs
 *   inconsistently — it can fire a full document reload, putting the app into
 *   an infinite mount→reload→mount loop. Verified empirically in May 2026.
 *
 *   Memory history keeps the routing state entirely in JS — never touches
 *   `window.location` — so neither the file:// pathname mismatch nor the
 *   Electron hash-reload bug applies. The trade-off: no native back/forward
 *   via the OS, and the URL bar doesn't reflect the route. For a packaged
 *   desktop app with no URL bar visible, this is invisible to users.
 *
 *   In-app history is preserved (TanStack Router maintains an internal stack
 *   so `<NavArrows />` and the `useNavigate` `back()` API still work). Deep
 *   linking via `--open-route` etc. can be added later as an Electron
 *   command-line flag if/when needed.
 *
 *   This also unblocks the Playwright E2E suite — the deferred specs from
 *   `docs/specs/2026-05-18-playwright-e2e-refresh-design.md` all skipped
 *   with the note "React doesn't paint into #root despite the bundle
 *   loading" — that was the file:// pathname mismatch above.
 */
export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ['/'] }),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
