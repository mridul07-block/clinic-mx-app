'use client';

import { useActionState, useId } from 'react';
import { FormMessage, secondaryButtonClass } from '../../../../../../components/forms';
import {
  openPartBOnTabletAction,
  type PartBTabletState,
} from '../../../../../../modules/consent/actions';

const initialState: PartBTabletState = {};

/** Open on tablet (BIL-03, PRD J4.4: the tablet as backup): Part B on a kiosk tablet here. */
export function PartBTabletForm({
  episodeId,
  tablets,
}: {
  episodeId: string;
  tablets: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(openPartBOnTabletAction, initialState);
  const picker = useId();
  const [only] = tablets;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="episodeId" value={episodeId} />
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.done ? <FormMessage tone="info">{state.done}</FormMessage> : null}
      {tablets.length > 1 ? (
        <label htmlFor={picker} className="flex flex-col gap-1 text-sm text-ink-secondary">
          Tablet
          <select
            id={picker}
            name="kioskId"
            className="h-row rounded-control border border-line-control bg-surface px-3 text-ink pointer-coarse:h-row-touch"
          >
            {tablets.map((tablet) => (
              <option key={tablet.id} value={tablet.id}>
                {tablet.name}
              </option>
            ))}
          </select>
        </label>
      ) : only ? (
        <input type="hidden" name="kioskId" value={only.id} />
      ) : null}
      <button type="submit" disabled={pending} className={`${secondaryButtonClass} sm:w-auto`}>
        {only && tablets.length === 1 ? `Open Part B on ${only.name}` : 'Open Part B on tablet'}
      </button>
    </form>
  );
}
