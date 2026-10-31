import {
  aroundNowToday,
  consultationSectionsSchema,
  earlierToday,
  istDate,
  sessionNoteSchema,
  type SignedRows,
} from '@clinic-mx/schemas';
import { and, eq, like, sql } from 'drizzle-orm';
import { insertNotifications } from '../clinical';
import { signConsultation } from '../clinical-record';
import { insertConsentRecords } from '../consent';
import { openConsultation } from '../consultations';
import { insertEpisode } from '../episodes';
import { startVisit } from '../my-patients';
import { insertPatientLink } from '../patient-links';
import { insertPatient } from '../patients';
import { confirmAppointment } from '../reminders';
import { bill, consultation, episode, intakeResponse, patient, treatmentSession } from '../schema';
import { openSession, signSession } from '../sessions';
import { checkIn, markNoShow } from '../slots';
import type { DbOrTransaction } from '../versioned';
import type { DemoCatalog, DemoCentre, DemoCondition } from './context';
import { actAs, actAsSystem, addVisit, after, BackDates, isFree } from './helpers';
import { DEMO_EMAIL_DOMAIN, demoPerson, hashText, pick, seeded } from './names';
import { billOf, moveEpisode, pay } from './story';

type Tx = DbOrTransaction;

/**
 * Today's visits at a centre (docs/runbooks/demo-data.md), through the same steps the desk and the
 * physio take, so the database's own day rules apply: something in every column of Today, a
 * patient with the physio and one whose note is signed, a no show, a walk in, a declined consent.
 * Made once a day per centre: a centre that already has today's demo patients is left as it is.
 */

export type TodayVisit =
  | 'done'
  | 'with_physio'
  | 'here_now'
  | 'walk_in'
  | 'confirmed'
  | 'not_confirmed'
  | 'no_show'
  | 'session_done';

export interface TodayResult {
  made: TodayVisit[];
  skipped: TodayVisit[];
  already: boolean;
}

/** The slug prefix of a centre's demo patients made on `day`: `hsr-t20261031`. */
export function todayPrefix(centre: DemoCentre, day: string): string {
  return `${centre.code}-t${day.replaceAll('-', '')}`;
}

