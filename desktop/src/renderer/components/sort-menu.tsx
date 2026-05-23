import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { ArrowUpDown, Check } from 'lucide-react';

/**
 * Small dropdown for picking a sort option on a list page. Each option
 * carries an opaque `value: string` plus a human label; the consumer
 * page maintains state and implements the actual comparator.
 *
 * Why not a `<select>`: native selects can't be styled to match the
 * compact filter-bar look on Tailwind-styled list headers, and they
 * skip the keyboard-friendly Radix dropdown semantics already used
 * elsewhere in the app.
 *
 * Usage:
 *   <SortMenu
 *     value={sort}
 *     onChange={setSort}
 *     options={[
 *       { value: 'recent', label: m.activities_sort_recent() },
 *       { value: 'co2e_desc', label: m.activities_sort_co2e_desc() },
 *     ]}
 *   />
 */

export interface SortMenuOption<V extends string = string> {
  value: V;
  label: string;
}

export interface SortMenuProps<V extends string = string> {
  value: V;
  onChange: (v: V) => void;
  options: SortMenuOption<V>[];
  className?: string;
}

export function SortMenu<V extends string = string>({
  value,
  onChange,
  options,
  className,
}: SortMenuProps<V>) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          // Compact pill matching the filter chip aesthetic so the sort
          // control reads as part of the filter row rather than a
          // separate action.
          'inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground transition-colors hover:bg-foreground/5',
          className,
        )}
      >
        <ArrowUpDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">{m.sort_label()}:</span>
        <span>{current?.label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <DropdownMenuItem
              key={opt.value}
              onSelect={() => onChange(opt.value)}
              className="flex items-center gap-2 text-xs"
            >
              <span
                aria-hidden="true"
                className={cn('flex h-3 w-3 items-center justify-center', !selected && 'invisible')}
              >
                <Check className="h-3 w-3" />
              </span>
              <span>{opt.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
