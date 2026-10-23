import { centreList } from '@clinic-mx/db';
import { istDate, staffRoleLabels, todayFilters, type TodayFilter } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { EmergencyAlert } from '../../../../../components/emergency-banner';
import { EmergencyBanner } from '../../../../../components/emergency-banner';
import { FormMessage, primaryButtonClass } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { loadCheckIn } from '../../../../../modules/front-desk/check-in';
import { ownOrigin } from '../../../../../lib/own-origin';
import { todayHref, type CheckInDone } from '../../../../../modules/front-desk/links';
import { loadToday } from '../../../../../modules/front-desk/today';
import { calendarHref } from '../../../../../modules/scheduling/links';
import { getSetting } from '../../../../../modules/settings/settings';
import { CheckInDrawer } from './check-in-drawer';
import { TodayBoard } from './today-board';

export const metadata: Metadata = { title: 'Today · Clinic Mx' };

const pillClass = 'rounded-control border px-3 py-1.5 text-sm pointer-coarse:py-2.5';
const linkClass = 'text-sm text-ink-secondary underline underline-offset-2';

// The front desk Today board (INT-01, Frontend Specification "Front Desk": the Front Desk's home).
// Count chips filter To arrive, Here now, With physio, Done and Not confirmed; rows by time with
// status tags and waiting time; Check in in one tap, undone the same day (user decisions 23
// October 2026). For those who check in: the Super Admin, Centre Managers and the Front Desk.
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{
    centre?: string;
    show?: string;
    appointment?: string;
    qr?: string;
    done?: string;
  }>;
}) {
  const staff = await requirePermission('check_in.manage');
  const params = await searchParams;
  const centres = (await asStaff(staff, (tx) => centreList(tx))).filter(
    (c) => c.active && (staff.role === 'super_admin' || staff.centreIds.includes(c.id)),
  );
  const centre = centres.find((c) => c.id === params.centre) ?? centres[0];
  const signedInAs = `Signed in as ${staff.name}, ${staffRoleLabels[staff.role]}`;
  if (!centre) {
    return (
      <main className="flex flex-col gap-4 px-4 py-6">
        <Link href="/app" className={linkClass}>
          Home
        </Link>
        <h1 className="text-title font-semibold">Today</h1>
        <p className="text-sm text-ink-muted">{signedInAs}</p>
        <FormMessage tone="info">There is no centre to show.</FormMessage>
      </main>
    );
  }

  const [lateMinutes, refreshSeconds, maxReportMegabytes] = [
    await getSetting('day.running_late_minutes'),
    await getSetting('live.refresh_seconds'),
    await getSetting('reports.max_file_mb'),
  ];
  const date = istDate(new Date());
  const today = await loadToday(staff, { centreId: centre.id, date });
  const renderedAt = new Date().getTime();
  const show = todayFilters.find<TodayFilter>((f): f is TodayFilter => f === params.show);
  // The check in drawer (INT-02): the appointment named in the address, if this person sees it.
  const opened =
    params.appointment && /^[0-9a-f-]{36}$/i.test(params.appointment)
      ? await loadCheckIn(staff, params.appointment)
      : undefined;
  const doneOptions: CheckInDone[] = ['checked-in', 'undone', 'tablet', 'reports'];
  const done = doneOptions.find((d) => d === params.done);
  // The emergency banner's place: open emergency alerts at the centre come with red flag alerts
  // (INT-10); until then there are none to show.
  const emergencies: EmergencyAlert[] = [];

  return (
    <>
      {emergencies.map((alert) => (
        <EmergencyBanner key={alert.id} alert={alert} />
      ))}
      <main className="flex w-full flex-col gap-4 px-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <nav aria-label="Go to" className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/app" className={linkClass}>
                Home
              </Link>
              <Link href={calendarHref({ centreId: centre.id, date })} className={linkClass}>
                Calendar
              </Link>
              <Link href="/app/patients" className={linkClass}>
                Patients
              </Link>
            </nav>
            <h1 className="text-title font-semibold">Today</h1>
            <p className="text-sm text-ink-muted">
              {centre.name} · {signedInAs}
            </p>
          </div>
          <Link
            href={calendarHref({ centreId: centre.id, date, newBooking: {} })}
            className={`${primaryButtonClass} sm:w-auto`}
          >
            New booking
          </Link>
        </div>
        {centres.length > 1 ? (
          <nav aria-label="Centre" className="flex flex-wrap gap-2">
            {centres.map((c) => (
              <Link
                key={c.id}
                href={todayHref({ centreId: c.id })}
                aria-current={c.id === centre.id ? 'page' : undefined}
                className={`${pillClass} ${
                  c.id === centre.id
                    ? 'border-ink bg-surface font-medium text-ink'
                    : 'border-line-control text-ink-secondary'
                }`}
              >
                {c.name}
              </Link>
            ))}
          </nav>
        ) : null}
        <TodayBoard
          key={`${centre.id}:${date}:${today.version}:${show ?? ''}`}
          initial={today.appointments}
          version={today.version}
          renderedAt={renderedAt}
          centreId={centre.id}
          date={date}
          lateMinutes={lateMinutes}
          refreshSeconds={refreshSeconds}
          show={show}
        />
        {opened ? (
          <CheckInDrawer
            view={opened}
            place={{ appointmentId: opened.appointment.id, centreId: centre.id, show }}
            origin={await ownOrigin()}
            showQr={params.qr === '1'}
            done={done}
            closeHref={todayHref({ centreId: centre.id, show })}
            maxReportMegabytes={maxReportMegabytes}
          />
        ) : null}
      </main>
    </>
  );
}
