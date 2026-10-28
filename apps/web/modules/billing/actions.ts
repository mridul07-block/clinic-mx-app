'use server';

import { planChoiceFromForm } from '@clinic-mx/schemas';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { BillError, makeConsultationBill } from './bills';
import { DiscountError, applyBillDiscount, removeBillDiscount } from './discounts';
import { PaymentError, recordBillPayment, undoBillPayment } from './payments';
import { PlanChoiceError, recordPatientPlanChoice } from './plan-choice';

/** What the patient choice form shows after a post (BIL-02). */
export interface PlanChoiceFormState {
  error?: string;
  done?: boolean;
  /** The option picked, given back with a refusal: the form resets after each post (React 19). */
  option?: string;
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Refusals become messages; anything else is ours and is thrown. */
function failure(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? 'That could not be read.';
  }
  if (
    error instanceof PlanChoiceError ||
    error instanceof BillError ||
    error instanceof PaymentError ||
    error instanceof DiscountError ||
    error instanceof ReadOnlyError
  ) {
    return error.message;
  }
  if (error instanceof NotAllowedError) {
    return 'Only the front desk at this centre, Finance or the Super Admin records the choice.';
  }
  throw error;
}

/** Records the patient's choice on the plan and payment sheet. */
export async function recordPlanChoiceAction(
  _state: PlanChoiceFormState,
  form: FormData,
): Promise<PlanChoiceFormState> {
  const episodeId = text(form, 'episodeId');
  const option = text(form, 'option');
  try {
    await recordPatientPlanChoice(await serviceContext(), {
      episodeId,
      choice: planChoiceFromForm(option, text(form, 'session')),
    });
  } catch (error) {
    return { error: failure(error), option };
  }
  revalidatePath(['/app/plans', episodeId].join('/'));
  return { done: true };
}

/** What "Make the consultation bill" shows after a post (BIL-05). */
export interface BillFormState {
  error?: string;
  done?: boolean;
}

/** Makes the consultation fee bill once the consultant's fee is set. */
export async function makeConsultationBillAction(
  _state: BillFormState,
  form: FormData,
): Promise<BillFormState> {
  const episodeId = text(form, 'episodeId');
  try {
    await makeConsultationBill(await serviceContext(), { episodeId });
  } catch (error) {
    return { error: failure(error) };
  }
  revalidatePath(['/app/plans', episodeId].join('/'));
  return { done: true };
}

/** What a payment form shows after a post (BIL-06). */
export interface PaymentFormState {
  error?: string;
  done?: boolean;
  /** What was picked and typed, given back with a refusal (the form resets after each post). */
  values?: Record<string, string>;
}

/** "Mark paid": the bill's whole total by the method picked, with an optional reference. */
export async function recordPaymentAction(
  _state: PaymentFormState,
  form: FormData,
): Promise<PaymentFormState> {
  const values = { method: text(form, 'method'), reference: text(form, 'reference') };
  try {
    await recordBillPayment(await serviceContext(), {
      billId: text(form, 'billId'),
      expectedTotalPaise: text(form, 'expectedTotal'),
      method: values.method,
      reference: values.reference,
    });
  } catch (error) {
    return { error: failure(error), values };
  }
  revalidatePath(['/app/plans', text(form, 'episodeId')].join('/'));
  return { done: true };
}

/** Undoes a payment recorded by mistake, on its day, with the reason. */
export async function undoPaymentAction(
  _state: PaymentFormState,
  form: FormData,
): Promise<PaymentFormState> {
  const values = { reason: text(form, 'reason') };
  try {
    await undoBillPayment(await serviceContext(), {
      paymentId: text(form, 'paymentId'),
      reason: values.reason,
    });
  } catch (error) {
    return { error: failure(error), values };
  }
  revalidatePath(['/app/plans', text(form, 'episodeId')].join('/'));
  return { done: true };
}

/** What a discount form shows after a post (BIL-07). */
export interface DiscountFormState {
  error?: string;
  done?: boolean;
  /** What was picked and typed, given back with a refusal (the form resets after each post). */
  values?: Record<string, string>;
}

const discountRefused = (error: unknown) =>
  error instanceof NotAllowedError
    ? 'Only Finance or the Super Admin applies a discount that is not on the list.'
    : failure(error);

/**
 * Applies a discount to a bill's line: a preset from the list (`preset:<id>`), or for Finance and
 * the Super Admin an Other discount, a percent or an amount with its reason.
 */
export async function applyDiscountAction(
  _state: DiscountFormState,
  form: FormData,
): Promise<DiscountFormState> {
  const values = {
    choice: text(form, 'choice'),
    by: text(form, 'by'),
    percent: text(form, 'percent'),
    amount: text(form, 'amount'),
    reason: text(form, 'reason'),
  };
  const lineId = text(form, 'lineId');
  const input = values.choice.startsWith('preset:')
    ? { kind: 'preset', lineId, presetId: values.choice.slice('preset:'.length) }
    : values.choice === 'other'
      ? values.by === 'amount'
        ? { kind: 'flat', lineId, amount: values.amount, reason: values.reason }
        : { kind: 'percent', lineId, percent: values.percent, reason: values.reason }
      : undefined;
  if (!input) return { error: 'Choose a discount.', values };
  try {
    await applyBillDiscount(await serviceContext(), input);
  } catch (error) {
    return { error: discountRefused(error), values };
  }
  revalidatePath(['/app/plans', text(form, 'episodeId')].join('/'));
  return { done: true };
}

/** Takes a line's discount off an unpaid bill. */
export async function removeDiscountAction(
  _state: DiscountFormState,
  form: FormData,
): Promise<DiscountFormState> {
  try {
    await removeBillDiscount(await serviceContext(), { lineId: text(form, 'lineId') });
  } catch (error) {
    return { error: discountRefused(error) };
  }
  revalidatePath(['/app/plans', text(form, 'episodeId')].join('/'));
  return { done: true };
}
