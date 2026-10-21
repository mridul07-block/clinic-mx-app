import type { ReactNode } from 'react';
import { DraftSync } from '../../../../lib/drafts/draft-sync';
import { StaffProvider } from '../../../../lib/staff-context';
import { requireStaff } from '../../../../modules/auth/session';

// Every page here needs an active staff member (IAM-01); anyone else goes to sign in. Their
// drafts are kept on the device under their id and saved when the connection returns (FND-08).
export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  return (
    <StaffProvider staff={{ id: staff.id, name: staff.name, role: staff.role }}>
      {children}
      <DraftSync />
    </StaffProvider>
  );
}
