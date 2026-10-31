import {
  addDays,
  consultationSectionsSchema,
  istDate,
  istInstant,
  knowledgeRegionKeys,
  sessionNoteSchema,
  taskKindLabel,
  type SignedRows,
} from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { signConsultation } from '../clinical-record';
import { insertConsentRecords } from '../consent';
import { openConsultation } from '../consultations';
import { insertEpisode } from '../episodes';
import { insertFeedback } from '../feedback';
import { insertPatientLink } from '../patient-links';
import { insertPatient } from '../patients';
import {
  appointment,
  bill,
  consultation,
  episode,
  intakeResponse,
  message,
  patient,
  patientPackage,
  patientPlanChoice,
  payment,
  planOfCare,
  redFlagAlert,
  task,
  treatmentSession,
} from '../schema';
import { openSession, signSession } from '../sessions';
import type { DbOrTransaction } from '../versioned';
import type { DemoCatalog, DemoCentre } from './context';
import { actAs, actAsSystem, addVisit, after, BackDates, freeStart, workingDay } from './helpers';
import { between, demoPerson, hashText, pick, seeded } from './names';

type Tx = DbOrTransaction;

/**
 * One demo patient's history (docs/runbooks/demo-data.md): a booking, the health form, consent,
 * a signed consultation with its plan of care, the plan choice and its bills, treatment sessions,
 * and where the episode stands now. Written through the database's own rules, then moved back to
 * when it happened (`BackDates`).
 */

export const storyStages = [
  'active',
  'discharged',
  'plan_proposed',
  'awaiting_consultation',
  'under_review',
  'on_hold',
  'think_about_it',
  'old_discharged',
] as const;
export type StoryStage = (typeof storyStages)[number];

/** Twenty patients a centre, spread so that even a few cover every stage. */
const stageOrder: StoryStage[] = [
  'active',
  'discharged',
  'plan_proposed',
  'awaiting_consultation',
  'under_review',
  'on_hold',
  'think_about_it',
  'old_discharged',
  'active',
  'discharged',
  'active',
  'discharged',
  'active',
  'old_discharged',
  'active',
  'discharged',
  'active',
  'old_discharged',
  'active',
  'old_discharged',
];

export function stageOf(index: number): StoryStage {
  return stageOrder[index % stageOrder.length] ?? 'active';
}

const complaints = [
  'Sore for about six weeks, worse after long days at the desk.',
  'Started after a weekend run; stiff in the mornings, easing with movement.',
  'Came on gradually over two months; aches on stairs and after sitting.',
  'Twisted it at football three weeks ago; better but still not trusting it.',
  'On and off for a year, flared up after moving house.',
];

const goals = [
  'Run 5 km without pain',
  'Sit through a full work day comfortably',
  'Climb stairs without holding the rail',
  'Get back to badminton twice a week',
  'Sleep through the night',
  'Lift the children without a twinge',
];

const sessionNotes = [
  'Progressed loading; tolerated well.',
  'Kept the same programme; form improving.',
  'Added a single leg exercise; mild ache after, settled in the session.',
  'Reviewed the home programme; doing it most days.',
  'Hands on work and mobility; easier range by the end.',
];

export interface StoryResult {
  status: 'made' | 'exists';
  stage: StoryStage;
  patientId: string;
  episodeId?: string;
}

