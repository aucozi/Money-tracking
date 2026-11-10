import { account, category, ctx, tx } from '@/test/factories';
import { budgetAmountFor, carryInFor, computeMonthBudget, setBudgetAmount, spendingByDay, suggestBudgets } from '../budget';
import { buildActivityIndex } from '../transactions';
import type { AppData, BudgetEntry, Category, CategoryGroup, Transaction } from '../types';

describe('budgetAmountFor', () => {
  const entries: BudgetEntry[] = [
    { from: '2026-03', amount: 300 },
    { from: '2026-01', amount: 200 },
    { from: '2026-06', amount: 0 },
  ];

  it('uses the latest entry that has started', () => {
    expect(budgetAmountFor(entries, '2025-12')).toBe(0);
    expect(budgetAmountFor(entries, '2026-01')).toBe(200);
    expect(budgetAmountFor(entries, '2026-02')).toBe(200);
    expect(budgetAmountFor(entries, '2026-03')).toBe(300);
    expect(budgetAmountFor(entries, '2026-05')).toBe(300);
    expect(budgetAmountFor(entries, '2026-07')).toBe(0);
    expect(budgetAmountFor(undefined, '2026-07')).toBe(0);
  });
});

describe('setBudgetAmount', () => {
  const original: BudgetEntry[] = [{ from: '2026-01', amount: 200 }];
  const amounts = (entries: BudgetEntry[], months: string[]) => months.map((month) => budgetAmountFor(entries, month));
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

  it('changes this month and everything after it, never the past', () => {
    const next = setBudgetAmount(original, '2026-03', 350, 'forward');
    expect(amounts(next, months)).toEqual([200, 200, 350, 350, 350]);
  });

  it('changes one month only', () => {
    const next = setBudgetAmount(original, '2026-03', 350, 'month');
    expect(amounts(next, months)).toEqual([200, 200, 350, 200, 200]);
  });

  it('keeps later one-off months when changing a single month', () => {
    const withLater = setBudgetAmount(original, '2026-04', 500, 'month');
    const next = setBudgetAmount(withLater, '2026-03', 350, 'month');
    expect(amounts(next, months)).toEqual([200, 200, 350, 500, 200]);
  });

  it('replaces later changes when changing going forward', () => {
    const withLater = setBudgetAmount(original, '2026-04', 500, 'month');
    const next = setBudgetAmount(withLater, '2026-02', 100, 'forward');
    expect(amounts(next, months)).toEqual([200, 100, 100, 100, 100]);
  });

  it('creates a first budget without back-dating it', () => {
    const next = setBudgetAmount(undefined, '2026-03', 400, 'forward');
    expect(amounts(next, months)).toEqual([0, 0, 400, 400, 400]);
    expect(amounts(setBudgetAmount(undefined, '2026-03', 400, 'month'), months)).toEqual([0, 0, 400, 0, 0]);
  });

  it('stores nothing redundant and never a negative budget', () => {
    expect(setBudgetAmount(original, '2026-03', 200, 'forward')).toEqual(original);
    expect(setBudgetAmount(original, '2026-03', 200, 'month')).toEqual(original);
    expect(setBudgetAmount(undefined, '2026-03', 0, 'forward')).toEqual([]);
    expect(budgetAmountFor(setBudgetAmount(original, '2026-03', -50, 'forward'), '2026-03')).toBe(0);
  });

  it('does not mutate its input', () => {
    const frozen = Object.freeze([...original]) as readonly BudgetEntry[];
    expect(() => setBudgetAmount(frozen, '2026-03', 1, 'month')).not.toThrow();
    expect(original).toEqual([{ from: '2026-01', amount: 200 }]);
  });
});

