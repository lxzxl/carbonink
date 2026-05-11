import { Toaster as SonnerToaster, toast } from 'sonner';

export { toast };

/**
 * App-wide toast container. Mount once at the root, near the top of the
 * React tree.
 *
 * Styling: sonner's default visual is fine on light bg; for dark mode we
 * inherit our token system via the theme prop. position bottom-right is
 * least obstructive for a desktop app (top-right risks clashing with
 * macOS notifications).
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      theme="system"
      toastOptions={{
        classNames: {
          toast: 'bg-popover text-popover-foreground border border-border',
          title: 'text-foreground',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}