/** The demo patient for `slug` at `centre`, at `stage`, as of `now`. */
export async function patientStory(
  tx: Tx,
  options: {
    centre: DemoCentre;
    slug: string;
    stage: StoryStage;
    catalog: DemoCatalog;
    now: Date;
    /** Spreads patients over the day's times. */
    index: number;
  },
): Promise<StoryResult> {
  const { centre, slug, stage, catalog, now, index } = options;
  const person = demoPerson(slug);
  const [existing] = await tx
    .select({ id: patient.id })
    .from(patient)
    .where(eq(patient.email, person.email));
  if (existing) return { status: 'exists', stage, patientId: existing.id };

  const random = seeded(hashText(`${slug}:story`));
  const today = istDate(now);
  const back = new BackDates();
  const { desk, consultant, physio } = centre;

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

  const ageDays: Record<StoryStage, [number, number]> = {
    active: [10, 45],
    discharged: [50, 85],
    old_discharged: [95, 170],
    plan_proposed: [2, 6],
    think_about_it: [4, 12],
    under_review: [42, 55],
    on_hold: [12, 25],
    awaiting_consultation: [-6, -1],
  };
  const [low, high] = ageDays[stage];
  const future = stage === 'awaiting_consultation';
  const consultDay = workingDay(addDays(today, -between(random, low, high)), future ? 1 : -1);
  const bookedAt = future
    ? after(now, -between(random, 60, 60 * 30))
    : istInstant(addDays(consultDay, -between(random, 2, 5)), between(random, 9, 20) * 60);
  back.add('patient', patientId, { created_at: bookedAt, updated_at: bookedAt });
  back.add('episode', episodeId, {
    opened_at: bookedAt,
    created_at: bookedAt,
    updated_at: bookedAt,
  });

  const consultStart = await freeStart(tx, consultant.id, consultDay, 45, index);
  if (!consultStart) throw new Error(`No free consultation time on ${consultDay}.`);
  const channel = random() < 0.6 ? 'whatsapp' : 'front_desk';
  const consultVisit = await addVisit(tx, {
    patientId,
    centreId: centre.id,
    physioId: consultant.id,
    appointmentTypeId: catalog.types.consultation,
    episodeId,
    startsAt: consultStart,
    minutes: 45,
    status: future ? (random() < 0.5 ? 'confirmed' : 'booked') : 'in_progress',
    channel,
    desk,
  });
  back.add('appointment', consultVisit, { created_at: bookedAt, updated_at: bookedAt });
  await sentMessage(tx, back, {
    patientId,
    phone: person.phone,
    appointmentId: consultVisit,
    key: channel === 'whatsapp' ? 'booking_confirmation' : 'front_desk_booking_confirmation',
    at: after(bookedAt, 1),
    read: random() < 0.7,
  });

  // The health form, the evening before (INT-03), moving the episode on to its consultation.
  const formAt = future ? after(now, -between(random, 30, 600)) : after(consultStart, -14 * 60);
  const form = await insertPatientLink(tx, {
    patientId,
    purpose: 'health_form',
    appointmentId: consultVisit,
    expiresAt: after(now, 60),
  });
  await tx.insert(intakeResponse).values({
    appointmentId: consultVisit,
    patientId,
    patientLinkId: form.id,
    formVersion: 'hf-3',
    answers: {},
    submittedAt: formAt,
  });
  back.add('patient_link', form.id, { created_at: after(bookedAt, 2) });
  back.add(
    'intake_response',
    consultVisit,
    { created_at: formAt, updated_at: formAt },
    'appointment_id',
  );
  await moveEpisode(tx, episodeId, 'awaiting_consultation');
  await insertConsentRecords(
    tx,
    (['part_a.screening', 'part_a.contact'] as const).map((key) => ({
      patientId,
      appointmentId: consultVisit,
      patientLinkId: form.id,
      stage: 'A' as const,
      statementKey: key,
      statementVersion: 1,
      accepted: true,
      signatureKind: 'typed' as const,
      typedName: person.name,
      signer: 'patient' as const,
    })),
  );
  back.add(
    'consent_record',
    consultVisit,
    { signed_at: formAt, created_at: formAt },
    'appointment_id',
  );
  if (future) {
    await back.apply(tx);
    return { status: 'made', stage, patientId, episodeId };
  }

  // The consultation (CLN-02 to CLN-09), signed by the consultant.
  const goal = pick(random, goals);
  const region = (knowledgeRegionKeys as readonly string[]).includes(condition.region)
    ? condition.region
    : '';
  const sessionsPerWeek = 2;
  const weeks = between(random, 4, 8);
  await actAs(tx, consultant);
  const consultationId = await openConsultation(tx, {
    appointmentId: consultVisit,
    episodeId,
    physioId: consultant.id,
  });
  const sections = consultationSectionsSchema.parse({
    subjective: { notes: pick(random, complaints) },
    screening: { notes: 'Screening questions gone through; nothing of concern.' },
    objective: { notes: 'Movement and strength assessed; findings recorded.', region },
    assessment: {
      notes: '',
      conditionId: condition.conditionId,
      movement: 'Reduced load tolerance',
      irritability: pick(random, ['low', 'moderate'] as const),
      stage: pick(random, ['subacute', 'chronic'] as const),
      categoryCode: '',
      provisional: false,
    },
    plan: {
      notes: '',
      goals: [{ text: goal, patient: true }],
      interventions: ['exercise', 'manual_therapy'],
      sessionsPerWeek,
      weeks,
      treatingPhysioId: physio.id,
    },
  });
  await tx.update(consultation).set({ sections }).where(eq(consultation.id, consultationId));
  const rows: SignedRows = {
    measures: [],
    tests: [],
    diagnosis: {
      conditionId: condition.conditionId,
      movement: 'Reduced load tolerance',
      irritability: sections.assessment.irritability || 'moderate',
      stage: sections.assessment.stage || 'subacute',
      categoryCode: null,
      provisional: false,
    },
    plan: {
      goals: [{ text: goal, patient: true }],
      interventions: ['exercise', 'manual_therapy'],
      modalities: [],
      sessionsPerWeek,
      weeks,
      homeProgramme: [
        { exercise: 'Glute bridge', dose: '3 sets of 15', note: '' },
        { exercise: 'Heel raises', dose: '3 sets of 15', note: '' },
      ],
      reviewDate: addDays(consultDay, weeks * 7),
      questionnaires: [],
      treatingPhysioId: physio.id,
      investigations: '',
      referral: '',
    },
  };
  const signedAt = after(consultStart, 40);
  const [draft] = await tx
    .select({ version: consultation.version })
    .from(consultation)
    .where(eq(consultation.id, consultationId));
  const signed = await signConsultation(tx, {
    consultationId,
    baseVersion: draft?.version ?? 1,
    by: consultant.id,
    episodeId,
    appointmentId: consultVisit,
    kbVersionId: catalog.kbVersionId,
    rows,
  });
  if (signed !== 'signed') throw new Error('The demo consultation was not signed.');
  await actAsSystem(tx);
  back.add('consultation', consultationId, {
    created_at: consultStart,
    signed_at: signedAt,
    updated_at: signedAt,
  });
  back.add('plan_of_care', consultationId, { created_at: signedAt }, 'consultation_id');
  back.add('appointment', consultVisit, { completed_at: signedAt, updated_at: signedAt });
  await moveEpisode(tx, episodeId, 'plan_proposed');
  back.add('episode', episodeId, { plan_proposed_at: signedAt });

  // The consultation fee bill the visit made (BIL-05), paid at the desk, except "think about it".
  const feeBill = await billOf(tx, eq(bill.appointmentId, consultVisit));
  if (feeBill) {
    back.add('bill', feeBill.id, { created_at: signedAt });
    if (stage !== 'think_about_it') {
      await pay(tx, back, feeBill, after(signedAt, 10), centre, random);
    }
  }

  if (stage === 'plan_proposed') {
    await back.apply(tx);
    return { status: 'made', stage, patientId, episodeId };
  }

  const [plan] = await tx
    .select({ id: planOfCare.id })
    .from(planOfCare)
    .where(eq(planOfCare.consultationId, consultationId));
  if (!plan) throw new Error('The demo plan of care is missing.');
  const choiceAt = after(signedAt, 8);
  const kind =
    stage === 'think_about_it' ? 'think_about_it' : random() < 0.6 ? 'package' : 'per_session';
  const pack = pick(random, catalog.packages);
  const [choice] = await tx
    .insert(patientPlanChoice)
    .values({
      episodeId,
      planOfCareId: plan.id,
      choice: kind,
      packageTypeId: kind === 'package' ? pack.id : null,
      // A package names the session it covers too (BIL-02).
      sessionPriceItemId: kind === 'think_about_it' ? null : catalog.prices.session,
      recordedBy: desk.id,
    })
    .returning({ id: patientPlanChoice.id });
  if (!choice) throw new Error('The demo plan choice was not recorded.');
  back.add('plan_choice', choice.id, { recorded_at: choiceAt });
  if (stage === 'think_about_it') {
    await back.apply(tx);
    return { status: 'made', stage, patientId, episodeId };
  }

  // A package is bought at once (BIL-08); the episode goes Active.
  if (kind === 'package') {
    const packBill = await billOf(tx, eq(bill.planChoiceId, choice.id));
    if (!packBill) throw new Error('The demo package bill is missing.');
    back.add('bill', packBill.id, { created_at: choiceAt });
    const paid = await pay(tx, back, packBill, after(choiceAt, 5), centre, random);
    const [made] = await tx
      .insert(patientPackage)
      .values({
        patientId,
        episodeId,
        centreId: centre.id,
        packageTypeId: pack.id,
        billId: packBill.id,
        paymentId: paid,
        name: pack.name,
        sessionsTotal: pack.sessions,
        reschedulesLeft: 2,
        paidAt: after(choiceAt, 5),
        validUntil: addDays(consultDay, 90),
      })
      .returning({ id: patientPackage.id });
    if (made) back.add('package', made.id, { paid_at: after(choiceAt, 5) });
  }
  await moveEpisode(tx, episodeId, 'active');
  back.add('episode', episodeId, { activated_at: choiceAt });

  // Treatment sessions, about twice a week, signed by the treating physio (SES-03).
  const sessionCount: Record<StoryStage, [number, number]> = {
    // In treatment: sessions right up to yesterday, so the recent figures have them.
    active: [30, 30],
    discharged: [6, 9],
    old_discharged: [5, 8],
    under_review: [5, 7],
    on_hold: [2, 3],
    plan_proposed: [0, 0],
    think_about_it: [0, 0],
    awaiting_consultation: [0, 0],
  };
  const [fewest, most] = sessionCount[stage];
  const sessions = between(random, fewest, most);
  let day = consultDay;
  let pain = between(random, 5, 7);
  let lastDay = consultDay;
  for (let n = 0; n < sessions; n++) {
    day = workingDay(addDays(day, n % 2 === 0 ? 3 : 4), 1);
    if (day >= today) break;
    const startsAt = await freeStart(tx, physio.id, day, 30, index + n);
    if (!startsAt) continue;
    // A missed visit now and then (ALT-04), and a cancellation.
    if (n === 2 && random() < 0.3) {
      await addVisit(tx, {
        patientId,
        centreId: centre.id,
        physioId: physio.id,
        appointmentTypeId: catalog.types.session,
        episodeId,
        startsAt,
        minutes: 30,
        status: random() < 0.5 ? 'no_show' : 'cancelled',
        channel: 'front_desk',
        desk,
      });
      continue;
    }
    const visit = await addVisit(tx, {
      patientId,
      centreId: centre.id,
      physioId: physio.id,
      appointmentTypeId: catalog.types.session,
      episodeId,
      startsAt,
      minutes: 30,
      // Started by the physio; signing the note completes it (SES-03).
      status: 'in_progress',
      channel: 'front_desk',
      desk,
    });
    pain = Math.max(0, pain - between(random, 0, 1));
    const note = sessionNoteSchema.parse({
      newSymptoms: { answer: 'no' },
      sinceLastVisit: 'Doing the exercises most days.',
      pain: { rest: Math.max(0, pain - 2), activity: pain, after: Math.max(0, pain - 1) },
      treatment: {
        interventions: ['exercise', 'manual_therapy'],
        note: pick(random, sessionNotes),
      },
      response: { rating: pain <= 3 ? 'better' : 'same' },
      homeProgramme: { note: 'Carry on with the home programme.' },
      nextSession: { plan: 'progress' },
    });
    await actAs(tx, physio);
    const sessionId = await openSession(tx, {
      appointmentId: visit,
      physioId: physio.id,
      kbVersionId: catalog.kbVersionId,
      note,
    });
    const [open] = await tx
      .select({ version: treatmentSession.version })
      .from(treatmentSession)
      .where(eq(treatmentSession.id, sessionId));
    const signedSession = await signSession(tx, {
      sessionId,
      baseVersion: open?.version ?? 1,
      by: physio.id,
      pain: note.pain as { rest: number; activity: number; after: number },
    });
    if (signedSession !== 'signed') throw new Error('The demo session was not signed.');
    await actAsSystem(tx);
    const closedAt = after(startsAt, 28);
    back.add('session', sessionId, {
      created_at: startsAt,
      signed_at: closedAt,
      updated_at: closedAt,
    });
    back.add('appointment', visit, {
      arrived_at: after(startsAt, -5),
      completed_at: closedAt,
      updated_at: closedAt,
    });
    // Pay as you go: the session's bill (BIL-10), mostly paid the same day.
    const sessionBill = await billOf(
      tx,
      and(eq(bill.appointmentId, visit), eq(bill.kind, 'session')),
    );
    if (sessionBill) {
      back.add('bill', sessionBill.id, { created_at: closedAt });
      if (random() < 0.85) await pay(tx, back, sessionBill, after(closedAt, 3), centre, random);
    }
    lastDay = day;
  }

  // Where the episode stands now.
  if (stage === 'under_review') {
    await moveEpisode(tx, episodeId, 'under_review');
    await tx.insert(task).values({
      kind: 'review.overdue',
      title: taskKindLabel('review.overdue'),
      details: { episodeId },
      assigneeStaffUserId: consultant.id,
      centreId: centre.id,
      patientId,
      episodeId,
      dueAt: after(now, 24 * 60),
    });
  }
  if (stage === 'on_hold') {
    await redFlag(tx, back, {
      episodeId,
      kbVersionId: catalog.kbVersionId,
      by: consultant,
      at: istInstant(lastDay, 12 * 60),
      outcome: 'referred',
    });
  }
  if (stage === 'discharged' || stage === 'old_discharged') {
    const closedAt = istInstant(workingDay(addDays(lastDay, 3), 1), 13 * 60);
    await actAs(tx, consultant);
    await tx
      .update(episode)
      .set({
        status: 'discharged',
        dischargeReason: random() < 0.85 ? 'goals_achieved' : 'patient_choice',
        closedAt,
        dischargeNote: 'Goals met; confident with the home programme.',
        dischargeRecommendations: 'Keep up the exercises three times a week.',
        dischargeFlarePlan: 'Ease off for two days, then build back up; call us if it lasts.',
      })
      .where(eq(episode.id, episodeId));
    await actAsSystem(tx);
    back.add('episode', episodeId, { closed_at: closedAt, updated_at: closedAt });
    if (random() < 0.7) {
      await dischargeFeedback(tx, back, {
        patientId,
        episodeId,
        centre,
        at: after(closedAt, 120),
        random,
      });
    }
  }
  if (stage === 'active' && index % 7 === 0) {
    // An alert waiting for the physio's review (ALT-01).
    await redFlag(tx, back, {
      episodeId,
      kbVersionId: catalog.kbVersionId,
      by: consultant,
      at: after(now, -between(random, 60, 60 * 30)),
      outcome: 'raised',
    });
  }
  if (stage === 'active') {
    await nextSession(tx, { centre, catalog, patientId, episodeId, now, index, random });
  }
  if (stage === 'active' && index % 9 === 0) {
    // A reminder WhatsApp could not deliver (WA-13), for the desk to call about.
    await failedMessage(tx, back, {
      patientId,
      phone: person.phone,
      at: after(now, -between(random, 90, 60 * 40)),
    });
  }
  await back.apply(tx);
  return { status: 'made', stage, patientId, episodeId };
}

