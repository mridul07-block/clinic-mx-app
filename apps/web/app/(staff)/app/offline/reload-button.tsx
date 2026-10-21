'use client';

import { useEffect } from 'react';

// Primary button recipe from design system v2 section 8 (the Button component arrives with the
// screens that need it). When the connection returns the page reloads by itself: the staff page
// that was asked for opens, and it saves any drafts still waiting on the device (FND-08).
export function ReloadButton() {
  useEffect(() => {
    const reload = () => {
      window.location.reload();
    };
    window.addEventListener('online', reload);
    return () => {
      window.removeEventListener('online', reload);
    };
  }, []);
  return (
    <button
      type="button"
      onClick={() => {
        window.location.reload();
      }}
      className="inline-flex h-row items-center justify-center rounded-control border border-transparent bg-accent px-3.5 font-medium text-on-accent shadow-xs transition-colors duration-[var(--duration-quick)] hover:bg-accent-hover pointer-coarse:h-row-touch"
    >
      Try again
    </button>
  );
}
