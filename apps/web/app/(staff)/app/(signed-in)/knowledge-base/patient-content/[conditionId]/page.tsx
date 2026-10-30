import {
  conditionIdSchema,
  formatIstDateTime,
  patientContentPartLabels,
  patientContentParts,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FormMessage } from '../../../../../../../components/forms';
import type { PatientContentEntry } from '@clinic-mx/db';
import { requirePermission } from '../../../../../../../modules/access/require-permission';
import { loadPatientContent } from '../../../../../../../modules/knowledge-base/patient-content';
import { DecideDraft, DraftForm } from './forms';

export const metadata: Metadata = { title: 'Patient content · Knowledge base · Clinic Mx' };
export const dynamic = 'force-dynamic';

function Content({ entry }: { entry: PatientContentEntry }) {
  return (
    <dl className="flex flex-col gap-3">
      {patientContentParts.map((part) => (
        <div key={part} className="flex flex-col gap-1">
          <dt className="font-medium text-ink">{patientContentPartLabels[part]}</dt>
          <dd className="whitespace-pre-line text-ink-secondary">{entry[part]}</dd>
        </div>
      ))}
    </dl>
  );
}

// A condition's patient content (AI-07): the approved text patients see, and the draft a
// consultant who treats patients writes, then approves or discards. Approving supersedes the
// approved text; an approved text never changes.
export default async function PatientContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ conditionId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('knowledge_base.view');
  const { conditionId } = await params;
  if (!conditionIdSchema.safeParse(conditionId).success) notFound();
  const content = await loadPatientContent(staff, conditionId);
  if (!content) notFound();
  const { done } = await searchParams;
  const { name, draft, approved, draftIsOld, writes } = content;
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/knowledge-base/patient-content"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          Patient content
        </Link>
        <h1 className="text-title font-semibold">{name}</h1>
        <p className="font-mono text-sm text-ink-muted">{conditionId}</p>
      </div>
      {done === 'approved' ? (
        <FormMessage tone="info">Approved. Patients see this content from now on.</FormMessage>
      ) : done === 'discarded' ? (
        <FormMessage tone="info">The draft is discarded.</FormMessage>
      ) : null}

      <section
        className="flex flex-col gap-3"
        aria-labelledby="approved-heading"
        data-testid="patient-content-approved"
      >
        <h2 id="approved-heading" className="text-lg font-semibold">
          What patients see
        </h2>
        {approved ? (
          <>
            <p className="text-sm text-ink-muted">
              Approved by {approved.approvedByName ?? 'a former staff member'}
              {approved.approvedAt ? `, ${formatIstDateTime(approved.approvedAt)}` : ''}
            </p>
            <Content entry={approved} />
          </>
        ) : (
          <p className="text-ink-muted">
            Nothing yet. Patients see this condition&rsquo;s content once a consultant who treats
            patients approves it.
          </p>
        )}
      </section>

      <section
        className="flex flex-col gap-3"
        aria-labelledby="draft-heading"
        data-testid="patient-content-draft"
      >
        <h2 id="draft-heading" className="text-lg font-semibold">
          {approved ? 'New draft' : 'Draft'}
        </h2>
        {draft ? (
          <p className="text-sm text-ink-muted">
            {draft.source === 'ai' ? 'Written by AI' : 'Written'}
            {draft.writtenByName
              ? `${draft.source === 'ai' ? ', edited' : ''} by ${draft.writtenByName}`
              : ''}
            , last saved {formatIstDateTime(draft.updatedAt)}. Not shown to patients until approved.
          </p>
        ) : null}
        {writes ? (
          <>
            {/* Kept mounted across saves, so "Draft saved." shows and what was typed stays. */}
            <DraftForm
              key={conditionId}
              conditionId={conditionId}
              draft={draft ?? approved}
              open={draft ? { id: draft.id, revision: draft.revision } : undefined}
            />
            {draft ? (
              draftIsOld ? (
                <p className="text-sm text-ink-secondary" data-testid="patient-content-old">
                  This draft was written against an older knowledge base version. Save it again to
                  bring it up to date before approving it.
                </p>
              ) : (
                <DecideDraft
                  conditionId={conditionId}
                  draftId={draft.id}
                  revision={draft.revision}
                />
              )
            ) : null}
          </>
        ) : draft ? (
          <Content entry={draft} />
        ) : (
          <p className="text-ink-muted">No draft.</p>
        )}
      </section>
    </main>
  );
}
