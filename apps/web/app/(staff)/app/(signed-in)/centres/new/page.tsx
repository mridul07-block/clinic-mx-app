import { centreList } from '@clinic-mx/db';
import { centreColours } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../../components/forms';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { allColoursInUse } from '../../../../../../modules/centres/services';
import { CentreForm } from '../centre-form';

export const metadata: Metadata = { title: 'Add a centre · Clinic Mx' };

// Add a centre (SET-01): its details and a chart colour no active centre uses.
export default async function NewCentrePage() {
  const staff = await requirePermission('centres.manage');
  const centres = await asStaff(staff, (tx) => centreList(tx));
  const takenBy: Record<string, string> = Object.fromEntries(
    centres.filter((c) => c.active).map((c) => [c.colour, c.name]),
  );
  const colourFree = centreColours.some((colour) => !takenBy[colour.value]);
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/app/centres" className="text-sm text-ink-muted underline underline-offset-2">
          Centres
        </Link>
        <h1 className="text-title font-semibold">Add a centre</h1>
      </div>
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : colourFree ? (
        <CentreForm takenBy={takenBy} />
      ) : (
        // No form to fill in vain: the service refuses the same way if one is sent anyway.
        <FormMessage tone="info">{allColoursInUse}</FormMessage>
      )}
    </main>
  );
}
