import { currencyToBase, type Ctx } from './context';
import { diffDays } from './dates';
import { monthlyEquivalent, nextOccurrence } from './recurring';
import type { Account, ID, ISODate, Recurring, Transaction } from './types';

/** A price that was steady and then moved. Amounts are positive, in the item's own currency. */
export interface PriceChange {
  from: number;
  to: number;
  date: ISODate;
  /** Extra cost over a year at the new price, in the item's currency. Negative when it got cheaper. */
  perYear: number;
}

export interface Subscription {
  recurring: Recurring;
  /** What it costs per month and per year, as positive amounts in the base currency. */
  monthly: number;
  yearly: number;
  next: ISODate | null;
  /** The most recent payment matched to it, as a positive amount in the account's currency. */
  lastPaid?: { date: ISODate; amount: number };
  payments: number;
  change?: PriceChange;
}

export interface SubscriptionSummary {
  /** Most expensive per month first. */
  items: Subscription[];
  monthly: number;
  yearly: number;
  /** Items whose price went up and has not been acknowledged yet. */
  increases: Subscription[];
}

const PER_YEAR: Record<Recurring['frequency'], number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };

/** How long after a changed payment it is still worth pointing out. */
const NEWS_DAYS = 45;

/**
 * The price change to point out for one item, if any. Bills that differ every
 * time (energy, a phone with roaming) are left alone: a change only counts
 * when the price before it had held, and it stops being reported once the
 * tracked amount is brought in line with the new price.
 */
export function priceChange(recurring: Recurring, payments: readonly { date: ISODate; amount: number }[], today: ISODate): PriceChange | undefined {
  if (payments.length < 2) return undefined;
  const last = payments[payments.length - 1];
  const before = payments[payments.length - 2];
  const earlier = payments[payments.length - 3];
  if (earlier && earlier.amount !== before.amount) return undefined;
  if (last.amount === before.amount || last.amount === Math.abs(recurring.amount)) return undefined;
  // Under one percent is rounding or an exchange-rate wobble, not a new price.
  if (Math.abs(last.amount - before.amount) * 100 < before.amount) return undefined;
  if (diffDays(last.date, today) > NEWS_DAYS) return undefined;
  return { from: before.amount, to: last.amount, date: last.date, perYear: (last.amount - before.amount) * PER_YEAR[recurring.frequency] };
}

/**
 * Everything paid on a schedule: what each item costs per month and per year,
 * when it was last paid, and whether its price has just changed.
 */
export function subscriptions(
  recurrings: readonly Recurring[],
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  ctx: Ctx,
  today: ISODate,
): SubscriptionSummary {
  const currency = new Map(accounts.map((account) => [account.id, account.currency]));
  const paid = new Map<ID, { date: ISODate; amount: number }[]>();
  for (const tx of transactions) {
    if (!tx.recurringId || tx.kind === 'transfer' || tx.amount >= 0) continue;
    const list = paid.get(tx.recurringId) ?? [];
    list.push({ date: tx.date, amount: -tx.amount });
    paid.set(tx.recurringId, list);
  }
  const accountOf = new Map<ID, ID>();
  for (const tx of transactions) if (tx.recurringId) accountOf.set(tx.recurringId, tx.accountId);

  const items: Subscription[] = [];
  for (const recurring of recurrings) {
    if (recurring.status !== 'active' || recurring.amount >= 0) continue;
    const payments = (paid.get(recurring.id) ?? []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const monthly = -currencyToBase(monthlyEquivalent(recurring), recurring.currency, ctx);
    const yearly = -currencyToBase(recurring.amount * PER_YEAR[recurring.frequency], recurring.currency, ctx);
    // Prices are only compared when the payments are in the currency the item is tracked in.
    const comparable = currency.get(accountOf.get(recurring.id) ?? '') === recurring.currency;
    items.push({
      recurring,
      monthly,
      yearly,
      next: nextOccurrence(recurring, today),
      lastPaid: payments[payments.length - 1],
      payments: payments.length,
      change: comparable ? priceChange(recurring, payments, today) : undefined,
    });
  }
  items.sort((a, b) => b.monthly - a.monthly || a.recurring.name.localeCompare(b.recurring.name));
  return {
    items,
    monthly: items.reduce((total, item) => total + item.monthly, 0),
    yearly: items.reduce((total, item) => total + item.yearly, 0),
    increases: items.filter((item) => item.change && item.change.to > item.change.from),
  };
}
