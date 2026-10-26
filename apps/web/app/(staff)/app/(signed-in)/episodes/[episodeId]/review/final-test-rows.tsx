import type { FinalTestRow } from '../../../../../../../modules/reviews/services';

const notTested = (reason: string | null) => `Not tested${reason ? `: ${reason}` : ''}`;

/**
 * Before and after, one baseline measure a row (OUT-07, PRD J6.2): the baseline, session 4 when
 * it was reassessed, the final reading and the change from baseline to final. Built for 360 px:
 * each row stacks.
 */
export function FinalTestRows({
  rows,
  sessionNumber,
}: {
  rows: FinalTestRow[];
  sessionNumber: number | null;
}) {
  return (
    <ul className="flex flex-col gap-3" data-testid="final-test-rows">
      {rows.map((row) => (
        <li
          key={row.measure.key}
          data-testid="final-test-row"
          className="flex flex-col gap-1 border-t border-line pt-3 first:border-0 first:pt-0"
        >
          <span className="font-medium text-ink">{row.measure.name}</span>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
            <dt className="text-ink-muted">Baseline</dt>
            <dd className="text-ink">{row.baseline ?? notTested(row.baselineNotTested)}</dd>
            {sessionNumber !== null ? (
              <>
                <dt className="text-ink-muted">Session {sessionNumber}</dt>
                <dd className="text-ink">{row.session ?? notTested(row.sessionNotTested)}</dd>
              </>
            ) : null}
            <dt className="text-ink-muted">Final</dt>
            <dd className="text-ink">{row.now ?? notTested(row.nowNotTested)}</dd>
            {row.change ? (
              <>
                <dt className="text-ink-muted">Change</dt>
                <dd className="font-medium text-ink" data-testid="final-test-change">
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
