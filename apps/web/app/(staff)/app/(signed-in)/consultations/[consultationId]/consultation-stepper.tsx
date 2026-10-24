'use client';

import {
  CONSULTATION_NOTES_MAX,
  adjacentSteps,
  confirmedCount,
  consultationSections,
  consultationSectionsSchema,
  consultationStepLabels,
  consultationSteps,
  sectionHasNotes,
  sectionStarted,
  stepFromQuery,
  type HealthFormAnswers,
  type ConsultationSection,
  type ConsultationSections,
  type ConsultationStep,
} from '@clinic-mx/schemas';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { primaryButtonClass, secondaryButtonClass } from '../../../../../../components/forms';
import { Tag } from '../../../../../../components/tag';
import { ConflictNotice } from '../../../../../../lib/drafts/conflict-notice';
import { SaveStatus } from '../../../../../../lib/drafts/save-status';
import { saveConsultationDraft } from '../../../../../../lib/drafts/savers';
import { useAutosave } from '../../../../../../lib/drafts/use-autosave';
import { SubjectiveFields } from './subjective-fields';

const isSection = (step: ConsultationStep): step is ConsultationSection =>
  (consultationSections as readonly string[]).includes(step);

const hrefOf = (step: ConsultationStep) => `?section=${step}`;

/**
 * The consultation's steps (CLN-02). One draft holds every section, so moving between steps
 * never loses or splits an edit; the step is kept in the address, so a reload and Back stay put.
 * Desktop shows the vertical stepper beside the section; phones show one section with Back and
 * Next pinned at the bottom.
 */
export function ConsultationStepper({
  id,
  serverValue,
  serverVersion,
  signed,
  initialStep,
  patientAnswers,
}: {
  id: string;
  serverValue: ConsultationSections;
  serverVersion: number;
  signed: boolean;
  initialStep: ConsultationStep;
  /** The submitted health form's answers, for Subjective (CLN-03). */
  patientAnswers: HealthFormAnswers;
}) {
  const save = useMemo(() => saveConsultationDraft(id), [id]);
  const draft = useAutosave({ kind: 'consultation', id, serverValue, serverVersion, save });
  // A draft kept on the device from before CLN-03 lacks the newer fields; read it as today's shape.
  const sections = useMemo(() => {
    const read = consultationSectionsSchema.safeParse(draft.value);
    return read.success ? read.data : serverValue;
  }, [draft.value, serverValue]);
  const [step, setStep] = useState(initialStep);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    const onPop = () => {
      setStep(stepFromQuery(new URL(window.location.href).searchParams.get('section')));
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  useEffect(() => {
    // After a move (not on first open), take focus and the view to the new section's title.
    if (!moved.current) return;
    heading.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step]);

  const go = (next: ConsultationStep) => (event?: MouseEvent) => {
    event?.preventDefault();
    if (next === step) return;
    window.history.pushState(null, '', hrefOf(next));
    moved.current = true;
    setStep(next);
  };

  const { back, next } = adjacentSteps(step);
  const at = consultationSteps.indexOf(step) + 1;

  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:items-start md:gap-8">
      <nav aria-label="Consultation steps" className="hidden md:sticky md:top-4 md:block">
        <ol className="flex flex-col gap-1">
          {consultationSteps.map((key, index) => {
            const current = key === step;
            const written = isSection(key) && sectionStarted(sections, key);
            return (
              <li key={key}>
                <a
                  href={hrefOf(key)}
                  onClick={go(key)}
                  aria-current={current ? 'step' : undefined}
                  className={[
                    'flex min-h-row items-center gap-3 rounded-control px-3 py-1.5',
                    current
                      ? 'bg-surface-sunken font-semibold text-ink'
                      : 'text-ink-secondary hover:bg-surface-hover',
                  ].join(' ')}
                >
                  <span
                    aria-hidden="true"
                    className={[
                      'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums',
                      written
                        ? 'border-accent bg-accent text-on-accent'
                        : current
                          ? 'border-ink text-ink'
                          : 'border-line-strong text-ink-muted',
                    ].join(' ')}
                  >
                    {index + 1}
                  </span>
                  <span>{consultationStepLabels[key]}</span>
                  {written ? <span className="sr-only">, notes added</span> : null}
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="consultation-step" className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-ink-muted md:hidden">
          Step {at} of {consultationSteps.length}
        </p>
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="consultation-step"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold outline-none"
          >
            {consultationStepLabels[step]}
          </h2>
          <SaveStatus status={draft.status} />
        </div>
        {signed ? (
          <p className="rounded-control border border-line bg-surface-sunken px-3 py-2 text-sm">
            This consultation is signed. Changes are addenda.
          </p>
        ) : null}
        {draft.status === 'conflict' ? (
          <ConflictNotice keepMine={draft.keepMine} takeSaved={draft.takeSaved} />
        ) : null}

        {step === 'subjective' ? (
          <SubjectiveFields
            confirmed={sections.subjective.confirmed}
            patientAnswers={patientAnswers}
            readOnly={signed}
            onChange={(key, answer) => {
              draft.setValue({
                ...sections,
                subjective: {
                  ...sections.subjective,
                  confirmed: { ...sections.subjective.confirmed, [key]: answer },
                },
              });
            }}
          />
        ) : null}
        {isSection(step) ? (
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">{step === 'subjective' ? 'Other notes' : 'Notes'}</span>
            <textarea
              value={sections[step].notes}
              readOnly={signed}
              maxLength={CONSULTATION_NOTES_MAX}
              onChange={(event) => {
                draft.setValue({
                  ...sections,
                  [step]: { ...sections[step], notes: event.target.value },
                });
              }}
              rows={10}
              className="w-full rounded-control border border-line-control bg-surface px-3 py-2 text-md shadow-xs hover:border-ink-muted"
            />
          </label>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-ink-secondary">Check each section before signing.</p>
            <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
              {consultationSections.map((key) => {
                const written = sectionHasNotes(sections, key);
                const changed = key === 'subjective' ? confirmedCount(sections) : 0;
                return (
                  <li
                    key={key}
                    data-testid="sign-section"
                    className="flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{consultationStepLabels[key]}</span>
                      <Tag tone={written ? 'done' : 'neutral'}>
                        {written ? 'Notes added' : 'Nothing yet'}
                      </Tag>
                      {changed > 0 ? <Tag tone="done">{`${String(changed)} confirmed`}</Tag> : null}
                    </span>
                    <a
                      href={hrefOf(key)}
                      onClick={go(key)}
                      className="text-sm underline underline-offset-2"
                      aria-label={`Edit ${consultationStepLabels[key]}`}
                    >
                      Edit
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div
          data-testid="step-actions"
          className="sticky bottom-0 -mx-4 flex gap-3 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:mx-0 md:justify-end md:border-0 md:bg-transparent md:p-0"
        >
          {back ? (
            <a
              href={hrefOf(back)}
              onClick={go(back)}
              className={`${secondaryButtonClass} md:w-auto`}
            >
              Back
            </a>
          ) : null}
          {next ? (
            <a href={hrefOf(next)} onClick={go(next)} className={`${primaryButtonClass} md:w-auto`}>
              {next === 'sign' ? 'Review and sign' : 'Next'}
            </a>
          ) : null}
        </div>
      </section>
    </div>
  );
}