/** Moves the episode on, as the app's services do (the transition guard checks the step). */
export async function moveEpisode(
  tx: Tx,
  episodeId: string,
  status: 'awaiting_consultation' | 'plan_proposed' | 'active' | 'under_review',
): Promise<void> {
  await tx.update(episode).set({ status }).where(eq(episode.id, episodeId));
}

export async function billOf(tx: Tx, where: ReturnType<typeof eq> | undefined) {
  const [row] = await tx
    .select({ id: bill.id, total: bill.totalPaise })
    .from(bill)
    .where(and(where, sql`${bill.status} = 'unpaid'`))
    .orderBy(desc(bill.createdAt))
    .limit(1);
  return row;
}

/** Pays a bill in full at the desk; the payment's id. */
export async function pay(
  tx: Tx,
  back: BackDates,
  owed: { id: string; total: number },
  at: Date,
  centre: DemoCentre,
  random: () => number,
): Promise<string> {
  const [paid] = await tx
    .insert(payment)
    .values({
      billId: owed.id,
      method: pick(random, ['upi', 'upi', 'card', 'cash'] as const),
      amountPaise: owed.total,
      recordedBy: centre.desk.id,
    })
    .returning({ id: payment.id });
  if (!paid) throw new Error('The demo payment was not recorded.');
  await tx.update(bill).set({ status: 'paid' }).where(eq(bill.id, owed.id));
  back.add('payment', paid.id, { recorded_at: at });
  return paid.id;
}

