import { toBase, type Ctx } from './context';
import { addMonthsToKey, diffDays, monthKey } from './dates';
import { allocate, currencyDecimals, fromMinor, sum } from './money';
import type { Account, Category, ID, ISODate, MonthKey, Transaction, TransactionStatus } from './types';

export interface Part {
  categoryId: ID | null;
  amount: number;
}

/** The categorised pieces of a transaction: its splits, or the transaction itself. */
export function partsOf(tx: Transaction): Part[] {
  if (tx.splits && tx.splits.length > 0) {
    return tx.splits.map((split) => ({ categoryId: split.categoryId, amount: split.amount }));
  }
  return [{ categoryId: tx.categoryId, amount: tx.amount }];
}

/** Null when the splits are usable, otherwise a sentence explaining what is wrong. */
export function validateSplits(tx: Pick<Transaction, 'amount' | 'splits'>): string | null {
  if (!tx.splits || tx.splits.length === 0) return null;
  if (tx.splits.length < 2) return 'A split needs at least two parts.';
  if (tx.splits.some((split) => split.amount === 0)) return 'Every part needs an amount.';
  if (tx.splits.some((split) => Math.sign(split.amount) !== Math.sign(tx.amount))) {
    return 'Parts must go in the same direction as the transaction.';
  }
  const difference = tx.amount - sum(tx.splits.map((split) => split.amount));
  if (difference !== 0) return 'Parts must add up to the full amount.';
  return null;
}

export interface BudgetImpact {
  month: MonthKey;
  categoryId: ID | null;
  /** In the account's currency. */
  amount: number;
}

/**
 * Where a transaction lands in the budget. Transfers land nowhere; a spread
 * transaction lands in several months, with every cent accounted for.
 */
export function budgetImpacts(tx: Transaction): BudgetImpact[] {
  if (tx.kind === 'transfer') return [];
  const months = Math.max(1, Math.floor(tx.spreadMonths ?? 1));
  const first = monthKey(tx.date);
  const impacts: BudgetImpact[] = [];
  for (const part of partsOf(tx)) {
    if (months === 1) {
      impacts.push({ month: first, categoryId: part.categoryId, amount: part.amount });
      continue;
    }
    const shares = allocate(part.amount, new Array(months).fill(1));
    shares.forEach((amount, index) => {
      impacts.push({ month: addMonthsToKey(first, index), categoryId: part.categoryId, amount });
    });
  }
  return impacts;
}

/** Key for uncategorised money going out. */
export const UNCATEGORIZED = '';
/** Key for uncategorised money coming in, kept apart so it cannot cancel out spending. */
export const UNCATEGORIZED_INCOME = '+';

/** month -> category id (or one of the two keys above) -> signed total in the base currency. */
export type ActivityIndex = Map<MonthKey, Map<string, number>>;

export function buildActivityIndex(transactions: readonly Transaction[], ctx: Ctx): ActivityIndex {
  const index: ActivityIndex = new Map();
  for (const tx of transactions) {
    for (const impact of budgetImpacts(tx)) {
      let month = index.get(impact.month);
      if (!month) {
        month = new Map();
        index.set(impact.month, month);
      }
      const key = impact.categoryId ?? (impact.amount > 0 ? UNCATEGORIZED_INCOME : UNCATEGORIZED);
      month.set(key, (month.get(key) ?? 0) + toBase(impact.amount, tx.accountId, ctx));
    }
  }
  return index;
}

export function activityFor(index: ActivityIndex, month: MonthKey, key: string): number {
  return index.get(month)?.get(key) ?? 0;
}

export function normalizePayee(payee: string): string {
  return payee
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type TxType = 'expense' | 'income' | 'transfer';

export function typeOf(tx: Pick<Transaction, 'kind' | 'amount'>): TxType {
  if (tx.kind === 'transfer') return 'transfer';
  return tx.amount > 0 ? 'income' : 'expense';
}

export interface TxFilter {
  query?: string;
  accountIds?: ID[];
  /** Category ids; '' selects uncategorised transactions. */
  categoryIds?: string[];
  tags?: string[];
  from?: ISODate;
  to?: ISODate;
  status?: TransactionStatus;
  needsReview?: boolean;
  type?: TxType;
}

export interface FilterLookup {
  categories: readonly Category[];
  accounts: readonly Account[];
}

export function isFilterActive(filter: TxFilter): boolean {
  return Boolean(
    filter.query?.trim() ||
      filter.accountIds?.length ||
      filter.categoryIds?.length ||
      filter.tags?.length ||
      filter.from ||
      filter.to ||
      filter.status ||
      filter.needsReview ||
      filter.type,
  );
}

export function filterTransactions(
  transactions: readonly Transaction[],
  filter: TxFilter,
  lookup: FilterLookup,
): Transaction[] {
  const categoryName = new Map(lookup.categories.map((category) => [category.id, category.name.toLowerCase()]));
  const account = new Map(lookup.accounts.map((item) => [item.id, item]));
  const tokens = (filter.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const accountIds = filter.accountIds?.length ? new Set(filter.accountIds) : null;
  const categoryIds = filter.categoryIds?.length ? new Set(filter.categoryIds) : null;
  const tags = filter.tags?.length ? filter.tags.map((tag) => tag.toLowerCase()) : null;

  return transactions.filter((tx) => {
    if (accountIds && !accountIds.has(tx.accountId)) return false;
    if (filter.from && tx.date < filter.from) return false;
    if (filter.to && tx.date > filter.to) return false;
    if (filter.status && tx.status !== filter.status) return false;
    if (filter.needsReview && tx.reviewed) return false;
    if (filter.type && typeOf(tx) !== filter.type) return false;
    if (categoryIds) {
      if (tx.kind === 'transfer') return false;
      if (!partsOf(tx).some((part) => categoryIds.has(part.categoryId ?? UNCATEGORIZED))) return false;
    }
    if (tags) {
      const own = tx.tags.map((tag) => tag.toLowerCase());
      if (!tags.every((tag) => own.includes(tag))) return false;
    }
    if (tokens.length > 0) {
      const owner = account.get(tx.accountId);
      const amount = owner ? fromMinor(Math.abs(tx.amount), owner.currency).toFixed(currencyDecimals(owner.currency)) : '';
      const haystack = [
        tx.payee,
        tx.rawPayee ?? '',
        tx.notes ?? '',
        tx.tags.map((tag) => `#${tag}`).join(' '),
        tx.kind === 'transfer'
          ? ''
          : partsOf(tx)
              .map((part) => (part.categoryId ? (categoryName.get(part.categoryId) ?? '') : 'uncategorized'))
              .join(' '),
        owner?.name ?? '',
        amount,
        tx.kind === 'transfer' ? 'transfer' : '',
        tx.status,
      ]
        .join(' ')
        .toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) return false;
    }
    return true;
  });
}

/** Newest first; within a day, the most recently entered first. */
export function sortNewestFirst(transactions: readonly Transaction[]): Transaction[] {
  return [...transactions].sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)),
  );
}

