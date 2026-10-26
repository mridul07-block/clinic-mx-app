'use client';

import {
  BASELINE_REASON_MAX,
  emptyReassessmentEntry,
  entryOfReassessment,
  reassessmentChangeText,
  takesBothSides,
  type KnowledgeMeasure,
  type MeasureEntry,
  type ReassessmentEntry,
} from '@clinic-mx/schemas';

const choice =
  'flex min-h-row flex-1 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface px-3 font-medium has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus has-[:disabled]:cursor-default pointer-coarse:min-h-row-touch';
const tick = 'size-5 shrink-0 accent-ink';
const input =
  'h-row w-full min-w-0 rounded-control border border-line-control bg-surface px-3 text-md shadow-xs hover:border-ink-muted read-only:bg-surface-sunken pointer-coarse:h-row-touch';
const grades = ['0', '1', '2', '3'] as const;
const gradeLabels = { 0: '0', 1: '1', 2: '2', 3: '3' } as Record<(typeof grades)[number], string>;

/** One-tap choices, as radios that look like buttons. */
export function Choices<T extends string>({
  name,
  options,
  labels,
  value,
  readOnly,
  onChange,
}: {
  name: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T | null;
  readOnly: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <label key={option} className={choice}>
          <input
            type="radio"
            name={name}
            className="sr-only"
            disabled={readOnly}
            checked={value === option}
            onChange={() => {
              onChange(option);
            }}
          />
          {labels[option]}
        </label>
      ))}
    </div>
  );
}

/** A number field for one reading; empty is null. */
export function Reading({
  label,
  unit,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | null;
  readOnly: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="decimal"
        step="any"
        aria-label={label}
        readOnly={readOnly}
        value={value ?? ''}
        onChange={(event) => {
          const read = event.target.valueAsNumber;
          onChange(Number.isFinite(read) ? read : null);
        }}
        className={`${input} max-w-32`}
      />
      <span className="text-ink-secondary">{unit === 'grade' ? '' : unit}</span>
    </div>
  );
}

/**
 * Retesting one baseline measure (session 4, OUT-05; final testing, OUT-07): both sides of a side
 * by side measure, a 0 to 3 grade, or one value, with the change from the baseline as it is typed;
 * or Not tested with a reason. Built for 360 px: the sides stack.
 */
export function RetestInputs({
  measure,
  baselineEntry,
  entry: given,
  readOnly,
  testIdPrefix,
  onChange,
}: {
  measure: KnowledgeMeasure;
  baselineEntry: MeasureEntry;
  entry: ReassessmentEntry | undefined;
  readOnly: boolean;
  /** For example `reassessment`, giving `reassessment-live-change`. */
  testIdPrefix: string;
  onChange: (entry: ReassessmentEntry) => void;
}) {
  const entry = given ?? emptyReassessmentEntry;
  const change = reassessmentChangeText(measure, baselineEntry, entryOfReassessment(entry));
  const update = (part: Partial<ReassessmentEntry>) => {
    onChange({ ...entry, ...part });
  };
  return (
    <>
      {!entry.notTested ? (
        takesBothSides(measure) ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink-secondary">Involved</span>
              <Reading
                label={`${measure.name} involved`}
                unit={measure.unit}
                value={entry.involved}
                readOnly={readOnly}
                onChange={(involved) => {
                  update({ involved });
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-ink-secondary">Uninvolved</span>
              <Reading
                label={`${measure.name} uninvolved`}
                unit={measure.unit}
                value={entry.uninvolved}
                readOnly={readOnly}
                onChange={(uninvolved) => {
                  update({ uninvolved });
                }}
              />
            </div>
          </div>
        ) : measure.kind === 'grade' ? (
          <Choices
            name={[testIdPrefix, measure.key].join('-')}
            options={grades}
            labels={gradeLabels}
            value={entry.value === null ? null : (String(entry.value) as (typeof grades)[number])}
            readOnly={readOnly}
            onChange={(value) => {
              update({ value: Number(value) });
            }}
          />
        ) : (
          <Reading
            label={measure.name}
            unit={measure.unit}
            value={entry.value}
            readOnly={readOnly}
            onChange={(value) => {
              update({ value });
            }}
          />
        )
      ) : null}
      {change && !entry.notTested ? (
        <p
          className="text-sm font-medium text-ink"
          data-testid={[testIdPrefix, 'live-change'].join('-')}
        >
          {change}
        </p>
      ) : null}
      <label className="flex min-h-row items-center gap-3 pointer-coarse:min-h-row-touch">
        <input
          type="checkbox"
          className={tick}
          disabled={readOnly}
          checked={entry.notTested}
          onChange={(event) => {
            update({ notTested: event.target.checked });
          }}
        />
        Not tested
      </label>
      {entry.notTested ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-secondary">Why it was not tested</span>
          <input
            type="text"
            maxLength={BASELINE_REASON_MAX}
            readOnly={readOnly}
            value={entry.reason}
            onChange={(event) => {
              update({ reason: event.target.value });
            }}
            className={input}
          />
        </label>
      ) : null}
    </>
  );
}
