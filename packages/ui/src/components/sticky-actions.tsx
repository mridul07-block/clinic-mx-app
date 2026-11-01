import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface StickyActionsProps {
  /** The screen's one primary action, then any secondary ones. Full width on phones. */
  children: ReactNode;
  /** False on screens that hide the bottom tabs (consultation, session note): the bar sits on the
   * bottom edge instead of above the tabs. */
  aboveTabs?: boolean;
  className?: string;
}

/**
 * The screen's sticky action area (design system v3 section 7). Below 768 px a bar fixed above
 * the 56 px bottom tab bar and the safe area, its buttons full width, with a spacer so it never
 * covers the page's last lines. From 768 px it is an ordinary row at the end of the content.
 */
export function StickyActions({ children, aboveTabs = true, className }: StickyActionsProps) {
  return (
    <>
      <div aria-hidden className="h-20 md:hidden" />
      <div
        data-sticky-actions
        className={cn(
          'fixed inset-x-0 z-20 flex flex-col gap-2 border-t border-line bg-surface px-4 pt-3 *:w-full',
          aboveTabs
            ? 'bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] pb-3'
            : 'bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          'md:static md:flex-row md:justify-end md:border-0 md:bg-transparent md:p-0 md:*:w-auto',
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
