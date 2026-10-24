'use client';

import {
  patientScreeningAnswer,
  screeningAnswerText,
  screeningItems,
  screeningRegionLabels,
  validScreeningAnswer,
  type HealthFormAnswers,
  type ScreeningConfirmed,
  type ScreeningItem,
  type ScreeningProgress,
  type ScreeningRegion,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import { Tag } from '../../../../../../components/tag';

type Status = 'unconfirmed' | 'confirmed' | 'changed';

const statusLabel: Record<Status, string> = {
  unconfirmed: 'Not confirmed',
  confirmed: 'Confirmed',
  changed: "Changed from the patient's answer",
};
const statusTone: Record<Status, Tone> = {
  unconfirmed: 'waiting',
  confirmed: 'done',
  changed: 'danger',
};

const choice =
  'flex min-h-row flex-1 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface px-4 font-medium has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus has-[:disabled]:cursor-default pointer-coarse:min-h-row-touch';

/**
 * Screening's items (CLN-04, PRD J3.3): the region's red flag questions, then each precaution.
 * Nothing is preselected; the clinician taps Yes or No (or enters the number) with what the
 * patient said beside it, and a confirmation that differs from the patient is marked (user
 * decisions 24 October 2026). Signing waits until every item asked is confirmed.
 */
export function ScreeningItems({
  region,
  sex,
  progress,
  confirmed,
  patientAnswers,
  readOnly,
  onConfirm,
}: {
  region: ScreeningRegion | undefined;
  sex: unknown;
  progress: ScreeningProgress;
  confirmed: ScreeningConfirmed;
  patientAnswers: HealthFormAnswers;
  readOnly: boolean;
  onConfirm: (key: string, answer: boolean | number) => void;
}) {
  const items = screeningItems(region, sex, confirmed);
  const groups = [
    { key: 'question', title: 'Red flag questions' },
    { key: 'precaution', title: 'Precautions' },
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      <p data-testid="screening-progress" className="text-sm text-ink-secondary">
        Region: {region ? screeningRegionLabels[region] : 'not given'} ·{' '}
        {`${String(progress.confirmed)} of ${String(progress.total)} confirmed`}
      </p>
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          <h3 className="text-md font-semibold">{group.title}</h3>
          <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
            {items
              .filter((item) => item.kind === group.key)
              .map((item) => (
                <Item
                  key={item.key}
                  item={item}
                  value={confirmed[item.key]}
                  patient={patientScreeningAnswer(item, patientAnswers)}
                  readOnly={readOnly}
                  onConfirm={(answer) => {
                    if (!readOnly && validScreeningAnswer(item.key, answer)) {
                      onConfirm(item.key, answer);
                    }
                  }}
                />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Item({
  item,
  value,
  patient,
  readOnly,
  onConfirm,
}: {
  item: ScreeningItem;
  value: boolean | number | undefined;
  patient: boolean | number | undefined;
  readOnly: boolean;
  onConfirm: (answer: boolean | number) => void;
}) {
  const status: Status =
    value === undefined
      ? 'unconfirmed'
      : patient !== undefined && value !== patient
        ? 'changed'
        : 'confirmed';
  const textId = ['screening', item.key, 'text'].join('-');
  return (
    <li
      data-testid="screening-item"
      data-item={item.key}
      className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center md:justify-between md:gap-6"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span id={textId} className="font-medium">
          {item.text}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span>Patient said: {screeningAnswerText(item, patient)}</span>
          <Tag tone={statusTone[status]}>{statusLabel[status]}</Tag>
        </span>
      </div>
      {item.input === 'yes_no' ? (
        <div role="radiogroup" aria-labelledby={textId} className="flex shrink-0 gap-2 md:w-48">
          {[
            { answer: true, label: 'Yes' },
            { answer: false, label: 'No' },
          ].map((option) => (
            <label key={option.label} className={choice}>
              <input
                type="radio"
                name={item.key}
                className="sr-only"
                disabled={readOnly}
                checked={value === option.answer}
                onChange={() => {
                  onConfirm(option.answer);
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={item.max}
            step={1}
            aria-labelledby={textId}
            readOnly={readOnly}
            value={typeof value === 'number' ? value : ''}
            onChange={(event) => {
              if (event.target.value !== '') onConfirm(Number(event.target.value));
            }}
            className="w-24 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted read-only:bg-surface-sunken"
          />
          <span className="text-sm text-ink-muted">{item.unit}</span>
        </div>
      )}
    </li>
  );
}
