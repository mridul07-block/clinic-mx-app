'use client';

import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

type Side = 'top' | 'bottom' | 'left' | 'right';

/**
 * The tooltip's panel: ink with white text (`on-accent` is white; 15:1 on ink), 12 px, 6 px
 * radius, 8 x 4 px padding, at z-index 50 with menus and lists (section 4.5).
 */
export const tooltipPopupClass =
  'max-w-64 rounded-tag bg-ink px-2 py-1 text-xs text-on-accent shadow-float transition-opacity duration-[var(--duration-quick)] ease-standard data-starting-style:opacity-0 data-ending-style:opacity-0';

export interface TooltipProps {
  /** The words shown; also the trigger's accessible name unless `labelsTrigger` is false. */
  label: string;
  /** One focusable element (a button or link), which becomes the trigger. */
  children: ReactElement;
  side?: Side;
  /**
   * True by default: `label` is set as the trigger's `aria-label`, for an icon-only trigger
   * (IconButton, the rail's icons). False when the trigger shows its own words, so its name stays
   * what it shows.
   */
  labelsTrigger?: boolean;
  /** Milliseconds before it opens on hover; Base UI's 600 by default. */
  delay?: number;
}

/**
 * A short label for sighted mouse and keyboard users (Base UI Tooltip): it opens on hover and on
 * keyboard focus. Base UI does not open tooltips on touch (no tap or long press: a long press is
 * the browser's own menu), so a tooltip never carries anything a person needs. That is why the
 * label is also the trigger's accessible name by default, and why touch screens show the words
 * another way (the rail puts small labels under its icons on touch, section 7). Anything longer,
 * or needed on a phone, goes in a Popover.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  labelsTrigger = true,
  delay,
}: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        render={children}
        delay={delay}
        aria-label={labelsTrigger ? label : undefined}
      />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
          <BaseTooltip.Popup className={tooltipPopupClass}>{label}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

/**
 * Shares one open delay across a group of tooltips, so moving along a toolbar or the rail opens
 * the next one at once. Optional; place it around the group.
 */
export function TooltipProvider({ children, delay }: { children: ReactNode; delay?: number }) {
  return <BaseTooltip.Provider delay={delay}>{children}</BaseTooltip.Provider>;
}
