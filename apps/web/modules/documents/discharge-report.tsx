import 'server-only';
import {
  dischargeReportFacts,
  documentByGenerationKey,
  type Db,
  type DischargeReportFacts,
} from '@clinic-mx/db';
import {
  ageOn,
  criterionResultLabels,
  dischargeReasonLabels,
  documentDate,
  goalOutcomeLabels,
  irritabilityLabels,
  istDate,
  patientSexLabels,
  screeningRegionLabels,
  stageLabels,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { systemService } from '../access/service';
import { readinessView, type ReadinessView } from '../reviews/readiness';
import { finalTestingOf, type FinalTesting } from '../reviews/services';
import { LetterheadDocument, SignOff } from './letterhead';
import { SectionsBody, sectionList, type DocumentSection } from './record-rows';
import { generateDocument, type GeneratedDocument } from './services';

/**
 * The discharge report (OUT-11, PRD J6.5 and J6.7, Frontend Specification section 11; TAD section
 * 9: built from the signed discharge; user decisions 27 October 2026): the episode summary,
 * attendance, baseline against final testing as a table (greyscale), the plan's goals as marked at
 * discharge, every readiness criterion with any override and its reason, the clearances, ongoing
 * needs and recommendations, signed off by the discharging consultant. Questionnaire scores join
 * with OUT-02. A section with nothing in it is left out.
 */

const NONE = 'None recorded.';

/** What the report prints, section by section; tested without rendering. */
export function reportSections(
  facts: DischargeReportFacts,
  testing: FinalTesting,
  readiness: ReadinessView | undefined,
): DocumentSection[] {
  const { out, add } = sectionList();
  const { patient, episode, diagnosis, attendance } = facts;
  const closed = istDate(episode.closedAt);

  add('Patient details', {
    kind: 'fields',
    rows: [
      ['Name', patient.name],
      ...(patient.dateOfBirth
        ? [['Age', `${String(ageOn(patient.dateOfBirth, closed))} years`] as [string, string]]
        : []),
      ...(patient.sex ? [['Sex', patientSexLabels[patient.sex]] as [string, string]] : []),
      ['OP number', patient.opNumber],
    ],
  });

  add('Episode summary', {
    kind: 'fields',
    rows: [
      ...(episode.region
        ? [['Region', screeningRegionLabels[episode.region]] as [string, string]]
        : []),
      ['Diagnosis', diagnosis.conditionName],
      ...(diagnosis.movement.trim()
        ? [['Movement diagnosis', diagnosis.movement.trim()] as [string, string]]
        : []),
      ['Irritability', irritabilityLabels[diagnosis.irritability]],
      ['Stage', stageLabels[diagnosis.stage]],
      ['Consultant', facts.consultant],
      ['Episode opened', documentDate(episode.openedAt)],
      ['Discharged', documentDate(episode.closedAt)],
      [
        'Reason for discharge',
        episode.note
          ? `${dischargeReasonLabels[episode.reason]}: ${episode.note}`
          : dischargeReasonLabels[episode.reason],
      ],
    ],
  });

  add('Attendance', {
    kind: 'fields',
    rows: [
      ['Visits attended', String(attendance.attended)],
      ...(attendance.firstAttended && attendance.lastAttended
        ? [
            [
              'Attended between',
              `${documentDate(attendance.firstAttended)} and ${documentDate(attendance.lastAttended)}`,
            ] as [string, string],
          ]
        : []),
      ['Missed', String(attendance.noShows)],
      ['Cancelled', String(attendance.cancelled)],
    ],
  });

  // Baseline against final testing, with session 4 between (OUT-05, OUT-07).
  const notTested = (reason: string | null) => (reason ? `Not tested: ${reason}` : 'Not tested');
  const final = testing.finalTest;
  add(
    'Baseline and final results',
    testing.items.length === 0
      ? { kind: 'lines', lines: ['No baseline was recorded at session 1.'] }
      : {
          kind: 'table',
          columns: [
            { label: 'Measure' },
            { label: 'Baseline' },
            {
              label: testing.sessionNumber ? `Session ${String(testing.sessionNumber)}` : 'Review',
            },
            { label: 'Final' },
            { label: 'Change' },
          ],
          rows: testing.items.map((item, index) => {
            const row = final?.rows[index];
            return [
              item.measure.name,
              item.baseline ?? notTested(item.baselineNotTested),
              item.session ?? (item.sessionNotTested ? notTested(item.sessionNotTested) : '—'),
              !row ? 'Not retested' : (row.now ?? notTested(row.nowNotTested)),
              row?.change ?? '',
            ];
          }),
        },
    // Only a baseline can go unretested.
    ...(final || testing.items.length === 0
      ? []
      : [{ kind: 'lines' as const, lines: ['Final testing was not signed before discharge.'] }]),
  );

  add('Goals', {
    kind: 'table',
    columns: [{ label: 'Goal' }, { label: 'Outcome' }],
    rows: episode.goals.map((goal) => [goal.text, goalOutcomeLabels[goal.outcome]]),
  });

  if (readiness) {
    add('Readiness criteria', {
      kind: 'table',
      columns: [{ label: 'Criterion' }, { label: 'Result' }, { label: 'Override reason' }],
      rows: readiness.rows.map((row) => {
        const override = row.result === 'met' ? null : row.override;
        return [
          row.reading ? `${row.criterion.text} (${row.reading})` : row.criterion.text,
          override ? 'Overridden' : criterionResultLabels[row.result],
          override?.reason ?? '',
        ];
      }),
    });
    add('Clearance', {
      kind: 'fields',
      rows: readiness.clearances.map((clearance): [string, string] => [
        clearance.label,
        clearance.signed
          ? `Signed by ${clearance.signed.by} on ${documentDate(clearance.signed.at)}`
          : 'Not signed',
      ]),
    });
  }

  add('Ongoing needs', { kind: 'lines', lines: [episode.ongoingNeeds ?? NONE] });
  add('Recommendations', { kind: 'lines', lines: [episode.recommendations ?? NONE] });
  // PAT-03: the return and flare plans, only when the consultant wrote them.
  if (episode.returnPlan) add('Return plan', { kind: 'lines', lines: [episode.returnPlan] });
  if (episode.flarePlan) add('Flare plan', { kind: 'lines', lines: [episode.flarePlan] });
  return out;
}

export function DischargeReport({
  facts,
  testing,
  readiness,
  version,
  generatedAt,
}: {
  facts: DischargeReportFacts;
  testing: FinalTesting;
  readiness: ReadinessView | undefined;
  version: number;
  generatedAt: Date;
}) {
  return (
    <LetterheadDocument
      title="Discharge report"
      centre={facts.centre}
      versionLabel={`Version ${String(version)}`}
      generatedAt={generatedAt}
    >
      <SectionsBody sections={reportSections(facts, testing, readiness)} />
      <SignOff
        name={facts.dischargedBy.name}
        credentials={facts.dischargedBy.credentials}
        signedAt={facts.episode.closedAt}
      />
    </LetterheadDocument>
  );
}

/**
 * The report job (OUT-11): a discharged episode's report, as the system. `generationKey` is the
 * job's own key, so a job that runs again makes nothing new. What it made, or why it made nothing.
 */
export async function generateDischargeReport(
  db: Db,
  episodeId: string,
  generationKey: string,
  generate: typeof generateDocument = generateDocument,
): Promise<GeneratedDocument | 'already made' | 'not discharged'> {
  const service = systemService({
    component: 'documents',
    input: z.object({ episodeId: z.guid(), generationKey: z.string().min(1) }),
    run: async (tx, input): Promise<GeneratedDocument | 'already made' | 'not discharged'> => {
      if (await documentByGenerationKey(tx, input.generationKey)) return 'already made';
      const facts = await dischargeReportFacts(tx, input.episodeId);
      if (!facts) return 'not discharged';
      const testing = await finalTestingOf(tx, input.episodeId);
      const readiness = await readinessView(tx, input.episodeId);
      return generate(tx, {
        kind: 'discharge_report',
        patientId: facts.patientId,
        episodeId: facts.episodeId,
        centreId: facts.centreId,
        sourceId: input.episodeId,
        generationKey: input.generationKey,
        build: ({ version, generatedAt }) => (
          <DischargeReport
            facts={facts}
            testing={testing}
            readiness={readiness}
            version={version}
            generatedAt={generatedAt}
          />
        ),
      });
    },
  });
  return service(db, { episodeId, generationKey });
}
