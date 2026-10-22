import { centreList } from '@clinic-mx/db';
import { centreColours, formatIndianPhone } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage, secondaryButtonClass } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { allColoursInUse } from '../../../../../modules/centres/services';
import { CentreSwatch } from './centre-swatch';

export const metadata: Metadata = { title: 'Centres · Clinic Mx' };

// Centres (SET-01, PRD M16): address, map link, phone and chart colour per centre. The Super
// Admin adds, edits and deactivates them (centres.manage); read as them under row level
// security. A support login sees the page read only.
export default async function CentresPage() {
  const staff = await requirePermission('centres.manage');
  const centres = await asStaff(staff, (tx) => centreList(tx));
  const used = new Set(centres.filter((c) => c.active).map((c) => c.colour));
  const colourFree = centreColours.some((colour) => !used.has(colour.value));

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Centres</h1>
        <p className="text-ink-secondary">
          Patients see the address, phone and map link in messages and on their pages. The colour
          marks the centre in charts.
        </p>
      </div>

      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : colourFree ? (
        <Link href="/app/centres/new" className={secondaryButtonClass}>
          Add a centre
        </Link>
      ) : (
        <p className="text-sm text-ink-muted" data-testid="no-free-colour">
          {allColoursInUse}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {centres.map((centre) => (
          <li key={centre.id} data-testid="centre">
            <Link
              href={`/app/centres/${centre.id}`}
              className="flex flex-col gap-1.5 rounded-panel border border-line bg-surface p-4 hover:bg-surface-hover"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{centre.name}</span>
                {centre.active ? (
                  <Tag tone="active">Active</Tag>
                ) : (
                  <Tag tone="neutral">Inactive</Tag>
                )}
              </span>
              <span className="text-sm text-ink-secondary">
                {centre.address ?? 'No address yet'}
              </span>
              <span className="text-sm text-ink-secondary">
                {centre.phone ? formatIndianPhone(centre.phone) : 'No phone yet'}
                {centre.mapLink ? ' · Map link set' : ' · No map link yet'}
              </span>
              <CentreSwatch colour={centre.colour} />
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
