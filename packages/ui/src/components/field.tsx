import { CircleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '../cn';

/** What a Field hands its control: spread it onto the Input, Textarea or Select. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/** Helper text under a label or legend, in small muted text. */
export function FieldHelper({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm text-ink-muted">
      {children}
    </p>
  );
}

/** An error under a control, in the danger tone with an icon; screen readers hear "Error:". */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-danger">
      <CircleAlert aria-hidden strokeWidth={1.75} className="mt-px size-4 shrink-0" />
      <span>
        <span className="sr-only">Error: </span>
        {children}
      </span>
    </p>
  );
}

/** The ids of a helper and an error that are shown, for `aria-describedby`. */
export function describedBy(id: string, helper: ReactNode, error: ReactNode): string | undefined {
  const ids = [helper ? `${id}-helper` : '', error ? `${id}-error` : ''].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export interface FieldProps {
  label: ReactNode;
  /** Says "(optional)" after the label; required fields are not starred. */
  optional?: boolean;
  helper?: ReactNode;
  /** Shown when the form is sent, never while typing. */
  error?: ReactNode;
  /** The control's id; give one when an ErrorSummary links to this field. */
  id?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Design system v3 Field: the label above (14 px, 500), helper text below, then the error. The
 * control comes from a render function so the ids, `aria-describedby` and `aria-invalid` are
 * wired for it: `<Field label="Email">{(control) => <Input {...control} name="email" />}</Field>`.
 */
export function Field({
  label,
  optional = false,
  helper,
  error,
  id: idProp,
  className,
  children,
}: FieldProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const control: FieldControlProps = { id };
  const described = describedBy(id, helper, error);
  if (described) control['aria-describedby'] = described;
  if (error) control['aria-invalid'] = true;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-base font-medium text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-muted"> (optional)</span> : null}
      </label>
      {children(control)}
      {helper ? <FieldHelper id={`${id}-helper`}>{helper}</FieldHelper> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

export interface ErrorSummaryProps {
  /** Each error with the id of the control it belongs to, in the order of the form. */
  errors: readonly { fieldId: string; message: ReactNode }[];
  title?: string;
  className?: string;
}

/**
 * The error summary at the top of a form with more than one error (NHS pattern): "There is a
 * problem" and a link to each field. Renders nothing when there are no errors.
 */
export function ErrorSummary({
  errors,
  title = 'There is a problem',
  className,
}: ErrorSummaryProps) {
  const headingId = useId();
  if (errors.length === 0) return null;
  return (
    <div
      role="alert"
      aria-labelledby={headingId}
      tabIndex={-1}
      className={cn(
        'flex flex-col gap-2 rounded-control border border-danger-line bg-danger-soft px-4 py-3',
        className,
      )}
    >
      <h2 id={headingId} className="flex items-center gap-2 text-md font-semibold text-ink">
        <CircleAlert aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-danger" />
        {title}
      </h2>
      <ul className="flex flex-col gap-1">
        {errors.map((error) => (
          <li key={error.fieldId}>
            <a
              href={`#${error.fieldId}`}
              className="font-medium text-danger underline underline-offset-2 hover:no-underline"
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