export async function demoToday(
  tx: Tx,
  centre: DemoCentre,
  catalog: DemoCatalog,
  now: Date,
): Promise<TodayResult> {
  const today = istDate(now);
  const prefix = todayPrefix(centre, today);
  const [already] = await tx
    .select({ id: patient.id })
    .from(patient)
    .where(like(patient.email, `${prefix}-%@${DEMO_EMAIL_DOMAIN}`))
    .limit(1);
  if (already) return { made: [], skipped: [], already: true };

  const result: TodayResult = { made: [], skipped: [], already: false };
  const random = seeded(hashText(prefix));
  const { desk, consultant } = centre;
  let n = 0;

  /** A new patient for today, booked for a consultation at `at` (moved on if the slot is taken). */
  const newPatient = async (at: Date, channel: 'whatsapp' | 'front_desk' | 'walk_in') => {
    const startsAt = await todayStart(tx, consultant.id, at, 30, now);
    if (!startsAt) return undefined;
    n += 1;
    const person = demoPerson(`${prefix}-${n}`);
    const { id: patientId } = await insertPatient(tx, {
      name: person.name,
      phone: person.phone,
      email: person.email,
      dateOfBirth: person.dateOfBirth,
      sex: person.sex,
      occupation: person.occupation,
      registeredCentreId: centre.id,
    });
    const condition = pick(random, catalog.conditions);
    const episodeId = await insertEpisode(tx, {
      patientId,
      centreId: centre.id,
      bodyRegion: condition.bodyRegion,
    });
    const visitId = await addVisit(tx, {
      patientId,
      centreId: centre.id,
      physioId: consultant.id,
      appointmentTypeId: catalog.types.consultation,
      episodeId,
      startsAt,
      minutes: 30,
      status: 'booked',
      channel,
      desk,
    });
    return { patientId, episodeId, visitId, startsAt, person, condition };
  };

  /** The health form sent the day before and filled in, with Part A consent. */
  const healthForm = async (
    made: NonNullable<Awaited<ReturnType<typeof newPatient>>>,
    contactAgreed = true,
  ) => {
    const link = await insertPatientLink(tx, {
      patientId: made.patientId,
      purpose: 'health_form',
      appointmentId: made.visitId,
      expiresAt: after(now, 24 * 60),
    });
    await tx.insert(intakeResponse).values({
      appointmentId: made.visitId,
      patientId: made.patientId,
      patientLinkId: link.id,
      formVersion: 'hf-3',
      answers: {},
      submittedAt: after(now, -90),
    });
    await insertConsentRecords(tx, [
      {
        patientId: made.patientId,
        appointmentId: made.visitId,
        patientLinkId: link.id,
        stage: 'A',
        statementKey: 'part_a.screening',
        statementVersion: 1,
        accepted: true,
        signatureKind: 'typed',
        typedName: made.person.name,
        signer: 'patient',
      },
      {
        patientId: made.patientId,
        appointmentId: made.visitId,
        patientLinkId: link.id,
        stage: 'A',
        statementKey: 'part_a.contact',
        statementVersion: 1,
        accepted: contactAgreed,
        ...(contactAgreed ? { signatureKind: 'typed' as const, typedName: made.person.name } : {}),
        signer: 'patient',
      },
    ]);
    await moveEpisode(tx, made.episodeId, 'awaiting_consultation');
  };

  const past = (minutes: number) => {
    const at = earlierToday(minutes, now);
    return at < now ? at : undefined;
  };
  const ahead = (minutes: number) => {
    const at = aroundNowToday(minutes, now);
    return at > now && istDate(at) === today ? at : undefined;
  };
  const record = (visit: TodayVisit, ok: boolean) => {
    (ok ? result.made : result.skipped).push(visit);
  };

  // Done: seen this morning, the note signed, the consultation fee still to pay.
  {
    const at = past(150);
    const made = at && (await newPatient(at, 'whatsapp'));
    if (made) {
      await healthForm(made);
      await checkIn(tx, {
        appointmentId: made.visitId,
        by: desk.id,
        now: after(made.startsAt, -5),
      });
      await actAs(tx, consultant);
      await startVisit(tx, { appointmentId: made.visitId, by: consultant.id, now: made.startsAt });
      await signedConsultation(tx, made, centre, catalog);
      await actAsSystem(tx);
      await moveEpisode(tx, made.episodeId, 'plan_proposed');
    }
    record('done', Boolean(made));
  }
  // With the physio: started a little while ago, the note a draft.
  {
    const at = past(20);
    const made = at && (await newPatient(at, 'front_desk'));
    if (made) {
      await healthForm(made);
      await checkIn(tx, {
        appointmentId: made.visitId,
        by: desk.id,
        now: after(made.startsAt, -5),
      });
      await actAs(tx, consultant);
      await startVisit(tx, { appointmentId: made.visitId, by: consultant.id, now: made.startsAt });
      const consultationId = await openConsultation(tx, {
        appointmentId: made.visitId,
        episodeId: made.episodeId,
        physioId: consultant.id,
      });
      await tx
        .update(consultation)
        .set({
          sections: consultationSectionsSchema.parse({
            subjective: { notes: 'Sore for about a month after starting a new gym programme.' },
          }),
        })
        .where(eq(consultation.id, consultationId));
      await actAsSystem(tx);
    }
    record('with_physio', Boolean(made));
  }
  // Here now: checked in, the health form in, the physio told (CLN-01).
  {
    const at = ahead(10) ?? past(5);
    const made = at && (await newPatient(at, 'whatsapp'));
    if (made) {
      await healthForm(made);
      await checkIn(tx, { appointmentId: made.visitId, by: desk.id, now: after(now, -3) });
      await insertNotifications(tx, [
        {
          staffUserId: consultant.id,
          kind: 'health_form_submitted',
          appointmentId: made.visitId,
          episodeId: made.episodeId,
        },
      ]);
    }
    record('here_now', Boolean(made));
  }
  // A walk in, checked in as they arrive (SCH-08).
  {
    const at = ahead(25) ?? past(10);
    const made = at && (await newPatient(at, 'walk_in'));
    if (made) await checkIn(tx, { appointmentId: made.visitId, by: desk.id, now });
    record('walk_in', Boolean(made));
  }
  // Coming later: one confirmed on WhatsApp, one not, whose contact consent was declined.
  {
    const at = ahead(75);
    const made = at && (await newPatient(at, 'whatsapp'));
    if (made) {
      await healthForm(made);
      await confirmAppointment(tx, made.visitId, now);
    }
    record('confirmed', Boolean(made));
  }
  {
    const at = ahead(150);
    const made = at && (await newPatient(at, 'front_desk'));
    if (made) await healthForm(made, false);
    record('not_confirmed', Boolean(made));
  }
  // A no show this morning (ALT-04): the call back task comes with it.
  {
    const at = past(100);
    const made = at && (await newPatient(at, 'whatsapp'));
    if (made) await markNoShow(tx, { appointmentId: made.visitId, by: desk.id, now });
    record('no_show', Boolean(made));
  }
  // A treatment session this morning for one of the centre's patients in treatment.
  {
    const at = past(60);
    const done = at && (await sessionToday(tx, centre, catalog, at, now));
    record('session_done', Boolean(done));
  }
  return result;
}

/** `at`, or the next quarter hour after it when the physio is free, on today's IST date. */
async function todayStart(
  tx: Tx,
  physioId: string,
  at: Date,
  minutes: number,
  now: Date,
): Promise<Date | undefined> {
  const quarter = 15 * 60_000;
  const first = new Date(Math.floor(at.getTime() / quarter) * quarter);
  for (let i = 0; i < 12; i++) {
    const startsAt = new Date(first.getTime() + (at < now ? -i : i) * quarter);
    if (istDate(startsAt) !== istDate(now)) return undefined;
    if (await isFree(tx, physioId, startsAt, after(startsAt, minutes))) return startsAt;
  }
  return undefined;
}

