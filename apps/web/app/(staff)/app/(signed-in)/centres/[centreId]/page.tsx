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
        <p className="text-sm text-ink-secondary" data-testid="centre-code">
          Code <span className="font-mono text-ink">{centre.code}</span>, at the start of its OP
          numbers, and prefix <span className="font-mono text-ink">{centre.appointmentPrefix}</span>
          , at the start of its appointment IDs. They never change.
        </p>
        <span className="flex flex-wrap items-center gap-2">
          {centre.active ? <Tag tone="active">Active</Tag> : <Tag tone="neutral">Inactive</Tag>}
          <CentreSwatch colour={centre.colour} />
        </span>
      </div>
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      <section className="flex flex-col gap-1.5" aria-labelledby="letterhead-heading">
        <h2 id="letterhead-heading" className="font-semibold text-ink">
          Letterhead
        </h2>
        <p className="text-sm text-ink-secondary">
          Documents from this centre are printed on its letterhead, with the address and phone
          below. Anything not filled in yet is left off.
        </p>
        <a
          href={`/app/centres/${centre.id}/letterhead`}
          target="_blank"
          rel="noopener"
          className="min-h-11 self-start py-2.5 font-medium text-ink underline underline-offset-2"
        >
          Preview letterhead (PDF)
        </a>
        {/* OPS-05: the paper fallback, printed on this letterhead. */}
        <a
          href={['/app/centres', centre.id, 'paper-forms'].join('/')}
          target="_blank"
          rel="noopener"
          className="min-h-11 self-start py-2.5 font-medium text-ink underline underline-offset-2"
        >
          Paper health form and consent (PDF)
        </a>
      </section>
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
            <dt className="font-medium text-ink">Google review link</dt>
            <dd className="break-all">{centre.reviewLink ?? 'None yet'}</dd>
            <dt className="font-medium text-ink">Zero Gravity Treadmills</dt>
            <dd>{centre.treadmills}</dd>
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
              reviewLink: centre.reviewLink ?? '',
              colour: centre.colour,
              treadmills: String(centre.treadmills),
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
