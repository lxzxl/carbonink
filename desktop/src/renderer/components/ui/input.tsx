import { cn } from '@renderer/lib/utils';
import * as React from 'react';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm',
      // Focus indicator via border-color (no outer ring halo) so the
      // input fits cleanly inside `overflow: auto` containers — the
      // old `ring-2` halo extended 2px outside the border and got
      // clipped on narrow detail panes. Same approach the Button
      // primitive uses (see button.tsx).
      'outline-none focus-visible:border-ring disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
