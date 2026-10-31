import { z } from 'zod';
import { messageTemplates } from './message-templates';
import { sessionReplyLabels, type SessionReply } from './whatsapp-router';

/**
 * "Not delivered" on the front desk's Today (WA-13): WhatsApp messages Meta could not deliver to
 * a known patient, so the desk can call them. Failed only (user decision, 31 October 2026): a
 * message Not sent for a setup reason (not approved, the 24 hour window, the test list) is the
 * Super Admin's, on WhatsApp templates.
 */

/** Meta's reason in plain words, for the desk; the code is kept for the Super Admin. */
export function undeliveredReason(code: string | null): string {
  switch (code) {
    case '131026':
      return 'Not on WhatsApp, or cannot receive messages';
    case '131047':
      return 'More than 24 hours since they last wrote to us';
    case '131049':
    case '131050':
      return 'WhatsApp held it back';
    case '131031':
      return 'The clinic’s WhatsApp account is restricted: tell the Super Admin';
    default:
      if (code?.startsWith('132')) return 'A template problem: tell the Super Admin';
      return code
        ? `WhatsApp could not deliver it (code ${code})`
        : 'WhatsApp could not deliver it';
  }
}

/** Which message it was, as the desk knows it: the template's name, or the reply's label. */
export function messageLabel(templateKey: string | null): string {
  const template = messageTemplates.find((entry) => entry.key === templateKey);
  if (template) return template.name;
  if (templateKey && templateKey in sessionReplyLabels) {
    return sessionReplyLabels[templateKey as SessionReply];
  }
  return 'A WhatsApp message';
}

/** Done on one of them, from Today: the message, and the centre whose board it is. */
export const followUpUndeliveredSchema = z.object({
  messageId: z.guid({ error: 'That message was not found.' }),
  centreId: z.guid({ error: 'That centre was not found.' }),
});
export type FollowUpUndeliveredInput = z.infer<typeof followUpUndeliveredSchema>;
