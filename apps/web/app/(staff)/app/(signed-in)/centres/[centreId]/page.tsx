import { centreList } from '@clinic-mx/db';
import { formatIndianPhone } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FormMessage } from '../../../../../../components/forms';
import { Tag } from '../../../../../../components/tag';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { CentreActiveForm, CentreForm } from '../centre-form';
import { CentreSwatch } from '../centre-swatch';

export const metadata: Metadata = { title: 'Centre · Clinic Mx' };

const notices: Record<string, string> = {
  added: 'Centre added.',
  saved: 'Centre saved.',
  deactivated: 'Centre deactivated. Its staff, tablets and history are kept.',
  reactivated: 'Centre reactivated.',
};

// One centre (SET-01): its details and chart colour, and deactivate or reactivate. A support
// login sees the details read only (IAM-08).
export default async function CentrePage({
  params,
  searchParams,
}: {
  params: Promise<{ centreId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('centres.manage');
  const { centreId } = await params;
  if (!z.guid().safeParse(centreId).success) notFound();
  const centres = await asStaff(staff, (tx) => centreList(tx));
  const centre = centres.find((c) => c.id === centreId);
  if (!centre) notFound();
  const takenBy = Object.fromEntries(
    centres.filter((c) => c.active && c.id !== centreId).map((c) => [c.colour, c.name]),
  );
  const notice = notices[(await searchParams).done ?? ''];

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app/centres" className="text-sm text-ink-muted underline underline-offset-2">
          Centres
        </Link>
        <h1 className="text-title font-semibold">{centre.name}</h1>
        <span className="flex flex-wrap items-center gap-2">
          {centre.active ? <Tag tone="active">Active</Tag> : <Tag tone="neutral">Inactive</Tag>}
          <CentreSwatch colour={centre.colour} />
        </span>
      </div>
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      {staff.support ? (
        <>
          <FormMessage tone="info">Velyx support access is read only.</FormMessage>
          <dl className="flex flex-col gap-2 text-ink-secondary">
            <dt className="font-medium text-ink">Address</dt>
            <dd>{centre.address ?? 'None yet'}</dd>
            <dt className="font-medium text-ink">Phone</dt>
            <dd>{centre.phone ? formatIndianPhone(centre.phone) : 'None yet'}</dd>
            <dt className="font-medium text-ink">Map link</dt>
            <dd className="break-all">{centre.mapLink ?? 'None yet'}</dd>
          </dl>
        </>
      ) : (
        <>
          <CentreForm
            centre={{
              centreId: centre.id,
              name: centre.name,
              address: centre.address ?? '',
              phone: centre.phone ?? '',
              mapLink: centre.mapLink ?? '',
              colour: centre.colour,
            }}
            takenBy={takenBy}
            inactive={!centre.active}
          />
          <section className="flex flex-col gap-3 border-t border-line pt-4">
            <h2 className="font-semibold text-ink">
              {centre.active ? 'Deactivate' : 'Reactivate'}
            </h2>
            <CentreActiveForm centreId={centre.id} name={centre.name} active={centre.active} />
          </section>
        </>
      )}
    </main>
  );
}
