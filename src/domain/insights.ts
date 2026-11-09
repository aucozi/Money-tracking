import { currencyToBase, type Ctx } from './context';
import { diffDays, monthEnd, monthKey, monthLength, parts } from './dates';
import type { MonthBudget, BudgetRow } from './budget';
import { percentChange, type Change } from './money';
import type { Occurrence } from './recurring';
import { UNCATEGORIZED, UNCATEGORIZED_INCOME, type ActivityIndex } from './transactions';
import type { Category, ISODate, MonthKey } from './types';

export interface CashflowMonth {
  month: MonthKey;
  income: number;
  spent: number;
  net: number;
}

/** Income, spending and what was left over for each month. Transfers never count. */
export function cashflow(index: ActivityIndex, categories: readonly Category[], months: readonly MonthKey[]): CashflowMonth[] {
  const kind = new Map(categories.map((category) => [category.id, category.kind]));
  return months.map((month) => {
    let income = 0;
    let spent = 0;
    for (const [key, value] of index.get(month) ?? []) {
      if (key === UNCATEGORIZED) spent -= value;
      else if (key === UNCATEGORIZED_INCOME) income += value;
      else if (kind.get(key) === 'income') income += value;
      else spent -= value;
    }
    return { month, income, spent, net: income - spent };
  });
}

/** Categories with the most spending this month, largest first. */
export function topCategories(budget: MonthBudget, limit = 5): BudgetRow[] {
  return budget.groups
    .flatMap((group) => group.rows)
    .filter((row) => row.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, limit);
}

export interface FreeToSpend {
  /** Budget left after spending so far and bills still to come this month. */
  amount: number;
  perDay: number;
  daysLeft: number;
  billsDue: number;
}

/**
 * What can still be spent this month without breaking the budget: the budget,
 * minus what is already spent, minus bills that are due before month end and
 * not yet paid. Null when there is no budget to measure against.
 */
export function freeToSpend(
  budget: MonthBudget,
  schedule: readonly Occurrence[],
  ctx: Ctx,
  today: ISODate,
): FreeToSpend | null {
  if (budget.totalBudgeted <= 0 || monthKey(today) !== budget.month) return null;
  const end = monthEnd(budget.month);
  let billsDue = 0;
  for (const item of schedule) {
    if (item.recurring.amount >= 0) continue;
    if (item.state === 'paid' || item.state === 'skipped') continue;
    if (item.date > end) continue;
    billsDue -= currencyToBase(item.recurring.amount, item.recurring.currency, ctx);
  }
  const daysLeft = diffDays(today, end) + 1;
  const amount = budget.totalBudgeted - budget.totalSpent - billsDue;
  return { amount, perDay: Math.trunc(amount / Math.max(1, daysLeft)), daysLeft, billsDue };
}

export interface Pace {
  /** Spending so far this month. */
  spent: number;
  /** Spending by the same day last month. */
  lastMonthToDate: number;
  change: Change;
  /** Where spending would be today if the budget were used evenly. */
  expectedByNow: number | null;
}

export function pace(
  thisMonth: readonly number[],
  lastMonth: readonly number[],
  budgeted: number,
  today: ISODate,
  month: MonthKey,
): Pace {
  const isCurrent = monthKey(today) === month;
  const day = isCurrent ? parts(today).day : thisMonth.length;
  const spent = thisMonth[Math.min(day, thisMonth.length) - 1] ?? 0;
  const lastMonthToDate = lastMonth[Math.min(day, lastMonth.length) - 1] ?? 0;
  return {
    spent,
    lastMonthToDate,
    change: percentChange(spent, lastMonthToDate),
    expectedByNow: budgeted > 0 ? Math.round((budgeted * day) / monthLength(month)) : null,
  };
}
