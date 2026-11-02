import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

/*
 * No 'use client': a key hint is plain markup, so a server page renders it without sending any
 * script for it.
 */

/**
 * Design system v3 Kbd, for hints like `Ctrl K`: 20 px high, at least 20 px wide, 4 px radius,
 * `line` border, white, 12 px `font-mono` in `ink-muted`.
 */
export const kbdClass =
  'inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-surface px-1 font-mono text-sm text-ink-muted';

/** One key: `<Kbd>Ctrl</Kbd> <Kbd>K</Kbd>`. */
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <kbd className={cn(kbdClass, className)} {...props} />;
}
