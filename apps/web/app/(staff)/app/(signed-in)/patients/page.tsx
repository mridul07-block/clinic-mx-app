import { PATIENT_SEARCH_LIMIT, searchPatients } from '@clinic-mx/db';
import { accessScope, formatIndianPhone, patientSearch } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { secondaryButtonClass } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';

export const metadata: Metadata = { title: 'Patients · Clinic Mx' };

// Patients (SCH-01, PRD M1): find a patient by mobile or name. Everyone with patients.view_contact
// searches every centre's patients (records are shared, PRD J7.6), read under row level security;
// those with patients.edit_contact add them.
export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const staff = await requirePermission('patients.view_contact');
  const { q } = await searchParams;
  const typed = typeof q === 'string' ? q : '';
  const search = patientSearch(typed);
  const results = search ? await asStaff(staff, (tx) => searchPatients(tx, search)) : [];
  const canAdd = accessScope(staff, 'patients.edit_contact') && !staff.support;

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Patients</h1>
        <p className="text-ink-secondary">
          Search every centre by mobile or name. One mobile can belong to several people.
        </p>
      </div>

      <form role="search" action="/app/patients" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="patient-search" className="font-medium text-ink">
            Mobile or name
          </label>
          <input
            id="patient-search"
            name="q"
            type="search"
            autoComplete="off"
            defaultValue={typed}
            className="h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs placeholder:text-ink-faint hover:border-ink-muted pointer-coarse:h-row-touch"
          />
        </div>
        <button type="submit" className={secondaryButtonClass}>
          Search
        </button>
      </form>

      {canAdd ? (
        <Link href="/app/patients/new" className={secondaryButtonClass}>
          Add patient
        </Link>
      ) : null}

      {typed && !search ? (
        <p className="text-ink-muted">Type at least two letters or digits.</p>
      ) : search ? (
        results.length === 0 ? (
          <p className="text-ink-muted" data-testid="no-patients">
            No patient matches “{typed.trim()}”.
          </p>
        ) : (
          <section aria-label="Results" className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {results.map((patient) => (
                <li key={patient.id} data-testid="patient">
                  <Link
                    href={`/app/patients/${patient.id}`}
                    className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4 hover:bg-surface-hover"
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold text-ink">{patient.name}</span>
                      <span className="font-mono text-sm text-ink-secondary">
                        {patient.opNumber}
                      </span>
                    </span>
                    <span className="text-sm text-ink-secondary">
                      {formatIndianPhone(patient.phone)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {results.length === PATIENT_SEARCH_LIMIT ? (
              <p className="text-sm text-ink-muted">
                Showing the first {PATIENT_SEARCH_LIMIT}. Type more to narrow the search.
              </p>
            ) : null}
          </section>
        )
      ) : null}
    </main>
  );
}
