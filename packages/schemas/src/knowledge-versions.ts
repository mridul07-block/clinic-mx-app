import { z } from 'zod';

/**
 * Knowledge base versions (SET-06; PRD section 3 and M16: the Super Admin approves versions; PRD
 * 278: "Knowledge base edits go live only as a new version he approves"). Recommended defaults
 * chosen under the user's standing approval, 28 October 2026 (docs/runbooks/knowledge-base.md).
 * A version is a draft until approved, and never changes after. Where a version stands is worked
 * out, not stored: the live one (the newest approved; before any approval, the newest import), an
 * older approved one superseded, a draft newer than live awaiting approval, and a draft older
 * than live passed over (it can no longer be approved).
 */

export const knowledgeVersionStandings = ['live', 'superseded', 'awaiting', 'passed_over'] as const;
export type KnowledgeVersionStanding = (typeof knowledgeVersionStandings)[number];

export const knowledgeVersionStandingLabels: Record<KnowledgeVersionStanding, string> = {
  live: 'Live',
  superseded: 'Superseded',
  awaiting: 'Draft, awaiting approval',
  passed_over: 'Passed over',
};

/**
 * Where each version stands, given every version's number and status. Before any approval the
 * newest is live and the others are drafts awaiting approval (none is older than an approval).
 */
export function knowledgeVersionStandingsOf(
  versions: readonly { number: number; status: 'draft' | 'approved' }[],
): Map<number, KnowledgeVersionStanding> {
  const approved = versions.filter((v) => v.status === 'approved').map((v) => v.number);
  const live = approved.length > 0 ? Math.max(...approved) : null;
  const newest = versions.length > 0 ? Math.max(...versions.map((v) => v.number)) : null;
  return new Map(
    versions.map((v): [number, KnowledgeVersionStanding] => {
      if (live === null) return [v.number, v.number === newest ? 'live' : 'awaiting'];
      if (v.number === live) return [v.number, 'live'];
      if (v.status === 'approved') return [v.number, 'superseded'];
      return [v.number, v.number > live ? 'awaiting' : 'passed_over'];
    }),
  );
}

/** Whether the Super Admin may approve a version: a draft newer than any approved one. */
export function knowledgeVersionApprovable(
  version: { number: number; status: 'draft' | 'approved' },
  versions: readonly { number: number; status: 'draft' | 'approved' }[],
): boolean {
  if (version.status !== 'draft') return false;
  const approved = versions.filter((v) => v.status === 'approved').map((v) => v.number);
  return approved.length === 0 || version.number > Math.max(...approved);
}

/** The Super Admin's approval of a draft, once they have read its import report. */
export const approveKnowledgeVersionSchema = z.object({
  versionId: z.guid({ error: 'That version was not found.' }),
  notes: z
    .string()
    .trim()
    .max(1000, { error: 'Keep the note under 1000 characters.' })
    .optional()
    .transform((value) => (value ? value : undefined)),
  confirmed: z.literal(true, { error: 'Confirm you have read the import report.' }),
});

/** The files a version was imported from, as the viewer reads them; a missing part reads empty. */
export const knowledgeSourceSummarySchema = z
  .object({
    files: z.array(z.object({ name: z.string(), sha256: z.string() }).loose()).default([]),
  })
  .loose();

const named = z.object({ name: z.string() }).loose();

/**
 * The import report as the viewer reads it (the import writes it, `packages/db/src/knowledge/
 * report.ts`): loose, so a report from an older import still reads; a missing part reads empty.
 */
export const importReportSummarySchema = z
  .object({
    files: z
      .array(
        z
          .object({
            region: z.string(),
            fileName: z.string(),
            sha256: z.string(),
            rows: z.number(),
          })
          .loose(),
      )
      .default([]),
    totals: z
      .object({ listings: z.number(), conditions: z.number(), merged: z.number() })
      .loose()
      .optional(),
    gaps: z.array(z.string()).default([]),
    merged: z.array(z.object({ conditionId: z.string() }).loose()).default([]),
    lookAlikes: z.array(z.object({ a: named, b: named }).loose()).default([]),
    copiedText: z.array(z.object({ column: z.string(), text: z.string() }).loose()).default([]),
    redFlagTiers: z.record(z.string(), z.number()).default({}),
    untagged: z.array(named).default([]),
    unmatched: z.array(z.object({ key: z.string(), conditionId: z.string() }).loose()).default([]),
  })
  .loose();

export type ImportReportSummary = z.infer<typeof importReportSummarySchema>;
