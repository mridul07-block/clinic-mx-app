import { centreList } from '@clinic-mx/db';
import { buttonVariants } from '@clinic-mx/ui/components/button';
import { Page } from '@clinic-mx/ui/components/page';
import { StickyActions } from '@clinic-mx/ui/components/sticky-actions';
import { can, istDate, staffRoleLabels, todayFilters, type TodayFilter } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { loadCheckIn } from '../../../../../modules/front-desk/check-in';
import { ownOrigin } from '../../../../../lib/own-origin';
import { todayHref, type CheckInDone } from '../../../../../modules/front-desk/links';
import { loadToday } from '../../../../../modules/front-desk/today';
import { undeliveredFor } from '../../../../../modules/messaging/undelivered';
import { calendarHref } from '../../../../../modules/scheduling/links';
import { getSetting } from '../../../../../modules/settings/settings';
import { CheckInDrawer } from './check-in-drawer';
import { NotDelivered } from './not-delivered';
import { TodayBoard } from './today-board';
import { chosenCentreId } from '../../../../../modules/navigation/centres';

export const metadata: Metadata = { title: 'Today · Clinic Mx' };

const pillClass = 'rounded-control border px-3 py-1.5 text-sm pointer-coarse:py-2.5';

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
  // The address's centre, else the one chosen in the sidebar (UI-02), else the first.
  const chosen = await chosenCentreId(staff);
  const centre =
    centres.find((c) => c.id === params.centre) ??
    centres.find((c) => c.id === chosen) ??
    centres[0];
  const signedInAs = `Signed in as ${staff.name}, ${staffRoleLabels[staff.role]}`;
  if (!centre) {
    return (
      <Page width="full">
        <h1 className="text-title font-semibold">Today</h1>
        <p className="text-sm text-ink-muted">{signedInAs}</p>
        <FormMessage tone="info">There is no centre to show.</FormMessage>
      </Page>
    );
  }

  const [lateMinutes, refreshSeconds, maxReportMegabytes] = [
    await getSetting('day.running_late_minutes'),
    await getSetting('live.refresh_seconds'),
    await getSetting('reports.max_file_mb'),
  ];
  const date = istDate(new Date());
  const today = await loadToday(staff, { centreId: centre.id, date });
  // WA-13: WhatsApp messages Meta could not deliver, for the desk to call about.
  const undelivered = await undeliveredFor(staff, centre.id);
  const renderedAt = new Date().getTime();
  const show = todayFilters.find<TodayFilter>((f): f is TodayFilter => f === params.show);
  // The check in drawer (INT-02): the appointment named in the address, if this person sees it.
  const opened =
    params.appointment && /^[0-9a-f-]{36}$/i.test(params.appointment)
      ? await loadCheckIn(staff, params.appointment)
      : undefined;
  const doneOptions: CheckInDone[] = ['checked-in', 'undone', 'tablet', 'reports', 'assisted'];
  const done = doneOptions.find((d) => d === params.done);

  const actions = (
    <>
      {/* A walk in (INT-12): today's free starts, then book and check in in one action. */}
      <Link
        href={calendarHref({
          centreId: centre.id,
          date,
          newBooking: { on: date },
          walkIn: true,
        })}
        className={buttonVariants({ variant: 'secondary' })}
      >
        Walk in
      </Link>
      <Link
        href={calendarHref({ centreId: centre.id, date, newBooking: {} })}
        className={buttonVariants()}
      >
        New booking
      </Link>
    </>
  );

  return (
    <>
      <Page width="full" className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-title font-semibold">Today</h1>
            {/* Who is signed in stays on the screen: front desk computers are shared. */}
            <p className="text-sm text-ink-muted">
              {centre.name} · {signedInAs}
            </p>
            {/* OPS-05: the paper health form and consent, for launch week and outages. */}
            <a
              href={['/app/centres', centre.id, 'paper-forms'].join('/')}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center self-start text-sm text-ink-secondary underline underline-offset-2"
              data-testid="paper-forms"
            >
              Paper health form and consent (PDF)
            </a>
          </div>
          {/* The screen's actions: in the header from 768 px, pinned above the tabs on phones. */}
          <div className="hidden gap-2 md:flex">{actions}</div>
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
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : 'border-line-control text-ink-secondary hover:bg-surface-hover'
                }`}
              >
                {c.name}
              </Link>
            ))}
          </nav>
        ) : null}
        <NotDelivered messages={undelivered} centreId={centre.id} show={show} />
        <TodayBoard
          key={`${centre.id}:${date}:${today.version}:${show ?? ''}:${String(undelivered.length)}`}
          initial={today.appointments}
          version={today.version}
          renderedAt={renderedAt}
          centreId={centre.id}
          date={date}
          lateMinutes={lateMinutes}
          refreshSeconds={refreshSeconds}
          show={show}
          pricesPlans={can(staff, 'bills.view_amounts')}
          notDelivered={undelivered.map((message) => message.patientId)}
        />
        {/* Last in the page, so its spacer keeps the board's end clear of the pinned bar. */}
        <StickyActions className="flex-row md:hidden">{actions}</StickyActions>
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
      </Page>
    </>
  );
}
