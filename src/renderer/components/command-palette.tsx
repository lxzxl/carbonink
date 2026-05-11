import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';

type CommandGroup = 'Navigation' | 'Actions' | 'Settings' | 'Help';

type CommandContext = {
  navigate: ReturnType<typeof useNavigate>;
  close: () => void;
};

export type CommandDef = {
  id: string;
  group: CommandGroup;
  label: string;
  hint?: string;
  onSelect: (ctx: CommandContext) => void;
};

const GROUP_ORDER: CommandGroup[] = ['Navigation', 'Actions', 'Settings', 'Help'];

export const commands: CommandDef[] = [
  {
    id: 'nav.dashboard',
    group: 'Navigation',
    label: 'Open Dashboard',
    onSelect: ({ navigate, close }) => {
      close();
      navigate({ to: '/' });
    },
  },
  {
    id: 'nav.onboarding',
    group: 'Navigation',
    label: 'Open Onboarding Wizard',
    onSelect: ({ navigate, close }) => {
      close();
      navigate({ to: '/onboarding/$step', params: { step: '1' } });
    },
  },
];

/**
 * Global command palette. Press ⌘K (or Ctrl+K on Windows) to open.
 *
 * ⌘K is reserved globally for this palette; no per-page hotkey may bind it.
 * Add new commands by appending to the `commands` array above — they will be
 * rendered automatically into the appropriate group. Escape is handled by
 * cmdk's `Command.Dialog` (Radix Dialog under the hood); do not re-add it.
 *
 * Each command's `onSelect` receives `{ navigate, close }` and must call
 * `close()` before navigating / firing the action, otherwise the palette
 * stays open behind the navigated page.
 *
 * Group render order is stable: Navigation → Actions → Settings → Help.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const close = () => setOpen(false);
  const ctx: CommandContext = { navigate, close };

  const groupsToRender = GROUP_ORDER.filter((g) => commands.some((c) => c.group === g));

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] backdrop-blur-sm bg-foreground/30"
    >
      <div className="w-[640px] max-w-[90vw] rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden">
        <Command.Input
          placeholder="Type a command or search…"
          className="w-full px-4 py-3 border-b border-border bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <Command.List className="max-h-[400px] overflow-y-auto p-2">
          <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
            No commands found.
          </Command.Empty>

          {groupsToRender.map((group) => (
            <Command.Group
              key={group}
              heading={group}
              className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground"
            >
              {commands
                .filter((c) => c.group === group)
                .map((c) => (
                  <Command.Item
                    key={c.id}
                    value={c.label}
                    onSelect={() => c.onSelect(ctx)}
                    className="flex items-center gap-2 px-2 py-2 rounded text-sm text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
                  >
                    {c.label}
                  </Command.Item>
                ))}
            </Command.Group>
          ))}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
