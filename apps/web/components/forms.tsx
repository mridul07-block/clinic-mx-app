import { buttonVariants } from '@clinic-mx/ui/components/button';
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * Form pieces for the staff voice (design system v3: Input, Field). Controls are 36 px with a
 * mouse and 44 px on touch screens. The button class strings now come from the kit's Button
 * (packages/ui, UIX-06), full width as before; screens move to <Button> itself as the redesign
 * reaches them, and these go when none is left (UIX-26).
 */

export const primaryButtonClass = buttonVariants({ width: 'full' });

export const secondaryButtonClass = buttonVariants({ variant: 'secondary', width: 'full' });

export const dangerButtonClass = buttonVariants({ variant: 'danger', width: 'full' });

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  helper?: ReactNode;
  error?: string;
}

/** Label above, helper below in muted text, the error below the helper. */
export function TextField({ label, name, helper, error, ...input }: TextFieldProps) {
  const id = useId();
  const described = [helper ? `${id}-helper` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className="h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs placeholder:text-ink-faint hover:border-ink-muted aria-invalid:border-danger pointer-coarse:h-row-touch"
        {...input}
      />
      {helper ? (
        <p id={`${id}-helper`} className="text-sm text-ink-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  name: string;
  helper?: ReactNode;
  error?: string;
}

/** A longer text: label above, helper below in muted text, the error below the helper. */
export function TextAreaField({ label, name, helper, error, ...textarea }: TextAreaFieldProps) {
  const id = useId();
  const described = [helper ? `${id}-helper` : '', error ? `${id}-error` : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-ink">
        {label}
      </label>
      <textarea
        id={id}
        name={name}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        className="w-full rounded-control border border-line-control bg-surface px-3 py-2 text-ink shadow-xs placeholder:text-ink-faint hover:border-ink-muted aria-invalid:border-danger"
        {...textarea}
      />
      {helper ? (
        <p id={`${id}-helper`} className="text-sm text-ink-muted">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A message for the whole form: an error in the danger tone, or a notice. */
export function FormMessage({ tone, children }: { tone: 'danger' | 'info'; children: ReactNode }) {
  return tone === 'danger' ? (
    <p
      role="alert"
      className="rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-danger"
    >
      {children}
    </p>
  ) : (
    <p
      role="status"
      className="rounded-control border border-info-line bg-info-soft px-3 py-2 text-info"
    >
      {children}
    </p>
  );
}
