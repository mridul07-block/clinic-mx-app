'use server';

import { redirect } from 'next/navigation';
import { serviceContext } from '../access/staff-db';
import { todayHref } from '../front-desk/links';
import { markUndeliveredDone } from './undelivered';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Done on a message that was not delivered (WA-13): recorded, then Today again. */
export async function markUndeliveredDoneAction(form: FormData): Promise<void> {
  const centreId = text(form, 'centreId');
  await markUndeliveredDone(await serviceContext(), {
    messageId: text(form, 'messageId'),
    centreId,
  });
  redirect(todayHref({ centreId, show: text(form, 'show') || undefined }));
}
