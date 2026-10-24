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

// Written out rather than taken from Intl, which gives "Sept" in some builds (design/README.md).
const monthNames = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** The IST date of an instant as documents print it (ALT-05), for example "28 Sep 2026". */
export function documentDate(instant: Date): string {
  const [year = '', month = '1', day = '1'] = istDate(instant).split('-');
  return `${Number(day)} ${monthNames[Number(month) - 1] ?? ''} ${year}`;
}

/** A calendar date (YYYY-MM-DD) as documents print it (ALT-06), for example "5 Dec 2026". */
export function documentCalendarDate(date: string): string {
  const [year = '', month = '1', day = '1'] = date.split('-');
  return `${Number(day)} ${monthNames[Number(month) - 1] ?? ''} ${year}`;
}

/** The IST time of an instant as documents print it (ALT-05), for example "4:05 PM". */
export function documentTime(instant: Date): string {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const hours = shifted.getUTCHours();
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Both, for example "28 Sep 2026, 4:05 PM". */
export function documentDateTime(instant: Date): string {
  return `${documentDate(instant)}, ${documentTime(instant)}`;
}

/** The instant a calendar day in IST starts: its midnight IST, in UTC. */
export function startOfIstDay(date: string): Date {
  return new Date(endOfIstDay(date).getTime() - 24 * 60 * 60 * 1000);
}

/** The instant of a wall clock time in IST on a calendar day, `minutes` after its midnight. */
export function istInstant(date: string, minutes: number): Date {
  return new Date(startOfIstDay(date).getTime() + minutes * 60 * 1000);
}

/** The ISO weekday of a calendar date: Monday 1 to Sunday 7. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** A calendar date `days` after another (or before, when negative). */
export function addDays(date: string, days: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Minutes after midnight as a 24 hour time, for example 570 as "09:30". */
export function timeText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
