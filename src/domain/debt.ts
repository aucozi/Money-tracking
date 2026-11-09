import { currencyToBase, type Ctx } from './context';
import { isLiability, type Account, type ID } from './types';

export interface Debt {
  id: ID;
  name: string;
  /** Amount owed, as a positive number of minor units. */
  balance: number;
  /** Annual rate in percent. */
  apr: number;
  minPayment: number;
}

export type Strategy = 'avalanche' | 'snowball';

export interface PayoffStep {
  id: ID;
  name: string;
  /** Month number (1 = next month) in which this debt reaches zero. */
  month: number;
  interest: number;
}

export interface PayoffPlan {
  strategy: Strategy;
  /** False when the payments never clear the debt (they do not cover the interest). */
  feasible: boolean;
  months: number;
  totalInterest: number;
  totalPaid: number;
  /** Debts in the order they are paid off. */
  order: PayoffStep[];
  /** Total owed at the end of each month; index 0 is today. */
  timeline: number[];
  monthlyPayment: number;
}

const MAX_MONTHS = 1200;

function priority(strategy: Strategy) {
  return (a: Debt, b: Debt) =>
    strategy === 'avalanche'
      ? b.apr - a.apr || a.balance - b.balance || a.name.localeCompare(b.name)
      : a.balance - b.balance || b.apr - a.apr || a.name.localeCompare(b.name);
}

/**
 * Simulate paying off debts month by month.
 *
 * Every month each debt accrues interest and receives its minimum payment.
 * Whatever is left of the monthly budget (the extra, plus the minimums of debts
 * already cleared) goes to one target debt: the highest rate for "avalanche",
 * the smallest balance for "snowball".
 */
export function payoffPlan(debts: readonly Debt[], extraMonthly: number, strategy: Strategy): PayoffPlan {
  const open = debts.filter((debt) => debt.balance > 0).map((debt) => ({ ...debt, interest: 0 }));
  const monthlyPayment = open.reduce((total, debt) => total + Math.max(0, debt.minPayment), 0) + Math.max(0, extraMonthly);
  const startTotal = open.reduce((total, debt) => total + debt.balance, 0);
  const plan: PayoffPlan = {
    strategy,
    feasible: true,
    months: 0,
    totalInterest: 0,
    totalPaid: 0,
    order: [],
    timeline: [startTotal],
    monthlyPayment,
  };
  if (open.length === 0) return plan;

  const rank = priority(strategy);
  for (let month = 1; month <= MAX_MONTHS; month += 1) {
    const active = open.filter((debt) => debt.balance > 0);
    if (active.length === 0) break;

    let interestThisMonth = 0;
    for (const debt of active) {
      const interest = Math.round((debt.balance * debt.apr) / 1200);
      debt.balance += interest;
      debt.interest += interest;
      interestThisMonth += interest;
    }
    if (monthlyPayment <= interestThisMonth) {
      plan.feasible = false;
      break;
    }

    let budget = monthlyPayment;
    for (const debt of active) {
      const payment = Math.min(debt.balance, Math.max(0, debt.minPayment), budget);
      debt.balance -= payment;
      budget -= payment;
      plan.totalPaid += payment;
    }
    for (const debt of [...active].sort(rank)) {
      if (budget <= 0) break;
      const payment = Math.min(debt.balance, budget);
      debt.balance -= payment;
      budget -= payment;
      plan.totalPaid += payment;
    }

    plan.totalInterest += interestThisMonth;
    plan.months = month;
    for (const debt of active) {
      if (debt.balance === 0) plan.order.push({ id: debt.id, name: debt.name, month, interest: debt.interest });
    }
    plan.timeline.push(open.reduce((total, debt) => total + debt.balance, 0));
  }

  if (open.some((debt) => debt.balance > 0)) plan.feasible = false;
  return plan;
}

/** Debts taken from credit and loan accounts that currently carry a balance, in the base currency. */
export function debtsFromAccounts(accounts: readonly Account[], balances: ReadonlyMap<ID, number>, ctx: Ctx): Debt[] {
  const debts: Debt[] = [];
  for (const account of accounts) {
    if (account.archived || !isLiability(account)) continue;
    const balance = balances.get(account.id) ?? 0;
    if (balance >= 0) continue;
    debts.push({
      id: account.id,
      name: account.name,
      balance: currencyToBase(-balance, account.currency, ctx),
      apr: account.apr ?? 0,
      minPayment: currencyToBase(account.minPayment ?? 0, account.currency, ctx),
    });
  }
  return debts;
}
