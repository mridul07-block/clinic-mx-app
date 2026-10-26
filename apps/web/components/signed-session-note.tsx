import {
  interventionLabels,
  nextSessionPlanLabels,
  painReadingLabels,
  painReadings,
  sessionResponseLabels,
  type SessionNote,
} from '@clinic-mx/schemas';
import type { ReactNode } from 'react';

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm font-medium text-ink-secondary">{title}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

/** A note's free text after its choice, when there is one. */
function withNote(choice: string, note: string): string {
  return note.trim() ? `${choice}. ${note.trim()}` : choice;
}

/**
 * A signed session note, read only (CLN-12 follow up): its sections in the note's own order
 * (SES-03), for the patient record's Notes. Modalities are named as at the note's knowledge base
 * version.
 */
export function SignedSessionNote({
  note,
  modalityNames,
}: {
  note: SessionNote;
  modalityNames: Record<string, string>;
}) {
  const treatment = [
    ...note.treatment.interventions.map((kind) => interventionLabels[kind]),
    ...note.treatment.modalities.map((key) => modalityNames[key] ?? key),
  ];
  return (
    <dl data-testid="signed-session-note" className="flex flex-col gap-3">
      <Row title="Any new symptoms?">
        {note.newSymptoms.answer === 'yes'
          ? withNote('Yes', note.newSymptoms.description)
          : note.newSymptoms.answer === 'no'
            ? 'No'
            : 'Not answered'}
      </Row>
      {note.sinceLastVisit.trim() ? (
        <Row title="Since last visit">{note.sinceLastVisit.trim()}</Row>
      ) : null}
      <Row title="Pain">
        {painReadings
          .map((reading) => {
            const value = note.pain[reading];
            return `${painReadingLabels[reading]}: ${value === null ? 'not set' : `${String(value)} out of 10`}`;
          })
          .join('\n')}
      </Row>
      <Row title="Treatment given">
        {withNote(treatment.length > 0 ? treatment.join(', ') : 'None ticked', note.treatment.note)}
      </Row>
      <Row title="Response">
        {withNote(
          note.response.rating ? sessionResponseLabels[note.response.rating] : 'Not chosen',
          note.response.note,
        )}
      </Row>
      {note.response.adverseEvent.reported ? (
        <Row title="Adverse event">{note.response.adverseEvent.description.trim()}</Row>
      ) : null}
      {note.homeProgramme.note.trim() ? (
        <Row title="Home programme changes">{note.homeProgramme.note.trim()}</Row>
      ) : null}
      <Row title="Next session">
        {withNote(
          note.nextSession.plan ? nextSessionPlanLabels[note.nextSession.plan] : 'Not chosen',
          note.nextSession.note,
        )}
      </Row>
    </dl>
  );
}
