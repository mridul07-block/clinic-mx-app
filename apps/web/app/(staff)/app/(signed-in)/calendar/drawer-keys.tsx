'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Esc closes the drawer, as its Close link does. */
export function DrawerKeys({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') router.push(closeHref, { scroll: false });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [closeHref, router]);
  return null;
}
