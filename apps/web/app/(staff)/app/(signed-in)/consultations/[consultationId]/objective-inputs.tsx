'use client';

import {
  INTERPRETATION_MAX,
  isPaired,
  knowledgeRegionKeys,
  knowledgeRegions,
  lsiPercent,
  measureResult,
  measureStatusLabels,
  specialTestResultLabels,
  specialTestResults,
  type ConsultationSections,
  type KnowledgeMeasure,
  type KnowledgeRegion,
  type KnowledgeSpecialTest,
  type MeasureEntry,
  type MeasureStatus,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import { Tag } from '../../../../../../components/tag';

type Objective = ConsultationSections['objective'];

const statusTone: Record<MeasureStatus, Tone> = {
  pass: 'done',
  symmetrical: 'done',
  full: 'done',
  not_yet: 'waiting',
  mild: 'waiting',
  restricted: 'danger',
};

const input =
  'w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs tabular-nums hover:border-ink-muted read-only:bg-surface-sunken';
const choice =
  'flex min-h-row flex-1 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface px-3 font-medium has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus has-[:disabled]:cursor-default pointer-coarse:min-h-row-touch';

const reading = (text: string): number | undefined => {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
};

/** The entry without the sides left empty, so an emptied measure is no longer recorded. */
const tidy = (entry: MeasureEntry): MeasureEntry =>
  Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));

/**
 * Objective (CLN-05, PRD J3.4): the region's measures from its workbook, with the LSI or deficit
 * worked out live as the workbook's formula does, its 0 to 3 ratings, and the special tests the
 * clinician adds from the region's list (user decisions 24 October 2026).
 */
