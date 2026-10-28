'use client';

import {
  MOVEMENT_MAX,
  irritabilities,
  irritabilityFeatures,
  irritabilityLabels,
  knowledgeRegions,
  stageLabels,
  stages,
  weeksText,
  type AssessmentCatalog,
  type AssessmentCondition,
  type AssessmentSettings,
  type AssessmentSuggestions,
  type ConsultationSections,
  type KnowledgeRegion,
} from '@clinic-mx/schemas';
import { useId, useMemo } from 'react';
import { ConditionSearch } from '../../../../../../components/condition-search';

type Assessment = ConsultationSections['assessment'];

const input =
  'w-full min-w-0 rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted read-only:bg-surface-sunken';
const choice =
  'flex min-h-row flex-1 cursor-pointer flex-wrap items-center justify-center gap-x-2 rounded-control border border-line-control bg-surface px-3 py-1.5 font-medium has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus has-[:disabled]:cursor-default pointer-coarse:min-h-row-touch';

const painSourceText = { pain_now: 'pain now', pain_activity: 'pain with activity' } as const;

/**
 * Assessment (CLN-06, PRD J3.6): the four part working diagnosis of the client's SOP: a knowledge
 * base condition, the movement diagnosis with the workbook's biomechanical cause beside it,
 * irritability and stage with what the pain and duration suggest (never chosen for the
 * clinician), and the client's diagnosis category, coded from the condition once mapped (user
 * decisions 24 October 2026).
 */
export function AssessmentInputs({
  assessment,
  catalog,
  suggestions,
  settings,
  region,
  readOnly,
  onChange,
}: {
  assessment: Assessment;
  catalog: AssessmentCatalog;
  suggestions: AssessmentSuggestions;
  settings: AssessmentSettings;
  /** The Objective's workbook, whose conditions the search lists first. */
  region: KnowledgeRegion | undefined;
  readOnly: boolean;
  onChange: (assessment: Assessment) => void;
}) {
  const set = (next: Partial<Assessment>) => {
    if (!readOnly) onChange({ ...assessment, ...next });
  };
  const byId = useMemo(
    () => new Map(catalog.conditions.map((condition) => [condition.conditionId, condition])),
    [catalog.conditions],
  );
  const condition = assessment.conditionId ? byId.get(assessment.conditionId) : undefined;
  const mapped = condition?.categoryCode
    ? catalog.categories.find((category) => category.code === condition.categoryCode)
    : undefined;
  const choose = (next: AssessmentCondition) => {
    // A category coded from the previous condition goes with it; one the clinician picked stays.
    const coded = condition?.categoryCode === assessment.categoryCode;
    set({
      conditionId: next.conditionId,
      categoryCode: next.categoryCode ?? (coded ? '' : assessment.categoryCode),
    });
  };
  const movementId = useId();
  const causes = condition?.listings.filter((listing) => listing.biomechanicalCause) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <ConditionSearch
        condition={condition}
        catalog={catalog}
        region={region}
        readOnly={readOnly}
        onChoose={choose}
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={movementId} className="font-medium">
          Movement diagnosis
        </label>
        <input
          id={movementId}
          type="text"
          maxLength={MOVEMENT_MAX}
          readOnly={readOnly}
          value={assessment.movement}
          placeholder="For example, dynamic valgus"
          onChange={(event) => {
            set({ movement: event.target.value });
          }}
          className={input}
        />
        {causes.map((listing) => (
          <p
            key={listing.region}
            data-testid="biomechanical-cause"
            className="text-sm text-ink-secondary"
          >
            <span className="font-medium">
              From the {knowledgeRegions[listing.region].label} workbook:
            </span>{' '}
            {listing.biomechanicalCause}
          </p>
        ))}
      </div>

      <fieldset data-testid="irritability" className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium">Irritability</legend>
        {suggestions.irritability ? (
          <p className="text-sm text-ink-secondary">
            Suggested from pain: worst {suggestions.irritability.worst}/10 (
            {painSourceText[suggestions.irritability.from]})
          </p>
        ) : (
          <p className="text-sm text-ink-muted">No pain scores to suggest from.</p>
        )}
        <div className="flex gap-2 md:w-[28rem]">
          {irritabilities.map((level) => (
            <label key={level} className={choice}>
              <input
                type="radio"
                name="irritability"
                className="sr-only"
                disabled={readOnly}
                checked={assessment.irritability === level}
                onChange={() => {
                  set({ irritability: level });
                }}
              />
              {irritabilityLabels[level]}
              {suggestions.irritability?.level === level ? <SuggestedTag /> : null}
            </label>
          ))}
        </div>
        <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
          {irritabilities.map((level) => (
            <li key={level}>
              <span className="font-medium">{irritabilityLabels[level]}:</span>{' '}
              {irritabilityFeatures[level]}
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset data-testid="stage" className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium">Stage</legend>
        {suggestions.stage ? (
          <p className="text-sm text-ink-secondary">
            Suggested from duration: {weeksText(suggestions.stage.weeks)}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">No duration to suggest from.</p>
        )}
        <div className="grid grid-cols-3 gap-2 md:flex">
          {stages.map((stage) => (
            <label key={stage} className={choice}>
              <input
                type="radio"
                name="stage"
                className="sr-only"
                disabled={readOnly}
                checked={assessment.stage === stage}
                onChange={() => {
                  set({ stage });
                }}
              />
              {stageLabels[stage]}
              {suggestions.stage?.stage === stage ? <SuggestedTag /> : null}
            </label>
          ))}
        </div>
        <p className="text-sm text-ink-muted">
          Acute under {settings.acuteWeeksBelow} weeks · Subacute {settings.acuteWeeksBelow} to{' '}
          {settings.chronicWeeksAbove} weeks · Chronic over {settings.chronicWeeksAbove} weeks
        </p>
      </fieldset>

      {mapped ? (
        <div data-testid="category" className="flex flex-col gap-1">
          <span className="font-medium">Diagnosis category</span>
          <p>{mapped.name}</p>
          <p className="text-sm text-ink-muted">Coded from the condition.</p>
        </div>
      ) : (
        <label data-testid="category" className="flex flex-col gap-1.5 md:w-96">
          <span className="font-medium">Diagnosis category</span>
          <select
            value={assessment.categoryCode}
            disabled={readOnly}
            onChange={(event) => {
              set({ categoryCode: event.target.value });
            }}
            className={`${input} disabled:bg-surface-sunken`}
          >
            <option value="">Choose the category</option>
            {catalog.categories.map((category) => (
              <option key={category.code} value={category.code}>
                {category.name}
              </option>
            ))}
          </select>
          {/* DECISION CLN-06: the client maps conditions to categories (SET-12). */}
          <span className="text-sm text-ink-muted">
            Coded from the condition once the clinic maps its conditions to categories.
          </span>
        </label>
      )}

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          disabled={readOnly}
          checked={assessment.provisional}
          onChange={(event) => {
            set({ provisional: event.target.checked });
          }}
          className="size-5 accent-ink"
        />
        <span className="font-medium">Provisional diagnosis</span>
      </label>
    </div>
  );
}

function SuggestedTag() {
  return (
    <span className="rounded-full border border-current px-1.5 text-xs font-normal">Suggested</span>
  );
}
