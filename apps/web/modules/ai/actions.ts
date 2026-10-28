'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { invalidateSettings } from '../settings/settings';
import { loadRecheck, recheckConsultation, type RecheckView } from './recheck';
import { AiSheetError, recordDisposition } from './sheet';
import { AiSwitchError, switchAiSheet } from './switch';

/** What the AI preparation sheet switch shows after a post (AI-09). */
export interface AiSwitchState {
  error?: string;
  /** Messages by field: blindTest.date, blindTest.reference, legalCheck.date, legalCheck.reference. */
  fieldErrors?: Record<string, string>;
  /** What was typed, given back with an error so the form keeps it. */
  values?: Record<string, string>;
  done?: string;
}

const PAGE = '/app/ai-preparation-sheet';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals and bad input become messages; anything else is ours and is thrown. */
function failure(error: unknown): AiSwitchState {
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      fieldErrors[issue.path.join('.') || 'form'] ??= issue.message;
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof AiSwitchError || error instanceof ReadOnlyError) {
    return { error: error.message };
  }
  if (error instanceof NotAllowedError) {
    return { error: 'Only the Super Admin switches the AI preparation sheet.' };
  }
  throw error;
}

/** "Switch on", with the blind test pass and the legal clearance, or "Switch off". */
export async function switchAiSheetAction(
  _state: AiSwitchState,
  form: FormData,
): Promise<AiSwitchState> {
  const on = text(form, 'on') === 'true';
  const values = {
    'blindTest.date': text(form, 'blindTest.date'),
    'blindTest.reference': text(form, 'blindTest.reference'),
    'legalCheck.date': text(form, 'legalCheck.date'),
    'legalCheck.reference': text(form, 'legalCheck.reference'),
  };
  try {
    await switchAiSheet(
      await serviceContext(),
      on
        ? {
            on: true,
            blindTest: { date: values['blindTest.date'], reference: values['blindTest.reference'] },
            legalCheck: {
              date: values['legalCheck.date'],
              reference: values['legalCheck.reference'],
            },
          }
        : { on: false },
    );
  } catch (error) {
    return { ...failure(error), values };
  }
  invalidateSettings();
  revalidatePath(PAGE);
  return { done: on ? 'AI preparation sheet switched on.' : 'AI preparation sheet switched off.' };
}

/** What a Keep or Dismiss shows after a post (AI-03). */
export interface DispositionState {
  error?: string;
}

/** Keep or Dismiss one suggestion on the preparation sheet. */
export async function recordDispositionAction(
  _state: DispositionState,
  form: FormData,
): Promise<DispositionState> {
  try {
    await recordDisposition(await serviceContext(), {
      suggestionId: text(form, 'suggestionId'),
      disposition: text(form, 'disposition'),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? 'Try again.' };
    if (error instanceof AiSheetError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only consultants keep or dismiss suggestions.' };
    }
    throw error;
  }
  revalidatePath(`/app/episodes/${text(form, 'episodeId')}/preparation-sheet`);
  return {};
}

/** What "Recheck with findings" shows after a tap (AI-04). */
export interface RecheckState {
  error?: string;
  recheck?: RecheckView | null;
}

/** Reranks the sheet with the consultation's findings, after the latest edits are saved. */
export async function recheckWithFindingsAction(
  _state: RecheckState,
  form: FormData,
): Promise<RecheckState> {
  const consultationId = text(form, 'consultationId');
  const context = await serviceContext();
  try {
    await recheckConsultation(context, {
      consultationId,
      baseVersion: Number(text(form, 'baseVersion')),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return { error: 'Try again.' };
    if (error instanceof AiSheetError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) {
      return { error: 'Only the consultant of the visit rechecks.' };
    }
    throw error;
  }
  const view = await loadRecheck(context.actor, consultationId);
  if (view) revalidatePath(view.sheetHref);
  return { recheck: view?.recheck ?? null };
}

/** The consultation's latest recheck, read again while one is running; nothing changes. */
export async function recheckViewAction(consultationId: string): Promise<RecheckView | null> {
  if (!z.guid().safeParse(consultationId).success) return null;
  const view = await loadRecheck((await serviceContext()).actor, consultationId);
  return view?.recheck ?? null;
}
