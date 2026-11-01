import { cn } from '../cn';

export type AvatarSize = 24 | 32 | 48;

const sizeClass: Record<AvatarSize, string> = {
  24: 'size-6 text-[0.625rem]',
  32: 'size-8 text-xs',
  48: 'size-12 text-md',
};

/** Up to two initials: the first letters of the first and last words. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export interface AvatarProps {
  name: string;
  size?: AvatarSize;
  /** Beside the person's written name (the usual case) it is hidden from screen readers; set
   * false when it stands alone, so it is read as the name. */
  decorative?: boolean;
  className?: string;
}

/** A person as initials on a sunken circle (design system v3 section 8), 24, 32 or 48 px. */
export function Avatar({ name, size = 32, decorative = true, className }: AvatarProps) {
  return (
    <span
      aria-hidden={decorative || undefined}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-surface-sunken font-semibold text-ink-secondary select-none',
        sizeClass[size],
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
