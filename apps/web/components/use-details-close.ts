'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * A ref for a `<details>` menu that closes on Escape (focus back on its summary), a click or focus
 * elsewhere, or moving to another screen (UI-02, UI-03). Escape inside an open dialog is the
 * dialog's.
 */
export function useDetailsClose() {
  const menu = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const close = (event: Event) => {
      const details = menu.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
        details.open = false;
        details.querySelector('summary')?.focus();
        return;
      }
      if (!details.contains(event.target as Node)) details.open = false;
    };
    const left = (event: FocusEvent) => {
      const details = menu.current;
      if (details?.open && !details.contains(event.relatedTarget as Node | null)) {
        details.open = false;
      }
    };
    const details = menu.current;
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    details?.addEventListener('focusout', left);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
      details?.removeEventListener('focusout', left);
    };
  }, []);

  return menu;
}