/** The next session, booked in the coming days, so the calendar and My patients have them. */
export async function nextSession(
  tx: Tx,
  options: {
    centre: DemoCentre;
    catalog: DemoCatalog;
    patientId: string;
    episodeId: string;
    now: Date;
    index: number;
    random: () => number;
  },
): Promise<void> {
  const { centre, catalog, now, random } = options;
  const [ahead] = await tx
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      and(
        eq(appointment.patientId, options.patientId),
        sql`${appointment.startsAt} > ${now.toISOString()}::timestamptz`,
        sql`${appointment.status} in ('booked', 'confirmed')`,
      ),
    )
    .limit(1);
  if (ahead) return;
  const day = workingDay(addDays(istDate(now), between(random, 1, 6)), 1);
  const startsAt = await freeStart(tx, centre.physio.id, day, 30, options.index);
  if (!startsAt) return;
  await addVisit(tx, {
    patientId: options.patientId,
    centreId: centre.id,
    physioId: centre.physio.id,
    appointmentTypeId: catalog.types.session,
    episodeId: options.episodeId,
    startsAt,
    minutes: 30,
    status: random() < 0.5 ? 'confirmed' : 'booked',
    channel: 'front_desk',
    desk: centre.desk,
  });
}

/** A red flag alert on the episode: waiting for review, or referred (which puts it On hold). */
async function redFlag(
  tx: Tx,
  back: BackDates,
  options: {
    episodeId: string;
    kbVersionId: string;
    by: DemoCentre['consultant'];
    at: Date;
    outcome: 'raised' | 'referred';
  },
): Promise<void> {
  const [alert] = await tx
    .insert(redFlagAlert)
    .values({
      episodeId: options.episodeId,
      kbVersionId: options.kbVersionId,
      ruleKey: 'demo.night_pain',
      name: 'Night pain not eased by rest',
      triage: 'specialist_referral',
      display: 'review',
      action: 'Review at the next visit and decide whether to refer.',
      signedOff: true,
    })
    .returning({ id: redFlagAlert.id });
  if (!alert) throw new Error('The demo alert was not raised.');
  back.add('red_flag_alert', alert.id, { raised_at: options.at });
  if (options.outcome === 'raised') return;
  await actAs(tx, options.by);
  const reviewedAt = after(options.at, 30);
  await tx
    .update(redFlagAlert)
    .set({ status: 'reviewed', reviewedBy: options.by.id, reviewedAt })
    .where(eq(redFlagAlert.id, alert.id));
  await tx
    .update(redFlagAlert)
    .set({
      status: 'referred',
      referredTo: 'Orthopaedics',
      referredBy: options.by.id,
      referredAt: after(reviewedAt, 10),
      referralReason: 'Night pain that has not settled with treatment.',
      referralQuestion: 'Please assess before we carry on with rehabilitation.',
    })
    .where(eq(redFlagAlert.id, alert.id));
  const [held] = await tx
    .select({ status: episode.status })
    .from(episode)
    .where(eq(episode.id, options.episodeId));
  await tx
    .update(episode)
    .set({ status: 'on_hold', pausedFrom: held?.status })
    .where(eq(episode.id, options.episodeId));
  await actAsSystem(tx);
}

