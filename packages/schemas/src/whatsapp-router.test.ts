import { describe, expect, it } from 'vitest';
import {
  MENU_BUTTONS,
  checkAnswerOf,
  contactMessage,
  contactText,
  emergencyReplyText,
  emergencyPhrasesSchema,
  frontDeskEmailSchema,
  hasEmergencyPhrase,
  inboundRoutes,
  isGreeting,
  routeHandlers,
  routeInbound,
  type RoutableMessage,
} from './whatsapp-router';

// WA-03 done when: buttons, Flow completions, typed text and emergency phrases each reach the
// right handler. Generated words only.
const phrases = ['chest pain', 'cant breathe', 'numb groin', 'emergency'];
const greetings = ['hi', 'hello', 'menu', 'good morning'];
const route = (message: Partial<RoutableMessage>) =>
  routeInbound(
    { kind: 'text', body: null, replyId: null, ...message },
    { emergencyPhrases: phrases, greetingWords: greetings },
  );

// Reply speed (user decision, 1 November 2026): a greeting gets the menu at once.
describe('greetings', () => {
  it('match the whole message in any case, punctuation or stretch, emojis aside', () => {
    expect(isGreeting('Hi', greetings)).toBe(true);
    expect(isGreeting('hiii!!', greetings)).toBe(true);
    expect(isGreeting('  HELLO 👋 ', greetings)).toBe(true);
    expect(isGreeting('Good Morning :)', greetings)).toBe(true);
    expect(isGreeting('Menu', greetings)).toBe(true);
    expect(isGreeting('hi, where is your clinic?', greetings)).toBe(false);
    expect(isGreeting('history', greetings)).toBe(false);
    expect(isGreeting('👋', greetings)).toBe(false);
    expect(isGreeting('hi', [])).toBe(false);
  });

  it('route the confirmation with a map’s buttons as the menu’s', () => {
    expect(route({ kind: 'reply', replyId: 'appointment_confirmation.reschedule' })).toBe(
      'reschedule',
    );
    expect(route({ kind: 'reply', replyId: 'appointment_confirmation.talk' })).toBe('talk');
  });

  it('get the menu without the assistant, emergency phrases still first', () => {
    expect(route({ body: 'Hello!' })).toBe('menu');
    expect(route({ body: 'hi, my knee hurts' })).toBe('assistant');
    expect(route({ body: 'emergency' })).toBe('emergency');
  });
});

describe('emergency phrases', () => {
  it('match whole words in any case or punctuation, apostrophes or not', () => {
    expect(hasEmergencyPhrase('I have CHEST PAIN!!', phrases)).toBe(true);
    expect(hasEmergencyPhrase('chest-pain since morning', phrases)).toBe(true);
    expect(hasEmergencyPhrase('I can’t breathe', phrases)).toBe(true);
    expect(hasEmergencyPhrase("can't  breathe properly", phrases)).toBe(true);
    expect(hasEmergencyPhrase('my groin feels numb', phrases)).toBe(false);
    expect(hasEmergencyPhrase('pain in my chest', phrases)).toBe(false);
    expect(hasEmergencyPhrase('emergencyroom', phrases)).toBe(false);
    expect(hasEmergencyPhrase('anything', [])).toBe(false);
  });

  it('come before anything else a typed message would get', () => {
    expect(route({ body: 'Hi, I want to book but I have chest pain' })).toBe('emergency');
    expect(route({ body: 'Hi, I want to book' })).toBe('assistant');
    expect(route({ body: null })).toBe('assistant');
  });

  it('are only looked for in what was typed, not in a tapped button', () => {
    expect(route({ kind: 'reply', body: 'Emergency', replyId: 'menu.talk' })).toBe('talk');
  });

  it('are kept as a list the Super Admin edits', () => {
    expect(emergencyPhrasesSchema.safeParse(['chest pain']).success).toBe(true);
    expect(emergencyPhrasesSchema.safeParse(['ab']).success).toBe(false);
  });
});

