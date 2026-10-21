import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

/**
 * Form pieces for the staff voice (design system v2: Button, Input, Field). Controls are 36 px
 * with a mouse and 44 px on touch screens.
 */

export const primaryButtonClass =
  'inline-flex h-row w-full items-center justify-center gap-2 rounded-control border border-transparent bg-accent px-3.5 font-medium text-on-accent shadow-xs transition-colors duration-[var(--duration-quick)] hover:bg-accent-hover disabled:border-line disabled:bg-surface-sunken disabled:text-ink-faint disabled:shadow-none pointer-coarse:h-row-touch';

export const secondaryButtonClass =
  'inline-flex h-row w-full items-center justify-center gap-2 rounded-control border border-line-control bg-surface px-3.5 font-medium text-ink shadow-xs transition-colors duration-[var(--duration-quick)] hover:bg-surface-hover disabled:text-ink-faint disabled:shadow-none pointer-coarse:h-row-touch';

export const dangerButtonClass =
  'inline-flex h-row w-full items-center justify-center gap-2 rounded-control border border-danger-line bg-surface px-3.5 font-medium text-danger shadow-xs transition-colors duration-[var(--duration-quick)] hover:bg-danger-soft disabled:text-ink-faint disabled:shadow-none pointer-coarse:h-row-touch';

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
