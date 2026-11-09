import { toBase, type Ctx } from './context';
import { addMonthsToKey, monthKey, monthLength, monthRange, parts } from './dates';
import {
  activityFor,
  budgetImpacts,
  UNCATEGORIZED,
  UNCATEGORIZED_INCOME,
  type ActivityIndex,
} from './transactions';
import type {
  AppData,
  BudgetEntry,
  BudgetMode,
  Category,
  CategoryGroup,
  ID,
  MonthKey,
  Transaction,
} from './types';

/** The budget in force for `month`: the latest entry that starts on or before it. */
export function budgetAmountFor(entries: readonly BudgetEntry[] | undefined, month: MonthKey): number {
  if (!entries) return 0;
  let amount = 0;
  let best = '';
  for (const entry of entries) {
    if (entry.from <= month && entry.from >= best) {
      best = entry.from;
      amount = entry.amount;
    }
  }
  return amount;
}

function normalise(entries: BudgetEntry[]): BudgetEntry[] {
  const sorted = [...entries].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const result: BudgetEntry[] = [];
  let previous = 0;
  for (const entry of sorted) {
    if (entry.amount === previous) continue;
    result.push(entry);
    previous = entry.amount;
  }
  return result;
}

/**
 * Change a budget without rewriting history. Months before `month` always keep
 * the amounts they had.
 *
 * - 'month'   changes this month only; later months keep what they had.
 * - 'forward' changes this month and every month after it.
 */
export function setBudgetAmount(
  entries: readonly BudgetEntry[] | undefined,
  month: MonthKey,
  amount: number,
  scope: 'month' | 'forward',
): BudgetEntry[] {
  const current = entries ?? [];
  const value = Math.max(0, Math.round(amount));
  const next = addMonthsToKey(month, 1);
  const earlier = current.filter((entry) => entry.from < month);

  if (scope === 'forward') {
    return normalise([...earlier, { from: month, amount: value }]);
  }
  const later = current.filter((entry) => entry.from > month);
  const restored = later.some((entry) => entry.from === next)
    ? later
    : [...later, { from: next, amount: budgetAmountFor(current, next) }];
  return normalise([...earlier, { from: month, amount: value }, ...restored]);
}

export type BudgetState = 'unbudgeted' | 'ok' | 'near' | 'over';

export interface BudgetRow {
  category: Category;
  budgeted: number;
  /** Money spent, net of refunds. Can be negative when refunds exceed spending. */
  spent: number;
  /** Leftover (or overspend, when negative) carried in from earlier months. */
  carryIn: number;
  /** budgeted + carryIn - spent */
  available: number;
  state: BudgetState;
}

export interface BudgetGroup {
  group: CategoryGroup;
  rows: BudgetRow[];
  budgeted: number;
  spent: number;
  available: number;
}

export interface IncomeRow {
  category: Category;
  expected: number;
  received: number;
}

export interface MonthBudget {
  month: MonthKey;
  mode: BudgetMode;
  groups: BudgetGroup[];
  income: IncomeRow[];
  totalBudgeted: number;
  /** All spending this month, including uncategorised and unbudgeted categories. */
  totalSpent: number;
  /** Sum of what is left across budgeted categories, carry-over included. */
  totalAvailable: number;
  uncategorizedSpent: number;
  incomeExpected: number;
  incomeReceived: number;
  /** Income the plan is built on: the expected figure if one is set, else what arrived. */
  incomeForPlan: number;
  /** Zero-based view: income not yet given a job. Negative means over-assigned. */
  leftToAssign: number;
}

function stateOf(budgetedWithCarry: number, spent: number, hasBudget: boolean): BudgetState {
  if (!hasBudget) return 'unbudgeted';
  if (spent > budgetedWithCarry) return 'over';
  if (budgetedWithCarry > 0 && spent >= budgetedWithCarry * 0.85) return 'near';
  return 'ok';
}

/** Leftover carried into `month` for a rollover category. */
export function carryInFor(
  category: Pick<Category, 'id' | 'rollover' | 'rolloverFrom'>,
  entries: readonly BudgetEntry[] | undefined,
  index: ActivityIndex,
  month: MonthKey,
): number {
  if (!category.rollover || !category.rolloverFrom || category.rolloverFrom >= month) return 0;
  let carry = 0;
  for (const past of monthRange(category.rolloverFrom, addMonthsToKey(month, -1))) {
    carry += budgetAmountFor(entries, past) + activityFor(index, past, category.id);
  }
  return carry;
}

