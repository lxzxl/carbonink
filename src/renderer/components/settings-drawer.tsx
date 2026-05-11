import type { ReactNode } from 'react';
import { Drawer } from 'vaul';

/**
 * Right-side settings drawer. Controlled via the `open` / `onOpenChange`
 * props; render once near the app root and toggle from anywhere that holds
 * the open state (e.g. a sidebar gear button).
 *
 * Phase 1+ will use this for the Settings panel (AI provider config,
 * license, theme, language, EF library version). For now this exposes only
 * the shell + a placeholder body — pass `children` to override the body
 * once real settings panels exist.
 *
 * Layout: 480px wide, full-height, slides in from the right. The overlay
 * uses `bg-foreground/30` (Tailwind v4 opacity syntax over our OKLch
 * `--foreground` token) to match the cmdk command palette backdrop. The
 * drawer surface uses `bg-popover` so macOS vibrancy / Windows Mica still
 * bleeds through subtly.
 *
 * Accessibility:
 * - `Drawer.Title` provides the accessible name required by vaul/Radix.
 * - `aria-describedby={undefined}` is set explicitly on `Drawer.Content`
 *   to silence vaul v1.1's "missing description" warning while we don't
 *   yet have a description element to point at.
 */
export function SettingsDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[480px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Drawer.Title className="text-base font-semibold text-foreground">
              Settings
            </Drawer.Title>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close settings"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {children ?? (
              <p className="text-sm text-muted-foreground">
                Settings panels will land in Phase 1+ (AI provider, license, theme, language).
              </p>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