function fixture(overrides: {
  categories?: Category[];
  transactions?: Transaction[];
  budgets?: AppData['budgets'];
  mode?: 'tracking' | 'zero';
}) {
  const groups: CategoryGroup[] = [
    { id: 'need', name: 'Essentials', kind: 'expense', sort: 0 },
    { id: 'want', name: 'Lifestyle', kind: 'expense', sort: 1 },
    { id: 'inc', name: 'Income', kind: 'income', sort: 2 },
  ];
  const categories = overrides.categories ?? [
    category({ id: 'food', name: 'Groceries', groupId: 'need', sort: 0 }),
    category({ id: 'rent', name: 'Rent', groupId: 'need', sort: 1 }),
    category({ id: 'fun', name: 'Fun', groupId: 'want', sort: 2 }),
    category({ id: 'pay', name: 'Salary', groupId: 'inc', kind: 'income', sort: 3 }),
  ];
  const data = {
    categoryGroups: groups,
    categories,
    budgets: overrides.budgets ?? {},
    settings: {
      baseCurrency: 'EUR',
      rates: {},
      budgetMode: overrides.mode ?? 'tracking',
      theme: 'system' as const,
      onboarded: true,
      forecastEverydaySpending: true,
    },
  };
  const index = buildActivityIndex(overrides.transactions ?? [], ctx([account({ id: 'acc' })]));
  return { data, index };
}

describe('computeMonthBudget', () => {
  it('reports budgeted, spent and available per category and in total', () => {
    const { data, index } = fixture({
      budgets: { food: [{ from: '2026-01', amount: 40000 }], rent: [{ from: '2026-01', amount: 90000 }] },
      transactions: [
        tx({ date: '2026-03-02', amount: -90000, categoryId: 'rent' }),
        tx({ date: '2026-03-05', amount: -12000, categoryId: 'food' }),
        tx({ date: '2026-03-06', amount: 2000, categoryId: 'food' }),
        tx({ date: '2026-03-08', amount: -3000, categoryId: 'fun' }),
        tx({ date: '2026-03-09', amount: -700, categoryId: null }),
        tx({ date: '2026-03-10', amount: -5000, kind: 'transfer' }),
        tx({ date: '2026-02-10', amount: -99999, categoryId: 'food' }),
      ],
    });
    const budget = computeMonthBudget(data, index, '2026-03');
    const food = budget.groups[0].rows.find((row) => row.category.id === 'food')!;
    expect(food).toMatchObject({ budgeted: 40000, spent: 10000, carryIn: 0, available: 30000, state: 'ok' });
    expect(budget.groups[0]).toMatchObject({ budgeted: 130000, spent: 100000, available: 30000 });
    expect(budget.groups[1].rows[0]).toMatchObject({ budgeted: 0, spent: 3000, state: 'unbudgeted' });
    expect(budget.totalBudgeted).toBe(130000);
    expect(budget.uncategorizedSpent).toBe(700);
    // rent + groceries net + unbudgeted fun + uncategorised; the transfer is not spending
    expect(budget.totalSpent).toBe(90000 + 10000 + 3000 + 700);
    expect(budget.totalAvailable).toBe(30000);
  });

  it('flags categories that are close to or over budget', () => {
    const { data, index } = fixture({
      budgets: { food: [{ from: '2026-01', amount: 10000 }], rent: [{ from: '2026-01', amount: 10000 }], fun: [{ from: '2026-01', amount: 10000 }] },
      transactions: [
        tx({ date: '2026-03-02', amount: -8500, categoryId: 'food' }),
        tx({ date: '2026-03-02', amount: -10001, categoryId: 'rent' }),
        tx({ date: '2026-03-02', amount: -8499, categoryId: 'fun' }),
      ],
    });
    const rows = computeMonthBudget(data, index, '2026-03').groups.flatMap((group) => group.rows);
    expect(rows.map((row) => [row.category.id, row.state])).toEqual([
      ['food', 'near'],
      ['rent', 'over'],
      ['fun', 'ok'],
    ]);
  });

  it('tracks expected and received income, including uncategorised income', () => {
    const { data, index } = fixture({
      budgets: { pay: [{ from: '2026-01', amount: 300000 }] },
      transactions: [
        tx({ date: '2026-03-25', amount: 310000, categoryId: 'pay' }),
        tx({ date: '2026-03-26', amount: 5000, categoryId: null }),
      ],
    });
    const budget = computeMonthBudget(data, index, '2026-03');
    expect(budget.income).toEqual([expect.objectContaining({ expected: 300000, received: 310000 })]);
    expect(budget.incomeExpected).toBe(300000);
    expect(budget.incomeReceived).toBe(315000);
    expect(budget.totalSpent).toBe(0);
  });

  it('works out what is left to assign for zero-based budgeting', () => {
    const budgets = { pay: [{ from: '2026-01', amount: 300000 }], food: [{ from: '2026-01', amount: 40000 }], rent: [{ from: '2026-01', amount: 90000 }] };
    const planned = computeMonthBudget(fixture({ budgets, mode: 'zero' }).data, new Map(), '2026-03');
    expect(planned.mode).toBe('zero');
    expect(planned.incomeForPlan).toBe(300000);
    expect(planned.leftToAssign).toBe(170000);

    // With no expected income, the plan is built on what actually arrived.
    const { data, index } = fixture({
      budgets: { food: [{ from: '2026-01', amount: 40000 }] },
      transactions: [tx({ date: '2026-03-25', amount: 30000, categoryId: 'pay' })],
    });
    const actual = computeMonthBudget(data, index, '2026-03');
    expect(actual.incomeForPlan).toBe(30000);
    expect(actual.leftToAssign).toBe(-10000);
  });

  it('hides archived categories unless they still matter this month', () => {
    const categories = [
      category({ id: 'old', groupId: 'need', archived: true }),
      category({ id: 'used', groupId: 'need', archived: true }),
      category({ id: 'oldpay', groupId: 'inc', kind: 'income', archived: true }),
    ];
    const { data, index } = fixture({ categories, transactions: [tx({ date: '2026-03-02', amount: -100, categoryId: 'used' })] });
    const budget = computeMonthBudget(data, index, '2026-03');
    expect(budget.groups[0].rows.map((row) => row.category.id)).toEqual(['used']);
    expect(budget.income).toEqual([]);
  });
});

