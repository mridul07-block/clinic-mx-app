'use server';

import { CENTRE_COOKIE } from '@clinic-mx/schemas';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { requireStaff } from '../auth/session';
import { switchableCentres } from './centres';

/** A year: the choice stays until changed. */
const COOKIE_SECONDS = 365 * 24 * 60 * 60;

/** The centre switcher's choice (UI-02): only a centre the person works in. Not a record. */
export async function chooseCentreAction(form: FormData): Promise<void> {
  const staff = await requireStaff();
  const parsed = z.uuid().safeParse(form.get('centre'));
  if (!parsed.success) return;
  const centres = await switchableCentres(staff);
  if (!centres.some((c) => c.id === parsed.data)) return;
  (await cookies()).set(CENTRE_COOKIE, parsed.data, {
    path: '/app',
    maxAge: COOKIE_SECONDS,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  });
}
