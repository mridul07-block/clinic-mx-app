import { Check } from 'lucide-react';
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  /** A second line under the label, in small muted text. */
  description?: ReactNode;
}

/**
 * A checkbox with its label (design system v3 section 8): a 16 px box with a 4 px radius,
 * checked in the teal accent with a white tick, and the whole label row as the target (36 px,
 * 44 on touch). It is the browser's own checkbox, styled, so it posts `value` (or "on") under
 * `name` with a plain form before any JavaScript runs; Base UI's renders a span that needs
 * JavaScript first. An unticked box posts nothing. `className` sets the row's layout.
 */
export function Checkbox({ label, description, className, id: idProp, ...props }: CheckboxProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-row cursor-pointer items-start gap-2.5 py-2 text-base text-ink pointer-coarse:min-h-row-touch pointer-coarse:py-3',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:text-ink-faint',
        className,
      )}
    >
      <span className="relative mt-0.5 flex size-4 shrink-0">
        <input
          id={id}
          type="checkbox"
          aria-describedby={description ? `${id}-description` : undefined}
          className={cn(
            'peer size-4 cursor-[inherit] appearance-none rounded-[4px] border border-line-control bg-surface shadow-xs',
            'transition-[background-color,border-color] duration-[var(--duration-quick)]',
            'checked:border-accent checked:bg-accent aria-[invalid=true]:border-danger',
            'disabled:border-line disabled:bg-surface-subtle disabled:shadow-none disabled:checked:border-ink-faint disabled:checked:bg-ink-faint',
          )}
          {...props}
        />
        <Check
          aria-hidden
          strokeWidth={1.75}
          className="pointer-events-none absolute inset-0 size-4 text-on-accent opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{label}</span>
        {description ? (
          <span id={`${id}-description`} className="text-sm text-ink-muted">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
