import { SourceForm } from '@renderer/components/SourceForm';
import * as m from '@renderer/paraglide/messages';
import type { CSSProperties } from 'react';
import { Drawer } from 'vaul';

/**
 * Right-side "add an emission source" drawer. Companion to
 * `SourceEditDrawer` — both wrap a chrome-less form in the same vaul
 * shell so create and edit feel like one family. The list behind stays
 * visible (overlay only) so the user can scan existing sources while
 * defining a new one (a frequent "did I already add this?" check).
 *
 * Width: 480px. SourceForm has 4 fields (name, scope radio, category,
 * site label) and the site row is read-only in the dominant
 * single-site case, so a narrow drawer is plenty — same width as
 * SourceEditDrawer would feel uneven; we land slightly wider here only
 * because the action bar lives inside the form (drawer doesn't claim
 * a sticky footer of its own, see the chrome-less form refactor).
 */

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface SourceAddDrawerProps {
  organizationId: string;
  open: boolean;
  onClose: () => void;
}

export function SourceAddDrawer({ organizationId, open, onClose }: SourceAddDrawerProps) {
  if (!open) return null;

  return (
    <Drawer.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          aria-describedby={undefined}
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[480px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Drawer.Title className="text-base font-semibold text-foreground">
              {m.sources_add_button()}
            </Drawer.Title>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close add-source drawer"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <SourceForm organizationId={organizationId} onCancel={onClose} onSuccess={onClose} />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
