'use client';

import { useEffect } from 'react';

/** How often the offline page checks whether the server answers again, once online. */
const RECHECK_MS = 3000;

// Primary button recipe from design system v2 section 8 (the Button component arrives with the
// screens that need it). When the connection returns the page reloads by itself: the staff page
// that was asked for opens, and it saves any drafts still waiting on the device (FND-08). The
// browser says "online" before the network always works, so the page first checks that the
// server answers, and keeps checking until it does.
export function ReloadButton() {
  useEffect(() => {
    // Read through a function: the page can be left while a check is waiting for the server.
    let stopped = false;
    const isStopped = () => stopped;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (isStopped()) return;
      try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        if (response.ok) {
          window.location.reload();
          return;
        }
      } catch {
        // Not reachable yet.
      }
      if (!isStopped() && navigator.onLine) timer = setTimeout(() => void check(), RECHECK_MS);
    };
    const online = () => {
      clearTimeout(timer);
      void check();
    };
    window.addEventListener('online', online);
    if (navigator.onLine) timer = setTimeout(() => void check(), RECHECK_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('online', online);
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
