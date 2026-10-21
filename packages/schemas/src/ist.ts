import { z } from 'zod';

/**
 * Times are stored in UTC and shown in India Standard Time (rule 15). IST is UTC+05:30 all year
 * (no daylight saving), so a calendar day in IST is a fixed span of UTC time.
 */
export const CLINIC_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** A calendar date typed in a form, YYYY-MM-DD, that exists. */
export const calendarDateSchema = z.iso.date({ error: 'Enter a date.' });

/** The instant a calendar day in IST ends: midnight IST at the start of the next day, in UTC. */
export function endOfIstDay(date: string): Date {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1) - IST_OFFSET_MS);
}

/** The IST calendar date (YYYY-MM-DD) an instant falls on. */
export function istDate(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The IST calendar date whose end is `end` (the inverse of endOfIstDay). */
export function istDayEndingAt(end: Date): string {
  return istDate(new Date(end.getTime() - 1));
}

/** A date for people to read, for example "30 Nov 2026". */
export function formatIstDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** An instant for people to read in IST, for example "22 Oct 2026, 14:30 IST". */
export function formatIstDateTime(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: CLINIC_TIME_ZONE,
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} IST`;
}
