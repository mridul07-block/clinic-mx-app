import 'server-only';
import {
  queueMessage,
  recentMessages,
  templateVersionsOnMeta,
  type MessageEntry,
  type StaffMember,
  type WhatsappTemplate,
} from '@clinic-mx/db';
import { TEST_TEMPLATE, can, sendTestMessageSchema } from '@clinic-mx/schemas';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * WhatsApp from the Super Admin's side (WA-01): the recent messages, and a test send of Meta's
 * `hello_world` sample to a number on the test list, to prove the connection end to end. The
 * job tick sends it within a minute.
 */

export class MessagingError extends Error {
  override name = 'MessagingError';
}

/** How many messages the Recent messages list shows (a screen size, not a business rule). */
const RECENT_MESSAGES = 20;

export async function recentMessagesOf(actor: StaffMember): Promise<MessageEntry[]> {
  if (!can(actor, 'templates.manage') || actor.support) return [];
  return asStaff(actor, (tx) => recentMessages(tx, RECENT_MESSAGES));
}

/** What Meta decided about each template version on this environment's number (WA-06). */
export async function templateVersionsOf(actor: StaffMember): Promise<WhatsappTemplate[]> {
  if (!can(actor, 'templates.manage') || actor.support) return [];
  return asStaff(actor, (tx) => templateVersionsOnMeta(tx));
}

export const sendTestMessageService = staffService({
  action: 'templates.manage',
  input: sendTestMessageSchema,
  run: async (tx, { to }, actor): Promise<{ id: string }> => {
    const recipients = await getSetting('whatsapp.test_recipients');
    if (!recipients.includes(to)) {
      throw new MessagingError('Only numbers on the WhatsApp test list get a test message.');
    }
    const id = await queueMessage(tx, {
      patientId: null,
      toPhone: to,
      kind: 'test',
      templateKey: TEST_TEMPLATE.key,
      templateVersion: 1,
      language: TEST_TEMPLATE.language,
      variables: {},
      createdBy: `staff:${actor.id}`,
    });
    return { id };
  },
});