/** The patient's answers at discharge (PAT-07), through their feedback link. */
async function dischargeFeedback(
  tx: Tx,
  back: BackDates,
  options: {
    patientId: string;
    episodeId: string;
    centre: DemoCentre;
    at: Date;
    random: () => number;
  },
): Promise<void> {
  const link = await insertPatientLink(tx, {
    patientId: options.patientId,
    purpose: 'feedback',
    episodeId: options.episodeId,
    expiresAt: after(new Date(), 60),
  });
  const score = pick(options.random, [10, 10, 9, 9, 9, 8, 7, 10, 6]);
  await insertFeedback(tx, {
    linkId: link.id,
    subject: {
      surveyKey: 'discharge',
      patientId: options.patientId,
      episodeId: options.episodeId,
      appointmentId: null,
      consultationId: null,
      centreId: options.centre.id,
      physioId: options.centre.consultant.id,
      followUp: null,
    },
    surveyVersion: 1,
    answers: { goals_achieved: 'yes', continue_independently: 'yes', satisfied_with_care: 'yes' },
    comment: score >= 9 ? 'Thank you, the team was very patient with me.' : null,
    score,
  });
  back.add('feedback', link.id, { submitted_at: options.at }, 'patient_link_id');
}

/** A delivered (or read) template message, as Meta reported it (WA-02). */
async function sentMessage(
  tx: Tx,
  back: BackDates,
  options: {
    patientId: string;
    phone: string;
    appointmentId: string;
    key: string;
    at: Date;
    read: boolean;
  },
): Promise<void> {
  const [row] = await tx
    .insert(message)
    .values({
      kind: 'template',
      direction: 'outbound',
      patientId: options.patientId,
      toPhone: options.phone,
      templateKey: options.key,
      templateVersion: options.key === 'booking_confirmation' ? 2 : 1,
      language: 'en',
      variables: {},
      appointmentId: options.appointmentId,
      status: options.read ? 'read' : 'delivered',
      waMessageId: `wamid.demo.${crypto.randomUUID()}`,
      sentAt: options.at,
      deliveredAt: after(options.at, 1),
      readAt: options.read ? after(options.at, 30) : null,
      statusAt: after(options.at, options.read ? 30 : 1),
      createdBy: 'system:demo',
    })
    .returning({ id: message.id });
  if (row) back.add('message', row.id, { created_at: options.at });
}

/** A reminder Meta could not deliver (WA-13). */
async function failedMessage(
  tx: Tx,
  back: BackDates,
  options: { patientId: string; phone: string; at: Date },
): Promise<void> {
  const [row] = await tx
    .insert(message)
    .values({
      kind: 'template',
      direction: 'outbound',
      patientId: options.patientId,
      toPhone: options.phone,
      templateKey: 'day_before_reminder',
      templateVersion: 1,
      language: 'en',
      variables: {},
      status: 'failed',
      errorCode: '131026',
      errorTitle: 'Message undeliverable',
      attempts: 1,
      statusAt: options.at,
      createdBy: 'system:demo',
    })
    .returning({ id: message.id });
  if (row) back.add('message', row.id, { created_at: options.at, status_at: options.at });
}
