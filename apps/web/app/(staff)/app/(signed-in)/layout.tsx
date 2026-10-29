import { activeGrant } from '@clinic-mx/db';
import {
  accessScope,
  formatIstDateTime,
  navigationFor,
  phoneTabsFor,
  staffRoleLabels,
} from '@clinic-mx/schemas';
import { cookies } from 'next/headers';
import { Suspense, type ReactNode } from 'react';
import { CentreSwitcher } from '../../../../components/centre-switcher';
import { EmergencyBanner } from '../../../../components/emergency-banner';
import { NavShell } from '../../../../components/nav-shell';
import { PersonMenu } from '../../../../components/person-menu';
import { PhoneTabBar } from '../../../../components/phone-tab-bar';
import { DraftSync } from '../../../../lib/drafts/draft-sync';
import { DEVICE_COOKIE, readDevice } from '../../../../lib/session-cookies';
import { asStaff } from '../../../../modules/access/staff-db';
import { StaffProvider } from '../../../../lib/staff-context';
import { emergencyBannersOf } from '../../../../modules/alerts/services';
import { requireStaff } from '../../../../modules/auth/session';
import { unreadNotifications } from '../../../../modules/notifications/services';
import { chosenCentreId, switchableCentres } from '../../../../modules/navigation/centres';
import { getSetting } from '../../../../modules/settings/settings';
import { openTasksOf } from '../../../../modules/tasks/services';
import { EmergencyWatch } from './emergency-watch';
import { NotificationsLink } from './notifications-link';
import { SessionGuard } from './session-guard';
import { SignOutButton } from './sign-out-button';

// Every page here needs an active staff member (IAM-01); anyone else goes to sign in. Their
// drafts are kept on the device under their id and saved when the connection returns (FND-08).
// The session rules (IAM-07) watch every open page; desktops sign out after the idle minutes.
// A Velyx support login is told on every page that it is read only and logged (IAM-08). Every
// page links to the staff member's notifications with the unread count (INT-10). Open emergency
// red flag alerts at the person's centres show as banners on every page, kept current (ALT-01).
// Phones get the role's bottom tab bar (UI-01); from 768 px the rail, from 1280 px the sidebar,
// with Search or jump to, beside the page on a white sheet (UI-02).
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const device = readDevice((await cookies()).get(DEVICE_COOKIE)?.value);
  const idleMinutes = await getSetting('security.desktop_idle_logout_minutes');
  const grant = staff.support ? await asStaff(staff, (tx) => activeGrant(tx)) : undefined;
  const unread = await unreadNotifications(staff);
  const banners = await emergencyBannersOf(staff);
  const refreshSeconds = await getSetting('live.refresh_seconds');
  const items = navigationFor(staff);
  const openTasks = items.some((item) => item.href === '/app/tasks') ? await openTasksOf(staff) : 0;
  // The centre switcher, for those who open Today or the Calendar at more than one centre.
  const opensCentres =
    accessScope(staff, 'check_in.manage') !== null || accessScope(staff, 'calendar.view') !== null;
  const centres = opensCentres ? await switchableCentres(staff) : [];
  const chosen =
    (await chosenCentreId(staff)) ??
    centres.find((c) => staff.centreIds.includes(c.id))?.id ??
    centres[0]?.id ??
    '';
  return (
    <StaffProvider staff={{ id: staff.id, name: staff.name, role: staff.role }}>
      {/* First on every page (design system v2 section 11), past the rail or sidebar. */}
      <a
        href="#page"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-ink focus:shadow-float"
      >
        Skip to page
      </a>
      <div className="md:flex md:min-h-dvh">
        <NavShell
          items={items}
          counts={{ '/app/tasks': openTasks }}
          findsPatients={accessScope(staff, 'patients.view_contact') !== null}
          centreSwitcher={
            centres.length > 1 ? (
              <Suspense>
                <CentreSwitcher centres={centres} chosen={chosen} />
              </Suspense>
            ) : null
          }
          personMenu={
            <PersonMenu
              name={staff.name}
              role={staffRoleLabels[staff.role]}
              signOut={<SignOutButton />}
            />
          }
        />
        <div className="min-w-0 flex-1 md:py-2 md:pr-2">
          <div
            id="page"
            tabIndex={-1}
            data-testid="page-sheet"
            className="min-h-full bg-canvas md:overflow-clip md:rounded-sheet md:border md:border-line md:bg-surface md:shadow-xs focus:outline-none"
          >
            {staff.support ? (
              <p
                role="note"
                className="w-full border-b border-waiting-line bg-waiting-soft px-4 py-2 text-sm text-waiting-strong"
              >
                Velyx support access, read only
                {grant ? `, until ${formatIstDateTime(grant.endsAt)}` : ''}. Everything you open is
                logged.
              </p>
            ) : null}
            {banners.map((banner) => (
              <EmergencyBanner
                key={banner.alertId}
                alert={{
                  id: banner.alertId,
                  patientName: banner.patientName,
                  href: banner.visitHref,
                  clinical: banner.clinical && { ...banner.clinical, raisedAt: banner.raisedAt },
                }}
              />
            ))}
            <div className="flex justify-end border-b border-line px-4 text-sm">
              <NotificationsLink unread={unread} />
            </div>
            {children}
          </div>
        </div>
      </div>
      {/* UI-01: the role's bottom tabs on phones. */}
      <PhoneTabBar tabs={phoneTabsFor(staff)} />
      <DraftSync />
      {staff.support ? null : (
        <EmergencyWatch
          alertIds={banners.map((banner) => banner.alertId)}
          refreshSeconds={refreshSeconds}
        />
      )}
      <SessionGuard device={device} idleMinutes={idleMinutes} />
    </StaffProvider>
  );
}
