import { useId, type ReactNode } from 'react';
import { cn } from '../cn';
import { describedBy, FieldError, FieldHelper } from './field';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  /** The name the chosen value posts under. */
  name: string;
  /** The group's id; give one when an ErrorSummary links to this group. */
  id?: string;
  legend: ReactNode;
  /** Keeps the legend for screen readers only, when a heading beside it already says it. */
  hideLegend?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  options: readonly SegmentedOption<T>[];
  /** Controlled: the chosen value (null for none); pass `onChange` with it. */
  value?: T | null;
  /** Uncontrolled: the value chosen at first; leave it out for no answer yet. */
  defaultValue?: T;
  onChange?: (value: T) => void;
  /** Read only: the chosen segment stays legible, nothing can be changed. */
  disabled?: boolean;
  required?: boolean;
  /** Layout only (width, margin). */
  className?: string;
  /** Layout of the segments' track, for a grid of many short options (times). */
  trackClassName?: string;
}

/**
 * One choice from a few short options, side by side on a sunken track (design system v3 Tabs,
 * segmented control): the chosen segment is a white pill with a `line` border and `shadow-xs`.
 * Browser radios underneath, so the choice posts under `name` with a plain form before any
 * JavaScript runs; segments wrap when they do not fit. 36 px high, 44 on touch.
 */
export function SegmentedControl<T extends string = string>({
  name,
  id: groupId,
  legend,
  hideLegend = false,
  helper,
  error,
  options,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  className,
  trackClassName,
}: SegmentedControlProps<T>) {
  const id = useId();
  return (
    <fieldset
      id={groupId}
      aria-describedby={describedBy(id, helper, error)}
      disabled={disabled}
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
    >
      <legend
        className={cn('mb-1.5 text-base font-medium text-ink', hideLegend ? 'sr-only' : null)}
      >
        {legend}
      </legend>
      <div
        className={cn(
          'flex min-h-row flex-wrap gap-0.5 rounded-control border border-line bg-surface-sunken p-0.5 pointer-coarse:min-h-row-touch',
          error ? 'border-danger' : null,
          trackClassName,
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex min-h-8 flex-auto cursor-pointer items-center justify-center rounded-[6px] border border-transparent px-3 text-base font-medium text-ink-muted pointer-coarse:min-h-10',
              'transition-[color,background-color,border-color] duration-[var(--duration-quick)] hover:text-ink',
              'has-[:checked]:border-line has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-xs',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
              'has-[:disabled]:cursor-not-allowed has-[:disabled:not(:checked)]:text-ink-faint has-[:disabled:not(:checked)]:hover:text-ink-faint',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              required={required}
              disabled={option.disabled}
              aria-invalid={error ? true : undefined}
              className="sr-only"
              {...(value === undefined
                ? { defaultChecked: defaultValue === option.value }
                : { checked: value === option.value })}
              onChange={
                onChange
                  ? () => {
                      onChange(option.value);
                    }
                  : undefined
              }
            />
            {option.label}
          </label>
        ))}
      </div>
      {helper ? <FieldHelper id={`${id}-helper`}>{helper}</FieldHelper> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </fieldset>
  );
}
