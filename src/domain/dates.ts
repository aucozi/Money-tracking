import type { ISODate, MonthKey } from './types';

/**
 * Calendar-date helpers. Dates are handled as "YYYY-MM-DD" strings and all
 * arithmetic runs in UTC, so daylight-saving changes and the device timezone
 * can never move a transaction to the wrong day.
 */

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

export function makeDate(year: number, month: number, day: number): ISODate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Today's calendar date in the device's own timezone. */
export function todayISO(now: Date = new Date()): ISODate {
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function parts(date: ISODate): { year: number; month: number; day: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

function toUTC(date: ISODate): number {
  const { year, month, day } = parts(date);
  return Date.UTC(year, month - 1, day);
}

function fromUTC(ms: number): ISODate {
  const d = new Date(ms);
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function isValidDate(date: string): date is ISODate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return fromUTC(toUTC(date)) === date;
}

const DAY = 86_400_000;

export function addDays(date: ISODate, days: number): ISODate {
  return fromUTC(toUTC(date) + days * DAY);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function diffDays(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add months, keeping `dayOfMonth` where the month is long enough and clamping
 * to its last day otherwise. Passing the original day keeps a bill due on the
 * 31st from sliding to the 28th forever after one February.
 */
export function addMonths(date: ISODate, months: number, dayOfMonth?: number): ISODate {
  const { year, month, day } = parts(date);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const wanted = dayOfMonth ?? day;
  return makeDate(targetYear, targetMonth, Math.min(wanted, daysInMonth(targetYear, targetMonth)));
}

export function monthKey(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

export function monthStart(month: MonthKey): ISODate {
  return `${month}-01`;
}

export function monthEnd(month: MonthKey): ISODate {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return makeDate(year, m, daysInMonth(year, m));
}

export function monthLength(month: MonthKey): number {
  return daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
}

export function addMonthsToKey(month: MonthKey, months: number): MonthKey {
  return monthKey(addMonths(monthStart(month), months));
}

/** Whole months from `from` to `to`; negative when `to` is earlier. */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
  const a = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7));
  const b = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  return b - a;
}

/** Inclusive list of months from `from` to `to`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const count = monthsBetween(from, to);
  const result: MonthKey[] = [];
  for (let i = 0; i <= count; i += 1) result.push(addMonthsToKey(from, i));
  return result;
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: ISODate): number {
  return new Date(toUTC(date)).getUTCDay();
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function monthName(month: number, short = false): string {
  const name = MONTHS[month - 1] ?? '';
  return short ? name.slice(0, 3) : name;
}

export function formatMonth(month: MonthKey, short = false): string {
  return `${monthName(Number(month.slice(5, 7)), short)} ${month.slice(0, 4)}`;
}

/** "Mon, 3 Nov" or, with the year, "3 Nov 2026". */
export function formatDate(date: ISODate, style: 'short' | 'long' | 'weekday' = 'short'): string {
  const { year, month, day } = parts(date);
  if (style === 'long') return `${day} ${monthName(month, true)} ${year}`;
  if (style === 'weekday') return `${WEEKDAYS[dayOfWeek(date)].slice(0, 3)}, ${day} ${monthName(month, true)}`;
  return `${day} ${monthName(month, true)}`;
}

/** "Today", "Tomorrow", "Yesterday", "in 5 days", "3 days ago", or the date. */
export function formatRelative(date: ISODate, today: ISODate): string {
  const delta = diffDays(today, date);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  if (delta > 1 && delta <= 14) return `in ${delta} days`;
  if (delta < -1 && delta >= -14) return `${-delta} days ago`;
  return formatDate(date, parts(date).year === parts(today).year ? 'short' : 'long');
}

export type DateOrder = 'YMD' | 'DMY' | 'MDY';

const MONTH_WORDS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Read a date written by a bank export. Handles "2026-11-03", "03/11/2026",
 * "11/3/26", "3.11.2026", "20261103", "3 Nov 2026", "Nov 3, 2026" and a trailing time.
 */
export function parseFlexibleDate(input: string, order: DateOrder = 'MDY'): ISODate | null {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (!text) return null;

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (compact) return validated(Number(compact[1]), Number(compact[2]), Number(compact[3]));

  const worded =
    /^(\d{1,2})[\s.-]+([A-Za-z]{3,})\.?[\s,.-]+(\d{2,4})/.exec(text) ?? null;
  if (worded) {
    const month = MONTH_WORDS[worded[2].slice(0, 3).toLowerCase()];
    if (month) return validated(fullYear(Number(worded[3])), month, Number(worded[1]));
  }
  const wordedUS = /^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})/.exec(text);
  if (wordedUS) {
    const month = MONTH_WORDS[wordedUS[1].slice(0, 3).toLowerCase()];
    if (month) return validated(fullYear(Number(wordedUS[3])), month, Number(wordedUS[2]));
  }

  const numeric = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/.exec(text);
  if (!numeric) return null;
  const [a, b, c] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
  if (numeric[1].length === 4) return validated(a, b, c);
  if (order === 'YMD') return validated(fullYear(a), b, c);
  if (order === 'DMY') return validated(fullYear(c), b, a);
  return validated(fullYear(c), a, b);
}

function fullYear(year: number): number {
  if (year >= 100) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function validated(year: number, month: number, day: number): ISODate | null {
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2200) return null;
  if (day > daysInMonth(year, month)) return null;
  return makeDate(year, month, day);
}

/**
 * Work out whether a column of dates is day-first or month-first. A value over
 * 12 in one position settles it; with no such evidence `fallback` is used.
 */
export function detectDateOrder(samples: readonly string[], fallback: DateOrder = 'MDY'): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const sample of samples) {
    const match = /^(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/.exec(sample.trim());
    if (!match) continue;
    if (match[1].length === 4) return 'YMD';
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) dayFirst += 1;
    if (second > 12 && first <= 12) monthFirst += 1;
  }
  if (dayFirst > monthFirst) return 'DMY';
  if (monthFirst > dayFirst) return 'MDY';
  return fallback;
}
