import { describe, expect, it } from 'vitest';
import {
  aiAssistantInputSchema,
  assistantAnswerText,
  assistantChoice,
  assistantFaqsSchema,
} from './ai-assistant';

// WA-11: the assistant only chooses among the clinic's approved answers and the menu's choices;
// the answer is sent word for word, `{{centres}}` filled from the centres as the clinic keeps them.

const faqs = [
  {
    id: 'directions',
    question: 'Where are your clinics and how do I get there?',
    answer: 'Our clinics:\n\n{{centres}}',
  },
  {
    id: 'what_to_bring',
    question: 'What should I bring to my appointment, and when should I arrive?',
    answer: 'Please arrive 10 minutes early and bring any reports you have.',
  },
];

describe('the approved answers setting', () => {
  it('accepts the answers it starts with', () => {
    expect(assistantFaqsSchema.parse(faqs)).toEqual(faqs);
  });

  it('refuses an id twice, an id kept for a menu choice, and a bad id', () => {
    expect(assistantFaqsSchema.safeParse([faqs[0], faqs[0]]).success).toBe(false);
    for (const id of ['book', 'talk', 'none', 'emergency', 'reschedule', 'Where', '9am', 'a']) {
      expect(assistantFaqsSchema.safeParse([{ ...faqs[1], id }]).success).toBe(false);
    }
  });

  it('keeps each answer within what one WhatsApp message with buttons holds', () => {
    expect(assistantFaqsSchema.safeParse([{ ...faqs[1], answer: 'x'.repeat(1001) }]).success).toBe(
      false,
    );
  });

  it('sends the model the message and questions only, nothing else', () => {
    expect(
      aiAssistantInputSchema.safeParse({
        message: 'What should I bring?',
        choices: faqs.map(({ id, question }) => ({ id, question })),
      }).success,
    ).toBe(true);
    expect(aiAssistantInputSchema.safeParse({ message: 'Hi', choices: faqs }).success).toBe(false);
    expect(
      aiAssistantInputSchema.safeParse({ message: 'Hi', choices: [], phone: '+91' }).success,
    ).toBe(false);
  });
});

describe('the model’s choice', () => {
  it('is an answer offered, or a menu choice, and anything else none', () => {
    expect(assistantChoice('what_to_bring', faqs)).toEqual({ kind: 'faq', faq: faqs[1] });
    for (const kind of ['book', 'reschedule', 'talk', 'emergency', 'none'] as const) {
      expect(assistantChoice(kind, faqs)).toEqual({ kind });
    }
    for (const invented of ['knee_pain', 'Book', '', 'directions ']) {
      expect(assistantChoice(invented, faqs)).toEqual({ kind: 'none' });
    }
  });
});

describe('an answer as the patient reads it', () => {
  it('is the answer word for word, the centres filled in with their address and map link', () => {
    expect(assistantAnswerText(faqs[1]?.answer ?? '', [])).toBe(faqs[1]?.answer);
    expect(
      assistantAnswerText(faqs[0]?.answer ?? '', [
        {
          name: 'HSR Layout',
          address: '1 Test Road, Bengaluru',
          mapLink: 'https://maps.example/1',
        },
        { name: 'Whitefield', address: null, mapLink: null },
      ]),
    ).toBe(
      [
        'Our clinics:',
        '',
        'Movementology HSR Layout: 1 Test Road, Bengaluru',
        'https://maps.example/1',
        '',
        'Movementology Whitefield: please ask the front desk for directions',
      ].join('\n'),
    );
  });
});
