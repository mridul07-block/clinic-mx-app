import { z } from 'zod';
import type { InboundKind } from './messaging';

/**
 * The conversation router (WA-03; TAD section 6, PRD J1.2, J1.9, J1.10). Every message sent to the
 * clinic's number gets one route: emergency phrases first, then button replies and Flow
 * completions to fixed handlers, typed text to the assistant. A route whose handler is not live
 * yet falls back (user decision, 30 October 2026): to "Talk to our team" (WA-09: the front desk
 * phone and email), or to the three button menu for typed text until the assistant (WA-11).
 * One reply is one message (TAD section 6, Rules).
 */

export const inboundRoutes = [
  'emergency',
  'menu',
  'talk',
  'book',
  'reschedule',
  'confirm',
  'booking_flow',
  'reschedule_flow',
  'assistant',
] as const;
export type InboundRoute = (typeof inboundRoutes)[number];

export const inboundRouteLabels: Record<InboundRoute, string> = {
  emergency: 'Emergency',
  menu: 'Menu',
  talk: 'Talk to our team',
  book: 'Book appointment',
  reschedule: 'Reschedule or cancel',
  confirm: 'Confirm',
  booking_flow: 'Booking form',
  reschedule_flow: 'Reschedule form',
  assistant: 'Typed message',
};

/**
 * The replies sent inside WhatsApp's 24 hour window: the router's own (the menu, the contact
 * details, the booking Flow, WA-04) and the booking confirmation text the Flow sends (until WA-07).
 */
export const sessionReplies = ['menu', 'contact', 'booking_flow', 'booking_confirmation'] as const;
export type SessionReply = (typeof sessionReplies)[number];

export const sessionReplyLabels: Record<SessionReply, string> = {
  menu: 'Menu',
  contact: 'Contact details',
  booking_flow: 'Booking form',
  booking_confirmation: 'Booking confirmation',
};

/** What the router answers a route with; `none` when the handler has answered already. */
export type RouteReply = Exclude<SessionReply, 'booking_confirmation'> | 'none';

/** The booking Flow message (WA-04): its text and the button that opens the form. */
export const BOOKING_FLOW_TEXT = 'Book your appointment in a few taps.';
export const BOOKING_FLOW_CTA = 'Book appointment';

/** Who handles each route, and what is sent until that handler is live. */
export const routeHandlers: Record<
  InboundRoute,
  { ticket: string; live: boolean; reply: RouteReply }
> = {
  // DECISION WA-03: emergency advice wording is WA-10's, from the clinic; until then the front
  // desk details, never a booking (PRD J1.9).
  emergency: { ticket: 'WA-10', live: false, reply: 'contact' },
  menu: { ticket: 'WA-03', live: true, reply: 'menu' },
  talk: { ticket: 'WA-09', live: true, reply: 'contact' },
  // WA-04: the booking Flow; the router falls back to the contact details where it is not set up.
  book: { ticket: 'WA-04', live: true, reply: 'booking_flow' },
  reschedule: { ticket: 'WA-05', live: false, reply: 'contact' },
  confirm: { ticket: 'WA-08', live: false, reply: 'contact' },
  // The form already booked and sent the confirmation text; nothing more to say.
  booking_flow: { ticket: 'WA-04', live: true, reply: 'none' },
  reschedule_flow: { ticket: 'WA-05', live: false, reply: 'contact' },
  assistant: { ticket: 'WA-11', live: false, reply: 'menu' },
};

/** The three button menu (PRD J1.2); Meta allows 3 reply buttons of at most 20 characters. */
export const MENU_BUTTONS = [
  { id: 'menu.book', title: 'Book appointment' },
  { id: 'menu.reschedule', title: 'Reschedule or cancel' },
  { id: 'menu.talk', title: 'Talk to our team' },
] as const;

export const MENU_TEXT = 'How can we help you today?';

/** The version of the router's replies, stored on each one like a template's. */
export const SESSION_REPLY_VERSION = 1;

/** The setting `whatsapp.emergency_phrases`: words and short phrases, matched whole. */
export const emergencyPhrasesSchema = z.array(z.string().trim().min(3).max(60)).max(200);

/** The setting `whatsapp.front_desk_email`: empty until the clinic gives its address. */
export const frontDeskEmailSchema = z.union([z.literal(''), z.email()]);

/** Lower case, apostrophes dropped (can't = cant), anything else not a letter or digit a space. */
function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/** Whether the text holds one of the phrases as whole words, however it is cased or punctuated. */
export function hasEmergencyPhrase(text: string, phrases: readonly string[]): boolean {
  const said = words(text);
  return phrases.some((phrase) => {
    const wanted = words(phrase);
    return wanted.trim() !== '' && said.includes(wanted);
  });
}

export interface RoutableMessage {
  kind: InboundKind;
  body: string | null;
  replyId: string | null;
}

const menuRoutes: Record<string, InboundRoute> = {
  'menu.book': 'book',
  'menu.reschedule': 'reschedule',
  'menu.talk': 'talk',
};

/** The day before reminder's quick replies (SET-11 `day_before_reminder`), by payload or text. */
const reminderRoutes: Record<string, InboundRoute> = {
  confirm: 'confirm',
  reschedule: 'reschedule',
};

const flowRoutes: Record<string, InboundRoute> = {
  booking: 'booking_flow',
  reschedule: 'reschedule_flow',
};

export function routeInbound(
  message: RoutableMessage,
  { emergencyPhrases }: { emergencyPhrases: readonly string[] },
): InboundRoute {
  switch (message.kind) {
    case 'text':
      // Emergency first (TAD section 6): before any booking or assistant.
      if (message.body && hasEmergencyPhrase(message.body, emergencyPhrases)) return 'emergency';
      return 'assistant';
    case 'reply': {
      const id = message.replyId ?? '';
      return menuRoutes[id] ?? reminderRoutes[id.trim().toLowerCase()] ?? 'menu';
    }
    case 'flow':
      return flowRoutes[message.replyId ?? ''] ?? 'menu';
    case 'other':
      return 'menu';
  }
}

export interface CentreContact {
  name: string;
  phone: string | null;
}

/**
 * "Talk to our team" (WA-09; PRD J1.2): the front desk phone and email, one message. The phones of
 * the patient's centre when the number is theirs alone, otherwise of every centre (user decision,
 * 30 October 2026). Nothing is invented: a missing phone or email is left out.
 */
export function contactText({
  centres,
  email,
}: {
  centres: readonly CentreContact[];
  email: string;
}): string {
  const phones = centres
    .filter((centre): centre is { name: string; phone: string } => Boolean(centre.phone))
    .map((centre) => (centres.length > 1 ? `${centre.name} ${centre.phone}` : centre.phone));
  const ways = [
    ...(phones.length > 0 ? [`call ${phones.join(', ')}`] : []),
    ...(email ? [`email ${email}`] : []),
  ];
  if (ways.length === 0) return 'Please call the clinic you visit; our front desk will help.';
  return `To talk to our team, ${ways.join(' or ')}.`;
}
