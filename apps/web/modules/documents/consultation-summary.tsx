import 'server-only';
import {
  consultationSummaryFacts,
  documentByGenerationKey,
  type ConsultationSummaryFacts,
  type Db,
} from '@clinic-mx/db';
import {
  ageOn,
  answerText,
  consultationSectionsSchema,
  documentCalendarDate,
  documentDate,
  documentDateTime,
  interventionLabels,
  irritabilityLabels,
  istDate,
  lsiPercent,
  measureResult,
  measureStatusLabels,
  patientSexLabels,
  specialTestResultLabels,
  stageLabels,
  subjectiveAnswered,
  subjectiveField,
  subjectiveValue,
  summaryComplaintRows,
  summaryFrequency,
  type KnowledgeMeasure,
  type MeasureEntry,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import { Fields, LetterheadDocument, Mono, Paragraph, Section, SignOff, Table } from './letterhead';
import { generateDocument, type GeneratedDocument } from './services';

/**
 * The consultation summary (ALT-06, PRD J4.1, Frontend Specification section 11, Blueprint Module
 * 6): the signed record on the centre's letterhead for the patient. Sections in the specification's
 * order; a section with nothing in it is left out. Never printed (Frontend Specification section
 * 7: nothing internal or alarming to patients): section notes, screening and red flags,
 * precautions and modality reasons, sources, questionnaires and knowledge base text.
 */

type Block =
  | { kind: 'fields'; rows: [string, string][] }
  | { kind: 'table'; columns: { label: string; align?: 'end' }[]; rows: string[][] }
  | { kind: 'lines'; lines: string[] };

export interface SummarySection {
  heading: string;
  blocks: Block[];
}

const number = (value: number) => String(Math.round(value * 10) / 10);

/** What was measured, as recorded: both sides, or the one value, with the unit. */
function recorded(measure: KnowledgeMeasure, entry: MeasureEntry): string {
  const unit = measure.unit ? ` ${measure.unit}` : '';
  if (entry.involved !== undefined || entry.uninvolved !== undefined) {
    return [
      entry.involved === undefined ? '' : `Involved ${number(entry.involved)}${unit}`,
      entry.uninvolved === undefined ? '' : `uninvolved ${number(entry.uninvolved)}${unit}`,
    ]
      .filter(Boolean)
      .join(', ');
  }
  return entry.value === undefined ? '' : `${number(entry.value)}${unit}`;
}

/** The workbook's result, as the Objective shows it: LSI or deficit, and its status in words. */
function result(measure: KnowledgeMeasure, entry: MeasureEntry): string {
  const found = measureResult(measure, entry);
  return [
    found.lsi === undefined ? '' : `LSI ${lsiPercent(found.lsi)}`,
    found.deficit === undefined ? '' : `Deficit ${number(found.deficit)} ${measure.unit}`.trim(),
    found.status ? measureStatusLabels[found.status] : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** What the summary prints, section by section; tested without rendering. */
export function summarySections(
  facts: ConsultationSummaryFacts,
  printsCategory: boolean,
): SummarySection[] {
  const sections = consultationSectionsSchema.parse(facts.sections);
  const visitDate = istDate(facts.visitStartsAt);
  const out: SummarySection[] = [];
  const add = (heading: string, ...blocks: Block[]) => {
    const kept = blocks.filter((block) =>
      block.kind === 'lines' ? block.lines.length > 0 : block.rows.length > 0,
    );
    if (kept.length > 0) out.push({ heading, blocks: kept });
  };

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

  const measures = Object.entries(sections.objective.measures).flatMap(([key, entry]) => {
    const measure = facts.objectiveCatalog.measures.find((m) => m.key === key);
    const shown = measure ? recorded(measure, entry) : '';
    return measure && shown ? [[measure.name, shown, result(measure, entry)]] : [];
  });
  const tests = sections.objective.tests.flatMap((test) => {
    const known = facts.objectiveCatalog.specialTests.find((t) => t.key === test.key);
    return known && test.result && test.result !== 'not_tested'
      ? [[known.test, specialTestResultLabels[test.result], test.interpretation.trim()]]
      : [];
  });
  add(
    'On examination',
    {
      kind: 'table',
      columns: [{ label: 'Measure' }, { label: 'Recorded' }, { label: 'Result' }],
      rows: measures,
    },
    {
      kind: 'table',
      columns: [{ label: 'Special test' }, { label: 'Result' }, { label: 'Interpretation' }],
      rows: tests,
    },
  );

  const investigated = subjectiveValue(
    'investigations',
    sections.subjective.confirmed,
    facts.answers,
  );
  add('On investigation', {
    kind: 'lines',
    lines:
      investigated !== undefined && subjectiveAnswered(investigated)
        ? [answerText(subjectiveField('investigations'), investigated)]
        : [],
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
      {summarySections(facts, printsCategory).map((section) => (
        <Section key={section.heading} heading={section.heading}>
          {section.blocks.map((block, index) => {
            const key = [section.heading, index].join('-');
            if (block.kind === 'lines') {
              return block.lines.map((line) => (
                <Paragraph key={[key, line].join('-')}>{line}</Paragraph>
              ));
            }
            if (block.kind === 'table') {
              return <Table key={key} columns={block.columns} rows={block.rows} />;
            }
            return (
              <Fields
                key={key}
                rows={block.rows.map(([label, value]) => [
                  label,
                  label === 'OP number' ? <Mono key={label}>{value}</Mono> : value,
                ])}
              />
            );
          })}
        </Section>
      ))}
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
