'use client';

import { SUGGESTIONS_UNAVAILABLE, formatIstDateTime } from '@clinic-mx/schemas';
import Link from 'next/link';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { FormMessage, secondaryButtonClass } from '../../../../../../components/forms';
import { Tag } from '../../../../../../components/tag';
import {
  recheckViewAction,
  recheckWithFindingsAction,
  type RecheckState,
} from '../../../../../../modules/ai/actions';
import type { RecheckView } from '../../../../../../modules/ai/recheck';

/** How often a running recheck is read again (another tab's, or one this page is waiting on). */
const POLL_MS = 3000;

function FindingList({
  testId,
  label,
  findings,
}: {
  testId: string;
  label: string;
  findings: string[];
}) {
  return (
    <details data-testid={testId}>
      <summary className="cursor-pointer text-sm text-ink-secondary pointer-coarse:py-2">
        {label} ({findings.length})
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-secondary">
        {findings.map((finding) => (
          <li key={finding}>{finding}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * "Recheck with findings" (AI-04; Frontend Specification: on the Consultation screen). Saves the
 * latest edits, then asks the assistant to rank the preparation sheet again with the special
 * tests and measures recorded, named as the knowledge base names them. Nothing enters the record;
 * the result is kept or dismissed on the preparation sheet.
 */
export function RecheckPanel({
  consultationId,
  initial,
  findings,
  sheetHref,
  saveNow,
}: {
  consultationId: string;
  initial: RecheckView | null;
  /** What a recheck would send now, from this draft. */
  findings: string[];
  sheetHref: string;
  saveNow: () => Promise<number | undefined>;
}) {
  const [state, action, pending] = useActionState<RecheckState, FormData>(
    recheckWithFindingsAction,
    {},
  );
  const [, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  // The latest read while a recheck runs; undefined until one is read.
  const [polled, setPolled] = useState<RecheckView | null | undefined>(undefined);
  const recheck =
    polled !== undefined ? polled : state.recheck === undefined ? initial : state.recheck;
  // A recheck whose run stopped is no longer running: the consultant may tap again.
  const running = recheck?.status === 'pending' && !recheck.stopped;
  const busy = saving || pending || running;
  const changed =
    recheck?.status === 'ready' && recheck.findings.join('\n') !== findings.join('\n');

  useEffect(() => {
    if (!running || pending) return;
    const timer = setTimeout(() => {
      recheckViewAction(consultationId).then(setPolled, () => undefined);
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [running, pending, recheck, consultationId]);

  // Saves the latest edits first, then rechecks at the version just saved.
  const start = async () => {
    setSaving(true);
    setUnsaved(false);
    const saved = await saveNow();
    setSaving(false);
    if (saved === undefined) {
      setUnsaved(true);
      return;
    }
    setPolled(undefined);
    const form = new FormData();
    form.set('consultationId', consultationId);
    form.set('baseVersion', String(saved));
    startTransition(() => {
      action(form);
    });
  };

  const top = recheck?.suggestions.filter((s) => s.section === 'top') ?? [];
  const also = recheck?.suggestions.filter((s) => s.section === 'also_consider') ?? [];
  const card = (s: RecheckView['suggestions'][number]) => (
    <li key={s.id} className="flex flex-col gap-1" data-testid="recheck-suggestion">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink-muted">{s.rank}</span>
        <span className="font-semibold text-ink">{s.name}</span>
        <Tag tone="outline">Assistant suggestion</Tag>
      </span>
      <span className="text-sm text-ink-secondary">{s.reason}</span>
    </li>
  );
  const announced = busy
    ? 'Rechecking with your findings…'
    : state.error
      ? ''
      : recheck?.status === 'unavailable'
        ? SUGGESTIONS_UNAVAILABLE
        : recheck?.status === 'ready'
          ? 'Recheck ready.'
          : '';

  return (
    <section
      aria-labelledby="recheck-heading"
      data-testid="recheck-panel"
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <h3 id="recheck-heading" className="font-semibold text-ink">
        Recheck with findings
      </h3>
      <p className="text-sm text-ink-secondary">
        Ranks the assistant’s suggestions again with the tests and measures you recorded. Nothing
        enters the record.
      </p>
      <button
        type="button"
        disabled={busy || findings.length === 0}
        onClick={() => void start()}
        className={`${secondaryButtonClass} md:w-auto md:self-start`}
      >
        {busy ? 'Rechecking…' : 'Recheck with findings'}
      </button>
      {findings.length === 0 ? (
        <p className="text-sm text-ink-muted">Record a special test result or a measure first.</p>
      ) : (
        <FindingList testId="recheck-findings" label="Findings to send" findings={findings} />
      )}
      {unsaved ? (
        <FormMessage tone="danger">
          Your latest changes are not saved yet. Check the connection and try again.
        </FormMessage>
      ) : null}
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {/* One live region, always there, so each change is announced. */}
      <p role="status" className={busy ? 'text-sm text-ink-secondary' : 'sr-only'}>
        {announced}
      </p>
      {recheck?.status === 'unavailable' && !busy ? (
        <p className="text-ink-secondary" data-testid="recheck-unavailable">
          {SUGGESTIONS_UNAVAILABLE}
        </p>
      ) : null}
      {recheck?.status === 'ready' ? (
        <div className="flex flex-col gap-3" data-testid="recheck-result">
          <p className="text-sm text-ink-muted">
            Rechecked {recheck.readyAt ? formatIstDateTime(new Date(recheck.readyAt)) : ''}
            {changed ? '. Your findings changed since this recheck.' : ''}
          </p>
          <FindingList
            testId="recheck-sent"
            label="Sent with this recheck"
            findings={recheck.findings}
          />
          <ol className="flex flex-col gap-3">{top.map(card)}</ol>
          {also.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-ink pointer-coarse:py-2">
                Also consider ({also.length})
              </summary>
              <ol className="mt-2 flex flex-col gap-3">{also.map(card)}</ol>
            </details>
          ) : null}
          <Link href={sheetHref} className="text-sm text-accent underline underline-offset-2">
            Keep or dismiss on the preparation sheet
          </Link>
        </div>
      ) : null}
    </section>
  );
}
