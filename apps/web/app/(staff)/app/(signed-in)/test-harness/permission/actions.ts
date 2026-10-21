'use server';

import { actions, type Action } from '@clinic-mx/schemas';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { testHarnessEnabled } from '../../../../../../lib/drafts/test-harness-store';
import { NotAllowedError } from '../../../../../../modules/access/guard';
import { staffService } from '../../../../../../modules/access/service';
import { serviceContext } from '../../../../../../modules/access/staff-db';

/**
 * A write through a staffService for the action (end to end tests only), so a test can show the
 * server refusing it, for example to a read only Velyx support login (IAM-08). It changes
 * nothing: the work is empty.
 */
export async function tryWriteAction(_state: string, form: FormData): Promise<string> {
  const action = form.get('action');
  if (!testHarnessEnabled() || !(actions as unknown[]).includes(action)) notFound();
  const write = staffService({
    action: action as Action,
    input: z.object({}),
    run: () => Promise.resolve('Written'),
  });
  try {
    return await write(await serviceContext(), {});
  } catch (error) {
    if (error instanceof NotAllowedError) return `Refused: ${error.message}`;
    throw error;
  }
}
