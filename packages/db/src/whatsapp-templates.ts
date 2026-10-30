import type { TemplateApprovalStatus } from '@clinic-mx/schemas';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { whatsappTemplate, type WhatsappTemplate } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Meta's verdict on each template version on this environment's number (WA-06). Written by the
 * server only, on the owner connection: the submit script as `system:whatsapp-templates`, the
 * webhook's job as `system:whatsapp`. The Super Admin reads it under row level security.
 */

export interface TemplateVersionOnMeta {
  key: string;
  version: number;
  language: string;
  metaName: string;
  metaId: string;
  category: string;
  status: TemplateApprovalStatus;
  reason: string | null;
}

export class TemplateVersionClashError extends Error {
  override name = 'TemplateVersionClashError';
}

/**
 * Records a version the submit script created, or what Meta says of one already there; a version
 * already recorded takes Meta's current status, category and reason. A version Meta now knows by
 * another id (deleted there and created again) is refused, never left pointing at the old id: the
 * text changes as a new version instead.
 */
export async function recordTemplateVersion(
  tx: DbOrTransaction,
  values: TemplateVersionOnMeta,
): Promise<void> {
  const [recorded] = await tx
    .select({ metaId: whatsappTemplate.metaId })
    .from(whatsappTemplate)
    .where(
      and(
        eq(whatsappTemplate.key, values.key),
        eq(whatsappTemplate.version, values.version),
        eq(whatsappTemplate.language, values.language),
      ),
    );
  if (recorded && recorded.metaId !== values.metaId) {
    throw new TemplateVersionClashError(
      `${values.metaName} has another id on Meta than the one recorded; raise its version and submit it again.`,
    );
  }
  await tx
    .insert(whatsappTemplate)
    .values(values)
    .onConflictDoUpdate({
      target: [whatsappTemplate.key, whatsappTemplate.version, whatsappTemplate.language],
      set: { status: values.status, category: values.category, reason: values.reason },
      setWhere: sql`(${whatsappTemplate.status}, ${whatsappTemplate.category}, ${whatsappTemplate.reason})
        IS DISTINCT FROM (excluded.status, excluded.category, excluded.reason)`,
    });
}

/**
 * Meta's webhook moved a template on (`message_template_status_update`, or the category with
 * `template_category_update`). A template we never submitted from here (Meta's samples, another
 * environment's) is left alone.
 */
export async function applyTemplateUpdate(
  tx: DbOrTransaction,
  update: {
    metaId: string;
    status?: TemplateApprovalStatus;
    category?: string;
    reason: string | null;
  },
): Promise<'changed' | 'unchanged' | 'unknown'> {
  const [current] = await tx
    .select()
    .from(whatsappTemplate)
    .where(eq(whatsappTemplate.metaId, update.metaId))
    .for('update');
  if (!current) return 'unknown';
  const next = {
    status: update.status ?? current.status,
    category: update.category ?? current.category,
    reason: update.reason ?? (update.status ? null : current.reason),
  };
  if (
    next.status === current.status &&
    next.category === current.category &&
    next.reason === current.reason
  ) {
    return 'unchanged';
  }
  await tx.update(whatsappTemplate).set(next).where(eq(whatsappTemplate.id, current.id));
  return 'changed';
}

/**
 * The newest version of a template Meta approved on this number, if any: the one to send. Never
 * one older than `minVersion`, whose variables differ from the registry's (WA-07).
 */
export async function approvedTemplateVersion(
  db: DbOrTransaction,
  key: string,
  language: string,
  minVersion = 1,
): Promise<{ metaName: string; version: number } | null> {
  const [row] = await db
    .select({ metaName: whatsappTemplate.metaName, version: whatsappTemplate.version })
    .from(whatsappTemplate)
    .where(
      and(
        eq(whatsappTemplate.key, key),
        eq(whatsappTemplate.language, language),
        eq(whatsappTemplate.status, 'approved'),
        gte(whatsappTemplate.version, minVersion),
      ),
    )
    .orderBy(desc(whatsappTemplate.version))
    .limit(1);
  return row ?? null;
}

/** Every version recorded on this number, newest first, for the templates page. */
export function templateVersionsOnMeta(db: DbOrTransaction): Promise<WhatsappTemplate[]> {
  return db
    .select()
    .from(whatsappTemplate)
    .orderBy(whatsappTemplate.key, desc(whatsappTemplate.version));
}
