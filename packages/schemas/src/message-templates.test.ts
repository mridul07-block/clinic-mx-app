import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  bodyVariables,
  bodyWithNames,
  messageTemplate,
  messageTemplates,
  metaTemplateName,
  templateCreateBody,
  type TemplateParameters,
  type TemplateVariables,
} from './message-templates';

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

  // WA-06: Meta refuses a template whose text breaks these rules, so they are checked here first.
  it.each(messageTemplates)('$key: text within Meta rules', (template) => {
    const text = template.body as string;
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(text).not.toMatch(/^\s*\{\{/);
    expect(text).not.toMatch(/\}\}[\s.!?]*$/);
    expect(text).not.toMatch(/\}\}\s*\{\{/);
    expect(text).not.toMatch(/[\n\t]| {5}/);
    const numbers = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
    const body = bodyVariables(template);
    expect(numbers).toEqual(body.map((_, index) => index + 1));
    for (const variable of template.variables) {
      expect(variable.example).not.toBe('');
      // Meta refuses line breaks inside a variable.
      expect(variable.example).not.toMatch(/[\n\t]/);
    }
    // Every variable fills the text or a link button.
    const used = new Set([
      ...body.map((variable) => variable.name),
      ...template.buttons.flatMap((button: { kind: string; variable?: string }) =>
        button.variable ? [button.variable] : [],
      ),
    ]);
    expect(used.size).toBe(template.variables.length);
    expect(metaTemplateName(template.key, template.version)).toMatch(/^[a-z0-9_]{1,512}$/);
  });

  it('builds the request Meta creates a template from', () => {
    const summary = templateCreateBody(messageTemplate('consultation_summary'), {
      origin: 'https://clinic.example/',
      documentHandle: 'handle-1',
    });
    expect(summary).toEqual({
      name: 'consultation_summary_v1',
      language: 'en',
      category: 'UTILITY',
      components: [
        { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['handle-1'] } },
        {
          type: 'BODY',
          text: messageTemplate('consultation_summary').body,
          example: { body_text: [['Asha']] },
        },
        {
          type: 'BUTTONS',
          buttons: [
            {
              type: 'URL',
              text: 'Open My plan',
              url: 'https://clinic.example/p/{{1}}',
              example: ['https://clinic.example/p/k3f9q2'],
            },
            {
              type: 'URL',
              text: 'Rate your visit',
              url: 'https://clinic.example/p/{{1}}',
              example: ['https://clinic.example/p/r7m2x8'],
            },
          ],
        },
      ],
    });
    const check = templateCreateBody(messageTemplate('first_treatment_check'), {
      origin: 'https://clinic.example',
    });
    expect(check.components.at(-1)).toEqual({
      type: 'BUTTONS',
      buttons: ['Better', 'Same', 'Still sore'].map((text) => ({ type: 'QUICK_REPLY', text })),
    });
    // A PDF header or a Flow button cannot be submitted without its sample or its Flow.
    expect(() =>
      templateCreateBody(messageTemplate('receipt'), { origin: 'https://clinic.example' }),
    ).toThrow('needs a sample PDF');
    expect(() =>
      templateCreateBody(messageTemplate('day_before_reminder'), {
        origin: 'https://clinic.example',
      }),
    ).toThrow('needs its Flow');
  });

  it('shows the text with variable names', () => {
    expect(bodyWithNames(messageTemplate('morning_reminder'))).toBe(
      'Hi {{patient_name}}, a reminder of your appointment today at {{time}} at Movementology {{clinic}}. See you soon.',
    );
  });

  it('holds back no template now the reschedule Flow exists (WA-05)', () => {
    expect(
      messageTemplates.filter((template) => 'held' in template).map((template) => template.key),
    ).toEqual([]);
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
    expectTypeOf<TemplateVariables<'morning_reminder'>>().toEqualTypeOf<{
      patient_name: string;
      time: string;
      clinic: string;
    }>();
    expectTypeOf<TemplateParameters<'receipt'>>().toEqualTypeOf<
      { patient_name: string; amount: string; bill_number: string } & {
        document_id: string;
        document_name: string;
      }
    >();
  });
});
