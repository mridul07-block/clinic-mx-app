import { bodyChartZoneByKey } from './body-chart';
import { consentStatements, type ConsentStatementKey } from './consent';
import type {
  HealthFormCondition,
  HealthFormDefinition,
  HealthFormField,
  HealthFormOption,
} from './health-form';

/**
 * The paper fallback (OPS-05; PRD resilience: "a paper fallback for launch week"; TAD section 13:
 * "A printed paper fallback (health form, consent) is kept at each centre for launch week and
 * outages"). The current health form and its Part A consent, laid out for paper from the same
 * versioned data the patient's phone shows, so no wording is added: every question and option
 * prints in order, and what the phone shows only after an earlier answer carries an "Answer only
 * if" note made from that question's own words. Part B waits for its texts (BIL-03, decisions 9
 * and 21). Recommended defaults chosen under the user's standing approval, 29 October 2026
 * (DECISION OPS-05; docs/runbooks/paper-fallback.md).
 */

export interface PaperOption {
  label: string;
  /** When the phone shows this option only after an earlier answer. */
  note: string | null;
}

export type PaperAnswer =
  | { kind: 'yes_no' }
  | { kind: 'number'; unit: string }
  | { kind: 'choice'; multiple: boolean; options: PaperOption[] }
  | { kind: 'text' }
  | { kind: 'date' }
  | { kind: 'scale'; min: number; max: number; minLabel: string; maxLabel: string };

export interface PaperQuestion {
  key: string;
  label: string;
  answer: PaperAnswer;
  /** "Answer only if …", when the phone asks it only after an earlier answer. */
  note: string | null;
}

export interface PaperConsentStatement {
  key: ConsentStatementKey;
  version: number;
  text: string;
}

export type PaperSection =
  | {
      kind: 'consent';
      /** The screen's key, unique in the form. */
      key: string;
      title: string;
      note: string | null;
      statements: PaperConsentStatement[];
    }
  | {
      kind: 'questions';
      key: string;
      title: string;
      /** "Answer this part only if …", when the phone shows the whole screen only then. */
      note: string | null;
      questions: PaperQuestion[];
    };

export interface PaperForm {
  version: string;
  sections: PaperSection[];
  /** "Health form hf-3 · Part A consent version 1", for the footer. */
  versionLabel: string;
}

/** The answer a condition names, in the words the patient reads it. */
function valueText(field: HealthFormField | undefined, value: string): string {
  if (field?.kind === 'body_chart') return bodyChartZoneByKey.get(value)?.label ?? value;
  const option =
    field && 'options' in field
      ? field.options.find((each: HealthFormOption) => each.value === value)
      : undefined;
  return option?.label ?? value;
}

/** A condition in the patient's words, for paper. */
export function paperConditionText(
  condition: HealthFormCondition,
  fields: ReadonlyMap<string, HealthFormField>,
): string {
  const field = fields.get(condition.answer);
  const label = field?.label ?? condition.answer;
  if ('has' in condition) return `you ticked “${valueText(field, condition.has)}” in ${label}`;
  if ('in' in condition) {
    return `${label} is ${condition.in.map((value) => valueText(field, value)).join(' or ')}`;
  }
  if (condition.is === true) return `you answered Yes to “${label}”`;
  if (condition.is === false) return `you answered No to “${label}”`;
  return `${label} is ${valueText(field, String(condition.is))}`;
}

function noteOf(
  conditions: readonly HealthFormCondition[] | undefined,
  fields: ReadonlyMap<string, HealthFormField>,
  lead = 'Answer only if',
): string | null {
  if (!conditions?.length) return null;
  const text = `${lead} ${conditions.map((c) => paperConditionText(c, fields)).join(' and ')}`;
  // A quoted question already ends with its own mark: “… recently?”, never “… recently?”.
  return /[.?!]”$/.test(text) ? text : `${text}.`;
}

function answerOf(
  field: HealthFormField,
  fields: ReadonlyMap<string, HealthFormField>,
): PaperAnswer {
  switch (field.kind) {
    case 'yes_no':
    case 'text':
    case 'date':
      return { kind: field.kind };
    case 'number':
      return { kind: 'number', unit: field.unit };
    case 'scale':
      return {
        kind: 'scale',
        min: field.min,
        max: field.max,
        minLabel: field.minLabel,
        maxLabel: field.maxLabel,
      };
    case 'single_choice':
    case 'multi_choice':
      return {
        kind: 'choice',
        multiple: field.kind === 'multi_choice',
        options: field.options.map((option) => ({
          label: option.label,
          note: noteOf(option.showIf, fields, 'Only if'),
        })),
      };
    case 'body_chart':
      return {
        kind: 'choice',
        multiple: true,
        options: field.zones.map((key) => ({
          label: bodyChartZoneByKey.get(key)?.label ?? key,
          note: null,
        })),
      };
  }
}

/** The health form `definition` laid out for paper, with its consent statements. */
export function paperForm(definition: HealthFormDefinition): PaperForm {
  const fields = new Map(
    definition.screens.flatMap((screen) => screen.fields.map((field) => [field.key, field])),
  );
  const consentVersions = new Set<string>();
  const sections = definition.screens.map((screen): PaperSection => {
    if (screen.consent) {
      const statements = screen.consent.statements.map((key) => {
        const statement = consentStatements[key];
        consentVersions.add(
          `Part ${screen.consent?.stage ?? ''} consent version ${String(statement.version)}`,
        );
        return { key, version: statement.version, text: statement.text };
      });
      return {
        kind: 'consent',
        key: screen.key,
        title: screen.title,
        note: noteOf(screen.showIf, fields, 'Answer this part only if'),
        statements,
      };
    }
    return {
      kind: 'questions',
      key: screen.key,
      title: screen.title,
      note: noteOf(screen.showIf, fields, 'Answer this part only if'),
      questions: screen.fields.map((field) => ({
        key: field.key,
        label: field.label,
        answer: answerOf(field, fields),
        note: noteOf(field.showIf, fields),
      })),
    };
  });
  return {
    version: definition.version,
    sections,
    versionLabel: [`Health form ${definition.version}`, ...consentVersions].join(' · '),
  };
}