describe('rollover', () => {
  const rolling = category({ id: 'trip', groupId: 'want', rollover: true, rolloverFrom: '2026-01' });
  const budgets = { trip: [{ from: '2026-01', amount: 10000 }] };

  it('carries unspent budget forward, month after month', () => {
    const { data, index } = fixture({
      categories: [rolling],
      budgets,
      transactions: [tx({ date: '2026-01-10', amount: -4000, categoryId: 'trip' })],
    });
    expect(carryInFor(rolling, budgets.trip, index, '2026-01')).toBe(0);
    expect(carryInFor(rolling, budgets.trip, index, '2026-02')).toBe(6000);
    expect(carryInFor(rolling, budgets.trip, index, '2026-03')).toBe(16000);
    const row = computeMonthBudget(data, index, '2026-03').groups[1].rows[0];
    expect(row).toMatchObject({ budgeted: 10000, carryIn: 16000, spent: 0, available: 26000, state: 'ok' });
  });

  it('carries overspending forward as a shortfall', () => {
    const { data, index } = fixture({
      categories: [rolling],
      budgets,
      transactions: [tx({ date: '2026-01-10', amount: -13000, categoryId: 'trip' }), tx({ date: '2026-02-10', amount: -8000, categoryId: 'trip' })],
    });
    const row = computeMonthBudget(data, index, '2026-02').groups[1].rows[0];
    expect(row).toMatchObject({ carryIn: -3000, spent: 8000, available: -1000, state: 'over' });
  });

  it('is unaffected by raising the budget later', () => {
    const { index } = fixture({ categories: [rolling], budgets });
    const before = carryInFor(rolling, budgets.trip, index, '2026-03');
    const raised = setBudgetAmount(budgets.trip, '2026-03', 50000, 'forward');
    expect(carryInFor(rolling, raised, index, '2026-03')).toBe(before);
    expect(carryInFor(rolling, raised, index, '2026-04')).toBe(before + 50000);
  });

  it('does nothing when switched off or not started yet', () => {
    const { index } = fixture({ budgets });
    expect(carryInFor({ id: 'trip', rollover: false, rolloverFrom: '2026-01' }, budgets.trip, index, '2026-03')).toBe(0);
    expect(carryInFor({ id: 'trip', rollover: true }, budgets.trip, index, '2026-03')).toBe(0);
    expect(carryInFor({ id: 'trip', rollover: true, rolloverFrom: '2026-05' }, budgets.trip, index, '2026-03')).toBe(0);
  });

  it('counts a spread purchase in each month it covers', () => {
    const { data, index } = fixture({
      categories: [category({ id: 'ins', groupId: 'need' })],
      budgets: { ins: [{ from: '2026-01', amount: 4000 }] },
      transactions: [tx({ date: '2026-01-06', amount: -46800, categoryId: 'ins', spreadMonths: 12 })],
    });
    expect(computeMonthBudget(data, index, '2026-01').groups[0].rows[0].spent).toBe(3900);
    expect(computeMonthBudget(data, index, '2026-07').groups[0].rows[0].spent).toBe(3900);
    expect(computeMonthBudget(data, index, '2027-01').groups[0].rows).toEqual([expect.objectContaining({ spent: 0 })]);
  });
});

