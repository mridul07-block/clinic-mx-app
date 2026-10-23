import { describe, expect, expectTypeOf, it } from 'vitest';
import { messageTemplate, messageTemplates, type TemplateVariables } from './message-templates';

/** Lower case words joined by single underscores, starting with a letter. */
const snakeCase = /^[a-z][a-z0-9_]*$/;
const expectSnakeCase = (name: string) => {
  expect(name).toMatch(snakeCase);
  expect(name).not.toContain('__');
  expect(name.endsWith('_')).toBe(false);
};

// SET-11: the registry holds every template in the TAD list, each with its key, variables and
// version, within Meta's limits.
describe('message template registry', () => {
  it('holds every template in the TAD list, once each', () => {
    expect(messageTemplates.map((template) => template.key)).toEqual([
      'booking_confirmation',
      'front_desk_booking_confirmation',
      'plan_sessions_list',
      'day_before_reminder',
      'morning_reminder',
      'consultation_summary',
      'receipt',
      'home_programme_update',
      'first_treatment_check',
      'session_3_check',
      'no_show',
      'package_expiry_reminder',
      'discharge_report',
      'review_request',
      'follow_up_check',
      'red_flag_safety_advice',
    ]);
  });

  it.each(messageTemplates)('$key: snake case names, a source and a version', (template) => {
    expectSnakeCase(template.key);
    expect(template.source).not.toBe('');
    expect(template.version).toBeGreaterThanOrEqual(1);
    expect(template.category).toBe('utility');
    const names = template.variables.map((variable) => variable.name);
    for (const name of names) expectSnakeCase(name);
    expect(new Set(names).size).toBe(names.length);
    for (const variable of template.variables) expect(variable.label).not.toBe('');
  });

  // Meta: up to 3 quick replies, or up to 2 links, plus at most one Flow button.
  it.each(messageTemplates)('$key: buttons within Meta limits', (template) => {
    const count = (kind: string) =>
      template.buttons.filter((button: { kind: string }) => button.kind === kind).length;
    expect(count('quick_reply')).toBeLessThanOrEqual(3);
    expect(count('url')).toBeLessThanOrEqual(2);
    expect(count('flow')).toBeLessThanOrEqual(1);
  });

  it('finds a template by key and refuses an unknown one', () => {
    expect(messageTemplate('follow_up_check').variables.map((v) => v.name)).toEqual([
      'patient_name',
      'period',
    ]);
    // @ts-expect-error an unknown key is a type error too
    expect(() => messageTemplate('marketing_offer')).toThrow('No message template');
  });

  it('types the variables a template needs to be sent', () => {
    expectTypeOf<TemplateVariables<'booking_confirmation'>>().toEqualTypeOf<{
      patient_name: string;
      date: string;
      time: string;
      clinic: string;
      physio: string;
    }>();
    expectTypeOf<TemplateVariables<'review_request'>>().toEqualTypeOf<{ patient_name: string }>();
  });
});
