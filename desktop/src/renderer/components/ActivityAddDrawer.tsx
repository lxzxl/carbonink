import { ActivityForm } from '@renderer/components/ActivityForm';
import * as m from '@renderer/paraglide/messages';
import type { EmissionSource } from '@shared/types';
import type { CSSProperties } from 'react';
import { Drawer } from 'vaul';

/**
 * Right-side "add an activity" drawer. Wraps ActivityForm in the same
 * vaul shell as SourceAddDrawer / SourceEditDrawer / SourceCatalogDrawer
 * — create, edit and browse all feel like one drawer family across the
 * app.
 *
 * Width: 720px. ActivityForm is denser than SourceForm — date pair +
 * amount/unit pair use grid-cols-2, and the EF Picker has an internal
 * list + filter. At 720px those two-column grids and the EF list both
 * fit comfortably without horizontal compression. SourceForm gets the
 * narrower 480px treatment because its longest field is a single
 * input.
 */

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface ActivityAddDrawerProps {
  organizationId: string;
  sources: EmissionSource[];
  open: boolean;
  onClose: () => void;
}

export function ActivityAddDrawer({
  organizationId,
  sources,
  open,
  onClose,
}: ActivityAddDrawerProps) {
  if (!open) return null;

  return (
    <Drawer.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          aria-describedby={undefined}
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[720px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Drawer.Title className="text-base font-semibold text-foreground">
              {m.activities_add_button()}
            </Drawer.Title>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close add-activity drawer"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            <ActivityForm
              organizationId={organizationId}
              sources={sources}
              onCancel={onClose}
              onSuccess={onClose}
            />
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
