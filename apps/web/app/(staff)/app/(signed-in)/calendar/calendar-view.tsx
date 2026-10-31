'use client';

import type { CalendarDay } from '@clinic-mx/db';
import { useEffect, useRef, useState } from 'react';
import { LIVE_HEADER } from '../../../../../lib/live';
import { AgendaList } from './agenda-list';
import { DayGrid } from './day-grid';
import { reviveDay, type CalendarDayJson } from './links';
import { scheduleLiveChecks } from '../../../../../lib/live-relay';
import { useLiveRelay } from '../../../../../lib/live-relay-context';

/**
 * The live calendar (SCH-05): the day as the server drew it, then checked every
 * `live.refresh_seconds` (user decision 22 October 2026: every 3 seconds until the realtime relay,
 * FND-09). Only a changed day is sent back. The check is never activity for the idle sign out.
 * The page gives it a new key for another day, centre or a changed day, so it starts afresh.
 * "Live, updated n s ago", or "Not updated for n s" in amber while checks fail. Phones get the
 * agenda and wider screens the grid (SCH-06), both from the same live day.
 */
export function CalendarView({
  initial,
  version,
  renderedAt,
  centreId,
  date,
  step,
  lateMinutes,
  refreshSeconds,
  physioId,
  selectedAppointment,
}: {
  initial: CalendarDay;
  version: string;
  renderedAt: number;
  centreId: string;
  date: string;
  step: number;
  lateMinutes: number;
  refreshSeconds: number;
  physioId?: string;
  selectedAppointment?: string;
}) {
  const [day, setDay] = useState(initial);
  const [checkedAt, setCheckedAt] = useState(renderedAt);
  const [failing, setFailing] = useState(false);
  const [now, setNow] = useState(renderedAt);
  const current = useRef(version);

  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, []);

  const { relay, connectedSeconds } = useLiveRelay();

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const query = new URLSearchParams({ centre: centreId, date, since: current.current });
        const response = await fetch(`/app/calendar/live?${query.toString()}`, {
          headers: { [LIVE_HEADER]: '1' },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`live check ${String(response.status)}`);
        const answer = (await response.json()) as { version: string; day?: CalendarDayJson };
        if (stopped) return;
        if (answer.day) {
          setDay(reviveDay(answer.day));
          current.current = answer.version;
        }
        setCheckedAt(Date.now());
        setFailing(false);
      } catch {
        if (!stopped) setFailing(true);
      }
    };
    // FND-09: at once when the realtime relay says this centre changed; on its own otherwise.
    const stop = scheduleLiveChecks(relay, check, {
      refreshSeconds,
      connectedSeconds,
      centres: [centreId],
    });
    return () => {
      stopped = true;
      stop();
    };
  }, [centreId, date, refreshSeconds, relay, connectedSeconds]);

  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  return (
    <div className="flex flex-col gap-3">
      <p
        data-testid="live-status"
        className={`text-sm ${failing ? 'text-waiting-strong' : 'text-ink-muted'}`}
      >
        {failing
          ? `Not updated for ${String(seconds)} s. Checking again.`
          : `Live, updated ${String(seconds)} s ago`}
      </p>
      <div className="md:hidden">
        <AgendaList
          day={day}
          centreId={centreId}
          date={date}
          physioId={physioId}
          step={step}
          now={now}
          lateMinutes={lateMinutes}
          selectedAppointment={selectedAppointment}
        />
      </div>
      <div className="hidden md:block">
        <DayGrid
          day={day}
          centreId={centreId}
          date={date}
          step={step}
          now={now}
          lateMinutes={lateMinutes}
          selectedAppointment={selectedAppointment}
        />
      </div>
    </div>
  );
}
