import { newId } from './context';
import { addDays, addMonths, diffDays, parts } from './dates';
import { normalizePayee } from './transactions';
import type { Account, Frequency, ID, ISODate, Recurring, Transaction } from './types';

const STEP_DAYS: Record<Frequency, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };
const STEP_MONTHS: Partial<Record<Frequency, number>> = { monthly: 1, quarterly: 3, yearly: 12 };
const PER_YEAR: Record<Frequency, number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
  quarterly: 'Every 3 months',
  yearly: 'Every year',
};

/** The n-th due date (0 = the anchor itself). */
function occurrence(rec: Pick<Recurring, 'frequency' | 'anchorDate'>, n: number): ISODate {
  const months = STEP_MONTHS[rec.frequency];
  if (months) return addMonths(rec.anchorDate, n * months, parts(rec.anchorDate).day);
  return addDays(rec.anchorDate, n * STEP_DAYS[rec.frequency]);
}

/** Due dates within [from, to], never before the anchor or after the end date. */
export function occurrencesBetween(
  rec: Pick<Recurring, 'frequency' | 'anchorDate' | 'endDate'>,
  from: ISODate,
  to: ISODate,
): ISODate[] {
  const last = rec.endDate && rec.endDate < to ? rec.endDate : to;
  if (last < from || last < rec.anchorDate) return [];
  // Jump close to the window, then step back a little so month clamping cannot skip a date.
  const gap = Math.max(0, diffDays(rec.anchorDate, from));
  let n = Math.max(0, Math.floor(gap / (STEP_DAYS[rec.frequency] + 1)) - 1);
  const result: ISODate[] = [];
  for (let guard = 0; guard < 5000; guard += 1, n += 1) {
    const date = occurrence(rec, n);
    if (date > last) break;
    if (date >= from) result.push(date);
  }
  return result;
}

export function nextOccurrence(
  rec: Pick<Recurring, 'frequency' | 'anchorDate' | 'endDate'>,
  onOrAfter: ISODate,
): ISODate | null {
  const horizon = addDays(onOrAfter, STEP_DAYS[rec.frequency] + 31);
  return occurrencesBetween(rec, onOrAfter, horizon)[0] ?? null;
}

/** How many days either side of a due date a payment may land and still count for it. */
export function matchWindow(frequency: Frequency): number {
  if (frequency === 'weekly') return 3;
  if (frequency === 'biweekly') return 6;
  if (frequency === 'monthly') return 12;
  return 20;
}

/** The amount to set aside each month to cover this item, e.g. a yearly bill / 12. */
export function monthlyEquivalent(rec: Pick<Recurring, 'amount' | 'frequency'>): number {
  return Math.round((rec.amount * PER_YEAR[rec.frequency]) / 12);
}

export type OccurrenceState = 'paid' | 'skipped' | 'overdue' | 'due' | 'upcoming';

export interface Occurrence {
  recurring: Recurring;
  date: ISODate;
  state: OccurrenceState;
  paidBy?: Transaction;
}

/**
 * Every due date of every active item within [from, to], with whether it has
 * been paid. A payment settles the nearest due date and only one of them.
 */
export function scheduleBetween(
  recurrings: readonly Recurring[],
  transactions: readonly Transaction[],
  from: ISODate,
  to: ISODate,
  today: ISODate,
): Occurrence[] {
  const linked = new Map<ID, Transaction[]>();
  for (const tx of transactions) {
    if (!tx.recurringId) continue;
    const list = linked.get(tx.recurringId);
    if (list) list.push(tx);
    else linked.set(tx.recurringId, [tx]);
  }

  const result: Occurrence[] = [];
  for (const recurring of recurrings) {
    if (recurring.status !== 'active') continue;
    const window = matchWindow(recurring.frequency);
    // Look a window either side so payments near the edges are attributed correctly.
    const all = occurrencesBetween(recurring, addDays(from, -window * 2), addDays(to, window * 2));
    const payments = [...(linked.get(recurring.id) ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    const claimed = new Set<ID>();
    const paidBy = new Map<ISODate, Transaction>();

    for (const payment of payments) {
      let best: ISODate | null = null;
      let bestGap = Infinity;
      for (const date of all) {
        if (paidBy.has(date)) continue;
        const gap = Math.abs(diffDays(date, payment.date));
        if (gap <= window && gap < bestGap) {
          best = date;
          bestGap = gap;
        }
      }
      if (best && !claimed.has(payment.id)) {
        paidBy.set(best, payment);
        claimed.add(payment.id);
      }
    }

    for (const date of all) {
      if (date < from || date > to) continue;
      const payment = paidBy.get(date);
      let state: OccurrenceState;
      if (payment) state = 'paid';
      else if (recurring.skipped.includes(date)) state = 'skipped';
      else if (date < today) state = 'overdue';
      else if (date === today) state = 'due';
      else state = 'upcoming';
      result.push({ recurring, date, state, paidBy: payment });
    }
  }
  return result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.recurring.name.localeCompare(b.recurring.name)));
}

