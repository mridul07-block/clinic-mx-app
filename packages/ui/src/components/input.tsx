import { cva, type VariantProps } from 'class-variance-authority';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../cn';

/**
 * The look every text control shares (design system v3 section 8, Inputs): full width, 1 px
 * `line-control` border, white, a hairline shadow, ink text and faint placeholders; the border
 * darkens on hover, turns danger when `aria-invalid`, and goes quiet when disabled. On touch
 * screens base.css raises the text to 16 px so iOS does not zoom.
 */
export const controlClass = [
  'w-full min-w-0 rounded-control border border-line-control bg-surface text-base text-ink shadow-xs',
  'transition-[border-color] duration-[var(--duration-quick)]',
  'placeholder:text-ink-faint hover:border-ink-muted',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:hover:border-danger',
  'disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-subtle disabled:text-ink-faint disabled:shadow-none disabled:hover:border-line',
].join(' ');

export const inputVariants = cva([controlClass, 'px-3'], {
  variants: {
    size: {
      default: 'h-row pointer-coarse:h-row-touch',
      /** The one figure that is the point of a screen: 48 px, 22 px semibold tabular. */
      large: 'h-12 text-xl font-semibold tabular-nums',
    },
  },
  defaultVariants: { size: 'default' },
});

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, VariantProps<typeof inputVariants> {}

/**
 * A text input, 36 px (44 on touch). Give it the right `inputMode` and `autoComplete` (mobile
 * numbers `tel`, amounts `decimal`); wrap it in a Field for its label.
 */
export function Input({ size, className, type = 'text', ...props }: InputProps) {
  return <input type={type} className={cn(inputVariants({ size }), className)} {...props} />;
}

/** A longer text with the Input's look, three rows by default. */
export function Textarea({
  className,
  rows = 3,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={cn(controlClass, 'min-h-20 px-3 py-2', className)}
      {...props}
    />
  );
}
