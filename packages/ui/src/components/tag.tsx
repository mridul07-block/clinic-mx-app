import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../cn';
import type { Tone } from '../status';

/** The status tones plus `emergency` (the solid red, a real emergency only) and `muted`. */
export type TagTone = Tone | 'emergency' | 'muted';

/**
 * The tag recipe of design system v3 section 8: a tint, the plain tone as text (never the
 * `-strong` one) and a same-hue border, always with a word.
 */
export const tagVariants = cva(
  'inline-flex shrink-0 items-center whitespace-nowrap rounded-tag border font-medium',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-sunken text-ink-secondary',
        outline: 'border-line-control bg-surface text-ink',
        info: 'border-info-line bg-info-soft text-info',
        waiting: 'border-waiting-line bg-waiting-soft text-waiting',
        active: 'border-active-line bg-active-soft text-active',
        done: 'border-done-line bg-done-soft text-done',
        danger: 'border-danger-line bg-danger-soft text-danger',
        emergency: 'border-danger-strong bg-danger-strong text-on-danger',
        muted: 'border-line bg-surface text-ink-muted',
      },
      size: {
        default: 'h-6 gap-1.5 px-2 text-sm',
        small: 'h-5 gap-1 px-1.5 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'default' },
  },
);

/** The 6 px dot before the word: a filled mark, or a ring on the outline and muted tones. */
const dotClass: Record<TagTone, string> = {
  neutral: 'bg-ink-muted',
  outline: 'border border-ink-muted',
  info: 'bg-info',
  waiting: 'bg-waiting-strong',
  active: 'bg-active',
  done: 'bg-done',
  danger: 'bg-danger',
  emergency: 'bg-on-danger',
  muted: 'border border-ink-faint',
};

export interface TagProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof tagVariants> {
  /** A 6 px round dot before the word (a StatusBadge). */
  dot?: boolean;
}

/** A tag: a word in a status tone, 24 px (20 px small), optionally with a dot. */
export function Tag({ tone, size, dot = false, className, children, ...props }: TagProps) {
  return (
    <span className={cn(tagVariants({ tone, size }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden
          className={cn('size-1.5 shrink-0 rounded-full', dotClass[tone ?? 'neutral'])}
        />
      ) : null}
      {children}
    </span>
  );
}
