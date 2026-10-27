import { istDate } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { openingEntriesView } from '../../../../../modules/opening-entries/services';
import { OpeningEntryCard, OpeningEntryForm, SwitchForm } from './opening-entry-forms';

export const metadata: Metadata = { title: 'Opening entries · Clinic Mx' };

// Opening entries (SCH-13): before launch the Super Admin enters each patient already in
// treatment, with their physio, the sessions left on their package and its expiry; the patient
// then books and is treated as usual. Entries are closed after go live (user decisions, 27
// October 2026).
export default async function OpeningEntriesPage() {
  const staff = await requirePermission('opening_entries.manage');
  const view = await openingEntriesView(staff);
  const today = istDate(new Date());
  const writes = view.open && !staff.support;
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Opening entries</h1>
        <p className="text-ink-secondary">
          Patients already in treatment at launch: each gets an Active episode and an opening
          package with the sessions left, so their sessions are booked, started and closed as usual.
        </p>
      </div>
      <section className="flex flex-col gap-3" aria-labelledby="opening-status">
        <h2 id="opening-status" className="font-semibold text-ink" data-testid="opening-status">
          {view.open ? 'Opening entries are open' : 'Opening entries are closed'}
        </h2>
        {staff.support ? (
          <FormMessage tone="info">Velyx support access is read only.</FormMessage>
        ) : (
          <SwitchForm open={view.open} />
        )}
      </section>
      {writes ? (
        <section className="flex flex-col gap-3" aria-labelledby="opening-new">
          <h2 id="opening-new" className="font-semibold text-ink">
            New opening entry
          </h2>
          <OpeningEntryForm centres={view.centres} today={today} />
        </section>
      ) : null}
      <section className="flex flex-col gap-3" aria-labelledby="opening-list">
        <h2 id="opening-list" className="font-semibold text-ink">
          Entered ({view.entries.length})
        </h2>
        {view.entries.length === 0 ? (
          <p className="text-ink-muted">No opening entries yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {view.entries.map((entry) => (
              <OpeningEntryCard
                key={entry.id}
                entry={entry}
                centres={view.centres}
                corrects={writes}
                today={today}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