describe('routes', () => {
  it('send each menu button to its handler', () => {
    expect(route({ kind: 'reply', replyId: 'menu.book' })).toBe('book');
    expect(route({ kind: 'reply', replyId: 'menu.reschedule' })).toBe('reschedule');
    expect(route({ kind: 'reply', replyId: 'menu.talk' })).toBe('talk');
  });

  it('send the day before reminder’s buttons to Confirm and Reschedule', () => {
    expect(route({ kind: 'reply', replyId: 'Confirm' })).toBe('confirm');
    expect(route({ kind: 'reply', replyId: 'confirm' })).toBe('confirm');
    expect(route({ kind: 'reply', replyId: 'Reschedule' })).toBe('reschedule');
  });

  it('send Flow completions to their form’s handler', () => {
    expect(route({ kind: 'flow', replyId: 'booking' })).toBe('booking_flow');
    expect(route({ kind: 'flow', replyId: 'reschedule' })).toBe('reschedule_flow');
    expect(route({ kind: 'flow', replyId: 'flow' })).toBe('menu');
  });

  // WA-06: a check's reply buttons carry `<template>.<answer>`.
  it('send a check’s reply buttons to its answer, and nothing else', () => {
    expect(route({ kind: 'reply', replyId: 'first_treatment_check.still_sore' })).toBe(
      'check_answer',
    );
    expect(route({ kind: 'reply', replyId: 'follow_up_check.injured_again' })).toBe('check_answer');
    expect(checkAnswerOf('follow_up_check.doing_well')).toEqual({
      template: 'follow_up_check',
      answer: 'doing_well',
    });
    for (const other of [
      'first_treatment_check.doing_well',
      'follow_up_check',
      'session_3_check.better',
      'first_treatment_check.better.x',
      'Still sore',
    ]) {
      expect(checkAnswerOf(other), other).toBeUndefined();
      expect(route({ kind: 'reply', replyId: other }), other).toBe('menu');
    }
  });

  it('answer anything else with the menu', () => {
    expect(route({ kind: 'reply', replyId: 'something old' })).toBe('menu');
    expect(route({ kind: 'other' })).toBe('menu');
  });
});

describe('handlers', () => {
  it('name every route, live or falling back to a reply the router can send', () => {
    for (const each of inboundRoutes) {
      expect(routeHandlers[each].ticket, each).toMatch(/^WA-\d\d$/);
      expect(['menu', 'contact', 'booking_flow', 'reschedule_flow', 'none'], each).toContain(
        routeHandlers[each].reply,
      );
    }
    expect(routeHandlers.menu).toMatchObject({ live: true, reply: 'menu' });
    expect(routeHandlers.talk).toMatchObject({ live: true, reply: 'contact' });
  });

  // WA-11: the assistant chooses the answer and queues it itself.
  it('send typed text to the assistant, the handler answering', () => {
    expect(routeHandlers.assistant).toMatchObject({ ticket: 'WA-11', live: true, reply: 'none' });
  });

  // WA-10: the handler sends the emergency advice and raises the task itself.
  it('answer an emergency phrase with the advice, the handler answering', () => {
    expect(routeHandlers.emergency).toMatchObject({ ticket: 'WA-10', live: true, reply: 'none' });
  });

  // WA-10 (user decision, 31 October 2026): the advice, then the clinic's number; every centre's,
  // by name, for a number not one patient's; a centre without a phone left out.
  it('give the emergency advice with the clinic’s number', () => {
    const advice = 'If this is a medical emergency, call 112 now.';
    expect(emergencyReplyText(advice, [{ name: 'HSR Layout', phone: '+918041234567' }])).toBe(
      'If this is a medical emergency, call 112 now. To reach the clinic, call +91 80 4123 4567.',
    );
    expect(
      emergencyReplyText(advice, [
        { name: 'HSR Layout', phone: '+918041234567' },
        { name: 'Koramangala', phone: null },
        { name: 'Whitefield', phone: '+919845012345' },
      ]),
    ).toBe(
      'If this is a medical emergency, call 112 now. To reach the clinic, call HSR Layout +91 80 4123 4567, Whitefield +91 98450 12345.',
    );
    expect(emergencyReplyText(advice, [{ name: 'HSR Layout', phone: null }])).toBe(advice);
  });

  // WA-08: the day before reminder's Confirm (its quick reply payload) confirms its appointment;
  // the handler answers itself.
  it('confirm the reminder’s appointment, the handler answering', () => {
    expect(routeHandlers.confirm).toMatchObject({ ticket: 'WA-08', live: true, reply: 'none' });
    expect(
      routeInbound(
        { kind: 'reply', body: 'Confirm', replyId: 'day_before_reminder.confirm' },
        { emergencyPhrases: [], greetingWords: [] },
      ),
    ).toBe('confirm');
  });

  // WA-05: Reschedule or cancel (the menu's, or the reminder's quick reply) opens the reschedule
  // form; its completion needs no reply (the form already sent the confirmation text).
  it('open the reschedule form, and say nothing more when it is completed', () => {
    expect(routeHandlers.reschedule).toMatchObject({
      ticket: 'WA-05',
      live: true,
      reply: 'reschedule_flow',
    });
    expect(routeHandlers.reschedule_flow).toMatchObject({ live: true, reply: 'none' });
  });

  // WA-04: Book appointment opens the booking form; its completion needs no reply (the form
  // already sent the confirmation text).
  it('open the booking form for Book appointment, and say nothing more when it is completed', () => {
    expect(routeHandlers.book).toMatchObject({
      ticket: 'WA-04',
      live: true,
      reply: 'booking_flow',
    });
    expect(routeHandlers.booking_flow).toMatchObject({
      ticket: 'WA-04',
      live: true,
      reply: 'none',
    });
  });

  it('keep the menu within Meta’s 3 reply buttons of 20 characters', () => {
    expect(MENU_BUTTONS).toHaveLength(3);
    for (const button of MENU_BUTTONS) expect(button.title.length).toBeLessThanOrEqual(20);
    expect(MENU_BUTTONS.map((button) => button.title)).toEqual([
      'Book appointment',
      'Reschedule or cancel',
      'Talk to our team',
    ]);
  });
});

