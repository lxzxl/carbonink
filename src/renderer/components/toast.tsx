import { Toaster as SonnerToaster, toast } from 'sonner';

export { toast };

/**
 * App-wide toast container. Mount once at the root, near the top of the
 * React tree.
 *
 * Styling: neutral OKLch token surface for all toast types; sonner's
 * type-specific icons (success ✓ / error !) differentiate types. We avoid
 * `richColors` because sonner's rich-color stylesheet
 * (`[data-rich-colors='true'][data-sonner-toast][data-type='error']`,
 * specificity 0,3,0) would override our classNames (0,1,0). Per-type
 * border accents pull from our destructive / primary tokens so error and
 * success still feel distinct without losing the neutral surface.
 *
 * Position bottom-right is least obstructive for a desktop app (top-right
 * risks clashing with macOS notifications).
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      closeButton
      theme="system"
      toastOptions={{
        classNames: {
          toast: 'bg-popover text-popover-foreground border border-border',
          title: 'text-foreground',
          description: 'text-muted-foreground',
          error: 'border-destructive/40',
          success: 'border-[color:var(--color-primary)]/40',
        },
      }}
    />
  );
}
