import { currencyToBase, toBase, type Ctx } from './context';
import { addDays, diffDays } from './dates';
import { accountBalances } from './networth';
import { scheduleBetween } from './recurring';
import { isCashAccount, type Account, type ID, type ISODate, type Recurring, type Transaction } from './types';

export interface ForecastEvent {
  date: ISODate;
  label: string;
  /** Signed, in the base currency. */
  amount: number;
  recurringId: ID;
  overdue: boolean;
}

export interface ForecastPoint {
  date: ISODate;
  balance: number;
  events: ForecastEvent[];
}

export interface Forecast {
  /** Cash on hand today, in the base currency. */
  start: number;
  points: ForecastPoint[];
  end: number;
  low: { date: ISODate; balance: number };
  /** First day the projected balance falls below zero, if it does. */
  firstNegative?: ISODate;
  /** Typical everyday spending per day that was assumed (0 when switched off). */
  everydayPerDay: number;
  events: ForecastEvent[];
}

/**
 * Average daily spending that is not a tracked bill, over the last `lookback`
 * days. Returns 0 until there are two weeks of history to base it on.
 */
export function everydaySpendingPerDay(transactions: readonly Transaction[], ctx: Ctx, today: ISODate, lookback = 90): number {
  const from = addDays(today, -lookback);
  let total = 0;
  let earliest = today;
  for (const tx of transactions) {
    if (tx.date <= from || tx.date > today) continue;
    if (tx.date < earliest) earliest = tx.date;
    if (tx.kind === 'transfer' || tx.recurringId) continue;
    if (tx.amount < 0) total -= toBase(tx.amount, tx.accountId, ctx);
  }
  const span = diffDays(earliest, today) + 1;
  if (span < 14 || total <= 0) return 0;
  return Math.round(total / span);
}

export interface ForecastInput {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  recurrings: readonly Recurring[];
  ctx: Ctx;
  today: ISODate;
  days: number;
  /** Subtract typical everyday spending each day, not just known bills. */
  everydaySpending: boolean;
  /** Accounts to project. Defaults to every open cash account. */
  accountIds?: readonly ID[];
}

/**
 * Project the cash balance day by day from known recurring items. Unpaid bills
 * that are already overdue are assumed to be paid today; overdue income is not
 * assumed to arrive.
 */
export function forecastBalance(input: ForecastInput): Forecast {
  const { accounts, transactions, recurrings, ctx, today, days, everydaySpending } = input;
  const selected = accounts.filter((account) => (input.accountIds ? input.accountIds.includes(account.id) : isCashAccount(account) && !account.archived));
  const selectedIds = new Set(selected.map((account) => account.id));
  const balances = accountBalances(accounts, transactions);
  let balance = 0;
  for (const account of selected) balance += currencyToBase(balances.get(account.id) ?? 0, account.currency, ctx);
  const start = balance;

  const relevant = recurrings.filter((item) => !item.accountId || selectedIds.has(item.accountId));
  const end = addDays(today, days);
  const schedule = scheduleBetween(relevant, transactions, addDays(today, -35), end, today);
  const byDate = new Map<ISODate, ForecastEvent[]>();
  const events: ForecastEvent[] = [];
  for (const item of schedule) {
    if (item.state === 'paid' || item.state === 'skipped') continue;
    const overdue = item.state === 'overdue';
    // A late bill still has to be paid; late income may never come, so do not count on it.
    if (overdue && item.recurring.amount > 0) continue;
    const date = overdue ? today : item.date;
    const event: ForecastEvent = {
      date,
      label: item.recurring.name,
      amount: currencyToBase(item.recurring.amount, item.recurring.currency, ctx),
      recurringId: item.recurring.id,
      overdue,
    };
    events.push(event);
    const list = byDate.get(date);
    if (list) list.push(event);
    else byDate.set(date, [event]);
  }

  const everydayPerDay = everydaySpending ? everydaySpendingPerDay(transactions, ctx, today) : 0;
  const points: ForecastPoint[] = [];
  let low = { date: today, balance: Infinity };
  let firstNegative: ISODate | undefined;

  for (let offset = 0; offset <= days; offset += 1) {
    const date = addDays(today, offset);
    const dayEvents = byDate.get(date) ?? [];
    for (const event of dayEvents) balance += event.amount;
    if (offset > 0) balance -= everydayPerDay;
    points.push({ date, balance, events: dayEvents });
    if (balance < low.balance) low = { date, balance };
    if (balance < 0 && !firstNegative) firstNegative = date;
  }

  return { start, points, end: balance, low, firstNegative, everydayPerDay, events };
}
