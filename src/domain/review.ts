import { computeMonthBudget, spendingByDay, type BudgetRow } from './budget';
import { toBase, type Ctx } from './context';
import { addMonthsToKey, monthKey, monthLength, parts } from './dates';
import { cashflow } from './insights';
import { percentChange, type Change } from './money';
import { normalizePayee, type ActivityIndex } from './transactions';
import type { AppData, Category, ISODate, MonthKey, Transaction } from './types';

export interface ReviewCategory {
  category: Category;
  spent: number;
  previous: number;
  change: Change;
}

export interface ReviewMerchant {
  payee: string;
  total: number;
  count: number;
}

export interface MonthReview {
  month: MonthKey;
  /** False while the month is still running, so the screen can say "so far". */
  complete: boolean;
  /** Days of the month that have happened: all of them once it is over. */
  days: number;
  income: number;
  spent: number;
  /** Income minus spending. Negative when more went out than came in. */
  kept: number;
  /** Share of income that was kept, 0..1. Null without income to measure against. */
  savingsRate: number | null;
  previous: { income: number; spent: number; kept: number };
  spentChange: Change;
  categories: ReviewCategory[];
  /** The categories that moved most against the month before, either way. */
  movers: ReviewCategory[];
  biggest: { tx: Transaction; amount: number }[];
  merchants: ReviewMerchant[];
  /** Days on which nothing was spent. */
  quietDays: number;
  perDay: number;
  transactions: number;
  /** Null when no budget was set for the month. */
  budget: { budgeted: number; spent: number; within: number; over: BudgetRow[] } | null;
}

type ReviewInput = Pick<AppData, 'categories' | 'categoryGroups' | 'budgets' | 'settings' | 'transactions'>;

/**
 * One month looked back on: what came in, what went out, where it went, what
 * changed against the month before, and how the budget held up. Transfers
 * never count, and a purchase spread over several months counts by its share.
 */
export function monthReview(data: ReviewInput, index: ActivityIndex, ctx: Ctx, month: MonthKey, today: ISODate): MonthReview {
  const before = addMonthsToKey(month, -1);
  const [last, now] = cashflow(index, data.categories, [before, month]);
  const current = monthKey(today);
  const complete = month < current;
  const days = complete ? monthLength(month) : month === current ? parts(today).day : 0;

  const budget = computeMonthBudget(data, index, month);
  const earlier = computeMonthBudget(data, index, before);
  const rows = budget.groups.flatMap((group) => group.rows);
  const earlierSpent = new Map(earlier.groups.flatMap((group) => group.rows).map((row) => [row.category.id, row.spent]));
  const categories = rows
    .map((row) => {
      const previous = earlierSpent.get(row.category.id) ?? 0;
      return { category: row.category, spent: row.spent, previous, change: percentChange(row.spent, previous) };
    })
    .filter((row) => row.spent > 0 || row.previous > 0)
    .sort((a, b) => b.spent - a.spent);
  const movers = categories
    .filter((row) => row.spent !== row.previous)
    .sort((a, b) => Math.abs(b.spent - b.previous) - Math.abs(a.spent - a.previous))
    .slice(0, 3);

  const incomeIds = new Set(data.categories.filter((category) => category.kind === 'income').map((category) => category.id));
  const purchases = data.transactions.filter(
    (tx) => tx.kind !== 'transfer' && tx.amount < 0 && monthKey(tx.date) === month && !(tx.categoryId && incomeIds.has(tx.categoryId)),
  );
  const sized = purchases.map((tx) => ({ tx, amount: -toBase(tx.amount, tx.accountId, ctx) })).sort((a, b) => b.amount - a.amount);

  const byPayee = new Map<string, ReviewMerchant>();
  for (const { tx, amount } of sized) {
    const key = normalizePayee(tx.payee) || tx.payee;
    const entry = byPayee.get(key);
    if (entry) {
      entry.total += amount;
      entry.count += 1;
    } else byPayee.set(key, { payee: tx.payee, total: amount, count: 1 });
  }
  const merchants = [...byPayee.values()]
    .filter((item) => item.count > 1)
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, 3);

  const running = spendingByDay(data.transactions, month, ctx, incomeIds);
  let quietDays = 0;
  for (let day = 0; day < days; day += 1) if (running[day] - (running[day - 1] ?? 0) <= 0) quietDays += 1;

  const budgeted = rows.filter((row) => row.state !== 'unbudgeted');
  return {
    month,
    complete,
    days,
    income: now.income,
    spent: now.spent,
    kept: now.net,
    savingsRate: now.income > 0 ? now.net / now.income : null,
    previous: { income: last.income, spent: last.spent, kept: last.net },
    spentChange: percentChange(now.spent, last.spent),
    categories,
    movers,
    biggest: sized.slice(0, 3),
    merchants,
    quietDays,
    perDay: days > 0 ? Math.round(now.spent / days) : 0,
    transactions: purchases.length,
    budget:
      budget.totalBudgeted > 0
        ? {
            budgeted: budget.totalBudgeted,
            spent: budget.totalSpent,
            within: budgeted.filter((row) => row.state !== 'over').length,
            over: budgeted.filter((row) => row.state === 'over').sort((a, b) => a.available - b.available),
          }
        : null,
  };
}
