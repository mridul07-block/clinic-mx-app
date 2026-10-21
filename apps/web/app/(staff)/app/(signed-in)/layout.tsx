import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { DraftSync } from '../../../../lib/drafts/draft-sync';
import { DEVICE_COOKIE, readDevice } from '../../../../lib/session-cookies';
import { StaffProvider } from '../../../../lib/staff-context';
import { requireStaff } from '../../../../modules/auth/session';
import { getSetting } from '../../../../modules/settings/settings';
import { SessionGuard } from './session-guard';

// Every page here needs an active staff member (IAM-01); anyone else goes to sign in. Their
// drafts are kept on the device under their id and saved when the connection returns (FND-08).
// The session rules (IAM-07) watch every open page; desktops sign out after the idle minutes.
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const device = readDevice((await cookies()).get(DEVICE_COOKIE)?.value);
  const idleMinutes = await getSetting('security.desktop_idle_logout_minutes');
  return (
    <StaffProvider staff={{ id: staff.id, name: staff.name, role: staff.role }}>
      {children}
      <DraftSync />
      <SessionGuard device={device} idleMinutes={idleMinutes} />
    </StaffProvider>
  );
}
