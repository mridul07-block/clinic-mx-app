import {
  dataRequestKindLabels,
  dataRequestOverdue,
  dataRequestStatusLabels,
  formatIstDate,
  formatIstDateTime,
  istDate,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FormMessage, secondaryButtonClass } from '../../../../../../components/forms';
import { Tag } from '../../../../../../components/tag';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { dataRequestFor } from '../../../../../../modules/data-requests/services';
import { CloseDataRequestForm } from '../data-request-forms';

export const metadata: Metadata = { title: 'Data request · Clinic Mx' };

// One data request (ADM-03): what was asked and when it is due; for a copy, the patient's data
// as one file while it is open; closing it once, done or declined. Deletion waits for the clinic's
// retention period (PRD decision 20).
export default async function DataRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const staff = await requirePermission('data_requests.manage');
  const { requestId } = await params;
  if (!z.uuid().safeParse(requestId).success) notFound();
  const request = await dataRequestFor(staff, requestId);
  if (!request) notFound();
  const overdue = dataRequestOverdue(request, istDate(new Date()));
  const open = request.status === 'open';

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/data-requests"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          Data requests
        </Link>
        <h1 className="text-title font-semibold">{dataRequestKindLabels[request.kind]}</h1>
        <p className="flex flex-wrap items-center gap-2 text-ink-secondary">
          <Link
            href={['/app/patients', request.patientId].join('/')}
            className="text-accent underline underline-offset-2"
          >
            {request.patientName}
          </Link>
          <span className="font-mono">{request.opNumber}</span>
          <Tag tone={open ? (overdue ? 'danger' : 'waiting') : 'done'}>
            {overdue ? 'Overdue' : dataRequestStatusLabels[request.status]}
          </Tag>
        </p>
      </div>

      <dl
        className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
        data-testid="data-request-facts"
      >
        <dt className="text-ink-secondary">Received</dt>
        <dd className="text-ink">{formatIstDate(request.receivedOn)}</dd>
        <dt className="text-ink-secondary">Due</dt>
        <dd className="text-ink">{formatIstDate(request.dueOn)}</dd>
        <dt className="text-ink-secondary">Recorded by</dt>
        <dd className="text-ink">{request.recordedByName}</dd>
        <dt className="text-ink-secondary">What they asked</dt>
        <dd className="min-w-0 whitespace-pre-wrap text-ink wrap-anywhere">{request.details}</dd>
        {open ? null : (
          <>
            <dt className="text-ink-secondary">Closed</dt>
            <dd className="text-ink">
              {request.closedAt ? formatIstDateTime(request.closedAt) : ''} by{' '}
              {request.closedByName ?? ''}
            </dd>
            <dt className="text-ink-secondary">What was done</dt>
            <dd
              className="min-w-0 whitespace-pre-wrap text-ink wrap-anywhere"
              data-testid="data-request-outcome"
            >
              {request.outcome}
            </dd>
          </>
        )}
      </dl>

      {open && request.kind === 'export' ? (
        <section aria-labelledby="export-heading" className="flex flex-col gap-2">
          <h2 id="export-heading" className="font-semibold text-ink">
            Their data
          </h2>
          <p className="text-sm text-ink-secondary">
            Everything held about {request.patientName}, as one file (JSON). Each download is kept
            in the audit log. Uploaded reports and photos are listed, not attached.
          </p>
          <form method="post" action={['/app/data-requests', request.id, 'export'].join('/')}>
            <button
              type="submit"
              className={`${secondaryButtonClass} sm:w-auto`}
              data-testid="data-request-export"
            >
              Download their data
            </button>
          </form>
        </section>
      ) : null}
      {open && request.kind === 'deletion' ? (
        <FormMessage tone="info">
          Deleting a patient’s data waits for the clinic’s retention period (PRD decision 20).
          Record what you told them, then close the request.
        </FormMessage>
      ) : null}
      {open && request.kind === 'correction' ? (
        <FormMessage tone="info">
          Correct their details on their record, then close the request with what was changed.
        </FormMessage>
      ) : null}

      {open && !staff.support ? (
        <section aria-labelledby="close-heading" className="flex flex-col gap-3">
          <h2 id="close-heading" className="font-semibold text-ink">
            Close the request
          </h2>
          <CloseDataRequestForm requestId={request.id} />
        </section>
      ) : null}
    </main>
  );
}
