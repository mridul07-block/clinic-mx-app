import { earlierToday, type SignedRows } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { signConsultation } from '../clinical-record';
import { openConsultation } from '../consultations';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { startVisit } from '../my-patients';
import { appointment, kbCondition } from '../schema';
import type { DbOrTransaction } from '../versioned';
import { becomeStaff, testPatient, typeId } from './fake-schedule';

/**
 * A patient's episode at `centreId` with a signed consultation by `consultant` whose plan of care
 * has `modalities` (BIL-03). Leaves the transaction acting as the consultant. A knowledge base
 * version of its own holds the one condition, "Test Condition" (`TST-001`).
 */
export async function signedPlan(
  tx: DbOrTransaction,
  {
    centreId,
    consultant,
    checkedInBy,
    modalities,
  }: { centreId: string; consultant: StaffMember; checkedInBy: string; modalities: string[] },
) {
  const [version] = await tx.execute<{ id: string }>(
    sql`insert into kb_version (number, source, report, created_by)
      select coalesce(max(number), 0) + 1, '{}'::jsonb, '{}'::jsonb, 'tests' from kb_version
      returning id`,
  );
  const kbVersionId = version?.id ?? '';
  await tx.insert(kbCondition).values({
    kbVersionId,
    conditionId: 'TST-001',
    name: 'Test Condition',
    homeRegion: 'knee',
  });
  const patientId = await testPatient(tx);
  const episodeId = await insertEpisode(tx, { patientId, centreId });
  const startsAt = earlierToday(5);
  const [visit] = await tx
    .insert(appointment)
    .values({
      number: '',
      patientId,
      centreId,
      physioId: consultant.id,
      appointmentTypeId: await typeId(tx, 'consultation'),
      episodeId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60000),
      channel: 'front_desk',
      bookedBy: checkedInBy,
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy,
    })
    .returning({ id: appointment.id });
  const appointmentId = visit?.id ?? '';
  await becomeStaff(tx, consultant);
  await startVisit(tx, { appointmentId, by: consultant.id, now: new Date() });
  const consultationId = await openConsultation(tx, {
    appointmentId,
    episodeId,
    physioId: consultant.id,
  });
  const rows: SignedRows = {
    measures: [],
    tests: [],
    diagnosis: {
      conditionId: 'TST-001',
      movement: '',
      irritability: 'moderate',
      stage: 'subacute',
      categoryCode: null,
      provisional: true,
    },
    plan: {
      goals: [{ text: 'Test goal', patient: false }],
      interventions: ['exercise'],
      modalities: modalities.map((key) => ({ key, reason: '' })),
      sessionsPerWeek: 2,
      weeks: 6,
      homeProgramme: [],
      reviewDate: '2026-12-05',
      questionnaires: [],
      treatingPhysioId: consultant.id,
      investigations: '',
      referral: '',
    },
  };
  const signed = await signConsultation(tx, {
    consultationId,
    baseVersion: 1,
    by: consultant.id,
    episodeId,
    appointmentId,
    kbVersionId,
    rows,
  });
  if (signed !== 'signed') throw new Error(`not signed: ${signed}`);
  return { patientId, episodeId, appointmentId, consultationId };
}
