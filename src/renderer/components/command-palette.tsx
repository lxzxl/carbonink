import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';

/**
 * Global command palette. Press ⌘K (or Ctrl+K on Windows) to open.
 *
 * Commands are organized by group. To add commands: append to the relevant
 * <Command.Group> below. Each Command.Item must have an `onSelect` that
 * closes the palette via setOpen(false) before navigating / firing action,
 * otherwise the palette stays open behind the navigated page.
 *
 * Phase 0 ships with 2 navigation commands (Dashboard / Onboarding). Phase
 * 1+ will register inventory / report / pipeline commands the same way.
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
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const goDashboard = () => {
    setOpen(false);
    navigate({ to: '/' });
  };

  const goOnboarding = () => {
    setOpen(false);
    navigate({ to: '/onboarding/$step', params: { step: '1' } });
  };

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

          <Command.Group
            heading="Navigation"
            className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground"
          >
            <Command.Item
              onSelect={goDashboard}
              className="flex items-center gap-2 px-2 py-2 rounded text-sm text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
            >
              Open Dashboard
            </Command.Item>
            <Command.Item
              onSelect={goOnboarding}
              className="flex items-center gap-2 px-2 py-2 rounded text-sm text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
            >
              Open Onboarding Wizard
            </Command.Item>
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
