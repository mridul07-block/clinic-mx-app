import { formatIstDate, staffRoleLabels } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { loadMyPatients } from '../../../../../modules/my-patients/services';
import { getSetting } from '../../../../../modules/settings/settings';
import { MyPatientsList } from './my-patients-list';

export const metadata: Metadata = { title: 'My patients today · Clinic Mx' };

// My patients today (CLN-01, Frontend Specification "Physiotherapist": the physio's home). The
// signed in clinician's own visits today in time order with status, form status and open alerts;
// Start consultation or Start session on a checked in visit (user decisions 24 October 2026).
// "Preparation sheet ready" (Consultant tick) joins each visit once AI-03 stores the sheets.
export default async function MyPatientsPage() {
  const staff = await requirePermission('visits.start');
  const [lateMinutes, refreshSeconds] = [
    await getSetting('day.running_late_minutes'),
    await getSetting('live.refresh_seconds'),
  ];
  const { date, visits, version } = await loadMyPatients(staff);
  return (
    <main className="flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">My patients today</h1>
        <p className="text-sm text-ink-muted">
          {formatIstDate(date)} · Signed in as {staff.name}, {staffRoleLabels[staff.role]}
        </p>
      </div>
      <MyPatientsList
        key={version}
        initial={visits}
        version={version}
        renderedAt={new Date().getTime()}
        lateMinutes={lateMinutes}
        refreshSeconds={refreshSeconds}
        showCentre={staff.centreIds.length > 1 || staff.role === 'super_admin'}
      />
    </main>
  );
}
