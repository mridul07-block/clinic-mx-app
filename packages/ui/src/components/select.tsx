import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from '../cn';
import { controlClass } from './input';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** A first, empty option ("Choose a centre") that a form posts as "". */
  placeholder?: string;
}

/**
 * A choice from a list, with the Input's look and a chevron on the right; children are its
 * <option>s. It is the browser's own select on purpose, not Base UI's: it posts with a plain form
 * before any JavaScript runs, gives phones their native picker, and adds no script to the page.
 * `className` sets the wrapper's layout. (The design check's ratchet counts native selects in
 * screen code only; the kit itself is where they belong.)
 */
export function Select({ placeholder, className, children, ...props }: SelectProps) {
  return (
    <div className={cn('relative w-full', className)}>
      <select
        className={cn(
          controlClass,
          'peer h-row cursor-pointer appearance-none pr-9 pl-3 pointer-coarse:h-row-touch',
        )}
        {...props}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {children}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted peer-disabled:text-ink-faint"
      />
    </div>
  );
}
