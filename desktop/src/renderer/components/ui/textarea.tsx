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
      'focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50 resize-none',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
