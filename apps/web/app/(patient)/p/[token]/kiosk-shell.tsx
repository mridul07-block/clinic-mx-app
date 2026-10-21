'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { resetKioskAction } from '../../../../modules/kiosk/actions';

/** What counts as someone using the tablet. */
const ACTIVITY = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'input'] as const;

/**
 * A patient page on the clinic tablet (IAM-10, Frontend Specification section 7). It goes back to
 * the welcome screen, taking the form off the tablet:
 * - while the form is open, after `resetAfterSeconds` with nobody touching it (kiosk.idle_seconds);
 * - once it is sent, or cannot be opened, after `resetAfterSeconds` (kiosk.thank_you_seconds).
 * The welcome screen replaces this page, so Back cannot bring the form back, and the server no
 * longer opens it on this tablet.
 */
export function KioskShell({
  token,
  resetAfterSeconds,
  resetOnIdle,
  children,
}: {
  token: string;
  resetAfterSeconds: number;
  /** Count from the last touch (an open form) rather than from the page opening. */
  resetOnIdle: boolean;
  children: ReactNode;
}) {
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = async () => {
      if (shell.current) shell.current.dataset.kiosk = 'resetting';
      try {
        await resetKioskAction(token);
      } finally {
        window.location.replace('/kiosk');
      }
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void reset(), resetAfterSeconds * 1000);
    };
    arm();
    if (resetOnIdle) {
      for (const event of ACTIVITY)
        window.addEventListener(event, arm, { capture: true, passive: true });
    }
    if (shell.current) shell.current.dataset.kiosk = 'armed';
    return () => {
      clearTimeout(timer);
      for (const event of ACTIVITY) window.removeEventListener(event, arm, { capture: true });
    };
  }, [token, resetAfterSeconds, resetOnIdle]);

  // data-kiosk says where the shell is: "starting" until the timer runs (the page is shown before
  // its script), "armed", then "resetting" from the moment the reset begins.
  return (
    <div ref={shell} data-kiosk="starting">
      {children}
    </div>
  );
}
