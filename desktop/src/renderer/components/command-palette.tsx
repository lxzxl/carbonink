import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@renderer/components/ui/command';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

type CommandGroupName = 'Navigation' | 'Actions' | 'Settings' | 'Help';

type CommandContext = {
  navigate: ReturnType<typeof useNavigate>;
  close: () => void;
};

export type CommandDef = {
  id: string;
  group: CommandGroupName;
  label: string;
  hint?: string;
  onSelect: (ctx: CommandContext) => void;
};

const GROUP_ORDER: CommandGroupName[] = ['Navigation', 'Actions', 'Settings', 'Help'];

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
    id: 'nav.sources',
    group: 'Navigation',
    label: 'Open Sources',
    onSelect: ({ navigate, close }) => {
      close();
      navigate({ to: '/sources' });
    },
  },
  {
    id: 'nav.activities',
    group: 'Navigation',
    label: 'Open Activities',
    onSelect: ({ navigate, close }) => {
      close();
      navigate({ to: '/activities' });
    },
  },
  {
    id: 'nav.documents',
    group: 'Navigation',
    label: 'Open Documents',
    onSelect: ({ navigate, close }) => {
      close();
      navigate({ to: '/documents' });
    },
  },
  {
    id: 'nav.settings',
    group: 'Navigation',
    label: 'Open Settings',
    onSelect: ({ navigate, close }) => {
      close();
      navigate({ to: '/settings' });
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
 * the underlying Radix Dialog; do not re-add it.
 *
 * Each command's `onSelect` receives `{ navigate, close }` and must call
 * `close()` before navigating / firing the action, otherwise the palette
 * stays open behind the navigated page.
 *
 * Group render order is stable: Navigation → Actions → Settings → Help.
 *
 * The dialog chrome (overlay, centered card, fade/zoom animations, close
 * button) is now provided by the shadcn `CommandDialog` primitive, which
 * wraps `cmdk` in a Radix Dialog with consistent shadcn styling — same
 * treatment as the rest of the app. The previous bespoke
 * `fixed inset-0 ... backdrop-blur-sm` overlay has been replaced.
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
  const ctx: CommandContext = {
    navigate,
    close,
  };

  const groupsToRender = GROUP_ORDER.filter((g) => commands.some((c) => c.group === g));

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command Palette">
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        {groupsToRender.map((group) => (
          <CommandGroup key={group} heading={group}>
            {commands
              .filter((c) => c.group === group)
              .map((c) => (
                <CommandItem key={c.id} value={c.label} onSelect={() => c.onSelect(ctx)}>
                  {c.label}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