describe('spendingByDay', () => {
  it('accumulates spending through the month, ignoring income and transfers', () => {
    const days = spendingByDay(
      [
        tx({ date: '2026-02-01', amount: -1000, categoryId: 'food' }),
        tx({ date: '2026-02-03', amount: -500, categoryId: null }),
        tx({ date: '2026-02-03', amount: 200, categoryId: 'food' }),
        tx({ date: '2026-02-04', amount: 9000, categoryId: 'pay' }),
        tx({ date: '2026-02-04', amount: 300, categoryId: null }),
        tx({ date: '2026-02-05', amount: -4000, kind: 'transfer' }),
        tx({ date: '2026-01-20', amount: -1200, categoryId: 'ins', spreadMonths: 3 }),
        tx({ date: '2026-03-01', amount: -7777, categoryId: 'food' }),
      ],
      '2026-02',
      ctx(),
      new Set(['pay']),
    );
    expect(days).toHaveLength(28);
    // Day 1: 1000 + 400 share of the spread purchase.
    expect(days.slice(0, 4)).toEqual([1400, 1400, 1700, 1700]);
    expect(days[27]).toBe(1700);
  });
});

describe('suggestBudgets', () => {
  it('suggests the recent average, rounded up, for categories without a budget', () => {
    const { data, index } = fixture({
      budgets: { rent: [{ from: '2026-01', amount: 90000 }] },
      transactions: [
        tx({ date: '2026-01-05', amount: -30000, categoryId: 'food' }),
        tx({ date: '2026-02-05', amount: -34000, categoryId: 'food' }),
        tx({ date: '2026-03-05', amount: -38100, categoryId: 'food' }),
        tx({ date: '2026-03-06', amount: -90000, categoryId: 'rent' }),
        tx({ date: '2026-03-07', amount: 250000, categoryId: 'pay' }),
        tx({ date: '2026-04-02', amount: -99999, categoryId: 'fun' }),
      ],
    });
    // Average 340.33 a month, rounded up to the next 5.00. Rent already has a budget; April is not history yet.
    expect(suggestBudgets(data, index, '2026-04', 500)).toEqual([{ categoryId: 'food', amount: 34500 }]);
  });

  it('averages over the months that have data and suggests nothing without history', () => {
    const { data, index } = fixture({ transactions: [tx({ date: '2026-03-05', amount: -1000, categoryId: 'food' })] });
    expect(suggestBudgets(data, index, '2026-04', 500)).toEqual([{ categoryId: 'food', amount: 1000 }]);
    expect(suggestBudgets(data, index, '2026-09', 500)).toEqual([]);
    expect(suggestBudgets(data, new Map(), '2026-04', 500)).toEqual([]);
  });

  it('ignores archived categories and categories where refunds outweigh spending', () => {
    const categories = [category({ id: 'old', groupId: 'need', archived: true }), category({ id: 'ref', groupId: 'need' })];
    const { data, index } = fixture({
      categories,
      transactions: [tx({ date: '2026-03-05', amount: -1000, categoryId: 'old' }), tx({ date: '2026-03-05', amount: 500, categoryId: 'ref' })],
    });
    expect(suggestBudgets(data, index, '2026-04', 500)).toEqual([]);
  });
});
