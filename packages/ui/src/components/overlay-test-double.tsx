import { createElement, type ReactNode } from 'react';

/*
 * For tests only. Base UI renders a dialog's popup in a portal after mounting, so server markup
 * (renderToStaticMarkup, the kit's tests) never shows it. A test swaps Base UI's Dialog or
 * AlertDialog for these plain parts with vi.mock, so it can read how a component fills them:
 * classes, titles, the footer, which part takes focus first.
 */

interface PartProps {
  children?: ReactNode;
  className?: unknown;
  initialFocus?: unknown;
  [key: string]: unknown;
}

const passedThrough = /^(aria-|data-)|^(id|disabled)$/;

function part(name: string, tag = 'div') {
  return function Part({ children, className, initialFocus, ...rest }: PartProps) {
    const attributes: Record<string, unknown> = {
      'data-part': name,
      className: typeof className === 'string' ? className : undefined,
    };
    if (initialFocus) attributes['data-initial-focus'] = '';
    for (const [key, value] of Object.entries(rest)) {
      if (passedThrough.test(key)) attributes[key] = value;
    }
    return createElement(tag, attributes, children);
  };
}

/** Base UI's Dialog (and AlertDialog) parts as plain elements; Root shows its children when open. */
export function dialogDouble() {
  return {
    Root({ open, defaultOpen, modal, children }: PartProps) {
      if (!(open ?? defaultOpen)) return null;
      return createElement(
        'div',
        { 'data-part': 'root', 'data-modal': modal === false ? 'false' : 'true' },
        children,
      );
    },
    Trigger: part('trigger', 'button'),
    Portal: part('portal'),
    Backdrop: part('backdrop'),
    Popup: part('popup'),
    Title: part('title', 'h2'),
    Description: part('description', 'p'),
    Close: part('close', 'button'),
  };
}
