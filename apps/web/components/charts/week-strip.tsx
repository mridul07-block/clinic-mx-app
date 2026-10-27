import { ChartFrame } from './chart-frame';

/**
 * A 7 day week strip (Frontend Specification sections 5 and 8: exercise adherence, for the physio
 * and the patient): seven squares, one a day, filled when done, an outline when missed, faint for a day still
 * to come; each day named in words, never by colour alone.
 */

export const weekDayStates = ['done', 'missed', 'to_come'] as const;

export type WeekDayState = (typeof weekDayStates)[number];

export const weekDayStateLabels: Record<WeekDayState, string> = {
  done: 'Done',
  missed: 'Missed',
  to_come: 'To come',
};

const mark: Record<WeekDayState, string> = {
  done: 'border-viz-1 bg-viz-1',
  missed: 'border-ink-muted bg-surface',
  to_come: 'border-dashed border-line-control bg-surface',
};

export function WeekStrip({
  label,
  days,
}: {
  label: string;
  /** Seven days, oldest first: "Mon", "28 Oct" and how it went. */
  days: readonly { day: string; date: string; state: WeekDayState }[];
}) {
  const done = days.filter((day) => day.state === 'done').length;
  const counted = days.filter((day) => day.state !== 'to_come').length;
  return (
    <ChartFrame
      label={label}
      table={{
        columns: ['Day', 'Exercises'],
        rows: days.map((day) => [`${day.day} ${day.date}`, weekDayStateLabels[day.state]]),
      }}
    >
      <div className="flex flex-col gap-2">
        <ol className="grid grid-cols-7 gap-1" aria-label={label}>
          {days.map((day) => (
            <li
              key={day.date}
              className="flex flex-col items-center gap-1"
              data-words={`${day.day} ${day.date}: ${weekDayStateLabels[day.state]}`}
              data-state={day.state}
              data-testid="week-day"
            >
              <span
                className={`size-7 rounded-control border-2 ${mark[day.state]}`}
                aria-hidden="true"
              />
              <span className="text-xs text-ink-muted">{day.day}</span>
              <span className="sr-only">{weekDayStateLabels[day.state]}</span>
            </li>
          ))}
        </ol>
        <ul
          className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-secondary"
          aria-hidden="true"
        >
          {weekDayStates.map((state) => (
            <li key={state} className="flex items-center gap-1">
              <span className={`size-3 rounded-[2px] border-2 ${mark[state]}`} />
              {weekDayStateLabels[state]}
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-secondary">
          {done} of {counted} days done so far
        </p>
      </div>
    </ChartFrame>
  );
}
