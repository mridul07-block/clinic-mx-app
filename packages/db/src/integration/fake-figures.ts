import { istDate, istInstant, type EpisodeStatus } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import type { StaffMember } from '../identity';
import { insertPatientLink } from '../patient-links';
import {
  appointment,
  bill,
  consultation,
  episode,
  intakeResponse,
  payment,
  redFlagAlert,
} from '../schema';
import { seedStaff } from '../seed/data';
import type { DbOrTransaction } from '../versioned';
import { testPatient, typeId } from './fake-schedule';

/**
 * Generated records for the figures' database tests (DSH-01, DSH-03; rule 12: never real data):
 * visits in any status with the times it needs, episodes moved through statuses, notes, health
 * forms, paid bills and referred red flags, all added as the database owner inside a test's
 * rolled back transaction.
 */

type Tx = DbOrTransaction;

const seedId = (email: string): string => {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  return row.id;
};
const superAdmin = { id: seedId('super.admin@clinicmx.test') };
const deskHsr = { id: seedId('desk.hsr@clinicmx.test') };

/** Back to the database owner with no staff claims, to add records. */
export async function asSystem(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
}

/** Acting as `staff` for the database's own checks (who signs, who discharges), still the owner. */
export async function claimsOf(tx: Tx, staff: StaffMember) {
  const claims = JSON.stringify({
    role: 'authenticated',
    clinic: { staff_id: staff.id, role: staff.role, all_centres: true, centres: [] },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
}

export async function knowledgeVersion(tx: Tx) {
  const [version] = await tx.execute<{ id: string }>(
    sql`insert into kb_version (number, source, report, created_by)
      select coalesce(max(number), 0) + 1, '{}'::jsonb, '{}'::jsonb, 'tests' from kb_version
      returning id`,
  );
  return version?.id ?? '';
}

/** An episode at `centreId` moved through `statuses` now, as the system (and the consultant). */
export async function episodeThrough(
  tx: Tx,
  centreId: string,
  statuses: EpisodeStatus[],
  patientId?: string,
) {
  const [row] = await tx
    .insert(episode)
    .values({ patientId: patientId ?? (await testPatient(tx)), centreId })
    .returning({ id: episode.id, patientId: episode.patientId });
  if (!row) throw new Error('no episode');
  let from: EpisodeStatus = 'intake_pending';
  for (const status of statuses) {
    await tx
      .update(episode)
      .set({ status, pausedFrom: status === 'on_hold' ? from : null })
      .where(eq(episode.id, row.id));
    from = status;
  }
  return row;
}

let slot = 0;

/** A visit on `day` at a centre, in `status`, with the times its status needs. */
export async function visit(
  tx: Tx,
  options: {
    centreId: string;
    physio: StaffMember;
    type: 'consultation' | 'session';
    day: string;
    status: 'booked' | 'checked_in' | 'in_progress' | 'completed' | 'no_show';
    episodeId?: string;
    patientId?: string;
  },
) {
  slot += 1;
  const startsAt = istInstant(options.day, 8 * 60 + (slot % 40) * 15);
  const came = ['checked_in', 'in_progress', 'completed'].includes(options.status);
  const started = ['in_progress', 'completed'].includes(options.status);
  const [row] = await tx
    .insert(appointment)
    .values({
      number: '',
      patientId: options.patientId ?? (await testPatient(tx)),
      centreId: options.centreId,
      physioId: options.physio.id,
      appointmentTypeId: await typeId(tx, options.type),
      episodeId: options.episodeId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 15 * 60_000),
      channel: 'front_desk',
      bookedBy: superAdmin.id,
      status: options.status,
      arrivedAt: came ? startsAt : null,
      checkedInBy: came ? superAdmin.id : null,
      startedAt: started ? startsAt : null,
      startedBy: started ? options.physio.id : null,
      completedAt: options.status === 'completed' ? startsAt : null,
      noShowAt: options.status === 'no_show' ? startsAt : null,
      noShowBy: options.status === 'no_show' ? superAdmin.id : null,
    })
    .returning({
      id: appointment.id,
      startsAt: appointment.startsAt,
      patientId: appointment.patientId,
    });
  if (!row) throw new Error('no visit');
  return row;
}

/** A consultation note on a visit: a draft, or signed at `signedAt`. */
export async function note(
  tx: Tx,
  options: {
    appointmentId: string;
    episodeId: string;
    physio: StaffMember;
    kbVersionId: string;
    signedAt?: Date;
  },
) {
  const [row] = await tx
    .insert(consultation)
    .values({
      appointmentId: options.appointmentId,
      episodeId: options.episodeId,
      physioId: options.physio.id,
      kbVersionId: options.kbVersionId,
      sections: {},
    })
    .returning({ id: consultation.id });
  if (!row) throw new Error('no consultation');
  if (options.signedAt) {
    await claimsOf(tx, options.physio);
    await tx
      .update(consultation)
      .set({ status: 'signed', signedAt: options.signedAt, signedBy: options.physio.id })
      .where(eq(consultation.id, row.id));
    await asSystem(tx);
  }
  return row.id;
}

/** A health form for a visit, submitted at `submittedAt`. */
export async function healthForm(
  tx: Tx,
  visited: { id: string; patientId: string },
  submittedAt: Date,
) {
  const link = await insertPatientLink(tx, {
    patientId: visited.patientId,
    purpose: 'health_form',
    appointmentId: visited.id,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  await tx.insert(intakeResponse).values({
    appointmentId: visited.id,
    patientId: visited.patientId,
    patientLinkId: link.id,
    formVersion: 'hf-3',
    answers: {},
    submittedAt,
  });
}

/** A consultation bill at `centreId` paid today; the payment's id. */
export async function paidBill(tx: Tx, centreId: string, physio: StaffMember, amount: number) {
  const one = await visit(tx, {
    centreId,
    physio,
    type: 'consultation',
    day: istDate(new Date()),
    status: 'booked',
  });
  // The fee bill the booking may have made is replaced by this one, paid.
  await tx.delete(bill).where(and(eq(bill.appointmentId, one.id), eq(bill.kind, 'consultation')));
  const [made] = await tx
    .insert(bill)
    .values({
      number: `TEST-B-${crypto.randomUUID().slice(0, 8)}`,
      kind: 'consultation',
      status: 'paid',
      patientId: one.patientId,
      centreId,
      appointmentId: one.id,
      totalPaise: amount,
    })
    .returning({ id: bill.id });
  const [paidWith] = await tx
    .insert(payment)
    .values({ billId: made?.id ?? '', method: 'upi', amountPaise: amount, recordedBy: deskHsr.id })
    .returning({ id: payment.id });
  return paidWith?.id ?? '';
}

/** A red flag alert on an episode, referred by `by`, which puts the episode On hold. */
export async function referred(tx: Tx, episodeId: string, by: StaffMember, kbVersionId: string) {
  const [alert] = await tx
    .insert(redFlagAlert)
    .values({
      episodeId,
      kbVersionId,
      ruleKey: 'test.night_pain',
      name: 'Night pain',
      triage: 'urgent_medical_referral',
      display: 'review',
      action: 'Review today.',
      signedOff: true,
    })
    .returning({ id: redFlagAlert.id });
  const now = new Date();
  await tx
    .update(redFlagAlert)
    .set({ status: 'reviewed', reviewedBy: by.id, reviewedAt: now })
    .where(eq(redFlagAlert.id, alert?.id ?? ''));
  await tx
    .update(redFlagAlert)
    .set({
      status: 'referred',
      referredTo: 'Orthopaedics',
      referredBy: by.id,
      referredAt: now,
      referralReason: 'Night pain with weight loss.',
      referralQuestion: 'Please assess for a serious cause.',
    })
    .where(eq(redFlagAlert.id, alert?.id ?? ''));
  const [held] = await tx
    .select({ status: episode.status })
    .from(episode)
    .where(eq(episode.id, episodeId));
  await tx
    .update(episode)
    .set({ status: 'on_hold', pausedFrom: held?.status })
    .where(eq(episode.id, episodeId));
}
