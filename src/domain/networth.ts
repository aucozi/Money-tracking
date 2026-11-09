import { currencyToBase, type Ctx } from './context';
import { monthEnd } from './dates';
import type { Account, ID, ISODate, MonthKey, Transaction } from './types';

export interface BalanceOptions {
  /** Only count transactions on or before this date. */
  asOf?: ISODate;
  /** Pending transactions count by default, so the balance shows what is really left. */
  includePending?: boolean;
}

/** Balance of every account, in its own currency. */
export function accountBalances(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  options: BalanceOptions = {},
): Map<ID, number> {
  const { asOf, includePending = true } = options;
  const balances = new Map<ID, number>();
  for (const account of accounts) {
    // Before it was opened an account simply did not exist.
    balances.set(account.id, asOf && asOf < account.openingDate ? 0 : account.openingBalance);
  }
  const opened = new Map(accounts.map((account) => [account.id, account.openingDate]));
  for (const tx of transactions) {
    if (!balances.has(tx.accountId)) continue;
    if (asOf) {
      if (tx.date > asOf) continue;
      if (asOf < (opened.get(tx.accountId) ?? '')) continue;
    }
    if (!includePending && tx.status === 'pending') continue;
    balances.set(tx.accountId, (balances.get(tx.accountId) ?? 0) + tx.amount);
  }
  return balances;
}

export interface NetWorth {
  /** In the base currency. */
  assets: number;
  /** Positive number: what is owed. */
  liabilities: number;
  net: number;
}

export function netWorth(accounts: readonly Account[], balances: ReadonlyMap<ID, number>, ctx: Ctx): NetWorth {
  let assets = 0;
  let liabilities = 0;
  for (const account of accounts) {
    if (account.archived || !account.includeInNetWorth) continue;
    const value = currencyToBase(balances.get(account.id) ?? 0, account.currency, ctx);
    // Decided by the sign, not the account type: an overdrawn current account
    // is a debt, and a credit card that is in credit is an asset.
    if (value < 0) liabilities -= value;
    else assets += value;
  }
  return { assets, liabilities, net: assets - liabilities };
}

export interface NetWorthPoint extends NetWorth {
  month: MonthKey;
  date: ISODate;
}

/** Net worth at the end of each month; the current month is measured as of today. */
export function netWorthHistory(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  ctx: Ctx,
  months: readonly MonthKey[],
  today: ISODate,
): NetWorthPoint[] {
  return months.map((month) => {
    const end = monthEnd(month);
    const date = end > today ? today : end;
    const balances = accountBalances(accounts, transactions, { asOf: date });
    return { month, date, ...netWorth(accounts, balances, ctx) };
  });
}

/**
 * The opening balance that makes an account's current balance equal `target`.
 * Used to reconcile against a statement without inventing a transaction.
 */
export function openingBalanceFor(account: Account, currentBalance: number, target: number): number {
  return account.openingBalance + (target - currentBalance);
}
