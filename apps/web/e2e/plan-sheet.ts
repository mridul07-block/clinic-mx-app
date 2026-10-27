import {
  appointment,
  consultation,
  createDb,
  episode,
  job,
  packageType,
  packageTypeItem,
  patientPackage,
  planModality,
  planOfCare,
  priceItem,
  systemActor,
  withActor,
} from '@clinic-mx/db';
import { and, eq, isNotNull, sql } from 'drizzle-orm';

// The plan and payment sheet for end to end tests (BIL-01): a priced modality on a signed
// consultation's plan, and a package type covering a session item. Generated
// names only ("E2E"), removed with the prices snapshot.

let database: ReturnType<typeof createDb> | undefined;
const db = () => {
  const url = process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
  database ??= createDb(url, { max: 1, idleTimeoutSeconds: 1 });
  return database.db;
};

/** Moves the 6 week review date of the consultation's plan (OUT-06). */
export async function planReviewDate(consultationId: string, reviewDate: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx
      .update(planOfCare)
      .set({ reviewDate })
      .where(eq(planOfCare.consultationId, consultationId));
  });
}

/** Plans a modality on the consultation's plan of care, as signing writes it. */
export async function plannedModality(consultationId: string, modalityKey: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [plan] = await tx
      .select({ id: planOfCare.id })
      .from(planOfCare)
      .where(eq(planOfCare.consultationId, consultationId));
    if (!plan) throw new Error('The consultation has no plan of care.');
    await tx.insert(planModality).values({ planOfCareId: plan.id, modalityKey, reason: '' });
  });
}

/** A package type covering one price item, by its key; its name starts with "E2E". */
export async function testPackage(values: {
  name: string;
  sessions: number;
  pricePaise: number;
  itemKey: string;
}): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [item] = await tx
      .select({ id: priceItem.id })
      .from(priceItem)
      .where(eq(priceItem.key, values.itemKey));
    if (!item) throw new Error(`No price item ${values.itemKey}`);
    const [created] = await tx
      .insert(packageType)
      .values({ name: values.name, sessions: values.sessions, pricePaise: values.pricePaise })
      .returning({ id: packageType.id });
    if (!created) throw new Error('The package type was not added.');
    await tx.insert(packageTypeItem).values({ packageTypeId: created.id, priceItemId: item.id });
  });
}

/**
 * Moves the consultation's episode to Plan proposed, as signing through the service does (the
 * fixture signs in the database directly).
 */
export async function proposedPlan(consultationId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    const [row] = await tx
      .select({ episodeId: consultation.episodeId, status: episode.status })
      .from(consultation)
      .innerJoin(episode, eq(episode.id, consultation.episodeId))
      .where(eq(consultation.id, consultationId));
    if (!row) throw new Error('The consultation has no episode.');
    const steps = ['awaiting_consultation', 'plan_proposed'] as const;
    for (const status of steps.slice(row.status === 'intake_pending' ? 0 : 1)) {
      await tx.update(episode).set({ status }).where(eq(episode.id, row.episodeId));
    }
  });
}

/** Makes the "I'll think about it" follow ups on the patient's choices due now (BIL-02). */
export async function thinkAboutItDueNow(patientId: string): Promise<number> {
  return withActor(db(), systemActor('tests'), async (tx) => {
    const due = await tx
      .update(job)
      .set({ runAt: new Date() })
      .where(
        sql`${job.kind} = 'billing.think_about_it_follow_up' and ${job.status} = 'queued'
          and ${job.payload} ->> 'choiceId' in (
            select c.id::text from plan_choice c join episode e on e.id = c.episode_id
            where e.patient_id = ${patientId})`,
      )
      .returning({ id: job.id });
    return due.length;
  });
}

/** Moves the last day of the patient's packages (BIL-08), to see them expiring or expired. */
export async function packageValidUntil(patientId: string, validUntil: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx
      .update(patientPackage)
      .set({ validUntil })
      .where(eq(patientPackage.patientId, patientId));
  });
}

/** How many sessions the patient's packages have used (SES-03 Close session uses one). */
export async function packageSessionsUsed(patientId: string): Promise<number> {
  const rows = await db()
    .select({ used: patientPackage.sessionsUsed })
    .from(patientPackage)
    .where(eq(patientPackage.patientId, patientId));
  return rows.reduce((total, row) => total + row.used, 0);
}

/** The patient's appointments booked in plan series (SCH-11), the series, and the lists queued. */
export async function planSeriesOf(patientId: string) {
  const rows = await db()
    .select({ planBookingId: appointment.planBookingId })
    .from(appointment)
    .where(and(eq(appointment.patientId, patientId), isNotNull(appointment.planBookingId)));
  const series = [...new Set(rows.map((row) => row.planBookingId ?? ''))];
  const lists =
    series.length === 0
      ? []
      : await db()
          .select({ id: job.id })
          .from(job)
          .where(
            sql`${job.kind} = 'whatsapp.plan_sessions_list' and ${job.payload} ->> 'planBookingId' in ${series}`,
          );
  return { appointments: rows.length, series: series.length, lists: lists.length };
}

/**
 * Moves the consultation's episode on to Active, as paying for the chosen plan does (SCH-12 books
 * next sessions only then); its id.
 */
export async function activePlan(consultationId: string): Promise<string> {
  await proposedPlan(consultationId);
  return withActor(db(), systemActor('tests'), async (tx) => {
    const [row] = await tx
      .select({ episodeId: consultation.episodeId })
      .from(consultation)
      .where(eq(consultation.id, consultationId));
    if (!row) throw new Error('The consultation has no episode.');
    await tx.update(episode).set({ status: 'active' }).where(eq(episode.id, row.episodeId));
    return row.episodeId;
  });
}

/** Makes another physio the episode's treating physio, on every plan version (OUT-04). */
export async function treatedBy(episodeId: string, physioId: string): Promise<void> {
  await withActor(db(), systemActor('tests'), async (tx) => {
    await tx
      .update(planOfCare)
      .set({ treatingPhysioId: physioId })
      .where(eq(planOfCare.episodeId, episodeId));
  });
}
