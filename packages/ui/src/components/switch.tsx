import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  label: ReactNode;
  /** A second line under the label, in small muted text. */
  description?: ReactNode;
}

/**
 * An on and off setting with its visible label (design system v3 section 8): a 32 × 18 px track,
 * `line-control` when off and the teal accent when on, with a 14 px white knob. The whole row is
 * the target (36 px, 44 on touch). A browser checkbox with the switch role underneath, so it
 * posts `value` (or "on") under `name` with a plain form before any JavaScript runs; off posts
 * nothing. `className` sets the row's layout.
 */
export function Switch({ label, description, className, id: idProp, ...props }: SwitchProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-row cursor-pointer items-start justify-between gap-4 py-2 text-base text-ink pointer-coarse:min-h-row-touch pointer-coarse:py-3',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-faint',
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{label}</span>
        {description ? (
          <span id={`${id}-description`} className="text-sm text-ink-muted">
            {description}
          </span>
        ) : null}
      </span>
      <span className="relative mt-px flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-describedby={description ? `${id}-description` : undefined}
          className={cn(
            'peer h-[18px] w-8 cursor-[inherit] appearance-none rounded-full bg-line-control',
            'transition-[background-color] duration-[var(--duration-quick)]',
            'checked:bg-accent disabled:bg-line-strong disabled:checked:bg-ink-faint',
          )}
          {...props}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 left-0.5 size-3.5 rounded-full bg-surface shadow-xs transition-transform duration-[var(--duration-quick)] peer-checked:translate-x-3.5"
        />
      </span>
    </label>
  );
}
