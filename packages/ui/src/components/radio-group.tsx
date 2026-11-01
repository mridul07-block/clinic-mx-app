import { useId, type ReactNode } from 'react';
import { cn } from '../cn';
import { describedBy, FieldError, FieldHelper } from './field';

export interface RadioOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** A second line under the label, in small muted text. */
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string = string> {
  /** The name the chosen value posts under. */
  name: string;
  /** The group's id; give one when an ErrorSummary links to this group. */
  id?: string;
  legend: ReactNode;
  /** Keeps the legend for screen readers only, when a heading beside it already says it. */
  hideLegend?: boolean;
  optional?: boolean;
  helper?: ReactNode;
  error?: ReactNode;
  options: readonly RadioOption<T>[];
  /** Controlled: the chosen value (null for none); pass `onChange` with it. */
  value?: T | null;
  /** Uncontrolled: the value chosen at first. */
  defaultValue?: T;
  onChange?: (value: T) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

/**
 * One of a few answers as large selectable rows (design system v3 ChoiceGroup): each option a
 * bordered row with a radio and its label; the chosen row sits on `accent-soft` with an accent
 * border. Browser radios underneath, so the chosen value posts under `name` with a plain form
 * before any JavaScript runs. Legend, helper and error are wired as in Field.
 */
export function RadioGroup<T extends string = string>({
  name,
  id: groupId,
  legend,
  hideLegend = false,
  optional = false,
  helper,
  error,
  options,
  value,
  defaultValue,
  onChange,
  disabled,
  required,
  className,
}: RadioGroupProps<T>) {
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
        {optional ? <span className="font-normal text-ink-muted"> (optional)</span> : null}
      </legend>
      <div className="flex flex-col gap-2">
        {options.map((option, index) => {
          const optionId = `${id}-${String(index)}`;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-control border border-line-strong bg-surface px-3 py-3 text-base text-ink shadow-xs',
                'transition-[background-color,border-color] duration-[var(--duration-quick)] hover:border-line-control hover:bg-surface-hover',
                'has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:hover:bg-accent-soft',
                'has-[:disabled]:cursor-not-allowed has-[:disabled]:border-line has-[:disabled]:bg-surface-subtle has-[:disabled]:text-ink-faint has-[:disabled]:shadow-none',
              )}
            >
              <span className="relative mt-0.5 flex size-4 shrink-0">
                <input
                  id={optionId}
                  type="radio"
                  name={name}
                  value={option.value}
                  required={required}
                  disabled={option.disabled}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={option.description ? `${optionId}-description` : undefined}
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
                  className={cn(
                    'peer size-4 cursor-[inherit] appearance-none rounded-full border border-line-control bg-surface',
                    'checked:border-accent checked:bg-accent aria-[invalid=true]:border-danger',
                    'disabled:border-line disabled:bg-surface-subtle disabled:checked:border-ink-faint disabled:checked:bg-ink-faint',
                  )}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 m-auto size-1.5 rounded-full bg-on-accent opacity-0 peer-checked:opacity-100"
                />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{option.label}</span>
                {option.description ? (
                  <span id={`${optionId}-description`} className="text-sm text-ink-muted">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {helper ? <FieldHelper id={`${id}-helper`}>{helper}</FieldHelper> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </fieldset>
  );
}
