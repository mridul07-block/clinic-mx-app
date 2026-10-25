import 'server-only';
import {
  documentByGenerationKey,
  referralLetterFacts,
  type Db,
  type ReferralLetterFacts,
} from '@clinic-mx/db';
import {
  ageOn,
  consultationSectionsSchema,
  documentDate,
  formatIndianPhone,
  irritabilityLabels,
  istDate,
  patientSexLabels,
  redFlagTriageActions,
  redFlagTriageLabels,
  reportKindLabels,
  stageLabels,
  summaryComplaintRows,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { Fields, LetterheadDocument, SignOff } from './letterhead';
import {
  SectionsBody,
  examinationBlocks,
  investigationLines,
  sectionList,
  type DocumentSection,
} from './record-rows';
import { generateDocument, type GeneratedDocument } from './services';

/**
 * The referral letter (ALT-07, CLN-11; Frontend Specification section 11; TAD section 9: built from
 * a red flag referral). Written clinician to clinician, so unlike the patient's summary it names the
 * red flags and their urgency. Generated when the referral is recorded, from the consultation as it
 * stood (or, before any consultation, the health form), plus what the referring physio wrote: where
 * to, the reason and the question for the specialist (user decisions, 25 October 2026).
 */

/** What the letter prints, section by section; tested without rendering. */
export function letterSections(facts: ReferralLetterFacts): DocumentSection[] {
  const sections = consultationSectionsSchema.parse(facts.sections ?? {});
  const { out, add } = sectionList();
  const { patient, referral } = facts;
  const seen = facts.visitStartsAt ?? referral.referredAt;

  add('Referral', {
    kind: 'fields',
    rows: [
      ['To', referral.referredTo],
      ['Date', documentDate(referral.referredAt)],
      ['Urgency', redFlagTriageLabels[referral.triage]],
    ],
  });
  add('Patient details', {
    kind: 'fields',
    rows: [
      ['Name', patient.name],
      ...(patient.dateOfBirth
        ? [
            ['Age', `${String(ageOn(patient.dateOfBirth, istDate(seen)))} years`] as [
              string,
              string,
            ],
          ]
        : []),
      ...(patient.sex ? [['Sex', patientSexLabels[patient.sex]] as [string, string]] : []),
      ['OP number', patient.opNumber],
      ...(facts.visitStartsAt
        ? [['Date of consultation', documentDate(facts.visitStartsAt)] as [string, string]]
        : []),
    ],
  });
  add(
    'Reason for referral',
    {
      kind: 'fields',
      rows: [
        ['Red flags found', referral.found],
        ['Action', redFlagTriageActions[referral.triage]],
      ],
    },
    { kind: 'lines', lines: [referral.reason] },
  );
  add('Question for the specialist', { kind: 'lines', lines: [referral.question] });

  add('Presenting complaint', {
    kind: 'fields',
    rows: summaryComplaintRows(sections.subjective.confirmed, facts.answers),
  });
  add('Relevant findings', ...examinationBlocks(sections.objective, facts.objectiveCatalog));
  add(
    'Investigations and imaging',
    {
      kind: 'lines',
      lines: investigationLines(sections.subjective.confirmed, facts.answers),
    },
    {
      kind: 'table',
      columns: [{ label: 'Report on file' }, { label: 'Added' }],
      rows: facts.reports.map((report) => [
        reportKindLabels[report.contentType],
        documentDate(report.createdAt),
      ]),
    },
  );

  // The working diagnosis as far as the consultation had got: whatever parts are filled.
  const { assessment } = sections;
  add('Working diagnosis', {
    kind: 'fields',
    rows: [
      ...(facts.conditionName
        ? [['Tissue diagnosis', facts.conditionName] as [string, string]]
        : []),
      ...(assessment.movement.trim()
        ? [['Movement diagnosis', assessment.movement.trim()] as [string, string]]
        : []),
      ...(assessment.irritability
        ? [['Irritability', irritabilityLabels[assessment.irritability]] as [string, string]]
        : []),
      ...(assessment.stage ? [['Stage', stageLabels[assessment.stage]] as [string, string]] : []),
      ...(facts.conditionName || assessment.movement.trim()
        ? [['Status', 'Provisional'] as [string, string]]
        : []),
    ],
  });

  add('Treatment so far', {
    kind: 'lines',
    lines:
      facts.completedVisits.length > 0
        ? facts.completedVisits.map((visit) => `${visit.typeName}, ${documentDate(visit.startsAt)}`)
        : [
            facts.visitStartsAt
              ? `No treatment yet; seen for consultation on ${documentDate(facts.visitStartsAt)}.`
              : 'No treatment yet.',
          ],
  });
  return out;
}

export function ReferralLetter({
  facts,
  version,
  generatedAt,
}: {
  facts: ReferralLetterFacts;
  version: number;
  generatedAt: Date;
}) {
  const contact = [
    facts.centre.name,
    facts.centre.phone ? formatIndianPhone(facts.centre.phone) : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <LetterheadDocument
      title="Referral letter"
      centre={facts.centre}
      versionLabel={`Version ${String(version)}`}
      generatedAt={generatedAt}
    >
      <SectionsBody sections={letterSections(facts)} />
      <SignOff
        name={facts.referrer.name}
        credentials={facts.referrer.credentials}
        signedAt={facts.referral.referredAt}
      />
      <Fields rows={[['Contact', contact]]} />
    </LetterheadDocument>
  );
}

/**
 * The letter job (ALT-07): a referred alert's letter, as the system. `generationKey` is the job's
 * own key, so a job that runs again makes nothing new. Returns what it made, or why it made
 * nothing.
 */
export async function generateReferralLetter(
  db: Db,
  alertId: string,
  generationKey: string,
  generate: typeof generateDocument = generateDocument,
): Promise<GeneratedDocument | 'already made' | 'not referred'> {
  const service = systemService({
    component: 'documents',
    input: z.object({ alertId: z.guid(), generationKey: z.string().min(1) }),
    run: async (tx, input): Promise<GeneratedDocument | 'already made' | 'not referred'> => {
      if (await documentByGenerationKey(tx, input.generationKey)) return 'already made';
      const facts = await referralLetterFacts(tx, input.alertId);
      if (!facts) return 'not referred';
      return generate(tx, {
        kind: 'referral_letter',
        patientId: facts.patientId,
        episodeId: facts.episodeId,
        centreId: facts.centreId,
        sourceId: input.alertId,
        generationKey: input.generationKey,
        build: ({ version, generatedAt }) => (
          <ReferralLetter facts={facts} version={version} generatedAt={generatedAt} />
        ),
      });
    },
  });
  return service(db, { alertId, generationKey });
}
