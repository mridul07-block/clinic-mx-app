import 'server-only';
import {
  appointmentTypeList,
  calendarDay,
  slotFit,
  type CalendarDay,
  type StaffMember,
} from '@clinic-mx/db';
import {
  accessScope,
  calendarQuerySchema,
  can,
  slotOptionsQuerySchema,
  slotRefusalMessages,
} from '@clinic-mx/schemas';
import { assertCan, assertMay } from '../access/guard';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';
import { holderOf } from './services';

/**
 * The calendar day view for staff (SCH-05): `calendar.view` at a centre the person sees. The
 * Super Admin, Centre Managers and the Front Desk see every physio with hours there; a physio
 * sees their own column (PRD section 2: "own schedule"). Fees show only to people who may see
 * prices. Settings are read before the transaction opens (SET-03).
 */
export async function loadCalendar(actor: StaffMember, rawQuery: unknown): Promise<CalendarDay> {
  assertMay(actor, 'calendar.view');
  const query = calendarQuerySchema.parse(rawQuery);
  const own = accessScope(actor, 'calendar.view') === 'own';
  assertCan(actor, 'calendar.view', { centreId: query.centreId, ownerId: actor.id });
  const step = await getSetting('scheduling.slot_minutes');
  const day = await asStaff(actor, (tx) =>
    calendarDay(tx, {
      ...query,
      physioId: own ? actor.id : undefined,
      holder: holderOf(actor),
      step,
      now: new Date(),
    }),
  );
  if (can(actor, 'prices.view')) return day;
  return { ...day, columns: day.columns.map((column) => ({ ...column, fee: null })) };
}

export interface SlotOption {
  appointmentTypeId: string;
  name: string;
  minutes: number | null;
  /** Null when it fits; otherwise why not, in words. */
  refusal: string | null;
}

/** For a picked free start: each active appointment type, and whether it fits there. */
export async function slotOptions(actor: StaffMember, rawQuery: unknown): Promise<SlotOption[]> {
  assertMay(actor, 'calendar.view');
  const query = slotOptionsQuerySchema.parse(rawQuery);
  assertCan(actor, 'calendar.view', { centreId: query.centreId, ownerId: actor.id });
  if (accessScope(actor, 'calendar.view') === 'own' && query.physioId !== actor.id) return [];
  const step = await getSetting('scheduling.slot_minutes');
  return asStaff(actor, async (tx) => {
    const types = (await appointmentTypeList(tx)).filter((type) => type.active);
    const options: SlotOption[] = [];
    for (const type of types) {
      const fit = await slotFit(tx, {
        ...query,
        appointmentTypeId: type.id,
        holder: holderOf(actor),
        step,
        now: new Date(),
      });
      options.push({
        appointmentTypeId: type.id,
        name: type.name,
        minutes: fit.ok
          ? Math.round((fit.slot.endsAt.getTime() - fit.slot.startsAt.getTime()) / 60000)
          : null,
        refusal: fit.ok ? null : slotRefusalMessages[fit.refusal],
      });
    }
    return options;
  });
}
