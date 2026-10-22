'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { serviceContext } from '../access/staff-db';
import { ConsultationFeeError, setConsultationFeeService } from './services';

/** What the consultation fee form shows after a post (SCH-05). */
export interface ConsultationFeeFormState {
  error?: string;
  notice?: string;
}

export async function setConsultationFeeAction(
  _state: ConsultationFeeFormState,
  form: FormData,
): Promise<ConsultationFeeFormState> {
  const value = (name: string) => {
    const entry = form.get(name);
    return typeof entry === 'string' ? entry : '';
  };
  const staffUserId = value('staffUserId');
  try {
    await setConsultationFeeService(await serviceContext(), {
      staffUserId,
      priceItemId: value('priceItemId'),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return { error: 'Choose a consultation fee.' };
    if (error instanceof ConsultationFeeError || error instanceof ReadOnlyError) {
      return { error: error.message };
    }
    if (error instanceof NotAllowedError) return { error: 'You do not have access to staff.' };
    throw error;
  }
  revalidatePath(`/app/staff/${staffUserId}`);
  revalidatePath('/app/calendar');
  return { notice: 'Consultation fee saved.' };
}