/** What still needs attention: unpaid items from the recent past plus everything due within `horizonDays`. */
export function upcoming(
  recurrings: readonly Recurring[],
  transactions: readonly Transaction[],
  today: ISODate,
  horizonDays = 30,
  lookbackDays = 35,
): Occurrence[] {
  return scheduleBetween(recurrings, transactions, addDays(today, -lookbackDays), addDays(today, horizonDays), today).filter(
    (item) => item.state === 'overdue' || item.state === 'due' || item.state === 'upcoming',
  );
}

type Linkable = Pick<Transaction, 'payee' | 'amount' | 'kind'> & { rawPayee?: string };

/** The recurring item an incoming transaction pays, if any. */
export function linkRecurring(
  tx: Linkable,
  txCurrency: string,
  recurrings: readonly Recurring[],
): Recurring | undefined {
  if (tx.kind === 'transfer') return undefined;
  const names = [normalizePayee(tx.payee), tx.rawPayee ? normalizePayee(tx.rawPayee) : ''].filter(Boolean);
  return recurrings.find((recurring) => {
    if (recurring.status === 'archived') return false;
    const wanted = normalizePayee(recurring.matchText);
    if (!wanted || !names.some((name) => name.includes(wanted))) return false;
    if (Math.sign(tx.amount) !== Math.sign(recurring.amount)) return false;
    if (txCurrency !== recurring.currency) return true;
    const allowed = Math.abs(recurring.amount) * (Math.max(0, recurring.tolerancePct) / 100);
    return Math.abs(Math.abs(tx.amount) - Math.abs(recurring.amount)) <= allowed;
  });
}

const RANGES: { frequency: Frequency; min: number; max: number }[] = [
  { frequency: 'weekly', min: 6, max: 8 },
  { frequency: 'biweekly', min: 13, max: 16 },
  { frequency: 'monthly', min: 26, max: 35 },
  { frequency: 'quarterly', min: 84, max: 98 },
  { frequency: 'yearly', min: 350, max: 380 },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface RecurringSuggestion {
  recurring: Recurring;
  /** How many past payments the suggestion is based on. */
  seen: number;
  lastDate: ISODate;
}

/**
 * Find regular payments in the history that are not tracked yet. Suggestions
 * are only ever offered for confirmation, never created silently.
 */
export function detectRecurring(
  transactions: readonly Transaction[],
  existing: readonly Recurring[],
  accounts: readonly Account[],
  today: ISODate,
): RecurringSuggestion[] {
  const currency = new Map(accounts.map((account) => [account.id, account.currency]));
  const known = existing.map((item) => normalizePayee(item.matchText)).filter(Boolean);
  const groups = new Map<string, Transaction[]>();

  for (const tx of transactions) {
    if (tx.kind === 'transfer' || tx.recurringId || tx.amount === 0) continue;
    const name = normalizePayee(tx.payee);
    if (!name || known.some((text) => name.includes(text))) continue;
    const key = `${currency.get(tx.accountId) ?? ''}|${Math.sign(tx.amount)}|${name}`;
    const list = groups.get(key);
    if (list) list.push(tx);
    else groups.set(key, [tx]);
  }

  const suggestions: RecurringSuggestion[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ordered = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
    const gaps: number[] = [];
    for (let i = 1; i < ordered.length; i += 1) gaps.push(diffDays(ordered[i - 1].date, ordered[i].date));
    const typical = median(gaps);
    const range = RANGES.find((item) => typical >= item.min && typical <= item.max);
    if (!range) continue;
    // Short cycles need more evidence; a yearly charge seen twice is already telling.
    const needed = range.frequency === 'yearly' || range.frequency === 'quarterly' ? 2 : 3;
    if (ordered.length < needed) continue;
    const regular = gaps.filter((gap) => gap >= range.min - 2 && gap <= range.max + 2).length;
    if (regular / gaps.length < 0.7) continue;

    const sizes = ordered.map((tx) => Math.abs(tx.amount));
    const middle = median(sizes);
    const spread = Math.max(...sizes.map((size) => Math.abs(size - middle))) / (middle || 1);
    if (spread > 0.4) continue;

    const last = ordered[ordered.length - 1];
    const step = STEP_DAYS[range.frequency];
    if (diffDays(last.date, today) > step * 2) continue; // stopped being charged

    const months = STEP_MONTHS[range.frequency];
    const next = months ? addMonths(last.date, months) : addDays(last.date, step);
    const categoryCounts = new Map<string, number>();
    for (const tx of ordered) {
      if (tx.categoryId) categoryCounts.set(tx.categoryId, (categoryCounts.get(tx.categoryId) ?? 0) + 1);
    }
    const categoryId = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    suggestions.push({
      seen: ordered.length,
      lastDate: last.date,
      recurring: {
        id: newId('rec_'),
        name: last.payee,
        amount: last.amount,
        currency: currency.get(last.accountId) ?? '',
        accountId: last.accountId,
        categoryId,
        frequency: range.frequency,
        anchorDate: next,
        status: 'active',
        matchText: last.payee,
        tolerancePct: Math.min(50, Math.max(10, Math.ceil(spread * 100) + 10)),
        skipped: [],
      },
    });
  }
  return suggestions.sort((a, b) => Math.abs(b.recurring.amount) - Math.abs(a.recurring.amount));
}
