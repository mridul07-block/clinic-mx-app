'use client';

import {
  answerText,
  subjectiveAnswered,
  subjectiveField,
  subjectiveFieldShown,
  subjectiveGroups,
  subjectiveSource,
  subjectiveSourceLabels,
  subjectiveValue,
  validSubjectiveAnswer,
  type HealthFormAnswer,
  type HealthFormAnswers,
  type HealthFormField,
  type SubjectiveFieldKey,
  type SubjectiveSource,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import { BodyChart } from '../../../../../../components/body-chart';
import { Tag } from '../../../../../../components/tag';

type Confirmed = Partial<Record<SubjectiveFieldKey, HealthFormAnswer>>;

const sourceTone: Record<SubjectiveSource, Tone> = {
  patient: 'info',
  clinician: 'done',
  unanswered: 'neutral',
};

const control =
  'w-full rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted';
// `:read-only` also matches a select, so only typed inputs grey out by it; a select by disabled.
const typed = `${control} read-only:bg-surface-sunken`;
const chooser = `${control} disabled:bg-surface-sunken`;

const asList = (answer: HealthFormAnswer | undefined): string[] =>
  Array.isArray(answer) ? [...(answer as readonly string[])] : [];

/**
 * Subjective's health form fields (CLN-03): each shows what the patient reported until the
 * clinician changes it, then Clinician confirmed with the patient's words beneath (user decisions
 * 24 October 2026). Grouped as on the health form; the wording is the form's own.
 */
export function SubjectiveFields({
  confirmed,
  patientAnswers,
  readOnly,
  onChange,
}: {
  confirmed: Confirmed;
  patientAnswers: HealthFormAnswers;
  readOnly: boolean;
  onChange: (key: SubjectiveFieldKey, answer: HealthFormAnswer) => void;
}) {
  const shown: HealthFormAnswers = { ...patientAnswers, ...confirmed };
  const change = (key: SubjectiveFieldKey, field: HealthFormField, answer: HealthFormAnswer) => {
    // A value the field cannot hold (a pain of 11) is not taken; the box keeps the last good one.
    if (!readOnly && validSubjectiveAnswer(field, answer)) onChange(key, answer);
  };

  return (
    <div className="flex flex-col gap-6">
      {subjectiveGroups.map((group) => (
        <fieldset key={group.key} className="flex min-w-0 flex-col gap-4">
          <legend className="mb-2 text-md font-semibold">{group.title}</legend>
          {group.fieldKeys
            .filter((key) => subjectiveFieldShown(key, shown))
            .map((key) => {
              const field = subjectiveField(key);
              const source = subjectiveSource(key, confirmed, patientAnswers);
              const value = subjectiveValue(key, confirmed, patientAnswers);
              const original = patientAnswers[key];
              const id = ['subjective', key].join('-');
              return (
                <div
                  key={key}
                  data-testid="subjective-field"
                  data-field={key}
                  className="flex flex-col gap-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FieldLabel field={field} id={id} />
                    <Tag tone={sourceTone[source]}>{subjectiveSourceLabels[source]}</Tag>
                  </div>
                  <FieldInput
                    id={id}
                    field={field}
                    value={value}
                    readOnly={readOnly}
                    onChange={(answer) => {
                      change(key, field, answer);
                    }}
                  />
                  {source === 'clinician' ? (
                    <p className="text-sm text-ink-muted">
                      Patient reported:{' '}
                      {original !== undefined && subjectiveAnswered(original)
                        ? answerText(field, original)
                        : 'nothing'}
                    </p>
                  ) : null}
                </div>
              );
            })}
        </fieldset>
      ))}
    </div>
  );
}

/** A label for one input; choices and the body chart are labelled by their group instead. */
function FieldLabel({ field, id }: { field: HealthFormField; id: string }) {
  if (field.kind === 'multi_choice' || field.kind === 'body_chart') {
    return (
      <span id={`${id}-label`} className="font-medium">
        {field.label}
      </span>
    );
  }
  return (
    <label htmlFor={id} className="font-medium">
      {field.label}
    </label>
  );
}

function FieldInput({
  id,
  field,
  value,
  readOnly,
  onChange,
}: {
  id: string;
  field: HealthFormField;
  value: HealthFormAnswer | undefined;
  readOnly: boolean;
  onChange: (answer: HealthFormAnswer) => void;
}) {
  switch (field.kind) {
    case 'text':
      return (
        <textarea
          id={id}
          rows={2}
          maxLength={field.maxLength}
          readOnly={readOnly}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={typed}
        />
      );
    case 'number':
    case 'scale': {
      const [min, max] = field.kind === 'scale' ? [field.min, field.max] : [0, field.max];
      return (
        <div className="flex flex-wrap items-center gap-3">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            readOnly={readOnly}
            value={typeof value === 'number' ? value : ''}
            onChange={(event) => {
              const text = event.target.value;
              onChange(text === '' ? '' : Number(text));
            }}
            className={`${typed} w-24`}
          />
          <span className="text-sm text-ink-muted">
            {field.kind === 'scale'
              ? `${String(min)} ${field.minLabel.toLowerCase()}, ${String(max)} ${field.maxLabel.toLowerCase()}`
              : field.unit}
          </span>
        </div>
      );
    }
    case 'single_choice':
      return (
        <select
          id={id}
          disabled={readOnly}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={chooser}
        >
          <option value="">Not given</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case 'multi_choice': {
      const ticked = asList(value);
      return (
        <div
          role="group"
          aria-labelledby={`${id}-label`}
          className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2"
        >
          {field.options.map((option) => (
            <label key={option.value} className="flex min-h-row items-center gap-2">
              <input
                type="checkbox"
                disabled={readOnly}
                checked={ticked.includes(option.value)}
                onChange={(event) => {
                  onChange(
                    event.target.checked
                      ? [...ticked, option.value]
                      : ticked.filter((v) => v !== option.value),
                  );
                }}
                className="size-4"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      );
    }
    case 'body_chart':
      return (
        <div role="group" aria-labelledby={`${id}-label`}>
          <BodyChart
            name={id}
            chosen={asList(value)}
            onChange={(zones) => {
              onChange(zones);
            }}
          />
        </div>
      );
    case 'yes_no':
    case 'date':
      return (
        <p id={id} className="text-ink-secondary">
          {value !== undefined && subjectiveAnswered(value) ? answerText(field, value) : '—'}
        </p>
      );
  }
}
