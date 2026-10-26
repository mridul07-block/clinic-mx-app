'use server';

import { SlotRefusedError } from '@clinic-mx/db';
import {
  documentTime,
  seriesClashLabels,
  seriesStartText,
  type SeriesRow,
} from '@clinic-mx/schemas';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { bookPlanSessions, previewPlanSessions } from './plan-sessions';
import { SchedulingError } from './services';

/** One date of the checked series, ready to show. */
export interface SeriesRowView {
  /** The asked start (ISO). */
  startsAt: string;
  when: string;
  free: boolean;
  reason?: string;
  /** For a date that is not free: the nearest times that day, then the next day's. */
  choices: { value: string; label: string }[];
}

/** What the Book plan sessions form shows after a post (SCH-11). */
export interface PlanSessionsFormState {
  error?: string;
  /** Messages by field: fromDate, weekdays, time, physioId. */
  fieldErrors?: Record<string, string>;
  /** The pattern given back: the form resets after each post (React 19). */
  pattern?: { fromDate: string; weekdays: string[]; time: string; physioId: string };
  rows?: SeriesRowView[];
  booked?: { number: string; when: string }[];
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

const texts = (form: FormData, name: string) =>
  form.getAll(name).filter((value): value is string => typeof value === 'string');

function rowView(row: SeriesRow): SeriesRowView {
  const startsAt = row.startsAt.toISOString();
  if (row.check.ok) {
    return { startsAt, when: seriesStartText(row.startsAt), free: true, choices: [] };
  }
  return {
    startsAt,
    when: seriesStartText(row.startsAt),
    free: false,
    reason: seriesClashLabels[row.check.refusal],
    choices: [
      ...row.sameDay.map((slot) => ({
        value: slot.startsAt.toISOString(),
        label: documentTime(slot.startsAt),
      })),
      ...(row.nextDay
        ? [
            {
              value: row.nextDay.startsAt.toISOString(),
              label: `Next day, ${seriesStartText(row.nextDay.startsAt)}`,
            },
          ]
        : []),
    ],
  };
}

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): Pick<PlanSessionsFormState, 'error' | 'fieldErrors'> {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const field = String(issue.path.at(0) ?? 'form');
      fieldErrors[field] ??= issue.message;
    }
    if (fieldErrors.starts) return { error: fieldErrors.starts };
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (
    error instanceof SchedulingError ||
    error instanceof SlotRefusedError ||
    error instanceof ReadOnlyError
  ) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'You cannot book at that centre.' };
  }
  throw error;
}

/**
 * Book plan sessions on the plan and payment sheet: "Check dates" checks the pattern's dates;
 * "Book" books the free ones and the picks for the others (or skips them), all or nothing.
 */
export async function planSessionsAction(
  _state: PlanSessionsFormState,
  form: FormData,
): Promise<PlanSessionsFormState> {
  const episodeId = text(form, 'episodeId');
  const pattern = {
    fromDate: text(form, 'fromDate'),
    weekdays: texts(form, 'weekdays'),
    time: text(form, 'time'),
    physioId: text(form, 'physioId'),
  };
  const context = await serviceContext();
  const check = async (): Promise<PlanSessionsFormState> => {
    try {
      const preview = await previewPlanSessions(context.actor, { episodeId, ...pattern });
      return { pattern, rows: preview.rows.map(rowView) };
    } catch (error) {
      return { pattern, ...failure(error) };
    }
  };
  if (text(form, 'intent') !== 'book') return check();

  const starts = texts(form, 'starts');
  const clashes = Number(text(form, 'clashes')) || 0;
  for (let index = 0; index < clashes; index++) {
    const pick = text(form, ['clash', index].join('-'));
    if (!pick) {
      return { ...(await check()), error: 'Pick a time or Skip for each date that is not free.' };
    }
    if (pick !== 'skip') starts.push(pick);
  }
  try {
    const result = await bookPlanSessions(context, { episodeId, ...pattern, starts });
    revalidatePath(['/app/plans', episodeId].join('/'));
    return {
      booked: result.booked.map((entry) => ({
        number: entry.number,
        when: seriesStartText(entry.startsAt),
      })),
    };
  } catch (error) {
    const refused = failure(error);
    const again = await check();
    return { ...again, error: refused.error ?? again.error, fieldErrors: refused.fieldErrors };
  }
}
