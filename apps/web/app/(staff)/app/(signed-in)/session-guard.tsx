'use client';

import type { DeviceClass } from '@clinic-mx/schemas';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition, type RefObject } from 'react';
import { primaryButtonClass } from '../../../../components/forms';
import { draftSavers } from '../../../../lib/drafts/savers';
import { flushDrafts } from '../../../../lib/drafts/sync';
import { useDraftScope } from '../../../../lib/drafts/use-autosave';
import { signOutIdle } from '../../../../modules/auth/actions';

/** How often an open page asks whether its session is still signed in. */
const CHECK_EVERY_MS = 60_000;
/** How often, at most, an active desktop tells the server it is in use. */
const PING_EVERY_MS = 60_000;
/** How long before the idle sign out the warning shows. */
const WARN_MS = 60_000;
/** Shared by every tab, so activity in one keeps the others signed in. */
const ACTIVITY_KEY = 'clinic.lastActivity';

const readSharedActivity = () => {
  try {
    return Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
  } catch {
    return 0;
  }
};
const writeSharedActivity = (at: number) => {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(at));
  } catch {
    // Storage blocked: this tab still counts its own activity.
  }
};

/**
 * Session rules on open pages (IAM-07): every device asks every minute whether it is still
 * signed in, so a deactivation or an end date reaches an open screen at once; desktops also sign
 * out after the idle minutes, with a warning first.
 */
export function SessionGuard({
  device,
  idleMinutes,
}: {
  device: DeviceClass;
  idleMinutes: number;
}) {
  // Set once this page is on its way to sign in, so the idle sign out and the session check never
  // both send it there (the idle one says why).
  const leaving = useRef(false);
  useSessionWatch(leaving);
  return device === 'desktop' ? <IdleLogout idleMinutes={idleMinutes} leaving={leaving} /> : null;
}

function useSessionWatch(leaving: RefObject<boolean>) {
  const router = useRouter();
  useEffect(() => {
    // Read through a function: the idle sign out can set it while a check is waiting.
    const isLeaving = () => leaving.current;
    const check = async () => {
      if (isLeaving() || document.visibilityState !== 'visible' || !navigator.onLine) return;
      let response: Response;
      try {
        response = await fetch('/app/session', { cache: 'no-store' });
      } catch {
        return; // No connection: ask again next time.
      }
      if (response.status !== 401 || isLeaving()) return;
      leaving.current = true;
      const body = (await response.json().catch(() => ({}))) as { reason?: string };
      const reason = body.reason === 'idle' || body.reason === 'expired' ? body.reason : 'ended';
      router.replace(`/app/sign-in?reason=${reason}`);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [leaving, router]);
}

const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

function IdleLogout({
  idleMinutes,
  leaving,
}: {
  idleMinutes: number;
  leaving: RefObject<boolean>;
}) {
  const scope = useDraftScope();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const lastActivity = useRef(0);
  const lastPing = useRef(0);
  const signingOut = useRef(false);

  const markActive = useCallback((force = false) => {
    const now = Date.now();
    // Pointer moves come in streams; once a second is enough.
    if (!force && now - lastActivity.current < 1000) return;
    lastActivity.current = now;
    writeSharedActivity(now);
    if (force || now - lastPing.current >= PING_EVERY_MS) {
      lastPing.current = now;
      void fetch('/app/session', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    // Loading the page was activity, and the server has just seen it.
    const loadedAt = Date.now();
    lastActivity.current = loadedAt;
    lastPing.current = loadedAt;
    writeSharedActivity(loadedAt);

    const idleMs = idleMinutes * 60_000;
    const onActivity = () => {
      markActive();
    };
    const tick = () => {
      const last = Math.max(lastActivity.current, readSharedActivity());
      const left = idleMs - (Date.now() - last);
      if (left > 0) {
        setSecondsLeft(left <= WARN_MS ? Math.ceil(left / 1000) : null);
        return;
      }
      if (signingOut.current) return;
      signingOut.current = true;
      leaving.current = true;
      // Decision 22 October 2026: drafts are saved if possible and the rest kept for this person.
      startTransition(async () => {
        if (navigator.onLine) await flushDrafts(scope, draftSavers).catch(() => undefined);
        await signOutIdle();
      });
    };
    for (const name of activityEvents) window.addEventListener(name, onActivity, { passive: true });
    const timer = window.setInterval(tick, 1000);
    return () => {
      for (const name of activityEvents) window.removeEventListener(name, onActivity);
      window.clearInterval(timer);
    };
  }, [idleMinutes, leaving, markActive, scope]);

  if (secondsLeft === null) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-signin flex-col gap-3 rounded-panel border border-waiting-line bg-waiting-soft p-4 shadow-float"
    >
      <p className="text-ink">
        You will be signed out in {secondsLeft} seconds because there has been no activity.
      </p>
      <button
        type="button"
        onClick={() => {
          markActive(true);
          setSecondsLeft(null);
        }}
        className={primaryButtonClass}
      >
        Stay signed in
      </button>
    </div>
  );
}
