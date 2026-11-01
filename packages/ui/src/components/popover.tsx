'use client';

import { Popover as BasePopover } from '@base-ui/react/popover';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../cn';
import { floatingPanelClass, floatingPositionerClass } from './floating';

type Side = 'top' | 'bottom' | 'left' | 'right';
type Align = 'start' | 'center' | 'end';

export interface PopoverProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * A small panel that opens from a trigger (Base UI Popover): extra detail or a short form next to
 * what it is about. `Esc` or a press outside closes it and focus returns to the trigger. Put a
 * PopoverTrigger and a PopoverContent inside. Unlike a Tooltip it works on touch screens, so
 * anything a person needs to read goes here, never in a tooltip.
 */
export function Popover({ open, defaultOpen, onOpenChange, children }: PopoverProps) {
  return (
    <BasePopover.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {children}
    </BasePopover.Root>
  );
}

export interface PopoverTriggerProps {
  /** The element that opens it, usually a Button: `render={<Button variant="quiet" />}`. */
  render?: ReactElement;
  /** Opens on hover too (with a mouse), for an info icon; a tap still opens it on touch. */
  openOnHover?: boolean;
  /** Layout only. */
  className?: string;
  'aria-label'?: string;
  children?: ReactNode;
}

/** Opens the popover; a plain button unless `render` gives it another element. */
export function PopoverTrigger({ render, className, children, ...props }: PopoverTriggerProps) {
  return (
    <BasePopover.Trigger render={render} className={className} {...props}>
      {children}
    </BasePopover.Trigger>
  );
}

export interface PopoverContentProps {
  /** A heading in 14 px semibold; also names the popover for screen readers. */
  title?: string;
  side?: Side;
  align?: Align;
  /** Gap from the trigger in px; 4 by default. */
  sideOffset?: number;
  /** Layout only, such as a width. */
  className?: string;
  children: ReactNode;
}

/** The floating panel: the "Floating list" look with 12 px padding for text, at z-index 50. */
export function PopoverContent({
  title,
  side = 'bottom',
  align = 'center',
  sideOffset = 4,
  className,
  children,
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={floatingPositionerClass}
      >
        <BasePopover.Popup
          className={cn(
            floatingPanelClass,
            'flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-1 p-3',
            className,
          )}
        >
          {title ? (
            <BasePopover.Title className="font-semibold text-ink">{title}</BasePopover.Title>
          ) : null}
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

/** Text in a popover, linked to it as its description. */
export function PopoverDescription({ children }: { children: ReactNode }) {
  return (
    <BasePopover.Description className="text-ink-secondary">{children}</BasePopover.Description>
  );
}

/** Closes the popover; a plain button unless `render` gives it another element (a Button). */
export function PopoverClose({
  render,
  className,
  children,
}: {
  render?: ReactElement;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <BasePopover.Close render={render} className={className}>
      {children}
    </BasePopover.Close>
  );
}
