import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { episodePainReadings } from '../progress';
import { appointment, consultation, kbVersion, treatmentSession } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient, testPhysio, typeId } from './fake-schedule';

// OUT-03: the Progress tab's pain, read under the reader's row level security: the signed
// consultation's pain now and on activity, and each signed session's three readings; drafts never;
// the desk nothing. Every test runs in a transaction that is rolled back. CI database only.
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
const deskHsr = member('desk.hsr@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

const DAY = 24 * 60 * 60 * 1000;

describe('the Progress tab’s pain', () => {
  it('is the signed consultation’s and the signed sessions’, for clinicians only', async () => {
    try {
      await withActor(db, systemActor('tests'), async (tx: Tx) => {
        const session = await typeId(tx, 'session');
        const physio = await testPhysio(tx, {
          centreIds: [centreIds.hsrLayout],
          consultant: true,
          createdBy: superAdmin.id,
        });
        const patientId = await testPatient(tx);
        const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
        const [version] = await tx.select({ id: kbVersion.id }).from(kbVersion).limit(1);
        const kbVersionId = version?.id ?? '';
        const visit = async (daysAgo: number) => {
          // eslint-disable-next-line no-restricted-syntax -- visits days in the past, by design
          const startsAt = new Date(Date.now() - daysAgo * DAY);
          const [row] = await tx
            .insert(appointment)
            .values({
              number: '',
              patientId,
              episodeId,
              centreId: centreIds.hsrLayout,
              physioId: physio.id,
              appointmentTypeId: session,
              startsAt,
              endsAt: new Date(startsAt.getTime() + 45 * 60000),
              channel: 'front_desk',
              bookedBy: superAdmin.id,
              status: 'checked_in',
              arrivedAt: startsAt,
              checkedInBy: superAdmin.id,
            })
            .returning({ id: appointment.id });
          return row?.id ?? '';
        };
        // The consultation, signed with confirmed pain (placed directly, triggers off).
        const consulted = await visit(10);
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.insert(consultation).values({
          appointmentId: consulted,
          episodeId,
          physioId: physio.id,
          kbVersionId,
          sections: { subjective: { notes: '', confirmed: { pain_now: 3, pain_activity: 6 } } },
          status: 'signed',
          signedBy: physio.id,
          signedAt: new Date(Date.now() - 10 * DAY),
        });
        // A later consultation still a draft, with other pain: never read.
        await tx.insert(consultation).values({
          appointmentId: await visit(1),
          episodeId,
          physioId: physio.id,
          kbVersionId,
          sections: { subjective: { notes: '', confirmed: { pain_now: 9, pain_activity: 9 } } },
        });
        await tx.execute(sql`set local session_replication_role = origin`);
        // Two sessions: one signed with its pain, one still a draft.
        for (const [daysAgo, signed] of [
          [6, true],
          [3, false],
        ] as const) {
          const appointmentId = await visit(daysAgo);
          const [opened] = await tx
            .insert(treatmentSession)
            .values({
              appointmentId,
              episodeId,
              patientId,
              centreId: centreIds.hsrLayout,
              physioId: physio.id,
              number: 1,
              kbVersionId,
            })
            .returning({ id: treatmentSession.id });
          if (signed) {
            await tx
              .update(treatmentSession)
              .set({
                status: 'signed',
                signedBy: physio.id,
                signedAt: new Date(),
                painRest: 2,
                painActivity: 4,
                painAfter: 1,
              })
              .where(eq(treatmentSession.id, opened?.id ?? ''));
          }
        }

        await becomeStaff(tx, physio);
        const read = await episodePainReadings(tx, episodeId);
        expect(read.consultation).toMatchObject({ now: 3, activity: 6, kbVersionId });
        expect(read.sessions.map((s) => s.pain)).toEqual([{ rest: 2, activity: 4, after: 1 }]);
        expect(read.sessions[0]?.at).toBeInstanceOf(Date);

        await tx.execute(sql`reset role`);
        await becomeStaff(tx, deskHsr);
        expect(await episodePainReadings(tx, episodeId)).toEqual({
          consultation: undefined,
          sessions: [],
        });
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
});
