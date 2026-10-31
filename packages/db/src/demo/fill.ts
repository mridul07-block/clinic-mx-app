import { and, eq, like, sql } from 'drizzle-orm';
import { systemActor, withActor } from '../audit';
import type { Db } from '../client';
import { episode, patient } from '../schema';
import type { DbOrTransaction } from '../versioned';
import { demoCatalog, demoCentres } from './context';
import { messagingRefusal } from './guard';
import { DEMO_EMAIL_DOMAIN, demoPerson, hashText, seeded } from './names';
import { canSwitchTriggers } from './remove';
import { demoSetup, type SetupCounts } from './setup';
import { nextSession, patientStory, stageOf, type StoryStage } from './story';
import { demoToday, type TodayVisit } from './today';

/**
 * `pnpm demo:fill` (docs/runbooks/demo-data.md): the set up, the patients' history and today's
 * visits. Each patient is its own transaction, so a run that stops part way keeps what it made and
 * the next run carries on from there.
 */

export const DEMO_PATIENTS_PER_CENTRE = 20;

export class DemoRefusedError extends Error {}

export const TRIGGERS_REFUSED =
  'This database login may not set session_replication_role, which back-dating and removal need.';

export interface FillCounts {
  setup: SetupCounts;
  patients: { made: number; existing: number; byStage: Partial<Record<StoryStage, number>> };
  today: Record<string, { made: TodayVisit[]; skipped: TodayVisit[]; already: boolean }>;
  quietened: number;
}

export function demoSlug(code: string, index: number): string {
  return `${code}-${String(index + 1).padStart(2, '0')}`;
}

export async function fillDemo(
  db: Db,
  options: { patientsPerCentre?: number; now?: Date } = {},
): Promise<FillCounts> {
  const perCentre = options.patientsPerCentre ?? DEMO_PATIENTS_PER_CENTRE;
  const now = options.now ?? new Date();
  const centres = demoCentres();
  const phones = centres.flatMap((centre) =>
    Array.from({ length: perCentre }, (_, i) => demoPerson(demoSlug(centre.code, i)).phone),
  );
  const refused = await messagingRefusal(db, phones);
  if (refused) throw new DemoRefusedError(refused);
  if (!(await canSwitchTriggers(db))) throw new DemoRefusedError(TRIGGERS_REFUSED);

  const actor = systemActor('demo');
  const setup = await withActor(db, actor, (tx) => demoSetup(tx, now));
  const catalog = await demoCatalog(db);
  const counts: FillCounts = {
    setup,
    patients: { made: 0, existing: 0, byStage: {} },
    today: {},
    quietened: 0,
  };

  for (const centre of centres) {
    for (let index = 0; index < perCentre; index++) {
      const slug = demoSlug(centre.code, index);
      const stage = stageOf(index);
      const story = await withActor(db, actor, async (tx) => {
        const made = await patientStory(tx, { centre, slug, stage, catalog, now, index });
        // A patient from an earlier run who is still in treatment gets their next session.
        if (made.status === 'exists' && stage === 'active') {
          const [open] = await tx
            .select({ id: episode.id })
            .from(episode)
            .where(and(eq(episode.patientId, made.patientId), eq(episode.status, 'active')));
          if (open) {
            await nextSession(tx, {
              centre,
              catalog,
              patientId: made.patientId,
              episodeId: open.id,
              now,
              index,
              random: seeded(hashText(`${slug}:${now.toISOString().slice(0, 10)}`)),
            });
          }
        }
        counts.quietened += await quietDemoMessages(tx);
        return made;
      });
      if (story.status === 'made') {
        counts.patients.made += 1;
        counts.patients.byStage[stage] = (counts.patients.byStage[stage] ?? 0) + 1;
      } else {
        counts.patients.existing += 1;
      }
    }
  }

  for (const centre of centres) {
    counts.today[centre.code] = await withActor(db, actor, async (tx) => {
      const made = await demoToday(tx, centre, catalog, now);
      counts.quietened += await quietDemoMessages(tx);
      return made;
    });
  }
  return counts;
}

/**
 * Deletes the WhatsApp jobs this transaction queued (a booking confirmation for each visit written,
 * a consultation summary, safety advice, a no show message), so nothing is even attempted for the
 * made up numbers; each fill transaction writes demo rows only, and a job's creation time is its
 * transaction's start. Messages the job runner makes later, such as the day before reminders,
 * meet `whatsapp.test_recipients_only` and are marked Not sent.
 */
export async function quietDemoMessages(tx: DbOrTransaction): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`
    with gone as (
      delete from public.job
      where kind like 'whatsapp.%' and status = 'queued' and created_at = now()
      returning 1
    )
    select count(*)::int as n from gone
  `);
  return rows[0]?.n ?? 0;
}

/** The demo patients there are now, for the counts the commands print. */
export async function demoPatientCount(db: DbOrTransaction): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(patient)
    .where(like(patient.email, `%@${DEMO_EMAIL_DOMAIN}`));
  return rows[0]?.n ?? 0;
}