type BudgetInput = Pick<AppData, 'categories' | 'categoryGroups' | 'budgets' | 'settings'>;

export function computeMonthBudget(data: BudgetInput, index: ActivityIndex, month: MonthKey): MonthBudget {
  const groups: BudgetGroup[] = [];
  const income: IncomeRow[] = [];
  const sortedGroups = [...data.categoryGroups].sort((a, b) => a.sort - b.sort);
  const byGroup = new Map<ID, Category[]>();
  for (const category of [...data.categories].sort((a, b) => a.sort - b.sort)) {
    const list = byGroup.get(category.groupId);
    if (list) list.push(category);
    else byGroup.set(category.groupId, [category]);
  }

  let totalBudgeted = 0;
  let totalSpent = 0;
  let totalAvailable = 0;
  let incomeExpected = 0;
  let incomeReceived = 0;

  for (const group of sortedGroups) {
    const categories = byGroup.get(group.id) ?? [];
    if (group.kind === 'income') {
      for (const category of categories) {
        const expected = budgetAmountFor(data.budgets[category.id], month);
        const received = activityFor(index, month, category.id);
        if (category.archived && expected === 0 && received === 0) continue;
        income.push({ category, expected, received });
        incomeExpected += expected;
        incomeReceived += received;
      }
      continue;
    }

    const rows: BudgetRow[] = [];
    for (const category of categories) {
      const entries = data.budgets[category.id];
      const budgeted = budgetAmountFor(entries, month);
      const spent = 0 - activityFor(index, month, category.id); // not unary minus: that yields -0
      const carryIn = carryInFor(category, entries, index, month);
      if (category.archived && budgeted === 0 && spent === 0 && carryIn === 0) continue;
      const hasBudget = budgeted > 0 || carryIn !== 0;
      rows.push({
        category,
        budgeted,
        spent,
        carryIn,
        available: budgeted + carryIn - spent,
        state: stateOf(budgeted + carryIn, spent, hasBudget),
      });
    }
    const budgeted = rows.reduce((total, row) => total + row.budgeted, 0);
    const spent = rows.reduce((total, row) => total + row.spent, 0);
    const available = rows.reduce((total, row) => total + (row.state === 'unbudgeted' ? 0 : row.available), 0);
    groups.push({ group, rows, budgeted, spent, available });
    totalBudgeted += budgeted;
    totalSpent += spent;
    totalAvailable += available;
  }

  const uncategorizedSpent = 0 - activityFor(index, month, UNCATEGORIZED);
  totalSpent += uncategorizedSpent;
  incomeReceived += activityFor(index, month, UNCATEGORIZED_INCOME);

  const incomeForPlan = incomeExpected > 0 ? incomeExpected : incomeReceived;
  return {
    month,
    mode: data.settings.budgetMode,
    groups,
    income,
    totalBudgeted,
    totalSpent,
    totalAvailable,
    uncategorizedSpent,
    incomeExpected,
    incomeReceived,
    incomeForPlan,
    leftToAssign: incomeForPlan - totalBudgeted,
  };
}

/**
 * Cumulative spending for each day of `month` (index 0 = the 1st), in the base
 * currency. A share of a spread purchase from an earlier month counts on the 1st.
 */
export function spendingByDay(
  transactions: readonly Transaction[],
  month: MonthKey,
  ctx: Ctx,
  incomeCategoryIds: ReadonlySet<ID>,
): number[] {
  const days = new Array<number>(monthLength(month)).fill(0);
  for (const tx of transactions) {
    for (const impact of budgetImpacts(tx)) {
      if (impact.month !== month) continue;
      if (impact.categoryId ? incomeCategoryIds.has(impact.categoryId) : impact.amount > 0) continue;
      const day = monthKey(tx.date) === month ? parts(tx.date).day : 1;
      days[day - 1] -= toBase(impact.amount, tx.accountId, ctx);
    }
  }
  let running = 0;
  return days.map((value) => (running += value));
}