async function signedConsultation(
  tx: Tx,
  made: { patientId: string; episodeId: string; visitId: string; condition: DemoCondition },
  centre: DemoCentre,
  catalog: DemoCatalog,
): Promise<void> {
  const { condition } = made;
  const consultationId = await openConsultation(tx, {
    appointmentId: made.visitId,
    episodeId: made.episodeId,
    physioId: centre.consultant.id,
  });
  await tx
    .update(consultation)
    .set({
      sections: consultationSectionsSchema.parse({
        subjective: { notes: 'Stiff and sore for two months; worse after sitting.' },
        assessment: {
          conditionId: condition.conditionId,
          movement: 'Reduced load tolerance',
          irritability: 'moderate',
          stage: 'subacute',
          provisional: false,
        },
        plan: {
          goals: [{ text: 'Get back to walking an hour a day', patient: true }],
          interventions: ['exercise'],
          treatingPhysioId: centre.physio.id,
        },
      }),
    })
    .where(eq(consultation.id, consultationId));
  const rows: SignedRows = {
    measures: [],
    tests: [],
    diagnosis: {
      conditionId: condition.conditionId,
      movement: 'Reduced load tolerance',
      irritability: 'moderate',
      stage: 'subacute',
      categoryCode: null,
      provisional: false,
    },
    plan: {
      goals: [{ text: 'Get back to walking an hour a day', patient: true }],
      interventions: ['exercise'],
      modalities: [],
      sessionsPerWeek: 2,
      weeks: 6,
      homeProgramme: [{ exercise: 'Glute bridge', dose: '3 sets of 15', note: '' }],
      reviewDate: istDate(after(new Date(), 42 * 24 * 60)),
      questionnaires: [],
      treatingPhysioId: centre.physio.id,
      investigations: '',
      referral: '',
    },
  };
  const [draft] = await tx
    .select({ version: consultation.version })
    .from(consultation)
    .where(eq(consultation.id, consultationId));
  const signed = await signConsultation(tx, {
    consultationId,
    baseVersion: draft?.version ?? 1,
    by: centre.consultant.id,
    episodeId: made.episodeId,
    appointmentId: made.visitId,
    kbVersionId: catalog.kbVersionId,
    rows,
  });
  if (signed !== 'signed') throw new Error("Today's demo consultation was not signed.");
}

/** A signed session today for an Active demo patient of the centre, if one is free then. */
async function sessionToday(
  tx: Tx,
  centre: DemoCentre,
  catalog: DemoCatalog,
  at: Date,
  now: Date,
): Promise<boolean> {
  const [patientInTreatment] = await tx
    .select({ patientId: episode.patientId, episodeId: episode.id })
    .from(episode)
    .innerJoin(patient, eq(patient.id, episode.patientId))
    .where(
      and(
        eq(episode.centreId, centre.id),
        eq(episode.status, 'active'),
        like(patient.email, `${centre.code}-%@${DEMO_EMAIL_DOMAIN}`),
        sql`not exists (select 1 from appointment a where a.episode_id = ${episode.id}
          and (a.starts_at at time zone 'Asia/Kolkata')::date = ${istDate(now)}::date)`,
      ),
    )
    .limit(1);
  if (!patientInTreatment) return false;
  const startsAt = await todayStart(tx, centre.physio.id, at, 30, now);
  if (!startsAt) return false;
  const visitId = await addVisit(tx, {
    ...patientInTreatment,
    centreId: centre.id,
    physioId: centre.physio.id,
    appointmentTypeId: catalog.types.session,
    startsAt,
    minutes: 30,
    status: 'booked',
    channel: 'front_desk',
    desk: centre.desk,
  });
  await checkIn(tx, { appointmentId: visitId, by: centre.desk.id, now: after(startsAt, -5) });
  await actAs(tx, centre.physio);
  await startVisit(tx, { appointmentId: visitId, by: centre.physio.id, now: startsAt });
  const note = sessionNoteSchema.parse({
    newSymptoms: { answer: 'no' },
    sinceLastVisit: 'Easier on the stairs this week.',
    pain: { rest: 1, activity: 3, after: 2 },
    treatment: { interventions: ['exercise'], note: 'Progressed loading; tolerated well.' },
    response: { rating: 'better' },
    nextSession: { plan: 'progress' },
  });
  const sessionId = await openSession(tx, {
    appointmentId: visitId,
    physioId: centre.physio.id,
    kbVersionId: catalog.kbVersionId,
    note,
  });
  const [open] = await tx
    .select({ version: treatmentSession.version })
    .from(treatmentSession)
    .where(eq(treatmentSession.id, sessionId));
  await signSession(tx, {
    sessionId,
    baseVersion: open?.version ?? 1,
    by: centre.physio.id,
    pain: { rest: 1, activity: 3, after: 2 },
  });
  await actAsSystem(tx);
  // Paid at the desk on the way out, when it is pay as you go (BIL-10).
  const owed = await billOf(tx, and(eq(bill.appointmentId, visitId), eq(bill.kind, 'session')));
  if (owed) await pay(tx, new BackDates(), owed, now, centre, () => 0);
  return true;
}
