import { centreOptions, kioskDevices, type KioskDeviceEntry } from '@clinic-mx/db';
import { formatIstDateTime } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { SetUpKioskForm, StopKioskForm } from './kiosk-forms';

export const metadata: Metadata = { title: 'Kiosk tablets · Clinic Mx' };

const sectionClass = 'flex flex-col gap-4 rounded-panel border border-line bg-surface p-4';

// Clinic tablets in kiosk mode (IAM-10, PRD J2.2, Frontend Specification section 7). Staff with
// check in rights set a tablet up as their centre's kiosk on the tablet itself, and stop one from
// any device. Read as the staff member under row level security: the tablets of their centres.
// A support login sees the page read only.
export default async function KioskTabletsPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('check_in.manage');
  const { done } = await searchParams;
  const [devices, centres] = await asStaff(staff, (tx) =>
    Promise.all([kioskDevices(tx), centreOptions(tx)]),
  );
  const readOnly = staff.support;
  const working = devices.filter((device) => !device.stoppedAt);
  const stopped = devices.filter((device) => device.stoppedAt);

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Kiosk tablets</h1>
        <p className="text-ink-secondary">
          A kiosk tablet shows only the patient form the front desk sends to it, and goes back to
          its welcome screen after a submit or when nobody touches it.
        </p>
      </div>

      {readOnly ? <FormMessage tone="info">Velyx support access is read only.</FormMessage> : null}
      {done === 'stopped' ? (
        <FormMessage tone="info">
          The tablet is no longer a kiosk. It shows this the next time it checks, within a few
          seconds.
        </FormMessage>
      ) : null}

      <section className={sectionClass} aria-labelledby="kiosk-list">
        <h2 id="kiosk-list" className="font-semibold text-ink">
          Tablets
        </h2>
        {working.length === 0 ? (
          <p className="text-ink-secondary">No tablet is a kiosk now.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {working.map((device) => (
              <li
                key={device.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
                data-testid="kiosk-tablet"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{device.name}</span>
                  {device.showingForm ? (
                    <Tag tone="active">Showing a form</Tag>
                  ) : (
                    <Tag tone="waiting">Waiting</Tag>
                  )}
                </div>
                <SetUpLine device={device} />
                {readOnly ? null : <StopKioskForm kioskId={device.id} name={device.name} />}
              </li>
            ))}
          </ul>
        )}
        {stopped.length === 0 ? null : (
          // Folded: every tablet ever set up stays listed.
          <details className="text-sm">
            <summary className="cursor-pointer text-accent underline underline-offset-2 pointer-coarse:py-3">
              Stopped tablets ({stopped.length})
            </summary>
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {stopped.map((device) => (
                <li key={device.id} className="flex flex-col gap-1 py-2" data-testid="kiosk-tablet">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{device.name}</span>
                    <Tag tone="neutral">Stopped</Tag>
                  </div>
                  <SetUpLine device={device} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {readOnly ? null : (
        <section className={sectionClass} aria-labelledby="kiosk-set-up">
          <h2 id="kiosk-set-up" className="font-semibold text-ink">
            Set up this device as a kiosk
          </h2>
          {centres.length === 0 ? (
            <p className="text-ink-secondary">You are not assigned to a centre.</p>
          ) : (
            <SetUpKioskForm centres={centres} />
          )}
        </section>
      )}
    </main>
  );
}

function SetUpLine({ device }: { device: KioskDeviceEntry }) {
  return (
    <p className="text-sm text-ink-secondary">
      {device.centreName} · set up {formatIstDateTime(device.createdAt)}
      {device.createdByName ? ` by ${device.createdByName}` : ''}
      {device.stoppedAt ? ` · stopped ${formatIstDateTime(device.stoppedAt)}` : ''}
    </p>
  );
}
