'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { cn } from '../cn';
import { closeButtonClass } from './floating';

/*
 * Built on Base UI Dialog, not Base UI Drawer. Drawer adds swipe to dismiss and snap points, but
 * its swipe direction is one prop for every width, so a right drawer on desktop and a bottom sheet
 * on a phone would need the width read in script, which the server cannot know (a layout shift
 * on every open). Dialog lets CSS alone switch the two at 768 px. A phone closes the sheet with
 * the Back gesture (the app opens sheets from the address, design system v3 section 8), the close
 * button or the scrim; swipe can come later from Drawer if research asks for it.
 */

/**
 * The scrim behind a bottom sheet on a phone. From 768 px there is none (the list or calendar
 * stays in view beside the drawer), so it is hidden there.
 */
export const sheetBackdropClass =
  'fixed inset-0 z-30 bg-scrim transition-opacity duration-[var(--duration-motion)] ease-standard data-starting-style:opacity-0 data-ending-style:opacity-0 md:hidden';

/**
 * Below 768 px a bottom sheet: full width, 16 px top corners, at most 90% of the screen high,
 * rising from the bottom edge. From 768 px a right drawer: 480 px, floating 8 px from the top,
 * right and bottom edges, 16 px corners, `shadow-drawer`, sliding in from the right (its width
 * plus 16 px, as motion.css's drawer keyframes). Both 240 ms; nothing moves under reduced motion
 * (base.css). Stacks at 30 (section 4.5).
 */
export const sheetPopupClass = [
  'fixed z-30 flex flex-col overflow-hidden border border-line bg-surface text-base text-ink outline-none',
  'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-sheet shadow-float',
  'md:inset-x-auto md:inset-y-2 md:right-2 md:max-h-none md:w-[calc(100vw-1rem)] md:max-w-drawer md:rounded-drawer md:shadow-drawer',
  'transition-transform duration-[var(--duration-motion)] ease-standard data-ending-style:ease-in',
  'data-starting-style:translate-y-full data-ending-style:translate-y-full',
  'md:data-starting-style:translate-x-[calc(100%+1rem)] md:data-starting-style:translate-y-0 md:data-ending-style:translate-x-[calc(100%+1rem)] md:data-ending-style:translate-y-0',
].join(' ');

export interface SheetProps {
  /**
   * Controlled from outside: the app opens a sheet from the address (search params) and closes it
   * by navigating, so `onOpenChange(false)` is where the caller navigates to the closed address.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 16 px semibold; names the sheet for screen readers. */
  title: string;
  /** One line under the title in `sm ink-muted`. */
  subtitle?: ReactNode;
  /** Before the title, such as a 32 px avatar. */
  leading?: ReactNode;
  /** Actions pinned at the bottom on `surface-subtle`, with the phone's safe area under them. */
  footer?: ReactNode;
  /**
   * True by default: focus is trapped in the sheet and the page behind cannot be used. False for a
   * drawer beside a list the person keeps using (a calendar): focus still moves in and returns,
   * `Esc` still closes it, but the page stays usable and a press outside does not close it.
   */
  modal?: boolean;
  /** What takes focus when it opens; the first focusable element by default. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Layout only, on the panel (a test id goes on a child). */
  className?: string;
  children: ReactNode;
}

/**
 * Design system v3 Drawer: details open in a right drawer on desktop and a bottom sheet on phones
 * (section 7). Header with the title, subtitle and a close button; a scrolling body (20 x 16 px);
 * an optional pinned footer. Sheets are never stacked; a long task gets a full page instead.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  subtitle,
  leading,
  footer,
  modal = true,
  initialFocus,
  className,
  children,
}: SheetProps) {
  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
      disablePointerDismissal={!modal}
    >
      <BaseDialog.Portal>
        {/* A non-modal sheet ignores presses outside it, but on a phone the scrim still closes it. */}
        <BaseDialog.Backdrop
          className={sheetBackdropClass}
          onClick={
            modal
              ? undefined
              : () => {
                  onOpenChange(false);
                }
          }
        />
        <BaseDialog.Popup initialFocus={initialFocus} className={cn(sheetPopupClass, className)}>
          <div aria-hidden className="flex justify-center pt-2 md:hidden">
            <span className="h-1 w-9 rounded-full bg-line-strong" />
          </div>
          <div className="flex items-start gap-3 border-b border-line py-3 pr-3 pl-5">
            {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5">
              <BaseDialog.Title className="text-md font-semibold text-ink">
                {title}
              </BaseDialog.Title>
              {subtitle ? (
                <BaseDialog.Description className="text-sm text-ink-muted">
                  {subtitle}
                </BaseDialog.Description>
              ) : null}
            </div>
            <BaseDialog.Close aria-label="Close" className={closeButtonClass}>
              <X aria-hidden strokeWidth={1.75} />
            </BaseDialog.Close>
          </div>
          {/* It scrolls when the content is long, so the keyboard must reach it (WCAG 2.1.1). */}
          <div
            tabIndex={0}
            className={cn(
              'flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-5 py-4',
              footer ? '' : 'pb-[max(1rem,env(safe-area-inset-bottom))]',
            )}
          >
            {children}
          </div>
          {footer ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-subtle px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
