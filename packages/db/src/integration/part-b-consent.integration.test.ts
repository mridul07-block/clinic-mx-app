import { partBStatements } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertConsentRecords } from '../consent';
import type { StaffMember } from '../identity';
import { partBForEpisode, partBForLink } from '../part-b-consent';
import { insertPatientLink } from '../patient-links';
import { patientLink } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { signedPlan } from './fake-plan';
import { becomeStaff, testPhysio } from './fake-schedule';

// BIL-03 done when: Part B consent pages, general terms always, package terms only with a package,
// one card per planned modality, signed. The database's side: the desk issues the episode's consent
// link at its centre; through it the patient reads their plan's Part B and adds their decisions,
// for that episode only, while the link is open; staff read where it stands without the diagnosis.
// Generated data only. Rolled back. CI database only.
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
const deskKoramangala = member('desk.koramangala@clinicmx.test');

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
    const cause = (error as { cause?: { code?: string } }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

async function asOwner(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
}

/** From here on, as the patient behind `link`, the way `withPatientAccess` reads. */
async function asLink(tx: Tx, link: { id: string; patientId: string; purpose: string }) {
  await setAuditContext(tx, { actor: patientActor(link.patientId) });
  const claims = JSON.stringify({
    role: 'clinic_patient',
    patient_link: { id: link.id, patient_id: link.patientId, purpose: link.purpose },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role clinic_patient`);
}

/** A signed plan with Laser and Dry needling, and the desk's consent link for it. */
async function setUp(tx: Tx) {
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const plan = await signedPlan(tx, {
    centreId: centreIds.hsrLayout,
    consultant,
    checkedInBy: deskHsr.id,
    modalities: ['laser', 'dry_needling'],
  });
  await asOwner(tx);
  await becomeStaff(tx, deskHsr);
  const link = await insertPatientLink(tx, {
    patientId: plan.patientId,
    episodeId: plan.episodeId,
    purpose: 'consent',
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await asOwner(tx);
  return { ...plan, link: { id: link.id, patientId: plan.patientId, purpose: 'consent' } };
}

const decision = (
  plan: { patientId: string; episodeId: string; link: { id: string } },
  statementKey: string,
  accepted: boolean,
  extra: Record<string, unknown> = {},
) => ({
  patientId: plan.patientId,
  episodeId: plan.episodeId,
  patientLinkId: plan.link.id,
  stage: 'B' as const,
  statementKey,
  statementVersion: 1,
  accepted,
  signer: 'patient' as const,
  ...(accepted ? { signatureKind: 'typed' as const, typedName: 'Test Patient' } : {}),
  ...extra,
});

describe('Part B consent', () => {
  it('is issued by the desk at the episode’s centre only', async () => {
    await rolledBack(async (tx) => {
      const plan = await setUp(tx);
      await becomeStaff(tx, deskKoramangala);
      expect(
        await failure(tx, (sp) =>
          insertPatientLink(sp, {
            patientId: plan.patientId,
            episodeId: plan.episodeId,
            purpose: 'consent',
            expiresAt: new Date(Date.now() + 3_600_000),
          }),
        ),
      ).toBe('42501');
    });
  });

  it('shows the patient their plan’s Part B and takes their decisions through the open link', async () => {
    await rolledBack(async (tx) => {
      const plan = await setUp(tx);
      await asLink(tx, plan.link);
      expect(await partBForLink(tx)).toMatchObject({
        episodeId: plan.episodeId,
        planned: true,
        package: false,
        diagnosis: 'Test Condition',
        latest: {},
      });
      expect((await partBForLink(tx))?.modalities.map((m) => m.key).sort()).toEqual([
        'dry_needling',
        'laser',
      ]);
      await insertConsentRecords(tx, [
        decision(plan, 'part_b.plan', true, { shownText: 'Test words shown' }),
        decision(plan, 'part_b.modality.laser', false, { modality: 'laser' }),
      ]);
      expect((await partBForLink(tx))?.latest).toEqual({
        'part_b.plan': true,
        'part_b.modality.laser': false,
      });
      // Never for a visit, never Part A, never another statement family.
      expect(
        await failure(tx, (sp) =>
          insertConsentRecords(sp, [
            decision(plan, 'part_b.plan', true, { appointmentId: plan.appointmentId }),
          ]),
        ),
      ).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          insertConsentRecords(sp, [decision(plan, 'part_a.screening', true, { stage: 'A' })]),
        ),
      ).toBe('42501');

      // Staff at the centre read where it stands, with no diagnosis.
      await asOwner(tx);
      await becomeStaff(tx, deskHsr);
      expect(await partBForEpisode(tx, plan.episodeId)).toMatchObject({
        diagnosis: null,
        latest: { 'part_b.plan': true, 'part_b.modality.laser': false },
      });
      await asOwner(tx);
      await becomeStaff(tx, deskKoramangala);
      expect(await partBForEpisode(tx, plan.episodeId)).toBeUndefined();
    });
  });

  it('takes nothing once the link is used, or for another episode', async () => {
    await rolledBack(async (tx) => {
      const plan = await setUp(tx);
      const other = await setUp(tx);
      await asLink(tx, plan.link);
      expect(
        await failure(tx, (sp) =>
          insertConsentRecords(sp, [
            { ...decision(plan, 'part_b.plan', true), episodeId: other.episodeId },
          ]),
        ),
      ).toBe('42501');
      await insertConsentRecords(tx, [decision(plan, 'part_b.right_to_decline', true)]);
      await tx
        .update(patientLink)
        .set({ completedAt: sql`now()` })
        .where(sql`id = ${plan.link.id}`);
      expect(
        await failure(tx, (sp) => insertConsentRecords(sp, [decision(plan, 'part_b.plan', true)])),
      ).toBe('42501');
    });
  });

  it('knows a package was chosen', async () => {
    await rolledBack(async (tx) => {
      const plan = await setUp(tx);
      const [made] = await tx.execute<{ id: string }>(sql`
        insert into package_type (name, sessions, price_paise, active)
        values ('Test package', 6, 600000, true) returning id`);
      const [ids] = await tx.execute<{ item: string; plan: string }>(sql`
        select (select id from price_item where active limit 1) as item,
          (select id from plan_of_care where episode_id = ${plan.episodeId}) as plan`);
      await tx.execute(
        sql`update episode set status = 'awaiting_consultation' where id = ${plan.episodeId}`,
      );
      await tx.execute(
        sql`update episode set status = 'plan_proposed' where id = ${plan.episodeId}`,
      );
      await tx.execute(sql`
        insert into plan_choice (episode_id, plan_of_care_id, choice, package_type_id,
          session_price_item_id, recorded_by)
        values (${plan.episodeId}, ${ids?.plan ?? ''}, 'package', ${made?.id ?? ''},
          ${ids?.item ?? ''}, ${deskHsr.id})`);
      await asLink(tx, plan.link);
      expect((await partBForLink(tx))?.package).toBe(true);
    });
  });
});

// BIL-12: the consent and pricing gate's Part B, as the database works it out.
describe('the Part B gate', () => {
  it('knows the same statements as the app', async () => {
    const rows = await db.execute<{
      statement_key: string;
      statement_group: string;
      modality: string | null;
      version: number;
    }>(sql`select * from internal.part_b_statements()`);
    expect(
      rows.map((row) => [row.statement_key, row.statement_group, row.modality, row.version]).sort(),
    ).toEqual(
      Object.values(partBStatements)
        .map((statement) => [
          statement.key,
          statement.group,
          'modality' in statement ? statement.modality : null,
          statement.version,
        ])
        .sort(),
    );
  });

  it('is met once every statement asked is decided, no general term declined', async () => {
    await rolledBack(async (tx) => {
      const plan = await setUp(tx);
      const gate = async () => {
        await asOwner(tx);
        const [row] = await tx.execute<{ gate: string }>(
          sql`select internal.part_b_gate(${plan.episodeId}::uuid) as gate`,
        );
        return row?.gate;
      };
      expect(await gate()).toBe('missing');
      await asLink(tx, plan.link);
      await insertConsentRecords(tx, [
        decision(plan, 'part_b.plan', true),
        decision(plan, 'part_b.right_to_decline', true),
        decision(plan, 'part_b.modality.laser', true, { modality: 'laser' }),
      ]);
      // Dry needling's wording is awaited: never asked, nothing waits on it (DECISION #21).
      expect(await gate()).toBe('met');
      await asLink(tx, plan.link);
      // A treatment declined leaves only it out.
      await insertConsentRecords(tx, [
        decision(plan, 'part_b.modality.laser', false, { modality: 'laser' }),
      ]);
      expect(await gate()).toBe('met');
      await asLink(tx, plan.link);
      // A later change of mind (a later transaction in life, a later time here).
      await insertConsentRecords(tx, [
        decision(plan, 'part_b.right_to_decline', false, {
          createdAt: new Date(Date.now() + 60_000),
        }),
      ]);
      expect(await gate()).toBe('general_declined');
    });
  });

  it('waits for a signed plan', async () => {
    await rolledBack(async (tx) => {
      const [row] = await tx.execute<{ gate: string }>(sql`
        with p as (insert into patient (name, phone, registered_centre_id)
          values ('Test Patient Gate', '+919900000123', ${centreIds.hsrLayout}) returning id),
        e as (insert into episode (patient_id, centre_id) select id, ${centreIds.hsrLayout} from p
          returning id)
        select internal.part_b_gate(e.id) as gate from e`);
      expect(row?.gate).toBe('no_plan');
    });
  });
});

// BIL-03 review: what the patient's link may add, and what a decline does.
describe('Part B records', () => {
  it('name a real, current statement with its own modality, words and guardian', async () => {
    await rolledBack(async (tx) => {
      const plan = await setUp(tx);
      const [stranger] = await tx.execute<{ id: string }>(sql`
        insert into guardian (patient_id, name, relationship, phone)
        select p.id, 'Test Guardian Other', 'mother', '+919900000777'
        from patient p where p.id <> ${plan.patientId} limit 1 returning id`);
      await asLink(tx, plan.link);
      for (const forged of [
        decision(plan, 'part_b.anything', true),
        decision(plan, 'part_b.plan', true, { statementVersion: 99 }),
        decision(plan, 'part_b.modality.laser', true, { modality: 'pemf' }),
        decision(plan, 'part_b.modality.dry_needling', true, {
          modality: 'dry_needling',
          statementVersion: 0,
        }),
        decision(plan, 'part_b.right_to_decline', true, { shownText: 'I agree to everything' }),
        decision(plan, 'part_b.plan', true, {
          signer: 'guardian',
          guardianId: stranger?.id ?? '',
        }),
      ]) {
        expect(
          await failure(tx, (sp) => insertConsentRecords(sp, [forged])),
          forged.statementKey,
        ).toBe('42501');
      }
    });
  });

  it('use the link only once something is recorded, and a decline gives the desk a task', async () => {
    await rolledBack(async (tx) => {
      const plan = await setUp(tx);
      await asLink(tx, plan.link);
      const complete = (sp: Tx) =>
        sp
          .update(patientLink)
          .set({ completedAt: sql`now()` })
          .where(sql`id = ${plan.link.id}`)
          .returning({ id: patientLink.id });
      expect(
        await failure(tx, async (sp) => {
          if ((await complete(sp)).length === 0) throw Object.assign(new Error(), { code: 'none' });
        }),
      ).toBeDefined();
      await insertConsentRecords(tx, [decision(plan, 'part_b.right_to_decline', false)]);
      expect(await complete(tx)).toHaveLength(1);
      await asOwner(tx);
      const tasks = await tx.execute<{ assignee_role: string; priority: string }>(sql`
        select assignee_role, priority from task
        where kind = 'consent.part_b_declined' and episode_id = ${plan.episodeId}`);
      expect(tasks).toEqual([{ assignee_role: 'front_desk', priority: 'high' }]);
    });
  });
});
