import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { auditEvent, whatsappTemplate } from '../schema';
import { seedStaff, seedStaffCentres } from '../seed/data';
import {
  applyTemplateUpdate,
  approvedTemplateVersion,
  recordTemplateVersion,
  TemplateVersionClashError,
  templateVersionsOnMeta,
  type TemplateVersionOnMeta,
} from '../whatsapp-templates';
import { becomeStaff } from './fake-schedule';

// WA-06 done when: every template in the TAD list is approved on the test number. Under row level
// security, in transactions rolled back: Meta's verdict on each version is recorded by the server
// and moved on by its webhook; only an approved version is sent, the newest; the Super Admin reads
// it and nobody signed in writes it. Made-up keys and Meta ids only. CI only.
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
const others = [
  member('manager@clinicmx.test'),
  member('desk.hsr@clinicmx.test'),
  member('physio.hsr@clinicmx.test'),
  member('finance@clinicmx.test'),
  member('support.velyx@clinicmx.test'),
];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('whatsapp-templates'), async (tx) => {
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

const asOwner = (tx: Tx) => tx.execute(sql`reset role`);
// A key no real template has, so a database with real versions changes nothing here.
const fakeKey = () => ['test_template', randomUUID().slice(0, 8)].join('_');
const version = (
  key: string,
  number: number,
  extra: Partial<TemplateVersionOnMeta> = {},
): TemplateVersionOnMeta => ({
  key,
  version: number,
  language: 'en',
  metaName: [key, `v${String(number)}`].join('_'),
  metaId: String(Math.floor(Math.random() * 1e15)),
  category: 'UTILITY',
  status: 'pending',
  reason: null,
  ...extra,
});

describe('WhatsApp template versions on Meta', () => {
  it('sends only an approved version, the newest, and follows Meta’s webhook', async () => {
    await rolledBack(async (tx) => {
      const key = fakeKey();
      const v1 = version(key, 1, { status: 'approved' });
      const v2 = version(key, 2);
      await recordTemplateVersion(tx, v1);
      await recordTemplateVersion(tx, v2);
      expect(await approvedTemplateVersion(tx, key, 'en')).toEqual({
        metaName: v1.metaName,
        version: 1,
      });
      // Not for another language.
      expect(await approvedTemplateVersion(tx, key, 'en_US')).toBeNull();
      // WA-07: never one older than the registry's variables allow.
      expect(await approvedTemplateVersion(tx, key, 'en', 2)).toBeNull();

      expect(
        await applyTemplateUpdate(tx, { metaId: v2.metaId, status: 'approved', reason: null }),
      ).toBe('changed');
      expect(await approvedTemplateVersion(tx, key, 'en')).toEqual({
        metaName: v2.metaName,
        version: 2,
      });
      expect(await approvedTemplateVersion(tx, key, 'en', 2)).toEqual({
        metaName: v2.metaName,
        version: 2,
      });
      // Meta repeating itself changes nothing; a template not ours is left alone.
      expect(
        await applyTemplateUpdate(tx, { metaId: v2.metaId, status: 'approved', reason: null }),
      ).toBe('unchanged');
      expect(await applyTemplateUpdate(tx, { metaId: '1', status: 'approved', reason: null })).toBe(
        'unknown',
      );

      // Paused or moved to marketing: the reason is kept; a paused one is not sent.
      await applyTemplateUpdate(tx, { metaId: v2.metaId, status: 'paused', reason: 'Low quality' });
      await applyTemplateUpdate(tx, {
        metaId: v2.metaId,
        category: 'MARKETING',
        reason: 'Meta moved it to the marketing category.',
      });
      const [paused] = await tx
        .select()
        .from(whatsappTemplate)
        .where(eq(whatsappTemplate.metaId, v2.metaId));
      expect(paused).toMatchObject({
        status: 'paused',
        category: 'MARKETING',
        reason: 'Meta moved it to the marketing category.',
      });
      expect(await approvedTemplateVersion(tx, key, 'en')).toEqual({
        metaName: v1.metaName,
        version: 1,
      });

      // A sync records Meta's current verdict on a version already recorded.
      await recordTemplateVersion(tx, { ...v1, status: 'rejected', reason: 'INVALID_FORMAT' });
      expect(await approvedTemplateVersion(tx, key, 'en')).toBeNull();

      // Every write is audited, as the server.
      const ids = (
        await tx
          .select({ id: whatsappTemplate.id })
          .from(whatsappTemplate)
          .where(eq(whatsappTemplate.key, key))
      ).map((row) => row.id);
      const events = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'whatsapp_template'), inArray(auditEvent.entityId, ids)));
      expect(events.length).toBeGreaterThanOrEqual(5);
      expect(new Set(events.map((event) => event.actor))).toEqual(
        new Set(['system:whatsapp-templates']),
      );
    });
  });

  it('keeps a version’s key, number, language and Meta id', async () => {
    await rolledBack(async (tx) => {
      const v1 = version(fakeKey(), 1);
      await recordTemplateVersion(tx, v1);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(whatsappTemplate)
            .set({ metaId: '99' })
            .where(eq(whatsappTemplate.metaId, v1.metaId)),
        ),
      ).toBe('23514');
      // The Meta name is the key and version.
      expect(
        await failure(tx, (sp) =>
          recordTemplateVersion(sp, { ...version(fakeKey(), 1), metaName: 'other_v1' }),
        ),
      ).toBe('23514');
      // Meta's language codes only, and Meta's numeric ids.
      expect(
        await failure(tx, (sp) =>
          recordTemplateVersion(sp, { ...version(fakeKey(), 1), language: 'en-US' }),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          recordTemplateVersion(sp, { ...version(fakeKey(), 1), metaId: '' }),
        ),
      ).toBe('23514');
      // Created again on Meta under a new id: refused, never left pointing at the old one.
      await expect(recordTemplateVersion(tx, { ...v1, metaId: '123456789' })).rejects.toThrow(
        TemplateVersionClashError,
      );
    });
  });

  it('is read by the Super Admin alone and written by nobody signed in', async () => {
    await rolledBack(async (tx) => {
      const v1 = version(fakeKey(), 1, { status: 'approved' });
      await recordTemplateVersion(tx, v1);
      await becomeStaff(tx, superAdmin);
      expect((await templateVersionsOnMeta(tx)).map((row) => row.metaId)).toContain(v1.metaId);
      expect(await failure(tx, (sp) => recordTemplateVersion(sp, version(fakeKey(), 1)))).toBe(
        '42501',
      );
      expect(
        await failure(tx, (sp) =>
          sp
            .update(whatsappTemplate)
            .set({ status: 'rejected' })
            .where(eq(whatsappTemplate.metaId, v1.metaId)),
        ),
      ).toBe('42501');
      await asOwner(tx);
      for (const staff of others) {
        await becomeStaff(tx, staff);
        expect(
          (await templateVersionsOnMeta(tx)).map((row) => row.metaId),
          staff.email,
        ).not.toContain(v1.metaId);
        expect(
          await failure(tx, (sp) => recordTemplateVersion(sp, version(fakeKey(), 1))),
          staff.email,
        ).toBe('42501');
        await asOwner(tx);
      }
    });
  });
});
