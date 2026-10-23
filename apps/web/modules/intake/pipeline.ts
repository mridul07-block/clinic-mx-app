import 'server-only';
import {
  enqueueJob,
  insertEpisode,
  insertNotifications,
  insertPrecautions,
  insertRedFlagAlerts,
  latestKnowledgeVersion,
  linkIntakeEpisode,
  redFlagRules,
  submittedIntake,
  updateEpisodeState,
  type NewNotification,
} from '@clinic-mx/db';
import {
  episodeTransition,
  evaluateRedFlags,
  intakeAge,
  intakePrecautions,
  intakeScreening,
  istDate,
  redFlagRuleSchema,
  screeningRegions,
  screeningThresholdKeys,
  type ScreeningThresholds,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { appDb } from '../../lib/db';
import { systemService } from '../access/service';
import { getSetting } from '../settings/settings';
import { formFor } from './visit';

/**
 * The submit pipeline (INT-10, PRD J2.6). A submitted health form, in one transaction as the
 * system (`system:intake`):
 *
 * 1. opens the clinical episode (Intake pending, then Awaiting consultation by the machine) and
 *    ties it to the visit, the form and the visit's Part A consent records;
 * 2. runs the red flag rules of the latest knowledge base version, signed off or not (user
 *    decision, 23 October 2026), and records each raised rule as an alert with its version;
 * 3. records the Health check items ticked as the episode's precautions;
 * 4. queues the AI preparation sheet;
 * 5. tells the visit's physio, and again when an emergency was raised.
 *
 * It runs right after the submit, and again from the `intake.submitted` job the submit queued:
 * the form's row is locked and a form that has its episode is done, so a second run changes
 * nothing.
 */
export type PipelineResult =
  | { status: 'done'; episodeId: string; alerts: number; precautions: number }
  | { status: 'already'; episodeId: string };

/** The job the pipeline queues; AI-01 to AI-03 make the sheet, AI-09 switches it on. */
export const AI_PREPARATION_SHEET_JOB = 'ai.preparation_sheet';

const thresholdsSchema = z.object(
  Object.fromEntries(screeningThresholdKeys.map((key) => [key, z.number()])) as Record<
    (typeof screeningThresholdKeys)[number],
    z.ZodNumber
  >,
);

const run = systemService({
  component: 'intake',
  input: z.object({ appointmentId: z.guid(), thresholds: thresholdsSchema }),
  run: async (tx, { appointmentId, thresholds }): Promise<PipelineResult> => {
    const intake = await submittedIntake(tx, appointmentId);
    if (!intake?.submittedAt) throw new Error('The health form is not submitted.');
    if (intake.episodeId) return { status: 'already', episodeId: intake.episodeId };
    const form = formFor(intake.formVersion);
    const { answers } = intake;
    const region = screeningRegions.find((candidate) => candidate === answers.region);

    // 1. The episode, moved on by the machine (rule 1: the episode is the backbone).
    const episodeId = await insertEpisode(tx, {
      patientId: intake.patientId,
      centreId: intake.centreId,
      ...(region ? { bodyRegion: region } : {}),
    });
    const moved = episodeTransition(
      { status: 'intake_pending', pausedFrom: null },
      'submit_intake',
    );
    if (!moved.ok || !(await updateEpisodeState(tx, episodeId, 'intake_pending', moved.next))) {
      throw new Error('The episode could not move to Awaiting consultation.');
    }
    await linkIntakeEpisode(tx, {
      appointmentId,
      intakeResponseId: intake.intakeResponseId,
      episodeId,
    });

    // 2. Red flag rules (rule 3: deterministic), with the version they came from (rule 4).
    const version = await latestKnowledgeVersion(tx);
    const rules = version && region ? await redFlagRules(tx, version.id) : [];
    const raised = region
      ? evaluateRedFlags(
          rules.map((rule) =>
            redFlagRuleSchema.parse({
              key: rule.ruleKey,
              name: rule.name,
              regions: rule.regions,
              trigger: rule.trigger,
              triage: rule.triage,
              action: rule.action,
              source: rule.source,
              signedOff: rule.signedOff,
            }),
          ),
          intakeScreening(answers),
          { region, age: intakeAge(answers, intake.dateOfBirth, istDate(new Date())) },
          thresholds,
        ).raised
      : [];
    const signedOff = new Map(rules.map((rule) => [rule.ruleKey, rule.signedOff]));
    if (version) {
      await insertRedFlagAlerts(
        tx,
        raised.map((flag) => ({
          episodeId,
          appointmentId,
          kbVersionId: version.id,
          ruleKey: flag.key,
          name: flag.name,
          triage: flag.triage,
          display: flag.display,
          action: flag.action,
          signedOff: signedOff.get(flag.key) ?? false,
        })),
      );
    }

    // 3. Precautions, as the patient ticked them.
    const precautions = intakePrecautions(form, answers);
    await insertPrecautions(
      tx,
      precautions.map((item) => ({
        ...item,
        episodeId,
        intakeResponseId: intake.intakeResponseId,
        formVersion: intake.formVersion,
      })),
    );

    // 4. The AI preparation sheet, once per episode.
    await enqueueJob(tx, {
      kind: AI_PREPARATION_SHEET_JOB,
      payload: { episodeId },
      idempotencyKey: `${AI_PREPARATION_SHEET_JOB}:${episodeId}`,
    });

    // 5. The visit's physio.
    const told: NewNotification[] = [
      { staffUserId: intake.physioId, kind: 'health_form_submitted', appointmentId, episodeId },
    ];
    if (raised.some((flag) => flag.display === 'emergency')) {
      told.push({
        staffUserId: intake.physioId,
        kind: 'red_flag_emergency',
        appointmentId,
        episodeId,
      });
    }
    await insertNotifications(tx, told);
    return { status: 'done', episodeId, alerts: raised.length, precautions: precautions.length };
  },
});

/** The red flag thresholds, each a setting (rule 6). */
async function screeningThresholds(): Promise<ScreeningThresholds> {
  const values = await Promise.all(screeningThresholdKeys.map((key) => getSetting(key)));
  return Object.fromEntries(
    screeningThresholdKeys.map((key, i) => [key, values[i]]),
  ) as ScreeningThresholds;
}

/** Runs the pipeline for a submitted visit's form. */
export async function processIntakeSubmission(appointmentId: string): Promise<PipelineResult> {
  return run(appDb(), { appointmentId, thresholds: await screeningThresholds() });
}
