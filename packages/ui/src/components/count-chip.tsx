import { cva } from 'class-variance-authority';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import { cn } from '../cn';

/** The chip's look; selected sits on `accent-soft` with an accent border. */
export const countChipVariants = cva(
  [
    'inline-flex h-row shrink-0 items-center gap-2 whitespace-nowrap rounded-control border px-3 text-base font-medium pointer-coarse:h-row-touch',
    'transition-[color,background-color,border-color] duration-[var(--duration-quick)]',
  ],
  {
    variants: {
      selected: {
        false:
          'border-line-strong bg-surface text-ink-secondary shadow-xs hover:border-line-control hover:bg-surface-hover hover:text-ink',
        true: 'border-accent bg-accent-soft text-accent',
      },
    },
    defaultVariants: { selected: false },
  },
);

const countClass = {
  false: 'tabular-nums text-ink-muted',
  true: 'tabular-nums text-accent',
};

interface CountChipCommon {
  label: ReactNode;
  count: number;
  selected?: boolean;
  /** Layout only (margin, grid position). */
  className?: string;
}

/** A link that filters by URL; `linkAs` takes Next's Link for client navigation. */
export interface CountChipLinkProps
  extends
    CountChipCommon,
    Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children' | 'href'> {
  href: string;
  linkAs?: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>;
}

/** A button that filters in place. */
export interface CountChipButtonProps
  extends CountChipCommon, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  href?: undefined;
}

export type CountChipProps = CountChipLinkProps | CountChipButtonProps;

/**
 * A filter chip with a label and its count in tabular figures ("To arrive 12"), the "count row as
 * tabs" of design system v3. With `href` it is a link (`aria-current` when selected); without, a
 * button (`aria-pressed`).
 */
export function CountChip({ label, count, selected = false, className, ...rest }: CountChipProps) {
  const classes = cn(countChipVariants({ selected }), className);
  const content = (
    <>
      <span>{label}</span>
      <span className={countClass[selected ? 'true' : 'false']}>{count}</span>
    </>
  );
  if (rest.href !== undefined) {
    const { linkAs, ...link } = rest;
    const Anchor = linkAs ?? 'a';
    return (
      <Anchor {...link} aria-current={selected ? 'true' : undefined} className={classes}>
        {content}
      </Anchor>
    );
  }
  const { type = 'button', ...button } = rest;
  return (
    <button type={type} {...button} aria-pressed={selected} className={classes}>
      {content}
    </button>
  );
}
