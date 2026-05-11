import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

/**
 * Shared open/close state for the global Settings drawer.
 *
 * Mounted once in `src/renderer/routes/__root.tsx` so the route tree
 * (Sidebar gear button) and out-of-tree consumers (CommandPalette, which
 * lives at the renderer entry above the router) can both call
 * `setOpen(true)` without a global state library.
 *
 * Rationale: the cmdk command palette is rendered in `main.tsx` outside
 * the router's route tree, so the provider has to wrap the whole app
 * (router + palette + toaster) at the renderer entry — not just the
 * `__root` route. See `src/renderer/main.tsx`.
 *
 * The drawer itself is also mounted at the renderer entry (next to the
 * provider) so its open state survives full-tree route transitions
 * without remount churn.
 */
type SettingsDrawerCtx = { open: boolean; setOpen: (v: boolean) => void };

const Ctx = createContext<SettingsDrawerCtx | null>(null);

export function SettingsDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  // Memoize so consumers using `useMemo`/`useCallback` against `setOpen`
  // don't churn on every parent render. `setOpen` from useState is already
  // stable, so we only need to stabilize the wrapping object.
  const value = useMemo<SettingsDrawerCtx>(() => ({ open, setOpen }), [open]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettingsDrawer(): SettingsDrawerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSettingsDrawer must be used within SettingsDrawerProvider');
  return ctx;
}
