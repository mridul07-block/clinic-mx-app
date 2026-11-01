import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface RecordFact {
  label: string;
  value: ReactNode;
}

export interface RecordHeaderProps {
  name: ReactNode;
  /** The OP number, in the mono face. */
  opNumber: string;
  /** Short facts such as age and sex, condition, episode stage; one line joined by middle dots
   * (the record page's one context line). */
  facts?: readonly string[];
  /** A status tag beside the name. */
  status?: ReactNode;
  /** Next visit, package sessions left, balance due: label over a tabular figure. */
  meta?: readonly RecordFact[];
  /** Red flag and consent tags. */
  flags?: ReactNode;
  /** The one primary action. */
  action?: ReactNode;
  className?: string;
}

/**
 * The header of a patient, episode, consultation or session (design system v3 section 7). On
 * phones it stacks: name, OP number and flags first, then the figures, then the action; from
 * 768 px it is one row with the figures and action on the right.
 */
export function RecordHeader({
  name,
  opNumber,
  facts,
  status,
  meta,
  flags,
  action,
  className,
}: RecordHeaderProps) {
  const factLine = facts?.filter(Boolean).join(' · ');
  return (
    <header
      className={cn(
        'flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="min-w-0 text-title font-semibold text-ink">{name}</h1>
          <span className="font-mono text-sm text-ink-secondary">{opNumber}</span>
          {status ? <span className="self-center">{status}</span> : null}
        </div>
        {flags ? <div className="flex flex-wrap items-center gap-1.5">{flags}</div> : null}
        {factLine ? <p className="text-sm text-ink-muted">{factLine}</p> : null}
      </div>
      {meta?.length || action ? (
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:gap-8">
          {meta?.length ? (
            <dl className="flex flex-wrap gap-x-6 gap-y-2">
              {meta.map((fact) => (
                <div key={fact.label} className="flex flex-col">
                  <dt className="text-sm text-ink-muted">{fact.label}</dt>
                  <dd className="font-medium text-ink tabular-nums">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}
    </header>
  );
}
