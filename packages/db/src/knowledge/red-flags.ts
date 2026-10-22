import { createHash } from 'node:crypto';
import { redFlagRulesSchema, type KnowledgeRegion, type RedFlagRule } from '@clinic-mx/schemas';
import { KnowledgeImportError } from './build';
import { RULES_FILE_NAME } from './paths';
import type { Workbook } from './workbook';

/**
 * Red flags in a knowledge base version (SET-10): the rules the health form submit runs, from the
 * committed rules file, and each region's red flag presentations, from the workbooks' Red Flags
 * sheets, kept word for word as reference for clinicians (not run automatically).
 */

/**
 * A row of a Red Flags sheet: a presentation (its features, the action and why it cannot wait), or
 * one of the screening notes listed under the sheet's "Screening rules" heading.
 */
export type RedFlagPresentation =
  | {
      kind: 'presentation';
      region: KnowledgeRegion;
      rowNumber: number;
      presentation: string;
      features: string;
      action: string;
      /** "Why It Cannot Wait"; Knee's sheet calls it "Note". */
      why: string | null;
    }
  | { kind: 'screening_note'; region: KnowledgeRegion; rowNumber: number; presentation: string };

export interface RedFlags {
  rules: RedFlagRule[];
  rulesFile: { name: string; sha256: string };
  presentations: RedFlagPresentation[];
}

type PresentationKey = 'presentation' | 'features' | 'action' | 'why';

const presentationHeaders: Record<string, PresentationKey> = {
  presentation: 'presentation',
  condition: 'presentation',
  features: 'features',
  'presenting features': 'features',
  'action required': 'action',
  'why it cannot wait': 'why',
  note: 'why',
};

/** Reads and checks the rules file; every problem stops the import. */
export function parseRedFlagRules(text: string): RedFlags['rules'] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new KnowledgeImportError([
      `${RULES_FILE_NAME}: not valid JSON (${(error as Error).message})`,
    ]);
  }
  const parsed = redFlagRulesSchema.safeParse(json);
  if (!parsed.success) {
    throw new KnowledgeImportError(
      parsed.error.issues.map(
        (issue) => `${RULES_FILE_NAME}: ${issue.path.join('.') || 'the list'}: ${issue.message}`,
      ),
    );
  }
  return parsed.data;
}

/** Each workbook's Red Flags rows; an unknown header or a row without its text stops the import. */
export function readPresentations(workbooks: Workbook[]): RedFlagPresentation[] {
  const problems: string[] = [];
  const presentations: RedFlagPresentation[] = [];
  for (const workbook of workbooks) {
    const { header, rows } = workbook.redFlags;
    const keys = header.map((label) => presentationHeaders[label.toLowerCase()]);
    header.forEach((label, i) => {
      if (!keys[i]) problems.push(`${workbook.fileName}, Red Flags: unknown column "${label}"`);
    });
    for (const needed of ['presentation', 'features', 'action'] as const) {
      if (!keys.includes(needed)) {
        problems.push(`${workbook.fileName}, Red Flags: no column for "${needed}"`);
      }
    }
    if (problems.length > 0) continue;
    for (const { rowNumber, cells } of rows) {
      // A merged row repeats one text in every column: the "Screening rules" heading, or a note.
      const texts = new Set(cells.filter(Boolean));
      if (texts.size === 1 && cells.length > 1) {
        const [text = ''] = texts;
        if (/^screening rules$/i.test(text)) continue;
        if (!text.startsWith('•')) {
          problems.push(
            `${workbook.fileName}, Red Flags row ${rowNumber}: a merged row that is neither the screening rules heading nor a note`,
          );
          continue;
        }
        presentations.push({
          kind: 'screening_note',
          region: workbook.region,
          rowNumber,
          presentation: text.replace(/^•\s*/, ''),
        });
        continue;
      }
      const cell = (key: PresentationKey) => cells[keys.indexOf(key)] ?? '';
      if (!cell('presentation') || !cell('features') || !cell('action')) {
        problems.push(
          `${workbook.fileName}, Red Flags row ${rowNumber}: presentation, features or action is empty`,
        );
        continue;
      }
      presentations.push({
        kind: 'presentation',
        region: workbook.region,
        rowNumber,
        presentation: cell('presentation'),
        features: cell('features'),
        action: cell('action'),
        why: cell('why') || null,
      });
    }
  }
  if (problems.length > 0) throw new KnowledgeImportError(problems);
  return presentations;
}

/** The red flags of a build: the parsed rules file and the workbooks' presentations. */
export function buildRedFlags(workbooks: Workbook[], rulesText: string): RedFlags {
  return {
    rules: parseRedFlagRules(rulesText),
    rulesFile: {
      name: RULES_FILE_NAME,
      sha256: createHash('sha256').update(rulesText).digest('hex'),
    },
    presentations: readPresentations(workbooks),
  };
}
