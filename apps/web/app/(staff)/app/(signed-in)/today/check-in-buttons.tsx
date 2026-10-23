'use client';

import { startTransition, useActionState, useId, useState, type SubmitEvent } from 'react';
import {
  FormMessage,
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '../../../../../components/forms';
import {
  addReportsAction,
  checkInAction,
  openOnTabletAction,
  showQrAction,
  undoCheckInAction,
  type TodayFormState,
} from '../../../../../modules/front-desk/actions';
import { shrinkPhotos } from '../../../../../lib/shrink-photo';

const initialState: TodayFormState = {};

/** The appointment a drawer form is about, and the board it goes back to. */
export interface DrawerPlace {
  appointmentId: string;
  centreId: string;
  /** The chip picked on the board, kept after the post. */
  show?: string;
}

function Fields({ place }: { place: DrawerPlace }) {
  return (
    <>
      <input type="hidden" name="appointmentId" value={place.appointmentId} />
      <input type="hidden" name="centreId" value={place.centreId} />
      {place.show ? <input type="hidden" name="show" value={place.show} /> : null}
    </>
  );
}

function Refusal({ state }: { state: TodayFormState }) {
  return state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null;
}

/**
 * Check in (INT-02, user decision 23 October 2026): the desk ticks that it has checked who the
 * patient is, then checks them in; the arrival time and who did it are recorded.
 */
export function CheckInForm({ place }: { place: DrawerPlace }) {
  const [state, action, pending] = useActionState(checkInAction, initialState);
  const tick = useId();
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <Fields place={place} />
      <Refusal state={state} />
      <label
        htmlFor={tick}
        className="flex min-h-11 items-start gap-3 rounded-control border border-line-control bg-surface p-3 text-ink"
      >
        <input id={tick} type="checkbox" name="identityChecked" className="mt-1 size-5 shrink-0" />
        <span>I have checked who this is (name and date of birth)</span>
      </label>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        Check in
      </button>
    </form>
  );
}

/** Undo a check in made by mistake (INT-01), on the appointment's day. */
export function UndoCheckInButton({ place }: { place: DrawerPlace }) {
  const [state, action, pending] = useActionState(undoCheckInAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <Fields place={place} />
      <Refusal state={state} />
      <button type="submit" disabled={pending} className={dangerButtonClass}>
        Undo check in
      </button>
    </form>
  );
}

/** Show QR (INT-02): the health form link, issued if needed, as a QR for the patient's phone. */
export function ShowQrButton({ place, label }: { place: DrawerPlace; label: string }) {
  const [state, action, pending] = useActionState(showQrAction, initialState);
  return (
    <form action={action} className="flex flex-col gap-2">
      <Fields place={place} />
      <Refusal state={state} />
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {label}
      </button>
    </form>
  );
}

/** Open on tablet (INT-02): the health form goes to the centre's kiosk tablet (IAM-10). */
export function OpenOnTabletForm({
  place,
  tablets,
}: {
  place: DrawerPlace;
  tablets: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(openOnTabletAction, initialState);
  const picker = useId();
  const [only] = tablets;
  return (
    <form action={action} className="flex flex-col gap-2">
      <Fields place={place} />
      <Refusal state={state} />
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
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {only && tablets.length === 1 ? `Open on ${only.name}` : 'Open on tablet'}
      </button>
    </form>
  );
}

/**
 * Add reports (INT-02): photos taken or chosen on the device, shrunk first to save mobile data,
 * and PDF scans as they are, up to `maxMegabytes` each.
 */
export function ReportUpload({
  place,
  maxMegabytes,
}: {
  place: DrawerPlace;
  maxMegabytes: number;
}) {
  const [state, action, pending] = useActionState(addReportsAction, initialState);
  const [preparing, setPreparing] = useState(false);
  const [tooBig, setTooBig] = useState<string>();
  const input = useId();

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const chosen = form.getAll('reports').filter((v): v is File => v instanceof File && v.size > 0);
    setPreparing(true);
    // A photo the browser cannot redraw goes as it is; the server says if it cannot be used.
    void shrinkPhotos(chosen)
      .then((files) => {
        // Said here, before a large upload is sent and refused.
        const large = files.find((file) => file.size > maxMegabytes * 1024 * 1024);
        setTooBig(large ? `${large.name} is larger than ${String(maxMegabytes)} MB.` : undefined);
        if (large) return;
        form.delete('reports');
        for (const file of files) form.append('reports', file);
        startTransition(() => {
          action(form);
        });
      })
      .finally(() => {
        setPreparing(false);
      });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <Fields place={place} />
      {tooBig ? <FormMessage tone="danger">{tooBig}</FormMessage> : <Refusal state={state} />}
      <label htmlFor={input} className="flex flex-col gap-1 text-sm text-ink-secondary">
        Photos or PDFs of the patient’s reports, up to {maxMegabytes} MB each
        <input
          id={input}
          type="file"
          name="reports"
          multiple
          accept="image/jpeg,image/png,image/heic,application/pdf"
          className="text-ink file:mr-3 file:h-row file:rounded-control file:border file:border-line-control file:bg-surface file:px-3 file:text-ink"
        />
      </label>
      <button type="submit" disabled={pending || preparing} className={secondaryButtonClass}>
        {preparing ? 'Preparing' : pending ? 'Adding' : 'Add reports'}
      </button>
    </form>
  );
}
