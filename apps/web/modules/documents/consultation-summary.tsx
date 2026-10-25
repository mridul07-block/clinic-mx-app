import 'server-only';
import {
  consultationSummaryFacts,
  documentByGenerationKey,
  type ConsultationSummaryFacts,
  type Db,
} from '@clinic-mx/db';
import {
  ageOn,
  consultationSectionsSchema,
  documentCalendarDate,
  documentDate,
  documentDateTime,
  interventionLabels,
  irritabilityLabels,
  istDate,
  patientSexLabels,
  stageLabels,
  summaryComplaintRows,
  summaryFrequency,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import { LetterheadDocument, SignOff } from './letterhead';
import {
  SectionsBody,
  examinationBlocks,
  investigationLines,
  sectionList,
  type DocumentSection,
} from './record-rows';
import { generateDocument, type GeneratedDocument } from './services';

/**
 * The consultation summary (ALT-06, PRD J4.1, Frontend Specification section 11, Blueprint Module
 * 6): the signed record on the centre's letterhead for the patient. Sections in the specification's
 * order; a section with nothing in it is left out. Never printed (Frontend Specification section
 * 7: nothing internal or alarming to patients): section notes, screening and red flags,
 * precautions and modality reasons, sources, questionnaires and knowledge base text.
 */

export type SummarySection = DocumentSection;

/** What the summary prints, section by section; tested without rendering. */
export function summarySections(
  facts: ConsultationSummaryFacts,
  printsCategory: boolean,
): SummarySection[] {
  const sections = consultationSectionsSchema.parse(facts.sections);
  const visitDate = istDate(facts.visitStartsAt);
  const { out, add } = sectionList();

  const { patient } = facts;
  add('Patient details', {
    kind: 'fields',
    rows: [
      ['Name', patient.name],
      ...(patient.dateOfBirth
        ? [['Age', `${String(ageOn(patient.dateOfBirth, visitDate))} years`] as [string, string]]
        : []),
      ...(patient.sex ? [['Sex', patientSexLabels[patient.sex]] as [string, string]] : []),
      ['OP number', patient.opNumber],
      ['Date of consultation', documentDate(facts.visitStartsAt)],
      ['Centre', facts.centre.name],
    ],
  });

  add('Primary complaints', {
    kind: 'fields',
    rows: summaryComplaintRows(sections.subjective.confirmed, facts.answers),
  });

  add('On examination', ...examinationBlocks(sections.objective, facts.objectiveCatalog));
  add('On investigation', {
    kind: 'lines',
    lines: investigationLines(sections.subjective.confirmed, facts.answers),
  });

  const { diagnosis } = facts;
  add('Diagnosis', {
    kind: 'fields',
    rows: [
      ['Tissue diagnosis', diagnosis.conditionName],
      ['Movement diagnosis', diagnosis.movement],
      ['Irritability', irritabilityLabels[diagnosis.irritability]],
      ['Stage', stageLabels[diagnosis.stage]],
      ...(diagnosis.provisional ? [['Status', 'Provisional'] as [string, string]] : []),
    ],
  });

  // PRD decision 18: off unless the clinic turns it on (`documents.summary_prints_category`).
  if (printsCategory && diagnosis.categoryName) {
    add('Physiotherapy diagnosis', { kind: 'lines', lines: [diagnosis.categoryName] });
  }

  const { plan } = facts;
  const frequency = summaryFrequency(plan.sessionsPerWeek, plan.weeks);
  add(
    'Plan of treatment',
    { kind: 'lines', lines: plan.goals.map((goal) => `Goal: ${goal.text}`) },
    {
      kind: 'fields',
      rows: [
        ...(plan.interventions.length
          ? [
              [
                'Interventions',
                plan.interventions.map((kind) => interventionLabels[kind]).join(', '),
              ] as [string, string],
            ]
          : []),
        ...(plan.modalities.length
          ? [['Modalities', plan.modalities.join(', ')] as [string, string]]
          : []),
        ...(frequency ? [['Frequency', frequency] as [string, string]] : []),
      ],
    },
    {
      kind: 'table',
      columns: [{ label: 'Home exercise' }, { label: 'Dose' }, { label: 'Note' }],
      rows: plan.homeProgramme.map((row) => [row.exercise, row.dose, row.note]),
    },
  );
  add('Investigations plan', {
    kind: 'lines',
    lines: plan.investigations ? [plan.investigations] : [],
  });
  add('Referral plan', { kind: 'lines', lines: plan.referral ? [plan.referral] : [] });
  add('Review plan', {
    kind: 'fields',
    rows: [['Review date', documentCalendarDate(plan.reviewDate)]],
  });
  add('Addenda', {
    kind: 'table',
    columns: [{ label: 'Added' }, { label: 'By' }, { label: 'Addendum' }],
    rows: facts.addenda.map((note) => [
      documentDateTime(note.createdAt),
      note.authorName,
      note.text,
    ]),
  });
  return out;
}

export function ConsultationSummary({
  facts,
  printsCategory,
  version,
  generatedAt,
}: {
  facts: ConsultationSummaryFacts;
  printsCategory: boolean;
  version: number;
  generatedAt: Date;
}) {
  return (
    <LetterheadDocument
      title="Consultation summary"
      centre={facts.centre}
      versionLabel={`Version ${String(version)}`}
      generatedAt={generatedAt}
    >
      <SectionsBody sections={summarySections(facts, printsCategory)} />
      <SignOff
        name={facts.signer.name}
        credentials={facts.signer.credentials}
        signedAt={facts.signedAt}
      />
    </LetterheadDocument>
  );
}

/**
 * The summary job (ALT-06): the next version of a signed consultation's summary, as the system.
 * `generationKey` is the job's own key: a job that runs again after a crash makes nothing new.
 * Returns what it made, or why it made nothing.
 */
export async function generateConsultationSummary(
  db: Db,
  consultationId: string,
  generationKey: string,
  generate: typeof generateDocument = generateDocument,
): Promise<GeneratedDocument | 'already made' | 'not signed'> {
  const printsCategory = await getSetting('documents.summary_prints_category');
  const service = systemService({
    component: 'documents',
    input: z.object({ consultationId: z.guid(), generationKey: z.string().min(1) }),
    run: async (tx, input): Promise<GeneratedDocument | 'already made' | 'not signed'> => {
      if (await documentByGenerationKey(tx, input.generationKey)) return 'already made';
      const facts = await consultationSummaryFacts(tx, input.consultationId);
      if (!facts) return 'not signed';
      return generate(tx, {
        kind: 'consultation_summary',
        patientId: facts.patientId,
        episodeId: facts.episodeId,
        centreId: facts.centreId,
        sourceId: input.consultationId,
        generationKey: input.generationKey,
        build: ({ version, generatedAt }) => (
          <ConsultationSummary
            facts={facts}
            printsCategory={printsCategory}
            version={version}
            generatedAt={generatedAt}
          />
        ),
      });
    },
  });
  return service(db, { consultationId, generationKey });
}
