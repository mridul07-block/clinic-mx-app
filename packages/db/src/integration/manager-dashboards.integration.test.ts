import { addDays, istDate, type AlertItem } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  appointmentsPerDay,
  arrivalsToday,
  bookingChannels,
  busyHours,
  kpiDiagnosisOutcomes,
  kpiFunnel,
  managerAlertCounts,
  paymentPendingCounts,
  teamDaily,
  utilisationOn,
} from '../dashboards';
import type { StaffMember } from '../identity';
import { kpiDaily } from '../kpis';
import { appointment, bill, consultation, episode, redFlagAlert, task } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import {
  asSystem,
  claimsOf,
  episodeThrough,
  knowledgeVersion,
  note,
  paidBill,
  visit,
} from './fake-figures';
import { becomeStaff, on, testDate, testPatient, testPhysio, typeId } from './fake-schedule';

// DSH-03: the Centre Manager's dashboard counts. A manager without the Treats patients tick gets
// the counts of what they cannot read row by row, only at their centres; physios, the desk and
// Finance are refused. Each test reads before and after adding generated records, all rolled
// back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}
const superAdmin = member('super.admin@clinicmx.test');
const manager = member('manager@clinicmx.test');
const finance = member('finance@clinicmx.test');
const deskHsr = member('desk.hsr@clinicmx.test');
const physioHsr = member('physio.hsr@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('tests'), async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

/** `read` as `staff`, back to the owner after. */
async function as<R>(tx: Tx, staff: StaffMember, read: (tx: Tx) => Promise<R>): Promise<R> {
  await becomeStaff(tx, staff);
  const result = await read(tx);
  await asSystem(tx);
  return result;
}

const today = istDate(new Date());
const past = addDays(today, -3);
const hsr = centreIds.hsrLayout;

const alertCount = (
  rows: { centreId: string; item: AlertItem; n: number }[],
  centreId: string,
  item: AlertItem,
) => rows.find((row) => row.centreId === centreId && row.item === item)?.n ?? 0;

describe('the alert counts', () => {
  it('counts what needs the manager at each centre they see, and nothing elsewhere', async () => {
    await rolledBack(async (tx) => {
      const kb = await knowledgeVersion(tx);
      const physio = await testPhysio(tx, {
        centreIds: [hsr, centreIds.whitefield],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const before = await as(tx, manager, managerAlertCounts);
      const everywhereBefore = await as(tx, superAdmin, managerAlertCounts);

      // An emergency red flag at HSR Layout, still raised.
      const flagged = await episodeThrough(tx, hsr, ['awaiting_consultation']);
      await tx.insert(redFlagAlert).values({
        episodeId: flagged.id,
        kbVersionId: kb,
        ruleKey: 'test.cauda_equina',
        name: 'Saddle numbness',
        triage: 'urgent_medical_referral',
        display: 'emergency',
        action: 'Send to the emergency department.',
        signedOff: true,
      });
      // A note started and not signed, at HSR Layout and at Whitefield.
      for (const centreId of [hsr, centreIds.whitefield]) {
        const held = await episodeThrough(tx, centreId, ['awaiting_consultation']);
        const drafted = await visit(tx, {
          centreId,
          physio,
          type: 'consultation',
          day: today,
          status: 'in_progress',
          episodeId: held.id,
          patientId: held.patientId,
        });
        await note(tx, { appointmentId: drafted.id, episodeId: held.id, physio, kbVersionId: kb });
      }
      // A new symptoms review held by a consultant, and an episode on hold.
      await tx.insert(task).values({
        kind: 'review.new_symptoms',
        title: 'Clinical review: new symptoms',
        assigneeStaffUserId: physio.id,
        centreId: hsr,
      });
      // ALT-02: a worse or escalated session joins the reviews; an overdue 6 week review counts
      // on its own.
      await tx.insert(task).values([
        {
          kind: 'review.worsening',
          title: 'Worse or escalated in session 3',
          assigneeStaffUserId: physio.id,
          centreId: hsr,
        },
        {
          kind: 'review.overdue',
          title: '6 week review overdue',
          assigneeStaffUserId: physio.id,
          centreId: hsr,
        },
      ]);
      await episodeThrough(tx, hsr, ['awaiting_consultation', 'on_hold']);

      const after = await as(tx, manager, managerAlertCounts);
      const change = (item: AlertItem, centreId = hsr) =>
        alertCount(after, centreId, item) - alertCount(before, centreId, item);
      expect(change('red_flags_emergency')).toBe(1);
      expect(change('unsigned_notes')).toBe(1);
      expect(change('reviews_open')).toBe(2);
      expect(change('reviews_overdue')).toBe(1);
      expect(change('episodes_on_hold')).toBe(1);
      // The manager does not see Whitefield; the Super Admin does.
      expect(manager.centreIds).not.toContain(centreIds.whitefield);
      expect(after.some((row) => row.centreId === centreIds.whitefield)).toBe(false);
      const everywhere = await as(tx, superAdmin, managerAlertCounts);
      expect(
        alertCount(everywhere, centreIds.whitefield, 'unsigned_notes') -
          alertCount(everywhereBefore, centreIds.whitefield, 'unsigned_notes'),
      ).toBe(1);
    });
  });

  it('counts unpaid bills without amounts, today and earlier', async () => {
    await rolledBack(async (tx) => {
      const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const before = await as(tx, manager, paymentPendingCounts);
      // A consultation booked today makes its fee bill (unpaid); a paid one is not pending.
      const owing = await visit(tx, {
        centreId: hsr,
        physio,
        type: 'consultation',
        day: today,
        status: 'booked',
      });
      const [fee] = await tx
        .select({ id: bill.id })
        .from(bill)
        .where(eq(bill.appointmentId, owing.id));
      if (!fee) {
        await tx.insert(bill).values({
          number: `TEST-B-${crypto.randomUUID().slice(0, 8)}`,
          kind: 'consultation',
          status: 'unpaid',
          patientId: owing.patientId,
          centreId: hsr,
          appointmentId: owing.id,
          totalPaise: 100_000,
        });
      }
      await paidBill(tx, hsr, physio, 120_000);
      const after = await as(tx, manager, paymentPendingCounts);
      const row = (rows: typeof after) => rows.find((each) => each.centreId === hsr);
      expect((row(after)?.sinceToday ?? 0) - (row(before)?.sinceToday ?? 0)).toBe(1);
      expect(Object.keys(row(after) ?? {}).sort()).toEqual(['centreId', 'earlier', 'sinceToday']);
      const columns = await tx.execute<{ name: string }>(
        sql`select unnest(proargnames) as name from pg_proc where proname = 'payment_pending_counts'`,
      );
      expect(columns.map((column) => column.name).join(' ')).not.toMatch(/amount|paise|total/);
    });
  });
});

describe('the team figures', () => {
  it('credits notes to their writer and visits to whoever started them, summing to the centre', async () => {
    await rolledBack(async (tx) => {
      const kb = await knowledgeVersion(tx);
      const writer = await testPhysio(tx, {
        centreIds: [hsr],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const cover = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const teamBefore = await as(tx, manager, (t) => teamDaily(t, past, past));
      const centreBefore = await as(tx, manager, (t) => kpiDaily(t, past, past));

      const held = await episodeThrough(tx, hsr, ['awaiting_consultation']);
      const seen = await visit(tx, {
        centreId: hsr,
        physio: writer,
        type: 'consultation',
        day: past,
        status: 'completed',
        episodeId: held.id,
        patientId: held.patientId,
      });
      await note(tx, {
        appointmentId: seen.id,
        episodeId: held.id,
        physio: writer,
        kbVersionId: kb,
        signedAt: new Date(seen.startsAt.getTime() + 20 * 60_000),
      });
      // A visit booked with the writer, started by the covering physio.
      const coveredEpisode = await episodeThrough(tx, hsr, ['awaiting_consultation']);
      const covered = await visit(tx, {
        centreId: hsr,
        physio: writer,
        type: 'consultation',
        day: past,
        status: 'completed',
        episodeId: coveredEpisode.id,
        patientId: coveredEpisode.patientId,
      });
      await tx
        .update(appointment)
        .set({ startedBy: cover.id })
        .where(eq(appointment.id, covered.id));
      // The covering physio writes and signs that visit's note the same day: theirs.
      await note(tx, {
        appointmentId: covered.id,
        episodeId: coveredEpisode.id,
        physio: cover,
        kbVersionId: kb,
        signedAt: new Date(covered.startsAt.getTime() + 30 * 60_000),
      });

      const team = await as(tx, manager, (t) => teamDaily(t, past, past));
      const of = (physioId: string, metric: string) =>
        team.find((row) => row.physioId === physioId && row.metric === metric);
      expect(of(writer.id, 'notes_signed_same_day')).toMatchObject({
        numerator: 1,
        denominator: 1,
      });
      expect(of(cover.id, 'notes_signed_same_day')).toMatchObject({
        numerator: 1,
        denominator: 1,
      });
      expect(of(writer.id, 'visits_attended')?.numerator).toBe(1);
      expect(of(cover.id, 'visits_attended')?.numerator).toBe(1);
      // The physios' notes add up to the centre's figure.
      const sum = (rows: typeof team) =>
        rows
          .filter((row) => row.centreId === hsr && row.metric === 'notes_signed_same_day')
          .reduce((total, row) => total + (row.denominator ?? 0), 0);
      const centre = await as(tx, manager, (t) => kpiDaily(t, past, past));
      const centreNotes = (rows: typeof centre) =>
        rows.find((row) => row.centreId === hsr && row.metric === 'notes_signed_same_day')
          ?.denominator ?? 0;
      expect(sum(team) - sum(teamBefore)).toBe(centreNotes(centre) - centreNotes(centreBefore));
    });
  });
});

describe('the outcomes', () => {
  it('follows episodes from their first attended consultation, leaving opening entries out', async () => {
    await rolledBack(async (tx) => {
      const consultant = await testPhysio(tx, {
        centreIds: [hsr],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const before = await as(tx, manager, (t) => kpiFunnel(t, addDays(today, -29), today));
      const stage = (rows: typeof before, name: string) =>
        rows.find((row) => row.centreId === hsr && row.stage === name)?.episodes ?? 0;

      const consulted = async (statuses: Parameters<typeof episodeThrough>[2]) => {
        const held = await episodeThrough(tx, hsr, statuses);
        await visit(tx, {
          centreId: hsr,
          physio: consultant,
          type: 'consultation',
          day: past,
          status: 'completed',
          episodeId: held.id,
          patientId: held.patientId,
        });
        return held;
      };
      const proposed = ['awaiting_consultation', 'plan_proposed'] as const;
      await consulted([...proposed]);
      await consulted([...proposed, 'active']);
      const recovered = await consulted([...proposed, 'active']);
      await claimsOf(tx, consultant);
      await tx
        .update(episode)
        .set({ status: 'discharged', dischargeReason: 'goals_achieved', closedAt: new Date() })
        .where(eq(episode.id, recovered.id));
      await asSystem(tx);
      // An opening entry later seen in a consultation visit: not in the funnel.
      const opened = await episodeThrough(tx, hsr, [...proposed, 'active']);
      await claimsOf(tx, superAdmin);
      await tx.execute(sql`insert into opening_entry (patient_id, episode_id, centre_id, physio_id,
        sessions_left, valid_until)
        values (${opened.patientId}, ${opened.id}, ${hsr}, ${physio.id}, 6, ${addDays(today, 30)})`);
      await asSystem(tx);
      await visit(tx, {
        centreId: hsr,
        physio: consultant,
        type: 'consultation',
        day: past,
        status: 'completed',
        episodeId: opened.id,
        patientId: opened.patientId,
      });

      const after = await as(tx, manager, (t) => kpiFunnel(t, addDays(today, -29), today));
      const change = (name: string) => stage(after, name) - stage(before, name);
      expect(
        [
          'consultation_held',
          'plan_proposed',
          'active',
          'discharged',
          'discharged_goals_met',
          'in_treatment',
        ].map(change),
      ).toEqual([3, 3, 2, 1, 1, 1]);
    });
  });

  it('gives each diagnosis its pain from the first consultation to the last session', async () => {
    await rolledBack(async (tx) => {
      const consultant = await testPhysio(tx, {
        centreIds: [hsr],
        consultant: true,
        createdBy: superAdmin.id,
      });
      const [condition] = await tx.execute<{
        kb_version_id: string;
        condition_id: string;
        name: string;
      }>(
        sql`select kb_version_id, condition_id, name from kb_condition order by kb_version_id desc limit 1`,
      );
      if (!condition) throw new Error('the knowledge base has no conditions');
      const before = await as(tx, manager, (t) =>
        kpiDiagnosisOutcomes(t, addDays(today, -29), today),
      );
      const ofCondition = (rows: typeof before) =>
        rows.find((row) => row.centreId === hsr && row.conditionId === condition.condition_id);

      const held = await episodeThrough(tx, hsr, [
        'awaiting_consultation',
        'plan_proposed',
        'active',
      ]);
      const seen = await visit(tx, {
        centreId: hsr,
        physio: consultant,
        type: 'consultation',
        day: past,
        status: 'completed',
        episodeId: held.id,
        patientId: held.patientId,
      });
      const consultationId = await note(tx, {
        appointmentId: seen.id,
        episodeId: held.id,
        physio: consultant,
        kbVersionId: condition.kb_version_id,
      });
      // The pain the consultant confirmed, then signed.
      await tx
        .update(consultation)
        .set({ sections: { subjective: { confirmed: { pain_activity: 7 } } } })
        .where(eq(consultation.id, consultationId));
      await claimsOf(tx, consultant);
      await tx
        .update(consultation)
        .set({ status: 'signed', signedAt: new Date(), signedBy: consultant.id })
        .where(eq(consultation.id, consultationId));
      await asSystem(tx);
      await tx.execute(sql`insert into diagnosis (consultation_id, episode_id, kb_version_id,
        condition_id, movement_dx, irritability, stage, provisional)
        values (${consultationId}, ${held.id}, ${condition.kb_version_id}, ${condition.condition_id},
          'Test movement diagnosis', 'moderate', 'subacute', false)`);
      // The last session: pain 2.
      const later = await visit(tx, {
        centreId: hsr,
        physio: consultant,
        type: 'session',
        day: today,
        status: 'in_progress',
        episodeId: held.id,
        patientId: held.patientId,
      });
      await tx.execute(sql`insert into session (appointment_id, physio_id, kb_version_id, number, note,
        status, signed_at, signed_by, pain_rest, pain_activity, pain_after)
        values (${later.id}, ${consultant.id}, ${condition.kb_version_id}, 1, '{}'::jsonb,
          'draft', null, null, null, null, null)`);
      await claimsOf(tx, consultant);
      await tx.execute(sql`update session set status = 'signed', signed_at = now(), signed_by = physio_id,
        pain_rest = 1, pain_activity = 2, pain_after = 1 where appointment_id = ${later.id}`);
      await tx
        .update(episode)
        .set({ status: 'discharged', dischargeReason: 'goals_achieved', closedAt: new Date() })
        .where(eq(episode.id, held.id));
      await asSystem(tx);

      const after = await as(tx, manager, (t) =>
        kpiDiagnosisOutcomes(t, addDays(today, -29), today),
      );
      const row = ofCondition(after);
      const earlier = ofCondition(before);
      expect((row?.diagnosed ?? 0) - (earlier?.diagnosed ?? 0)).toBe(1);
      expect((row?.discharged ?? 0) - (earlier?.discharged ?? 0)).toBe(1);
      expect((row?.paired ?? 0) - (earlier?.paired ?? 0)).toBe(1);
      expect(row?.conditionName).toBe(condition.name);
      if (!earlier?.paired) {
        expect(row?.baselinePain).toBe(7);
        expect(row?.dischargePain).toBe(2);
      }
    });
  });
});

describe('the appointment figures', () => {
  it('reads arrivals, bookings and busy hours at the manager’s centres only, and utilisation', async () => {
    await rolledBack(async (tx) => {
      // A physio at HSR Layout working 09:00 to 13:00 on the test date, with two 45 minute visits
      // there, one of them half outside the hours.
      const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdmin.id });
      const session = await typeId(tx, 'session');
      for (const minutes of [10 * 60, 12 * 60 + 30]) {
        await tx.insert(appointment).values({
          number: '',
          patientId: await testPatient(tx),
          centreId: hsr,
          physioId: physio.id,
          appointmentTypeId: session,
          startsAt: on(minutes),
          endsAt: on(minutes + 45),
          channel: 'walk_in',
          bookedBy: superAdmin.id,
        });
      }
      const used = await as(tx, manager, (t) => utilisationOn(t, hsr, testDate));
      expect(used).toEqual({ booked: 75, rostered: 240 });

      // Arrived today at HSR Layout and at Whitefield: the manager sees HSR Layout's only.
      const elsewhere = await testPhysio(tx, {
        centreIds: [centreIds.whitefield],
        createdBy: superAdmin.id,
      });
      const here = await visit(tx, {
        centreId: hsr,
        physio,
        type: 'session',
        day: today,
        status: 'checked_in',
      });
      const there = await visit(tx, {
        centreId: centreIds.whitefield,
        physio: elsewhere,
        type: 'session',
        day: today,
        status: 'checked_in',
      });
      const arrivals = await as(tx, manager, (t) => arrivalsToday(t, today));
      const starts = arrivals.map((row) => row.startsAt.getTime());
      expect(starts).toContain(here.startsAt.getTime());
      expect(arrivals.some((row) => row.centreId === centreIds.whitefield)).toBe(false);
      const everywhere = await as(tx, superAdmin, (t) => arrivalsToday(t, today));
      expect(everywhere.map((row) => row.startsAt.getTime())).toContain(there.startsAt.getTime());
      const perDay = await as(tx, manager, (t) => appointmentsPerDay(t, today, testDate));
      expect(perDay.every((row) => manager.centreIds.includes(row.centreId))).toBe(true);
      expect(
        perDay.find((row) => row.centreId === hsr && row.day === testDate)?.n,
      ).toBeGreaterThanOrEqual(2);
      const channels = await as(tx, manager, (t) => bookingChannels(t, today));
      expect(channels.find((row) => row.channel === 'walk_in')?.n).toBeGreaterThanOrEqual(2);
      const hours = await as(tx, manager, (t) => busyHours(t, today, today, hsr));
      expect(hours.reduce((total, row) => total + row.n, 0)).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('who reads the dashboards', () => {
  it('refuses physios, the desk and Finance every count', async () => {
    await rolledBack(async (tx) => {
      const reads = [
        (t: Tx) => managerAlertCounts(t),
        (t: Tx) => paymentPendingCounts(t),
        (t: Tx) => teamDaily(t, past, today),
        (t: Tx) => kpiFunnel(t, past, today),
        (t: Tx) => kpiDiagnosisOutcomes(t, past, today),
      ];
      for (const someone of [physioHsr, deskHsr, finance]) {
        for (const read of reads) {
          expect(
            await failure(tx, async (sp) => {
              await becomeStaff(sp, someone);
              await read(sp);
            }),
          ).toBe('42501');
        }
      }
      // And a period too long.
      expect(
        await failure(tx, async (sp) => {
          await becomeStaff(sp, manager);
          await teamDaily(sp, addDays(today, -400), today);
        }),
      ).toBe('22023');
      // A manager without the Treats patients tick still gets the counts.
      expect(manager.treatsPatients).toBe(false);
      await as(tx, manager, managerAlertCounts);
      expect(await testPatient(tx)).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