export function ObjectiveInputs({
  objective,
  catalog,
  defaultRegion,
  readOnly,
  onChange,
}: {
  objective: Objective;
  catalog: { measures: KnowledgeMeasure[]; specialTests: KnowledgeSpecialTest[] };
  defaultRegion: KnowledgeRegion | undefined;
  readOnly: boolean;
  onChange: (objective: Objective) => void;
}) {
  const region = objective.region || defaultRegion;
  const set = (next: Partial<Objective>) => {
    if (!readOnly) onChange({ ...objective, region: region ?? '', ...next });
  };
  const measures = catalog.measures.filter((m) => m.region === region);
  const sections = [...new Set(measures.map((m) => m.section))];
  const tests = catalog.specialTests.filter((t) => t.region === region);
  const added = objective.tests;
  const testByKey = new Map(catalog.specialTests.map((t) => [t.key, t]));
  const setMeasure = (key: string, entry: MeasureEntry) => {
    const kept = tidy(entry);
    const others = Object.entries(objective.measures).filter(([other]) => other !== key);
    set({
      measures: Object.fromEntries(
        Object.keys(kept).length > 0 ? [...others, [key, kept]] : others,
      ),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <label className="flex flex-col gap-1.5 md:w-72">
          <span className="font-medium">Region</span>
          <select
            value={region ?? ''}
            disabled={readOnly}
            onChange={(event) => {
              set({ region: event.target.value as KnowledgeRegion });
            }}
            className={`${input} disabled:bg-surface-sunken`}
          >
            {region ? null : <option value="">Choose the region</option>}
            {knowledgeRegionKeys.map((key) => (
              <option key={key} value={key}>
                {knowledgeRegions[key].label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1.5 md:w-60">
          <legend className="mb-1.5 font-medium">Involved side</legend>
          <div className="flex gap-2">
            {(['left', 'right'] as const).map((side) => (
              <label key={side} className={choice}>
                <input
                  type="radio"
                  name="involved-side"
                  className="sr-only"
                  disabled={readOnly}
                  checked={objective.side === side}
                  onChange={() => {
                    set({ side });
                  }}
                />
                {side === 'left' ? 'Left' : 'Right'}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {sections.map((section) => (
        <section key={section} className="flex flex-col gap-2">
          <h3 className="text-md font-semibold">{section}</h3>
          <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
            {measures
              .filter((m) => m.section === section)
              .map((measure) => (
                <MeasureRow
                  key={measure.key}
                  measure={measure}
                  entry={objective.measures[measure.key] ?? {}}
                  readOnly={readOnly}
                  onChange={(entry) => {
                    setMeasure(measure.key, entry);
                  }}
                />
              ))}
          </ul>
        </section>
      ))}

      <section className="flex flex-col gap-3">
        <h3 className="text-md font-semibold">Special tests</h3>
        {added.length > 0 ? (
          <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
            {added.map((entry) => {
              const test = testByKey.get(entry.key);
              const update = (next: Partial<typeof entry>) => {
                set({ tests: added.map((t) => (t.key === entry.key ? { ...t, ...next } : t)) });
              };
              return (
                <li
                  key={entry.key}
                  data-testid="special-test"
                  data-test={entry.key}
                  className="flex flex-col gap-2 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">{test?.test ?? entry.key}</span>
                      {test ? (
                        <span className="text-sm text-ink-muted">
                          {test.category} · {test.targets}
                        </span>
                      ) : null}
                    </div>
                    {readOnly ? null : (
                      <button
                        type="button"
                        onClick={() => {
                          set({ tests: added.filter((t) => t.key !== entry.key) });
                        }}
                        className="text-sm underline underline-offset-2"
                        aria-label={`Remove ${test?.test ?? entry.key}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {test?.positiveFinding ? (
                    <p className="text-sm text-ink-secondary">
                      Positive finding: {test.positiveFinding}
                    </p>
                  ) : null}
                  <div
                    role="radiogroup"
                    aria-label={`Result of ${test?.test ?? entry.key}`}
                    className="flex gap-2 md:w-96"
                  >
                    {specialTestResults.map((result) => (
                      <label key={result} className={choice}>
                        <input
                          type="radio"
                          name={['result', entry.key].join('-')}
                          className="sr-only"
                          disabled={readOnly}
                          checked={entry.result === result}
                          onChange={() => {
                            update({ result });
                          }}
                        />
                        {specialTestResultLabels[result]}
                      </label>
                    ))}
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-sm font-medium">Interpretation</span>
                    <input
                      type="text"
                      maxLength={INTERPRETATION_MAX}
                      readOnly={readOnly}
                      value={entry.interpretation}
                      onChange={(event) => {
                        update({ interpretation: event.target.value });
                      }}
                      className={input}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No special tests added yet.</p>
        )}
        {readOnly || tests.length === 0 ? null : (
          <label className="flex flex-col gap-1.5 md:w-96">
            <span className="font-medium">Add a test</span>
            <select
              value=""
              onChange={(event) => {
                const key = event.target.value;
                if (key && !added.some((t) => t.key === key)) {
                  set({ tests: [...added, { key, interpretation: '' }] });
                }
              }}
              className={input}
            >
              <option value="">Choose a test</option>
              {[...new Set(tests.map((t) => t.category))].map((category) => (
                <optgroup key={category} label={category}>
                  {tests
                    .filter((t) => t.category === category && !added.some((a) => a.key === t.key))
                    .map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.test}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
      </section>
    </div>
  );
}

function MeasureRow({
  measure,
  entry,
  readOnly,
  onChange,
}: {
  measure: KnowledgeMeasure;
  entry: MeasureEntry;
  readOnly: boolean;
  onChange: (entry: MeasureEntry) => void;
}) {
  const result = measureResult(measure, entry);
  const nameId = ['measure', measure.key].join('-').replace(/[^a-z0-9-]/g, '-');
  const field = (side: keyof MeasureEntry, label: string) => (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={[nameId, side].join('-')} className="text-sm text-ink-secondary">
        {label}
      </label>
      <span className="flex items-center gap-1.5">
        <input
          id={[nameId, side].join('-')}
          type="number"
          inputMode="decimal"
          step="any"
          readOnly={readOnly}
          aria-describedby={nameId}
          value={entry[side] ?? ''}
          onChange={(event) => {
            onChange({ ...entry, [side]: reading(event.target.value) });
          }}
          className={input}
        />
        <span className="shrink-0 text-sm text-ink-muted">{measure.unit}</span>
      </span>
    </div>
  );
  const rule = measure.rule;
  return (
    <li
      data-testid="measure"
      data-measure={measure.key}
      className="flex flex-col gap-2 px-3 py-3 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)_11rem] md:items-end md:gap-4"
    >
      <div className="flex min-w-0 flex-col gap-0.5 md:self-center">
        <span id={nameId} className="font-medium">
          {measure.name}
        </span>
        {measure.direction ? (
          <span className="text-sm text-ink-muted">{measure.direction}</span>
        ) : null}
        {measure.note ? <span className="text-sm text-ink-muted">{measure.note}</span> : null}
      </div>
      {measure.kind === 'grade' ? (
        <div className="flex flex-col gap-1">
          <div role="radiogroup" aria-labelledby={nameId} className="flex gap-2">
            {[0, 1, 2, 3].map((grade) => (
              <label key={grade} className={choice}>
                <input
                  type="radio"
                  name={measure.key}
                  className="sr-only"
                  disabled={readOnly}
                  checked={entry.value === grade}
                  onChange={() => {
                    onChange({ value: grade });
                  }}
                />
                {grade}
              </label>
            ))}
          </div>
          {/* DECISION CLN-05: what each grade means comes from the clinic; none is invented. */}
          <span className="text-sm text-ink-muted">Grade definitions are awaiting the clinic.</span>
        </div>
      ) : isPaired(measure) ? (
        <div className="flex gap-3">
          {field('involved', 'Involved')}
          {field('uninvolved', 'Uninvolved')}
        </div>
      ) : (
        <div className="flex gap-3">
          {field('value', 'Measured')}
          {rule.kind === 'reference_deficit' || rule.kind === 'reference_target' ? (
            <span className="flex flex-1 flex-col justify-end gap-1 pb-2 text-sm text-ink-secondary">
              {rule.kind === 'reference_deficit' ? 'Normal' : 'Target'}{' '}
              {`${String(rule.reference)} ${measure.unit}`}
            </span>
          ) : null}
        </div>
      )}
      <div
        data-testid="measure-result"
        className="flex min-h-row items-center gap-2 text-sm md:justify-end"
      >
        {result.lsi !== undefined ? (
          <span className="tabular-nums">LSI {lsiPercent(result.lsi)}</span>
        ) : null}
        {result.deficit !== undefined ? (
          <span className="tabular-nums">
            Deficit {`${String(Math.round(result.deficit * 10) / 10)} ${measure.unit}`}
          </span>
        ) : null}
        {result.status ? (
          <Tag tone={statusTone[result.status]}>{measureStatusLabels[result.status]}</Tag>
        ) : null}
      </div>
    </li>
  );
}
