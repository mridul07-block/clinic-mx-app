import { describe, expect, it } from 'vitest';
import {
  MENU_BUTTONS,
  contactText,
  emergencyPhrasesSchema,
  frontDeskEmailSchema,
  hasEmergencyPhrase,
  inboundRoutes,
  routeHandlers,
  routeInbound,
  type RoutableMessage,
} from './whatsapp-router';

// WA-03 done when: buttons, Flow completions, typed text and emergency phrases each reach the
// right handler. Generated words only.
const phrases = ['chest pain', 'cant breathe', 'numb groin', 'emergency'];
const route = (message: Partial<RoutableMessage>) =>
  routeInbound(
    { kind: 'text', body: null, replyId: null, ...message },
    { emergencyPhrases: phrases },
  );

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

  it('answer anything else with the menu', () => {
    expect(route({ kind: 'reply', replyId: 'something old' })).toBe('menu');
    expect(route({ kind: 'other' })).toBe('menu');
  });
});

describe('handlers', () => {
  it('name every route, live or falling back to a reply the router can send', () => {
    for (const each of inboundRoutes) {
      expect(routeHandlers[each].ticket, each).toMatch(/^WA-\d\d$/);
      expect(['menu', 'contact'], each).toContain(routeHandlers[each].reply);
    }
    expect(routeHandlers.menu).toMatchObject({ live: true, reply: 'menu' });
    expect(routeHandlers.talk).toMatchObject({ live: true, reply: 'contact' });
  });

  it('give the team’s contact details until a handler is live, the menu for typed text', () => {
    for (const each of ['emergency', 'book', 'reschedule', 'confirm', 'booking_flow'] as const) {
      expect(routeHandlers[each]).toMatchObject({ live: false, reply: 'contact' });
    }
    expect(routeHandlers.assistant).toMatchObject({ live: false, reply: 'menu' });
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
