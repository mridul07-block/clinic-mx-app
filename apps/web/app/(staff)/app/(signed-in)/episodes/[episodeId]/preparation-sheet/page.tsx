import type { PreparationSheet, SheetListing } from '@clinic-mx/db';
import {
  SUGGESTIONS_UNAVAILABLE,
  durationLabel,
  formatIstDateTime,
  knowledgeSource,
  screeningRegionLabels,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { Tag } from '../../../../../../../components/tag';
import { NotAllowedError } from '../../../../../../../modules/access/guard';
import {
  listingKey,
  loadPreparationSheet,
  type PreparationSheetView,
} from '../../../../../../../modules/ai/sheet';
import { requireStaff } from '../../../../../../../modules/auth/session';
import { DispositionButtons } from './disposition-buttons';

export const metadata: Metadata = { title: 'Preparation sheet · Clinic Mx' };

type Suggestion = PreparationSheet['suggestions'][number];

/** Knowledge base text exactly as stored (PRD: "shown word for word"). */
function Words({ label, text, testId }: { label: string; text: string | null; testId: string }) {
  if (!text) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm font-medium text-ink-muted">{label}</span>
      <p className="whitespace-pre-line text-ink" data-testid={testId}>
        {text}
      </p>
    </div>
  );
}

function Panel({
  title,
  id,
  tone,
  children,
}: {
  title: string;
  id: string;
  tone?: 'danger';
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-testid={id}
      className={`flex flex-col gap-3 rounded-panel border p-5 ${
        tone === 'danger' ? 'border-danger-line bg-surface' : 'border-line bg-surface'
      }`}
    >
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SuggestionCard({
  suggestion,
  listing,
  view,
  episodeId,
}: {
  suggestion: Suggestion;
  listing: SheetListing | undefined;
  view: PreparationSheetView;
  episodeId: string;
}) {
  const mustRuleOut = view.sheet.shortlist.items.some(
    (i) => i.mustRuleOut && i.conditionId === suggestion.conditionId,
  );
  return (
    <li
      data-testid="suggestion-card"
      className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-muted">{suggestion.rank}</span>
        <h3 className="font-semibold text-ink" data-testid="suggestion-name">
          {listing?.name ?? suggestion.conditionId}
        </h3>
        {mustRuleOut ? <Tag tone="danger">Must rule out</Tag> : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="self-start">
          <Tag tone="outline">Assistant suggestion</Tag>
        </span>
        <p className="text-ink-secondary" data-testid="suggestion-reason">
          {suggestion.reason}
        </p>
      </div>
      <Words
        label="Discriminating question"
        text={listing?.discriminatingQuestion ?? null}
        testId="suggestion-question"
      />
      <Words label="Tests" text={listing?.testsImaging ?? null} testId="suggestion-tests" />
      <Link
        href={`/app/knowledge-base/${view.sheet.kbVersionId}`}
        className="text-sm text-ink-muted underline underline-offset-2"
      >
        {knowledgeSource(suggestion, view.sheet.kbVersionNumber)}
      </Link>
      <DispositionButtons
        suggestionId={suggestion.id}
        episodeId={episodeId}
        disposition={suggestion.disposition}
        canDispose={view.canDispose}
      />
    </li>
  );
}

// The AI preparation sheet (AI-03; Frontend Specification "Preparation sheet", Consultant tick):
// what the patient told us, safety, the likely diagnoses the model ranked (top 3 plus 2 under
// Also consider, decision 3), must rule out by rule, and the knowledge base's examination and
// biomechanics for each. Every clinical word is the knowledge base's own; Keep and Dismiss are the
// visit's consultant's, and nothing enters the record from here.
export default async function PreparationSheetPage({
  params,
}: {
  params: Promise<{ episodeId: string }>;
}) {
  const staff = await requireStaff();
  const { episodeId } = await params;
  if (!z.guid().safeParse(episodeId).success) notFound();
  let view: PreparationSheetView | null;
  try {
    view = await loadPreparationSheet(staff, episodeId);
  } catch (error) {
    if (error instanceof NotAllowedError) redirect('/app/not-allowed');
    throw error;
  }
  if (!view) notFound();
  const { sheet } = view;
  const words = (row: { conditionId: string; region: string; rowNumber: number }) =>
    view.listings[listingKey(row)];
  const top = sheet.suggestions.filter((s) => s.section === 'top');
  const also = sheet.suggestions.filter((s) => s.section === 'also_consider');
  const mustRuleOut = sheet.shortlist.items.filter((i) => i.mustRuleOut);
  const theCase = sheet.case;
  const told: [string, string][] = theCase
    ? [
        ['Region', screeningRegionLabels[theCase.region]],
        ['Symptoms', theCase.symptoms.join('; ')],
        ['Duration', theCase.durationWeeks === null ? '' : durationLabel(theCase.durationWeeks)],
        ['Activity', theCase.sport.join(', ')],
        ['Goal', theCase.goal ?? ''],
      ]
    : [];
  const examination = sheet.suggestions.flatMap((s) => {
    const text = words(s)?.details.examination_findings?.text;
    return text ? [{ s, text }] : [];
  });
  const biomechanics = sheet.suggestions.flatMap((s) => {
    const text = words(s)?.biomechanicalCause;
    return text ? [{ s, text }] : [];
  });

  return (
    <main className="flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/my-patients"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          My patients today
        </Link>
        <h1 className="text-title font-semibold">Preparation sheet</h1>
        <p className="text-ink-secondary">
          {view.patientName}
          {sheet.readyAt
            ? ` · prepared ${formatIstDateTime(sheet.readyAt)} from knowledge base version ${String(sheet.kbVersionNumber)}`
            : ''}
        </p>
        <p className="text-sm text-ink-muted">
          Suggestions support your reasoning; nothing enters the record until you confirm it.
        </p>
      </div>
      {sheet.status === 'pending' ? (
        <p role="status" className="text-ink-secondary" data-testid="sheet-pending">
          The preparation sheet is not ready yet.
        </p>
      ) : null}
      <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] md:items-start">
        <div className="flex flex-col gap-4">
          <Panel title="Likely diagnoses" id="sheet-likely">
            {sheet.status === 'ready' && top.length > 0 ? (
              <>
                <ol className="flex flex-col gap-4">
                  {top.map((s) => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      listing={words(s)}
                      view={view}
                      episodeId={episodeId}
                    />
                  ))}
                </ol>
                {also.length > 0 ? (
                  <details className="border-t border-line pt-3" data-testid="sheet-also-consider">
                    <summary className="cursor-pointer font-semibold text-ink pointer-coarse:py-3">
                      Also consider ({also.length})
                    </summary>
                    <ol className="mt-3 flex flex-col gap-4">
                      {also.map((s) => (
                        <SuggestionCard
                          key={s.id}
                          suggestion={s}
                          listing={words(s)}
                          view={view}
                          episodeId={episodeId}
                        />
                      ))}
                    </ol>
                  </details>
                ) : null}
              </>
            ) : sheet.status === 'pending' ? (
              <p className="text-ink-secondary">Not ready yet.</p>
            ) : (
              <p className="text-ink-secondary" data-testid="sheet-unavailable">
                {SUGGESTIONS_UNAVAILABLE}
              </p>
            )}
          </Panel>
          {examination.length > 0 ? (
            <Panel title="Suggested examination" id="sheet-examination">
              <ul className="flex flex-col gap-3">
                {examination.map(({ s, text }) => (
                  <li key={s.id} className="flex flex-col gap-0.5">
                    <span className="font-medium text-ink">{words(s)?.name}</span>
                    <p className="whitespace-pre-line text-ink-secondary">{text}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {biomechanics.length > 0 ? (
            <Panel title="Load and biomechanics" id="sheet-biomechanics">
              <ul className="flex flex-col gap-3">
                {biomechanics.map(({ s, text }) => (
                  <li key={s.id} className="flex flex-col gap-0.5">
                    <span className="font-medium text-ink">{words(s)?.name}</span>
                    <p className="whitespace-pre-line text-ink-secondary">{text}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <Panel title="Safety" id="sheet-safety" tone="danger">
            {view.alerts.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {view.alerts.map((alert) => (
                  <li key={alert.id} className="flex flex-col gap-0.5">
                    <span className="font-medium text-ink">{alert.name}</span>
                    <span className="text-sm text-ink-secondary">{alert.action}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-secondary">No open red flag alerts on this episode.</p>
            )}
          </Panel>
          <Panel title="Must rule out" id="sheet-must-rule-out" tone="danger">
            <span className="self-start">
              <Tag tone="danger">Rule: must rule out</Tag>
            </span>
            {mustRuleOut.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {mustRuleOut.map((item) => {
                  const listing = words(item);
                  return (
                    <li key={listingKey(item)} data-testid="must-rule-out">
                      <details className="group border-t border-line pt-2 first:border-t-0">
                        <summary className="cursor-pointer font-semibold text-ink pointer-coarse:py-2">
                          {listing?.name ?? item.conditionId}
                        </summary>
                        <div className="mt-2 flex flex-col gap-2">
                          <Words
                            label="Red flag"
                            text={listing?.redFlagText ?? null}
                            testId="must-rule-out-flag"
                          />
                          <Words
                            label="Discriminating question"
                            text={listing?.discriminatingQuestion ?? null}
                            testId="must-rule-out-question"
                          />
                          <Words
                            label="Tests"
                            text={listing?.testsImaging ?? null}
                            testId="must-rule-out-tests"
                          />
                          <span className="text-sm text-ink-muted">
                            {knowledgeSource(item, sheet.kbVersionNumber)}
                          </span>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-ink-secondary">No high risk rows match this patient.</p>
            )}
          </Panel>
          <Panel title="What the patient told us" id="sheet-told">
            <span className="self-start">
              <Tag tone="outline">Patient reported</Tag>
            </span>
            {told.length > 0 ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                {told
                  .filter(([, value]) => value !== '')
                  .map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-ink-muted">{label}</dt>
                      <dd className="text-ink">{value}</dd>
                    </div>
                  ))}
              </dl>
            ) : (
              <p className="text-ink-secondary">The health form did not give a region.</p>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}
