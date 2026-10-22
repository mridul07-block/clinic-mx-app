'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import {
  RosterError,
  cancelLeaveService,
  decideLeaveService,
  recordLeave,
  requestLeave,
  saveRosterService,
} from './services';

/** What a roster or leave form shows after a post (SET-04). */
export interface RosterFormState {
  error?: string;
  /** Messages by field: centreId, effectiveFrom, day0 to day6, from, to, date, fromTime... */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error so the form keeps it. */
  values?: Record<string, string>;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): RosterFormState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const [first, second] = issue.path;
      const field =
        first === 'days' && typeof second === 'number'
          ? `day${String(second)}`
          : (issue.path.find((part) => typeof part === 'string') ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof RosterError) {
    return error.field
      ? { error: 'Check the highlighted fields.', fieldErrors: { [error.field]: error.message } }
      : { error: error.message };
  }
  if (error instanceof ReadOnlyError) return { error: error.message };
  if (error instanceof NotAllowedError) return { error: 'You do not have access to this.' };
  throw error;
}

const values = (form: FormData, names: string[]) =>
  Object.fromEntries(names.map((name) => [name, text(form, name)]));

const DAYS = ['day0', 'day1', 'day2', 'day3', 'day4', 'day5', 'day6'];

export async function saveRosterAction(
  _state: RosterFormState,
  form: FormData,
): Promise<RosterFormState> {
  const typed = values(form, ['staffUserId', 'centreId', 'effectiveFrom', ...DAYS]);
  try {
    await saveRosterService(await serviceContext(), {
      staffUserId: typed.staffUserId,
      centreId: typed.centreId,
      effectiveFrom: typed.effectiveFrom,
      days: DAYS.map((day) => typed[day] ?? ''),
    });
  } catch (error) {
    return { ...failure(error), values: typed };
  }
  revalidatePath('/app/team');
  redirect(`/app/team/${typed.staffUserId ?? ''}?done=hours`);
}

const LEAVE_FIELDS = ['kind', 'from', 'to', 'date', 'fromTime', 'toTime', 'note'];

const leaveFrom = (typed: Record<string, string>) =>
  typed.kind === 'part'
    ? {
        kind: 'part',
        date: typed.date,
        fromTime: typed.fromTime,
        toTime: typed.toTime,
        note: typed.note,
      }
    : { kind: typed.kind, from: typed.from, to: typed.to, note: typed.note };

/** A person requests their own leave (My leave). */
export async function requestLeaveAction(
  _state: RosterFormState,
  form: FormData,
): Promise<RosterFormState> {
  const typed = values(form, LEAVE_FIELDS);
  try {
    const context = await serviceContext();
    await requestLeave(context, { staffUserId: context.actor.id, ...leaveFrom(typed) });
  } catch (error) {
    return { ...failure(error), values: typed };
  }
  revalidatePath('/app/leave');
  revalidatePath('/app/team');
  redirect('/app/leave?done=requested');
}

/** A manager records someone's leave from their team page. */
export async function recordLeaveAction(
  _state: RosterFormState,
  form: FormData,
): Promise<RosterFormState> {
  const typed = values(form, ['staffUserId', ...LEAVE_FIELDS]);
  try {
    await recordLeave(await serviceContext(), {
      staffUserId: typed.staffUserId,
      ...leaveFrom(typed),
    });
  } catch (error) {
    return { ...failure(error), values: typed };
  }
  revalidatePath('/app/team');
  redirect(`/app/team/${typed.staffUserId ?? ''}?done=leave`);
}

/** A manager approves or declines requested leave from Team. */
export async function decideLeaveAction(
  _state: RosterFormState,
  form: FormData,
): Promise<RosterFormState> {
  const typed = values(form, ['leaveId', 'decision', 'reason']);
  try {
    await decideLeaveService(await serviceContext(), typed);
  } catch (error) {
    return { ...failure(error), values: typed };
  }
  revalidatePath('/app/team');
  revalidatePath('/app/leave');
  redirect(`/app/team?done=${typed.decision === 'approve' ? 'approved' : 'declined'}`);
}

/** Cancels leave, then goes back to My leave or the person's team page. */
export async function cancelLeaveAction(
  _state: RosterFormState,
  form: FormData,
): Promise<RosterFormState> {
  const leaveId = text(form, 'leaveId');
  const back = text(form, 'back');
  try {
    await cancelLeaveService(await serviceContext(), { leaveId });
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/app/leave');
  revalidatePath('/app/team');
  // Only our own pages: My leave, or a team member's page.
  const target = /^\/app\/(leave|team\/[0-9a-f-]{36})$/.test(back) ? back : '/app/leave';
  redirect(`${target}?done=cancelled`);
}
