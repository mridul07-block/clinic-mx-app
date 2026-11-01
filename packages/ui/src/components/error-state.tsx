import { CircleAlert, FileQuestion, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface ErrorStateProps {
  /** A failure (danger tint well) or a missing page (grey well). */
  kind: 'error' | 'not-found';
  /** What happened, in plain words; never the raw error or "Something went wrong". */
  title: ReactNode;
  /** What to do next. */
  children: ReactNode;
  /** One primary button ("Load again"). */
  action?: ReactNode;
  /** A reference code (an error digest), shown in mono so support can find it. */
  reference?: string;
  /** A grey well even for a failure: patient pages show nothing alarming. */
  calm?: boolean;
  /** h1 when it stands for the whole page (route error and not found), h2 inside a page. */
  headingLevel?: 1 | 2;
  icon?: LucideIcon;
  className?: string;
}

/** Error and not found (design system v3 section 8): one narrow panel with an icon in a quiet well. */
export function ErrorState({
  kind,
  title,
  children,
  action,
  reference,
  calm = false,
  headingLevel = 1,
  icon,
  className,
}: ErrorStateProps) {
  const Icon = icon ?? (kind === 'error' ? CircleAlert : FileQuestion);
  const Heading = headingLevel === 2 ? 'h2' : 'h1';
  const danger = kind === 'error' && !calm;
  return (
    <section
      className={cn(
        'mx-auto flex w-full max-w-[28rem] flex-col items-center gap-3 rounded-panel border border-line bg-surface px-5 py-8 text-center shadow-xs',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-12 items-center justify-center rounded-full',
          danger ? 'bg-danger-soft text-danger' : 'bg-surface-sunken text-ink-muted',
        )}
      >
        <Icon aria-hidden size={20} strokeWidth={1.75} />
      </span>
      <Heading className="text-lg font-semibold text-ink">{title}</Heading>
      <p className="max-w-96 text-ink-secondary">{children}</p>
      {action ? <div className="mt-2">{action}</div> : null}
      {reference ? (
        <p className="text-sm text-ink-muted">
          Reference <span className="font-mono">{reference}</span>
        </p>
      ) : null}
    </section>
  );
}
