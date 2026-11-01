import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface DescriptionItem {
  label: string;
  value: ReactNode;
}

export interface DescriptionListProps {
  items: readonly DescriptionItem[];
  className?: string;
}

/**
 * Read-only label and value pairs (design system v3 section 8). Stacked on phones; from 768 px
 * the labels take a fixed 160 px so every list and drawer lines up.
 */
export function DescriptionList({ items, className }: DescriptionListProps) {
  return (
    <dl className={cn('flex flex-col gap-3 md:gap-2', className)}>
      {items.map((item, index) => (
        <div
          key={`${String(index)}:${item.label}`}
          className="flex flex-col gap-0.5 md:flex-row md:gap-4"
        >
          <dt className="text-ink-muted md:w-40 md:shrink-0">{item.label}</dt>
          <dd className="min-w-0 text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
