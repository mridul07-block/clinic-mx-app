import { useId, type ReactNode } from 'react';
import { cn } from '../cn';

export interface PanelProps {
  title?: ReactNode;
  /** The window it measures, beside the title ("Last 3 months"). */
  window?: ReactNode;
  /** Controls pushed to the right of the heading row. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** No body padding, for a table that runs edge to edge. */
  flush?: boolean;
  /** The title's heading level; h2 under the page's h1 by default. */
  headingLevel?: 2 | 3;
  className?: string;
  children: ReactNode;
}

/**
 * The unit of every page (design system v3 section 8): a white panel with a hairline border and
 * shadow-xs, a 56 px heading row, a 20 px body and an optional quiet footer. Panels on a page
 * differ in size and content; never a grid of identical tiles.
 */
export function Panel({
  title,
  window,
  actions,
  footer,
  flush = false,
  headingLevel = 2,
  className,
  children,
}: PanelProps) {
  const titleId = useId();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  const hasHead = Boolean(title ?? actions);
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={cn(
        'overflow-clip rounded-panel border border-line bg-surface shadow-xs',
        className,
      )}
    >
      {hasHead ? (
        <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
          {title ? (
            <Heading id={titleId} className="text-md font-semibold tracking-[-0.01em] text-ink">
              {title}
            </Heading>
          ) : null}
          {window ? <span className="text-sm text-ink-muted">{window}</span> : null}
          {actions ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={flush ? undefined : hasHead ? 'px-5 pb-5' : 'p-5'}>{children}</div>
      {footer ? (
        <div className="border-t border-line px-5 py-3 text-sm text-ink-muted">{footer}</div>
      ) : null}
    </section>
  );
}
