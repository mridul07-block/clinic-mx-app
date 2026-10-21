import { activeGrant } from '@clinic-mx/db';
import { formatIstDateTime } from '@clinic-mx/schemas';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { DraftSync } from '../../../../lib/drafts/draft-sync';
import { DEVICE_COOKIE, readDevice } from '../../../../lib/session-cookies';
import { asStaff } from '../../../../modules/access/staff-db';
import { StaffProvider } from '../../../../lib/staff-context';
import { requireStaff } from '../../../../modules/auth/session';
import { getSetting } from '../../../../modules/settings/settings';
import { SessionGuard } from './session-guard';

// Every page here needs an active staff member (IAM-01); anyone else goes to sign in. Their
// drafts are kept on the device under their id and saved when the connection returns (FND-08).
// The session rules (IAM-07) watch every open page; desktops sign out after the idle minutes.
// A Velyx support login is told on every page that it is read only and logged (IAM-08).
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const device = readDevice((await cookies()).get(DEVICE_COOKIE)?.value);
  const idleMinutes = await getSetting('security.desktop_idle_logout_minutes');
  const grant = staff.support ? await asStaff(staff, (tx) => activeGrant(tx)) : undefined;
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
      {children}
      <DraftSync />
      <SessionGuard device={device} idleMinutes={idleMinutes} />
    </StaffProvider>
  );
}
