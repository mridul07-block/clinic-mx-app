'use client';

import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { floatingItemClass, floatingPanelClass, floatingPositionerClass } from './floating';
import { controlClass } from './input';

export interface ComboboxProps<Item> {
  /**
   * What can be chosen. For a search done elsewhere (patients from the server) pass the latest
   * results with `searched` set; keep the chosen item in the list so it stays shown.
   */
  items: readonly Item[];
  /** The words for an item: shown in the input once chosen, and matched while typing. */
  itemToString: (item: Item) => string;
  /** A stable key for an item (its id). */
  itemKey: (item: Item) => string;
  /** How an option looks; its words by default. Two lines (name over OP number) are fine. */
  renderItem?: (item: Item) => ReactNode;
  value?: Item | null;
  defaultValue?: Item | null;
  onValueChange?: (item: Item | null) => void;
  /** What has been typed, for a caller that searches as it changes. */
  inputValue?: string;
  onInputValueChange?: (text: string) => void;
  /** The items already match what was typed (results from a search), so nothing is filtered here. */
  searched?: boolean;
  /** One line over the options for what is going on: "Searching", "Type 2 letters to search". */
  status?: ReactNode;
  /** Shown when nothing matches; "" for nothing (a search with nothing typed yet). */
  emptyText?: string;
  placeholder?: string;
  /**
   * The list sits under the input in the page or a dialog instead of floating: for search in a
   * Dialog with `placement="top"` (the command palette), where the list is always shown.
   */
  inline?: boolean;
  /** From a Field: `{(control) => <Combobox {...control} ... />}`. */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  /** When there is no visible label. */
  'aria-label'?: string;
  /** Posts the chosen item's key with a form. */
  name?: string;
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  /** Layout only, on the wrapper. */
  className?: string;
}

/**
 * A searchable list with an input (Base UI Combobox): type to narrow the options, arrow keys to
 * move, `Enter` to choose. The input has the Input look (36 px, 44 on touch) and the list the
 * "Floating list" recipe, with a tick on the chosen option.
 */
export function Combobox<Item>({
  items,
  itemToString,
  itemKey,
  renderItem,
  value,
  defaultValue,
  onValueChange,
  inputValue,
  onInputValueChange,
  searched = false,
  status,
  emptyText = 'No matches',
  placeholder,
  inline = false,
  id,
  name,
  disabled,
  required,
  autoFocus,
  className,
  ...aria
}: ComboboxProps<Item>) {
  const options = (
    <>
      {/* Always there, so screen readers hear the status change as it does. */}
      <BaseCombobox.Status className="px-2.5 py-1.5 text-sm text-ink-muted empty:hidden">
        {status}
      </BaseCombobox.Status>
      {emptyText ? (
        <BaseCombobox.Empty>
          <div className="px-2.5 py-1.5 text-sm text-ink-muted">{emptyText}</div>
        </BaseCombobox.Empty>
      ) : null}
      <BaseCombobox.List className="flex flex-col outline-none data-empty:hidden">
        {(item: Item) => (
          <BaseCombobox.Item key={itemKey(item)} value={item} className={floatingItemClass}>
            <span className="min-w-0 flex-1">
              {renderItem ? renderItem(item) : itemToString(item)}
            </span>
            <BaseCombobox.ItemIndicator className="ml-auto flex">
              <Check aria-hidden strokeWidth={2} className="text-accent" />
            </BaseCombobox.ItemIndicator>
          </BaseCombobox.Item>
        )}
      </BaseCombobox.List>
    </>
  );

  return (
    <BaseCombobox.Root
      items={items}
      itemToStringLabel={itemToString}
      itemToStringValue={itemKey}
      isItemEqualToValue={(a: Item, b: Item) => itemKey(a) === itemKey(b)}
      filter={searched ? null : undefined}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      inputValue={inputValue}
      onInputValueChange={onInputValueChange}
      inline={inline}
      open={inline ? true : undefined}
      autoHighlight
      name={name}
      disabled={disabled}
      required={required}
    >
      <div className={cn('relative w-full', inline ? 'flex min-h-0 flex-col' : '', className)}>
        <BaseCombobox.Input
          id={id}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={cn(
            controlClass,
            'h-row pl-3 pointer-coarse:h-row-touch',
            inline ? 'pr-3' : 'pr-9',
          )}
          {...aria}
        />
        {inline ? (
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto">{options}</div>
        ) : (
          <>
            {/* A hint, not a button: a press in the input opens the list (Base UI's Trigger
                would be a second element named as the combobox). */}
            <ChevronDown
              aria-hidden
              strokeWidth={1.75}
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted"
            />
            <BaseCombobox.Portal>
              <BaseCombobox.Positioner sideOffset={4} className={floatingPositionerClass}>
                <BaseCombobox.Popup
                  className={cn(
                    floatingPanelClass,
                    'max-h-[min(22.5rem,var(--available-height))] w-(--anchor-width) max-w-(--available-width) overflow-y-auto overscroll-contain',
                  )}
                >
                  {options}
                </BaseCombobox.Popup>
              </BaseCombobox.Positioner>
            </BaseCombobox.Portal>
          </>
        )}
      </div>
    </BaseCombobox.Root>
  );
}
