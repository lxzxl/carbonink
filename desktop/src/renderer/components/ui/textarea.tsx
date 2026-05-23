import { cn } from '@renderer/lib/utils';
import * as React from 'react';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm',
      // border-color focus (no outer halo) — see Input primitive for
      // the rationale (ring-2 was getting clipped inside overflow-auto
      // detail panes).
      'outline-none focus-visible:border-ring disabled:opacity-50 resize-none',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
