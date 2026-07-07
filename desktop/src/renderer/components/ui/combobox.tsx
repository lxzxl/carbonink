import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@renderer/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover';
import { cn } from '@renderer/lib/utils';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import type * as React from 'react';
import { useState } from 'react';

/**
 * Searchable single-select built from Popover + cmdk. This is the
 * affordance for long option lists (the AI provider catalog runs 32
 * providers; model catalogs run past 250 entries) where a native
 * <select> offers no filter box. Short lists should stay native.
 *
 * The trigger renders as a form field — the same box as <Input> and the
 * native selects it replaces — not as a Button, because it sits inside
 * forms between other fields. Focus follows the app's ring-less rule:
 * border shifts to `ring`, no halo.
 *
 * Selection is reported by closing over each option's own `value`
 * rather than trusting cmdk's onSelect argument: cmdk normalizes item
 * values (lowercase/trim) for matching, which would corrupt mixed-case
 * ids like openrouter's `Qwen/...` model paths.
 */

export type ComboboxOption = {
  value: string;
  /** Row content; defaults to the raw value in mono (ids are identifiers). */
  label?: React.ReactNode;
  /** Extra strings the filter matches besides `value` (e.g. a human name). */
  keywords?: string[];
};

export type ComboboxGroup = {
  /** Optional section heading rendered above the group. */
  heading?: string;
  options: ComboboxOption[];
};

type ComboboxProps = {
  /** Forwarded to the trigger button so a <Label htmlFor> can target it. */
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  groups: ComboboxGroup[];
  /** Trigger text while no value is selected. */
  placeholder: string;
  searchPlaceholder: string;
  /** Shown when the filter matches nothing. */
  emptyText: string;
  /**
   * How the selected value renders inside the trigger. Defaults to the
   * raw value; pass a renderer to e.g. set mono or a warning color. The
   * value is rendered even when it matches no option (a saved id that
   * left the catalog) so the user can see what needs replacing.
   */
  renderValue?: (value: string) => React.ReactNode;
  /**
   * Escape hatch for values outside the option list. When set and the
   * search text isn't exactly an existing option value, a trailing row
   * offers to use the typed text verbatim (e.g. a model id newer than
   * the bundled catalog). The callback builds the localized row label
   * from the current query.
   */
  customValueLabel?: (query: string) => string;
  disabled?: boolean;
};

export function Combobox({
  id,
  value,
  onValueChange,
  groups,
  placeholder,
  searchPlaceholder,
  emptyText,
  renderValue,
  customValueLabel,
  disabled,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  // Controlled so the custom-value row can mirror the query; reset on
  // every open so each visit starts unfiltered.
  const [search, setSearch] = useState('');

  const handleSelect = (next: string) => {
    onValueChange(next);
    setOpen(false);
  };

  const customQuery = search.trim();
  const showCustomRow =
    customValueLabel !== undefined &&
    customQuery !== '' &&
    !groups.some((group) => group.options.some((option) => option.value === customQuery));

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-left',
              value === '' && 'text-muted-foreground',
            )}
          >
            {value === '' ? placeholder : (renderValue?.(value) ?? value)}
          </span>
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        {/* defaultValue pre-highlights the current selection so cmdk
            scrolls it into view on open — native-select behavior. */}
        <Command {...(value !== '' ? { defaultValue: value } : {})}>
          <CommandInput
            autoFocus
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {/* When the custom-value row is up it IS the empty-state
                action, so the plain "no matches" line yields to it. */}
            {!showCustomRow && <CommandEmpty>{emptyText}</CommandEmpty>}
            {groups.map((group) => (
              <CommandGroup
                key={group.heading ?? group.options[0]?.value ?? 'empty'}
                heading={group.heading}
              >
                {group.options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    {...(option.keywords ? { keywords: option.keywords } : {})}
                    onSelect={() => handleSelect(option.value)}
                    className="pr-2 pl-8"
                  >
                    {/* Leading indicator column, same geometry as
                        DropdownMenuCheckboxItem so menus and pickers
                        share one selected-state vocabulary. */}
                    <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
                      {option.value === value && <CheckIcon className="size-4" />}
                    </span>
                    {option.label ?? (
                      <span className="truncate font-mono text-[0.8125rem]">{option.value}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            {showCustomRow && (
              // forceMount opts this row out of cmdk's filtering: its label
              // is *about* the query, not matched by it. cmdk's keyboard
              // auto-highlight walks rendered items, so when the filter
              // matches nothing this row is the Enter target.
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value="__carbonink-custom-value__"
                  onSelect={() => handleSelect(customQuery)}
                  className="pr-2 pl-8"
                >
                  <span className="truncate">{customValueLabel(customQuery)}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