describe('Talk to our team', () => {
  const hsr = { name: 'HSR Layout', phone: '+91 80 0000 0001' };
  const kor = { name: 'Koramangala', phone: '+91 80 0000 0002' };

  // The layout chosen by the user (1 November 2026): heading, each centre with its phone, email.
  it('lays the message out a centre to a line pair, with icons, numbers formatted', () => {
    expect(
      contactMessage({
        centres: [hsr, { name: 'Whitefield', phone: '+919845012345' }],
        email: 'desk@example.com',
      }),
    ).toBe(
      [
        '*Talk to our team*',
        'Our front desk is happy to help.',
        '📞 *HSR Layout*\n+91 80 0000 0001',
        '📞 *Whitefield*\n+91 98450 12345',
        '✉️ desk@example.com',
      ].join('\n\n'),
    );
    expect(contactMessage({ centres: [{ name: 'HSR Layout', phone: null }], email: '' })).toBe(
      'Please call the clinic you visit; our front desk will help.',
    );
    expect(
      contactMessage({ centres: [{ name: 'HSR Layout', phone: null }], email: 'a@b.in' }),
    ).toBe('*Talk to our team*\n\nOur front desk is happy to help.\n\n✉️ a@b.in');
  });

  it('gives the patient’s centre phone, or every centre’s by name, and the email', () => {
    expect(contactText({ centres: [hsr], email: 'desk@example.com' })).toBe(
      'To talk to our team, call +91 80 0000 0001 or email desk@example.com.',
    );
    expect(contactText({ centres: [hsr, kor], email: '' })).toBe(
      'To talk to our team, call HSR Layout +91 80 0000 0001, Koramangala +91 80 0000 0002.',
    );
  });

  it('leaves out what is not set, and invents nothing', () => {
    expect(contactText({ centres: [{ name: 'HSR Layout', phone: null }, kor], email: '' })).toBe(
      'To talk to our team, call Koramangala +91 80 0000 0002.',
    );
    expect(contactText({ centres: [{ name: 'HSR Layout', phone: null }], email: '' })).toBe(
      'Please call the clinic you visit; our front desk will help.',
    );
    expect(frontDeskEmailSchema.safeParse('').success).toBe(true);
    expect(frontDeskEmailSchema.safeParse('not an email').success).toBe(false);
  });
});
