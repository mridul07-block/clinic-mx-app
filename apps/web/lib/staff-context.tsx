'use client';

import type { StaffRole } from '@clinic-mx/schemas';
import { createContext, useContext, type ReactNode } from 'react';

/** The signed in staff member as client components see them (IAM-01). */
export interface SignedInStaff {
  id: string;
  name: string;
  role: StaffRole;
}

const StaffContext = createContext<SignedInStaff | null>(null);

export function StaffProvider({ staff, children }: { staff: SignedInStaff; children: ReactNode }) {
  return <StaffContext value={staff}>{children}</StaffContext>;
}

/** The signed in staff member; only inside the signed in staff app. */
export function useStaff(): SignedInStaff {
  const staff = useContext(StaffContext);
  if (!staff) throw new Error('useStaff is used outside the signed in staff app.');
  return staff;
}
