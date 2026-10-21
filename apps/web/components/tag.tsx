import type { Tone } from '@clinic-mx/ui';
import type { ReactNode } from 'react';

// Status tags (design system v2 section 2.3): a tint, strong text and a same-hue border, always
// with a word, so colour is never the only signal.
const toneClass: Record<Tone, string> = {
  neutral: 'border-line bg-surface-sunken text-ink-secondary',
  outline: 'border-line-strong bg-surface text-ink-secondary',
  info: 'border-info-line bg-info-soft text-info',
  waiting: 'border-waiting-line bg-waiting-soft text-waiting-strong',
  active: 'border-active-line bg-active-soft text-active',
  done: 'border-done-line bg-done-soft text-done',
  danger: 'border-danger-line bg-danger-soft text-danger-strong',
};

export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-tag border px-2 py-0.5 text-sm font-medium',
        toneClass[tone],
      ].join(' ')}
    >
      {children}
    </span>
  );
}
