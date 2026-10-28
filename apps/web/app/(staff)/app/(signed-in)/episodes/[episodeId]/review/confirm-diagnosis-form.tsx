'use client';

import { confirmedDiagnosisStageLabels, formatIstDateTime } from '@clinic-mx/schemas';
import { useActionState, useState } from 'react';
import { ConditionSearch } from '../../../../../../../components/condition-search';
import { FormMessage, primaryButtonClass } from '../../../../../../../components/forms';
import { Tag } from '../../../../../../../components/tag';
import {
  confirmDiagnosisAction,
  type ReadinessFormState,
} from '../../../../../../../modules/reviews/actions';
import type { ConfirmDiagnosisView } from '../../../../../../../modules/reviews/confirm-diagnosis';

const initialState: ReadinessFormState = {};

/**
 * The confirmed diagnosis (AI-05; PRD section 6: the learning label, "the diagnosis confirmed at
 * review or discharge, not the first impression"): the signed diagnosis, the latest confirmation,
 * and for consultants the condition to confirm, the signed one unless changed. Never changed once
 * confirmed; confirming again records the new label.
 */
export function ConfirmDiagnosisPanel({
  episodeId,
  view,
}: {
  episodeId: string;
  view: ConfirmDiagnosisView;
}) {
  const [state, action, pending] = useActionState(confirmDiagnosisAction, initialState);
  const { signed, confirmed, catalog } = view;
  const [conditionId, setConditionId] = useState(
    confirmed?.conditionId ?? signed?.conditionId ?? '',
  );
  const condition = catalog?.conditions.find((c) => c.conditionId === conditionId);
  return (
    <section
      aria-labelledby="confirmed-diagnosis"
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
      data-testid="confirm-diagnosis"
    >
      <h2 id="confirmed-diagnosis" className="font-semibold text-ink">
        Confirmed diagnosis
      </h2>
      {!signed ? (
        <p className="text-ink-muted">Confirmed once the consultation is signed.</p>
      ) : (
        <>
          <p className="text-sm text-ink-secondary" data-testid="signed-diagnosis">
            Diagnosis at the consultation: {signed.name}
          </p>
          {confirmed ? (
            <div className="flex flex-col gap-1" data-testid="confirmed-diagnosis-record">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">{confirmed.name}</span>
                <Tag tone="done">Confirmed diagnosis</Tag>
              </span>
              <span className="text-sm text-ink-secondary">
                {confirmedDiagnosisStageLabels[confirmed.stage]}
                {confirmed.changed ? ', changed from the consultation' : ''}
                {confirmed.by ? ` · ${confirmed.by}` : ''} · {formatIstDateTime(confirmed.at)}
              </span>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Not confirmed yet.</p>
          )}
          {view.confirms && catalog ? (
            <form action={action} className="flex flex-col gap-3">
              <input type="hidden" name="episodeId" value={episodeId} />
              <input type="hidden" name="conditionId" value={conditionId} />
              <p className="text-sm text-ink-secondary">
                Confirm the diagnosis as it stands now, or change it. A later confirmation replaces
                this one as the episode’s label; neither is ever edited.
              </p>
              <ConditionSearch
                condition={condition}
                catalog={catalog}
                region={view.region}
                readOnly={false}
                onChoose={(next) => {
                  setConditionId(next.conditionId);
                }}
                label="Diagnosis to confirm"
              />
              {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
              {state.done && !pending ? <FormMessage tone="info">Confirmed.</FormMessage> : null}
              <button
                type="submit"
                disabled={pending || !condition}
                className={`${primaryButtonClass} md:w-auto md:self-start`}
              >
                {pending ? 'Confirming…' : 'Confirm diagnosis'}
              </button>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
