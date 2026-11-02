import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The theme's own names (theme.css), so tailwind-merge knows `text-title` is a size and
 * `text-ink` a colour. Without them it would read every unknown `text-*` as a colour and drop
 * one of `text-title text-ink`. cn.test.ts checks these lists against theme.css.
 */
export const themeColours = [
  'canvas', 'surface', 'surface-subtle', 'surface-hover', 'surface-sunken', 'line', 'line-strong',
  'line-control', 'ink', 'ink-secondary', 'ink-muted', 'ink-faint', 'brand', 'brand-deep',
  'on-brand', 'accent', 'accent-hover', 'accent-soft', 'on-accent', 'focus', 'info', 'info-soft',
  'info-line', 'waiting', 'waiting-soft', 'waiting-line', 'waiting-strong', 'active',
  'active-soft', 'active-line', 'done', 'done-soft', 'done-line', 'danger', 'danger-soft',
  'danger-line', 'danger-strong', 'on-danger', 'warning', 'warning-soft', 'scrim', 'viz-1',
  'viz-compare', 'viz-target', 'viz-centre-1', 'viz-centre-2', 'viz-centre-3', 'viz-promoter',
  'viz-passive', 'viz-detractor', 'viz-ramp-1', 'viz-ramp-2', 'viz-ramp-3', 'viz-ramp-4',
  'viz-ramp-5', 'viz-ramp-6', 'viz-ramp-7',
]; // prettier-ignore
export const themeTextSizes = ['axis', 'sm', 'base', 'md', 'lg', 'xl', '2xl', 'title', 'display'];
export const themeRadii = ['control', 'tag', 'panel', 'sheet', 'drawer'];
export const themeShadows = ['xs', 'float', 'drawer'];

const merge = extendTailwindMerge({
  override: {
    theme: {
      color: themeColours,
      text: themeTextSizes,
      radius: themeRadii,
      shadow: themeShadows,
    },
  },
});

/** Joins class names, dropping falsy parts; a later class wins over one it conflicts with. */
export function cn(...parts: ClassValue[]): string {
  return merge(clsx(parts));
}
