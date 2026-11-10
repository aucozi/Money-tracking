import { currencyToBase, type Ctx } from './context';
import { diffDays, monthKey, monthsBetween, parts } from './dates';
import type { Account, Goal, ID, ISODate } from './types';

export type GoalState = 'done' | 'on-track' | 'behind' | 'open';

export interface GoalProgress {
  saved: number;
  target: number;
  remaining: number;
  /** 0..1 */
  fraction: number;
  /** Whole months until the target date (at least 1 while it is in the future). */
  monthsLeft: number | null;
  /** What to put aside each month to arrive on time. */
  monthlyNeeded: number | null;
  state: GoalState;
}

export function goalProgress(goal: Goal, accounts: readonly Account[], balances: ReadonlyMap<ID, number>, ctx: Ctx, today: ISODate): GoalProgress {
  const linked = goal.accountId ? accounts.find((account) => account.id === goal.accountId) : undefined;
  const saved = linked
    ? Math.max(0, currencyToBase(balances.get(linked.id) ?? 0, linked.currency, ctx))
    : goal.contributions.reduce((total, item) => total + item.amount, 0);
  const target = Math.max(0, goal.targetAmount);
  const remaining = Math.max(0, target - saved);
  const fraction = target > 0 ? Math.min(1, Math.max(0, saved / target)) : 0;

  if (remaining === 0 && target > 0) {
    return { saved, target, remaining, fraction: 1, monthsLeft: null, monthlyNeeded: null, state: 'done' };
  }
  if (!goal.targetDate) {
    return { saved, target, remaining, fraction, monthsLeft: null, monthlyNeeded: null, state: 'open' };
  }

  const daysLeft = diffDays(today, goal.targetDate);
  // Count the monthly contributions that still fit before the target date.
  const calendarMonths = monthsBetween(monthKey(today), monthKey(goal.targetDate)) + (parts(goal.targetDate).day >= parts(today).day ? 1 : 0);
  const monthsLeft = daysLeft <= 0 ? 0 : Math.max(1, calendarMonths);
  const monthlyNeeded = Math.ceil(remaining / Math.max(1, monthsLeft));

  // On track means at least as far along as a straight line from start to target date.
  const total = Math.max(1, diffDays(goal.createdDate, goal.targetDate));
  const elapsed = Math.min(total, Math.max(0, diffDays(goal.createdDate, today)));
  const expected = target * (elapsed / total);
  const state: GoalState = daysLeft <= 0 || saved < expected * 0.95 ? 'behind' : 'on-track';

  return { saved, target, remaining, fraction, monthsLeft, monthlyNeeded, state };
}
