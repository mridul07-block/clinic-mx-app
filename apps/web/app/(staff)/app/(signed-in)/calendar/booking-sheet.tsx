import type { PatientMatch, PhysioSlots } from '@clinic-mx/db';
import { formatIstDate, istDate } from '@clinic-mx/schemas';
import { secondaryButtonClass } from '../../../../../components/forms';
import {
  BookPatientButton,
  CancelBookingButton,
  HoldButton,
  NewPatientBookForm,
  PatientLine,
  type SlotChoiceFields,
} from './booking-forms';
import { timeOf } from './calendar-block';
import { Detail, Drawer } from './drawer';

const inputClass =
  'h-row w-full rounded-control border border-line-control bg-surface px-3 text-ink shadow-xs placeholder:text-ink-faint hover:border-ink-muted pointer-coarse:h-row-touch';

const chipClass =
  'inline-flex min-h-11 items-center rounded-control border border-line-control bg-surface px-3 text-sm text-ink tabular-nums hover:bg-surface-hover disabled:text-ink-faint';

/** The calendar's own address fields, kept by the sheets' search forms. */
function KeepFields({ fields }: { fields: Record<string, string | undefined> }) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
    </>
  );
}

/**
 * The booking sheet (SCH-07, Frontend Specification "New booking sheet"): the held start, then
 * the patient, found by mobile or name, or added with a name and mobile. Book records the front
 * desk as the channel and the person as who booked (PRD J1.5). Cancel gives the hold back.
 */
export function BookingSheet({
  choice,
  date,
  view,
  typeName,
  physioName,
  centreName,
  heldUntil,
  find,
  results,
  closeHref,
}: {
  choice: SlotChoiceFields;
  date: string;
  view?: string;
  typeName: string;
  physioName: string;
  centreName: string;
  /** When the person's hold on this start runs out; undefined once it has. */
  heldUntil?: Date;
  /** The search as typed. */
  find: string;
  /** Patients matching the search; undefined with too little typed. */
  results?: PatientMatch[];
  closeHref: string;
}) {
  const startsAt = new Date(choice.startsAt);
  return (
    <Drawer
      label="Book"
      closeHref={closeHref}
      footer={<CancelBookingButton centreId={choice.centreId} date={date} view={view} />}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold text-ink">Book {typeName}</h2>
        <p
          data-testid="hold-status"
          className={heldUntil ? 'text-ink-secondary' : 'text-waiting-strong'}
        >
          {heldUntil
            ? `Held for you until ${timeOf(heldUntil)}`
            : 'Your hold ran out. Book still works if the time is free.'}
        </p>
      </div>
      <dl className="flex flex-col gap-3">
        <Detail term="When">
          {formatIstDate(istDate(startsAt))}, {timeOf(startsAt)}
        </Detail>
        <Detail term="With">
          {physioName} at {centreName}
        </Detail>
      </dl>

      <section aria-labelledby="find-patient" className="flex flex-col gap-3">
        <h3 id="find-patient" className="text-md font-semibold text-ink">
          Find the patient
        </h3>
        <form role="search" action="/app/calendar" className="flex flex-col gap-2">
          <KeepFields
            fields={{
              centre: choice.centreId,
              date,
              physio: view,
              book: `${choice.physioId}@${choice.startsAt}`,
              type: choice.appointmentTypeId,
            }}
          />
          <label htmlFor="booking-find" className="font-medium text-ink">
            Mobile or name
          </label>
          <input
            id="booking-find"
            name="find"
            type="search"
            autoComplete="off"
            defaultValue={find}
            className={inputClass}
          />
          <button type="submit" className={secondaryButtonClass}>
            Search
          </button>
        </form>
        {find && !results ? (
          <p className="text-ink-muted">Type at least two letters or digits.</p>
        ) : results?.length === 0 ? (
          <p className="text-ink-muted" data-testid="no-patients">
            No patient matches “{find.trim()}”. Add them below.
          </p>
        ) : results ? (
          <ul className="flex flex-col divide-y divide-line" aria-label="Patients found">
            {results.map((patient) => (
              <li
                key={patient.id}
                data-testid="booking-patient"
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <PatientLine patient={patient} />
                <BookPatientButton choice={choice} view={view} patient={patient} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="new-patient" className="flex flex-col gap-3">
        <h3 id="new-patient" className="text-md font-semibold text-ink">
          New patient
        </h3>
        <p className="text-sm text-ink-muted">
          A name and mobile are enough; the rest comes with the health form.
        </p>
        <NewPatientBookForm choice={choice} view={view} />
      </section>
    </Drawer>
  );
}

/**
 * The New booking sheet (SCH-07, the calendar's primary action): pick the type and day, then a
 * physio's free start, which holds it and opens the booking sheet.
 */
export function NewBookingSheet({
  centreId,
  date,
  view,
  types,
  typeId,
  on,
  slots,
  closeHref,
}: {
  centreId: string;
  date: string;
  view?: string;
  types: { id: string; name: string }[];
  typeId?: string;
  on: string;
  /** Free starts per physio for the type and day picked; undefined until both are. */
  slots?: PhysioSlots[];
  closeHref: string;
}) {
  const typeName = types.find((type) => type.id === typeId)?.name ?? '';
  return (
    <Drawer label="New booking" closeHref={closeHref}>
      <h2 className="text-title font-semibold text-ink">New booking</h2>
      <form action="/app/calendar" className="flex flex-col gap-3">
        <KeepFields fields={{ centre: centreId, date, physio: view, new: '1' }} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="booking-type" className="font-medium text-ink">
            Appointment type
          </label>
          <select id="booking-type" name="type" defaultValue={typeId ?? ''} className={inputClass}>
            <option value="" disabled>
              Choose a type
            </option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="booking-on" className="font-medium text-ink">
            Date
          </label>
          <input id="booking-on" name="on" type="date" defaultValue={on} className={inputClass} />
        </div>
        <button type="submit" className={secondaryButtonClass}>
          Show free times
        </button>
      </form>

      {slots ? (
        slots.every((physio) => physio.slots.length === 0) ? (
          <p className="text-ink-muted" data-testid="no-free-times">
            No free time for {typeName} on {formatIstDate(on)}.
          </p>
        ) : (
          <ul className="flex flex-col gap-4" aria-label="Free times">
            {slots
              .filter((physio) => physio.slots.length > 0)
              .map((physio) => (
                <li key={physio.physioId} className="flex flex-col gap-2">
                  <span className="font-medium text-ink">{physio.physioName}</span>
                  <span className="flex flex-wrap gap-2">
                    {physio.slots.map((slot) => (
                      <HoldButton
                        key={slot.startsAt.toISOString()}
                        choice={{
                          centreId,
                          physioId: physio.physioId,
                          appointmentTypeId: typeId ?? '',
                          startsAt: slot.startsAt.toISOString(),
                        }}
                        view={view}
                        label={timeOf(slot.startsAt)}
                        name={`Book ${typeName} at ${timeOf(slot.startsAt)} with ${physio.physioName}`}
                        className={chipClass}
                      />
                    ))}
                  </span>
                </li>
              ))}
          </ul>
        )
      ) : null}
    </Drawer>
  );
}
