import type { ReassessedRow } from '../../../../../../modules/sessions/reassessment';

const notTested = (reason: string | null) => `Not tested${reason ? `: ${reason}` : ''}`;

/**
 * Baseline against the reassessment session, one measure a row (OUT-05): the session screen once
 * signed and the consultant's review share it. Built for 360 px: each row stacks.
 */
export function ReassessmentRows({
  rows,
  sessionNumber,
}: {
  rows: ReassessedRow[];
  sessionNumber: number;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-ink-muted">
        No baseline was recorded at session 1, so nothing was reassessed.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="reassessment-rows">
      {rows.map((row) => (
        <li
          key={row.measure.key}
          data-testid="reassessment-row"
          className="flex flex-col gap-1 border-t border-line pt-3 first:border-0 first:pt-0"
        >
          <span className="font-medium text-ink">{row.measure.name}</span>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            <dt className="text-ink-muted">Baseline</dt>
            <dd className="text-ink">{row.baseline ?? notTested(row.baselineNotTested)}</dd>
            <dt className="text-ink-muted">Session {sessionNumber}</dt>
            <dd className="text-ink">{row.now ?? notTested(row.nowNotTested)}</dd>
            {row.change ? (
              <>
                <dt className="text-ink-muted">Change</dt>
                <dd className="font-medium text-ink" data-testid="reassessment-change">
                  {row.change}
                </dd>
              </>
            ) : null}
          </dl>
        </li>
      ))}
    </ul>
  );
}
