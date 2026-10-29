import {
  dataRequestKindLabels,
  dataRequestOverdue,
  dataRequestStatusLabels,
  formatIstDate,
  istDate,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { dataRequests } from '../../../../../modules/data-requests/services';

export const metadata: Metadata = { title: 'Data requests · Clinic Mx' };

// Data requests (ADM-03; PRD M16; TAD section 5, DPDP Act 2023): every patient request for a copy
// of their data, a correction or deletion; open ones first, soonest due, overdue ones marked.
// Requests are recorded from the patient's record.
export default async function DataRequestsPage() {
  const staff = await requirePermission('data_requests.manage');
  const requests = await dataRequests(staff);
  const today = istDate(new Date());

  return (
    <main className="flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Data requests</h1>
        <p className="text-ink-secondary">
          A patient’s requests for a copy of their data, a correction or deletion. To record one,
          open the patient’s record and choose Record a data request.
        </p>
      </div>
      {requests.length ? (
        <ul className="flex flex-col gap-3" data-testid="data-requests">
          {requests.map((request) => {
            const overdue = dataRequestOverdue(request, today);
            return (
              <li
                key={request.id}
                className="flex flex-col gap-1.5 rounded-panel border border-line bg-surface p-3"
                data-testid="data-request"
                data-request={request.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={['/app/data-requests', request.id].join('/')}
                    className="font-semibold text-accent underline underline-offset-2"
                  >
                    {request.patientName}
                  </Link>
                  <span className="font-mono text-sm text-ink-secondary">{request.opNumber}</span>
                  <Tag tone={request.status === 'open' ? (overdue ? 'danger' : 'waiting') : 'done'}>
                    {overdue ? 'Overdue' : dataRequestStatusLabels[request.status]}
                  </Tag>
                </div>
                <p className="text-ink">{dataRequestKindLabels[request.kind]}</p>
                <p className="text-sm text-ink-secondary">
                  Received {formatIstDate(request.receivedOn)}, due {formatIstDate(request.dueOn)}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-ink-secondary" data-testid="data-requests-none">
          No data requests yet.
        </p>
      )}
    </main>
  );
}
