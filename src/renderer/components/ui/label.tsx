import { cn } from '@renderer/lib/utils';
import * as React from 'react';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label ref={ref} className={cn('text-sm font-medium leading-none', className)} {...props} />
));
Label.displayName = 'Label';
