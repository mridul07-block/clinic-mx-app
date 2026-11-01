import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface EmptyStateProps {
  /** A lucide icon, shown at 20 px in a 40 px sunken circle. */
  icon?: LucideIcon;
  title?: ReactNode;
  /** One sentence saying what goes here ("No one has arrived yet"). */
  children: ReactNode;
  /** One action, when there is something to do. */
  action?: ReactNode;
  className?: string;
}

/** An empty list or panel (design system v3 section 8): an icon, one sentence, one action. */
export function EmptyState({ icon: Icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-5 py-10 text-center', className)}>
      {Icon ? (
        <span className="flex size-10 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
          <Icon aria-hidden size={20} strokeWidth={1.75} />
        </span>
      ) : null}
      {title ? <p className="font-medium text-ink">{title}</p> : null}
      <p className="max-w-96 text-ink-muted">{children}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
