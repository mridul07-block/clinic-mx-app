'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { ReactElement, ReactNode, RefObject } from 'react';
import { cn } from '../cn';
import { closeButtonClass } from './floating';

/** The scrim behind a dialog: fades in and out with the popup; stacks at 40 (section 4.5). */
export const dialogBackdropClass =
  'fixed inset-0 z-40 bg-scrim transition-opacity duration-[var(--duration-quick)] ease-standard data-starting-style:opacity-0 data-ending-style:opacity-0';

/**
 * A centred panel over the scrim: white, `line` border, 12 px radius, `shadow-float`, never wider
 * than the screen less 16 px a side. `placement="top"` is for search (the command palette): full
 * screen on a phone (design system v3 section 7, "opening search full screen"), near the top
 * from 768 px.
 */
export const dialogPopupVariants = cva(
  [
    'fixed z-40 flex flex-col overflow-hidden border border-line bg-surface text-base text-ink shadow-float outline-none',
    'transition-opacity duration-[var(--duration-quick)] ease-standard data-starting-style:opacity-0 data-ending-style:opacity-0',
  ],
  {
    variants: {
      size: {
        sm: 'md:w-[min(25rem,calc(100vw-2rem))]',
        md: 'md:w-[min(32rem,calc(100vw-2rem))]',
        lg: 'md:w-[min(40rem,calc(100vw-2rem))]',
      },
      placement: {
        centre:
          'top-1/2 left-1/2 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-panel',
        top: 'inset-0 h-dvh w-full rounded-none border-0 md:inset-auto md:top-[12vh] md:left-1/2 md:h-auto md:max-h-[76vh] md:-translate-x-1/2 md:rounded-panel md:border',
      },
    },
    defaultVariants: { size: 'md', placement: 'centre' },
  },
);

export interface DialogProps {
  /** Controlled open state; leave out with `defaultOpen` or a trigger for an uncontrolled one. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * A dialog (Base UI Dialog): focus moves into it and is trapped there, `Esc` or a press on the
 * scrim closes it, and focus returns to what opened it. Put a DialogTrigger and a DialogContent
 * inside.
 */
export function Dialog({ open, defaultOpen, onOpenChange, children }: DialogProps) {
  return (
    <BaseDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {children}
    </BaseDialog.Root>
  );
}

export interface DialogTriggerProps {
  /** The element that opens the dialog, usually a Button: `render={<Button variant="secondary" />}`. */
  render?: ReactElement;
  children?: ReactNode;
  className?: string;
}

/** Opens the dialog; a plain button unless `render` gives it another element. */
export function DialogTrigger({ render, children, className }: DialogTriggerProps) {
  return (
    <BaseDialog.Trigger render={render} className={className}>
      {children}
    </BaseDialog.Trigger>
  );
}

export interface DialogContentProps extends VariantProps<typeof dialogPopupVariants> {
  /** Names the dialog for everyone; shown in the header unless `hideHeader`. */
  title: string;
  description?: ReactNode;
  /**
   * No header row: the title is read by screen readers only and there is no close button (`Esc`
   * closes it). For search, where the input is the top of the dialog.
   */
  hideHeader?: boolean;
  /** Buttons pinned under the body, on `surface-subtle` with a `line` border. */
  footer?: ReactNode;
  /** What takes focus when it opens; the first focusable element by default. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Layout only (section 8). */
  className?: string;
  children?: ReactNode;
}

/** The dialog's portal, scrim and panel: a header with the title and a close button, the body, an optional footer. */
export function DialogContent({
  title,
  description,
  hideHeader = false,
  footer,
  initialFocus,
  size,
  placement,
  className,
  children,
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={dialogBackdropClass} />
      <BaseDialog.Popup
        initialFocus={initialFocus}
        className={cn(dialogPopupVariants({ size, placement }), className)}
      >
        {hideHeader ? (
          <>
            <BaseDialog.Title className="sr-only">{title}</BaseDialog.Title>
            {description ? (
              <BaseDialog.Description className="sr-only">{description}</BaseDialog.Description>
            ) : null}
          </>
        ) : (
          <div className="flex items-start gap-3 py-3 pr-3 pl-5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5">
              <BaseDialog.Title className="text-md font-semibold text-ink">
                {title}
              </BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="text-sm text-ink-muted">
                  {description}
                </BaseDialog.Description>
              ) : null}
            </div>
            <BaseDialog.Close aria-label="Close" className={closeButtonClass}>
              <X aria-hidden strokeWidth={1.75} />
            </BaseDialog.Close>
          </div>
        )}
        {/* It scrolls when the content is long, so the keyboard must reach it (WCAG 2.1.1). Without
            a header the content takes the first focus (the search palette), never this box. */}
        <div
          tabIndex={hideHeader ? undefined : 0}
          className={cn('min-h-0 flex-1 overflow-y-auto', hideHeader ? '' : 'px-5 pb-5')}
        >
          {children}
        </div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-surface-subtle px-5 py-3">
            {footer}
          </div>
        ) : null}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

/** Closes the dialog; a plain button unless `render` gives it another element (a Button). */
export function DialogClose({ render, children, className }: DialogTriggerProps) {
  return (
    <BaseDialog.Close render={render} className={className}>
      {children}
    </BaseDialog.Close>
  );
}
