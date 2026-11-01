import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../cn';

/**
 * The button recipe of design system v3 section 8. Also styles a link that acts as a button:
 * `<Link className={buttonVariants({ variant: 'secondary' })}>`.
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-control border text-center font-medium',
    'transition-[color,background-color,border-color,transform] duration-[var(--duration-quick)]',
    'active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:active:scale-100',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        /** Staff: the screen's one main action. */
        primary:
          'border-transparent bg-accent text-on-accent shadow-xs hover:bg-accent-hover disabled:border-line disabled:bg-surface-sunken disabled:text-ink-faint disabled:shadow-none',
        /** Patient pages and the kiosk: the gold action. */
        patient:
          'border-transparent bg-brand text-on-brand shadow-xs hover:border-brand-deep disabled:border-line disabled:bg-surface-sunken disabled:text-ink-faint disabled:shadow-none',
        secondary:
          'border-line-strong bg-surface text-ink shadow-xs hover:border-line-control hover:bg-surface-hover disabled:border-line disabled:bg-surface-subtle disabled:text-ink-faint disabled:shadow-none',
        quiet:
          'border-transparent bg-transparent text-accent hover:bg-accent-soft disabled:text-ink-faint disabled:hover:bg-transparent',
        danger:
          'border-line-strong bg-surface text-danger shadow-xs hover:border-danger-line hover:bg-danger-soft disabled:border-line disabled:bg-surface-subtle disabled:text-ink-faint disabled:shadow-none',
        /** Only inside a confirm dialog, for the irreversible action. */
        'danger-fill':
          'border-transparent bg-danger-strong text-on-danger hover:bg-danger disabled:border-line disabled:bg-surface-sunken disabled:text-ink-faint',
      },
      size: {
        sm: 'h-7 px-2.5 text-sm pointer-coarse:h-row-touch',
        md: 'h-row px-3.5 text-base pointer-coarse:h-row-touch',
        /** Patient pages and the kiosk. */
        lg: 'h-target-patient px-6 text-md',
        /** Kiosk Yes and No. */
        answer: 'h-16 px-6 text-lg',
      },
      width: {
        auto: '',
        full: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', width: 'auto' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** While the action runs: disabled, with this fixed text instead of a spinner ("Saving"). */
  pending?: boolean;
  pendingText?: string;
}

/** A button; `type` defaults to "button" so it never submits a form by accident. */
export function Button({
  variant,
  size,
  width,
  pending = false,
  pendingText,
  className,
  type = 'button',
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(buttonVariants({ variant, size, width }), className)}
      {...props}
    >
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