export interface DayGroup {
  date: ISODate;
  items: Transaction[];
  /** Net of the day in the base currency, ignoring transfers. */
  total: number;
}

export function groupByDay(transactions: readonly Transaction[], ctx: Ctx): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const tx of sortNewestFirst(transactions)) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== tx.date) {
      group = { date: tx.date, items: [], total: 0 };
      groups.push(group);
    }
    group.items.push(tx);
    if (tx.kind !== 'transfer') group.total += toBase(tx.amount, tx.accountId, ctx);
  }
  return groups;
}

export interface Totals {
  count: number;
  /** Positive number: money spent, net of refunds. */
  spent: number;
  income: number;
  net: number;
}

/** Totals in the base currency, ignoring transfers. */
export function totalsOf(transactions: readonly Transaction[], ctx: Ctx): Totals {
  let spent = 0;
  let income = 0;
  for (const tx of transactions) {
    if (tx.kind === 'transfer') continue;
    const amount = toBase(tx.amount, tx.accountId, ctx);
    if (amount < 0) spent -= amount;
    else income += amount;
  }
  return { count: transactions.length, spent, income, net: income - spent };
}

export type DuplicateKind = 'exact' | 'likely' | null;

type Fingerprintable = Pick<Transaction, 'accountId' | 'date' | 'amount' | 'payee'> & { rawPayee?: string };

function fingerprint(tx: Fingerprintable): string {
  return `${tx.accountId}|${tx.date}|${tx.amount}|${normalizePayee(tx.rawPayee ?? tx.payee)}`;
}

/**
 * Flag incoming rows that are already in the ledger.
 *
 * "exact" means same account, date, amount and descriptor. Counting is
 * respected, so two genuine identical coffees on one day are both kept when
 * only one is on file. "likely" catches the same charge re-exported with a
 * shifted date, which is how a pending charge usually reappears once it posts.
 */
export function findDuplicates(incoming: readonly Fingerprintable[], existing: readonly Transaction[]): DuplicateKind[] {
  const available = new Map<string, number>();
  for (const tx of existing) {
    const key = fingerprint(tx);
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  const byAmount = new Map<string, Transaction[]>();
  for (const tx of existing) {
    const key = `${tx.accountId}|${tx.amount}`;
    const list = byAmount.get(key);
    if (list) list.push(tx);
    else byAmount.set(key, [tx]);
  }
  const claimed = new Set<ID>();

  const result: DuplicateKind[] = incoming.map((tx) => {
    const key = fingerprint(tx);
    const left = available.get(key) ?? 0;
    if (left > 0) {
      available.set(key, left - 1);
      return 'exact';
    }
    return null;
  });

  incoming.forEach((tx, index) => {
    if (result[index]) return;
    const candidates = byAmount.get(`${tx.accountId}|${tx.amount}`) ?? [];
    const name = normalizePayee(tx.rawPayee ?? tx.payee);
    const match = candidates.find((candidate) => {
      if (claimed.has(candidate.id)) return false;
      const gap = Math.abs(diffDays(candidate.date, tx.date));
      if (gap === 0 || gap > 3) return false;
      const other = normalizePayee(candidate.rawPayee ?? candidate.payee);
      return other === name || (name.length >= 4 && (other.includes(name) || name.includes(other)) && other.length >= 4);
    });
    if (match) {
      claimed.add(match.id);
      result[index] = 'likely';
    }
  });
  return result;
}

/** Every tag in use, most used first. */
export function allTags(transactions: readonly Transaction[]): string[] {
  const counts = new Map<string, number>();
  for (const tx of transactions) for (const tag of tx.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

/** "Trip 2026, work" -> ["trip-2026", "work"]. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(/[,\n]/)) {
    const tag = raw.trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
    if (tag) seen.add(tag);
  }
  return [...seen];
}
