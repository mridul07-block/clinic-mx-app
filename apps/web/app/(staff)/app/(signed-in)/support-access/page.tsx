import { activeGrant, supportGrantHistory, supportLogins } from '@clinic-mx/db';
import { formatIstDateTime } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { getSetting } from '../../../../../modules/settings/settings';
import { loginsWithPendingInvite } from '../../../../../modules/staff/directory';
import { StaffStatus } from '../staff/staff-status';
import { AddSupportLoginForm, EndAccessForm, GrantForm } from './support-forms';

export const metadata: Metadata = { title: 'Support access · Clinic Mx' };

const sectionClass = 'flex flex-col gap-4 rounded-panel border border-line bg-surface p-4';

// Velyx support access (IAM-08, PRD section 2, M16): off by default; the Super Admin turns it on
// for a time with a reason, ends it early, and sees every page and action support asked for
// under each grant. Read as the Super Admin under row level security. A support login sees the
// page read only.
export default async function SupportAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('support_access.grant');
  const { done } = await searchParams;
  const [[grant, history, logins], pending, maxHours] = await Promise.all([
    asStaff(staff, (tx) =>
      Promise.all([activeGrant(tx), supportGrantHistory(tx), supportLogins(tx)]),
    ),
    loginsWithPendingInvite(),
    getSetting('security.support_grant_max_hours'),
  ]);
  const readOnly = staff.support;

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Support access</h1>
        <p className="text-ink-secondary">
          Velyx support can sign in only while access is on. It is read only, and every page it
          opens is logged here.
        </p>
      </div>

      {readOnly ? <FormMessage tone="info">Velyx support access is read only.</FormMessage> : null}
      {done === 'granted' && grant ? (
        <FormMessage tone="info">
          Support access is on until {formatIstDateTime(grant.endsAt)}.
        </FormMessage>
      ) : null}
      {done === 'ended' && !grant ? (
        <FormMessage tone="info">
          Support access ended. Velyx support is signed out on every device now.
        </FormMessage>
      ) : null}

      <section className={sectionClass} aria-labelledby="support-status">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="support-status" className="font-semibold text-ink">
            Status
          </h2>
          {grant ? <Tag tone="active">On</Tag> : <Tag tone="neutral">Off</Tag>}
        </div>
        {grant ? (
          <>
            <p className="text-ink-secondary">
              On until {formatIstDateTime(grant.endsAt)}, granted by {grant.grantedByName}:{' '}
              {grant.reason}
            </p>
            {readOnly ? null : <EndAccessForm grantId={grant.id} />}
          </>
        ) : (
          <>
            <p className="text-ink-secondary">Support access is off.</p>
            {readOnly ? null : <GrantForm maxHours={maxHours} />}
          </>
        )}
      </section>

      <section className={sectionClass} aria-labelledby="support-history">
        <h2 id="support-history" className="font-semibold text-ink">
          Past grants
        </h2>
        {history.length === 0 ? (
          <p className="text-ink-secondary">Support access has never been granted.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <p className="font-medium text-ink">
                  {formatIstDateTime(entry.startsAt)} to {formatIstDateTime(entry.endsAt)}
                </p>
                <p className="text-sm text-ink-secondary">
                  Granted by {entry.grantedByName}: {entry.reason}
                </p>
                {entry.activity.length === 0 ? (
                  <p className="text-sm text-ink-muted">Nothing was opened under this grant.</p>
                ) : (
                  // Folded: a working session can open hundreds of pages.
                  <details className="text-sm">
                    <summary className="cursor-pointer text-accent underline underline-offset-2 pointer-coarse:py-3">
                      What support opened ({entry.activity.length})
                    </summary>
                    <ul
                      aria-label="Activity under this grant"
                      className="mt-2 flex flex-col gap-1 break-all text-ink-secondary"
                    >
                      {entry.activity.map((request, index) => (
                        <li key={`${request.at.toISOString()}-${String(index)}`}>
                          {formatIstDateTime(request.at)} · {request.staffName} ·{' '}
                          {request.kind === 'action' ? 'Action on ' : ''}
                          <span className="font-mono">{request.path}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={sectionClass} aria-labelledby="support-logins">
        <h2 id="support-logins" className="font-semibold text-ink">
          Support logins
        </h2>
        {logins.length === 0 ? (
          <p className="text-ink-secondary">No Velyx support logins yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {logins.map((login) => (
              <li key={login.id} className="py-2 first:pt-0 last:pb-0">
                <Link
                  href={`/app/staff/${login.id}`}
                  className="flex flex-col gap-1.5 hover:underline"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-ink">{login.name}</span>
                    <span className="text-sm text-ink-muted">{login.email}</span>
                  </span>
                  <StaffStatus
                    active={login.active}
                    accessEndsAt={null}
                    invitePending={login.authUserId ? pending.has(login.authUserId) : false}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {readOnly ? null : <AddSupportLoginForm />}
      </section>
    </main>
  );
}
