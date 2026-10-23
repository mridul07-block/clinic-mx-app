import { activeGrant } from '@clinic-mx/db';
import { formatIstDateTime } from '@clinic-mx/schemas';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { EmergencyBanner } from '../../../../components/emergency-banner';
import { DraftSync } from '../../../../lib/drafts/draft-sync';
import { DEVICE_COOKIE, readDevice } from '../../../../lib/session-cookies';
import { asStaff } from '../../../../modules/access/staff-db';
import { StaffProvider } from '../../../../lib/staff-context';
import { emergencyBannersOf } from '../../../../modules/alerts/services';
import { requireStaff } from '../../../../modules/auth/session';
import { unreadNotifications } from '../../../../modules/notifications/services';
import { getSetting } from '../../../../modules/settings/settings';
import { EmergencyWatch } from './emergency-watch';
import { NotificationsLink } from './notifications-link';
import { SessionGuard } from './session-guard';

// Every page here needs an active staff member (IAM-01); anyone else goes to sign in. Their
// drafts are kept on the device under their id and saved when the connection returns (FND-08).
// The session rules (IAM-07) watch every open page; desktops sign out after the idle minutes.
// A Velyx support login is told on every page that it is read only and logged (IAM-08). Every
// page links to the staff member's notifications with the unread count (INT-10). Open emergency
// red flag alerts at the person's centres show as banners on every page, kept current (ALT-01).
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const device = readDevice((await cookies()).get(DEVICE_COOKIE)?.value);
  const idleMinutes = await getSetting('security.desktop_idle_logout_minutes');
  const grant = staff.support ? await asStaff(staff, (tx) => activeGrant(tx)) : undefined;
  const unread = await unreadNotifications(staff);
  const banners = await emergencyBannersOf(staff);
  const refreshSeconds = await getSetting('live.refresh_seconds');
  return (
    <StaffProvider staff={{ id: staff.id, name: staff.name, role: staff.role }}>
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
