'use client';

import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { cn } from '../cn';
import {
  floatingGroupLabelClass,
  floatingItemClass,
  floatingPanelClass,
  floatingPositionerClass,
  floatingSeparatorClass,
} from './floating';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

export interface MenuProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * A menu of actions or links (Base UI Menu): arrow keys move through it, typing jumps to an item,
 * `Esc` closes it and focus returns to the trigger. Put a MenuTrigger and a MenuContent inside.
 */
export function Menu({ open, defaultOpen, onOpenChange, children }: MenuProps) {
  return (
    <BaseMenu.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {children}
    </BaseMenu.Root>
  );
}

export interface MenuTriggerProps {
  /** The element that opens the menu, usually a Button: `render={<Button variant="secondary" />}`. */
  render?: ReactElement;
  /** Layout only. */
  className?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

/** Opens the menu; a plain button unless `render` gives it another element. */
export function MenuTrigger({ render, className, children, ...props }: MenuTriggerProps) {
  return (
    <BaseMenu.Trigger render={render} className={className} {...props}>
      {children}
    </BaseMenu.Trigger>
  );
}

export interface MenuContentProps {
  side?: Side;
  align?: Align;
  /** Gap from the trigger in px; 4 by default. */
  sideOffset?: number;
  /** Layout only, such as a minimum width. */
  className?: string;
  children: ReactNode;
}

/** The floating list: portal, positioner (z-index 50) and the panel of the "Floating list" recipe. */
export function MenuContent({
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  className,
  children,
}: MenuContentProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={floatingPositionerClass}
      >
        <BaseMenu.Popup
          className={cn(
            floatingPanelClass,
            'max-h-(--available-height) min-w-44 overflow-y-auto',
            className,
          )}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export type MenuItemProps = Omit<ComponentProps<typeof BaseMenu.Item>, 'className'> & {
  className?: string;
};

/** An action; `onClick` runs it and the menu closes. A lucide icon may come first. */
export function MenuItem({ className, ...props }: MenuItemProps) {
  return <BaseMenu.Item className={cn(floatingItemClass, className)} {...props} />;
}

export type MenuLinkItemProps = Omit<ComponentProps<typeof BaseMenu.LinkItem>, 'className'> & {
  className?: string;
};

/**
 * An item that goes to another page: an `<a href>`, or the app's router link with
 * `render={<Link href="/app/settings" />}`.
 */
export function MenuLinkItem({ className, ...props }: MenuLinkItemProps) {
  return <BaseMenu.LinkItem className={cn(floatingItemClass, className)} {...props} />;
}

/** A rule between groups of items. */
export function MenuSeparator() {
  return <BaseMenu.Separator className={floatingSeparatorClass} />;
}

/** A labelled group of items. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <BaseMenu.Group>
      <BaseMenu.GroupLabel className={floatingGroupLabelClass}>{label}</BaseMenu.GroupLabel>
      {children}
    </BaseMenu.Group>
  );
}
