'use client';

import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { tabClass, tabCountClass, tabListClass } from './link-tabs';

export interface TabsProps<Value extends string> {
  /** Controlled value; leave out with `defaultValue` for an uncontrolled one. */
  value?: Value;
  defaultValue?: Value;
  onValueChange?: (value: Value) => void;
  /** Layout only. */
  className?: string;
  children: ReactNode;
}

/**
 * Underline tabs that switch content in place (Base UI Tabs): arrow keys move between tabs, and
 * each TabsPanel is linked to its tab. For tabs with their own address, use LinkTabs.
 */
export function Tabs<Value extends string>({
  value,
  defaultValue,
  onValueChange,
  className,
  children,
}: TabsProps<Value>) {
  return (
    <BaseTabs.Root
      value={value}
      defaultValue={defaultValue}
      // Base UI types the value as unknown; every Tab here is given a Value.
      onValueChange={
        onValueChange
          ? (next) => {
              onValueChange(next as Value);
            }
          : undefined
      }
      className={cn('flex flex-col gap-4', className)}
    >
      {children}
    </BaseTabs.Root>
  );
}

/** The row of tabs; scrolls sideways on a phone if it ever outgrows the screen. */
export function TabsList({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <BaseTabs.List aria-label={label} className={tabListClass}>
        {children}
      </BaseTabs.List>
    </div>
  );
}

export interface TabProps {
  value: string;
  /** A count beside the label; nothing when zero or absent. */
  count?: number;
  /** The count needs action: waiting tint instead of grey. */
  attention?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

/** One tab: 40 px (44 on touch), `ink-muted`; the current one `ink` with a 2 px accent underline. */
export function Tab({ value, count, attention = false, disabled, children }: TabProps) {
  return (
    <BaseTabs.Tab value={value} disabled={disabled} className={tabClass}>
      {children}
      {count ? (
        <span className={tabCountClass[attention ? 'attention' : 'neutral']}>{count}</span>
      ) : null}
    </BaseTabs.Tab>
  );
}

/** The content of one tab, shown while its tab is current. */
export function TabsPanel({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <BaseTabs.Panel value={value} className={className}>
      {children}
    </BaseTabs.Panel>
  );
}
