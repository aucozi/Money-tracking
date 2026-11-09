import { account, category, ctx, recurring, tx } from '@/test/factories';
import { computeMonthBudget } from '../budget';
import { makeCtx } from '../context';
import { cashflow, freeToSpend, pace, topCategories } from '../insights';
import { accountBalances, netWorth } from '../networth';
import { detectRecurring, scheduleBetween } from '../recurring';
import { defaultCategories, demoData, emptyData } from '../seed';
import { buildActivityIndex, validateSplits } from '../transactions';

describe('cashflow', () => {
  it('splits each month into income and spending, ignoring transfers', () => {
    const categories = [category({ id: 'food' }), category({ id: 'pay', kind: 'income' })];
    const index = buildActivityIndex(
      [
        tx({ date: '2026-01-05', amount: 300000, categoryId: 'pay' }),
        tx({ date: '2026-01-06', amount: -40000, categoryId: 'food' }),
        tx({ date: '2026-01-07', amount: -1000, categoryId: null }),
        tx({ date: '2026-01-08', amount: 2000, categoryId: null }),
        tx({ date: '2026-01-09', amount: -50000, kind: 'transfer' }),
        tx({ date: '2026-02-06', amount: -10000, categoryId: 'food' }),
      ],
      ctx(),
    );
    expect(cashflow(index, categories, ['2026-01', '2026-02', '2026-03'])).toEqual([
      { month: '2026-01', income: 302000, spent: 41000, net: 261000 },
      { month: '2026-02', income: 0, spent: 10000, net: -10000 },
      { month: '2026-03', income: 0, spent: 0, net: 0 },
    ]);
  });
});

describe('pace', () => {
  const thisMonth = Array.from({ length: 30 }, (_, i) => (i + 1) * 1000);
  const lastMonth = Array.from({ length: 31 }, (_, i) => (i + 1) * 800);

  it('compares spending so far with the same day last month and with the budget', () => {
    expect(pace(thisMonth, lastMonth, 60000, '2026-11-10', '2026-11')).toEqual({
      spent: 10000,
      lastMonthToDate: 8000,
      change: { kind: 'percent', value: 25 },
      expectedByNow: 20000,
    });
  });

  it('uses whole months when looking at the past and copes with no budget or history', () => {
    const past = pace(thisMonth, lastMonth, 0, '2026-12-05', '2026-11');
    expect(past).toMatchObject({ spent: 30000, lastMonthToDate: 24000, expectedByNow: null });
    expect(pace(thisMonth, [], 0, '2026-11-10', '2026-11').change).toEqual({ kind: 'new' });
    expect(pace([], [], 0, '2026-11-10', '2026-11')).toMatchObject({ spent: 0, change: { kind: 'none' } });
  });
});

describe('freeToSpend', () => {
  const data = { ...emptyData('EUR'), budgets: { cat_groceries: [{ from: '2026-01', amount: 60000 }], cat_utilities: [{ from: '2026-01', amount: 10000 }] } };
  const accounts = [account({ id: 'acc' })];
  const context = ctx(accounts);
  const index = buildActivityIndex([tx({ date: '2026-03-05', amount: -20000, categoryId: 'cat_groceries' })], context);
  const budget = computeMonthBudget(data, index, '2026-03');

  it('takes spending and unpaid bills off the budget', () => {
    const bills = [
      recurring({ name: 'Power', amount: -8000, anchorDate: '2026-03-25' }),
      recurring({ name: 'Salary', amount: 250000, anchorDate: '2026-03-28' }),
      recurring({ name: 'Next month', amount: -5000, anchorDate: '2026-04-02' }),
    ];
    const schedule = scheduleBetween(bills, [], '2026-03-01', '2026-04-30', '2026-03-22');
    expect(freeToSpend(budget, schedule, context, '2026-03-22')).toEqual({
      amount: 70000 - 20000 - 8000,
      perDay: 4200,
      daysLeft: 10,
      billsDue: 8000,
    });
  });

  it('does not count bills that are already paid', () => {
    const power = recurring({ id: 'p', name: 'Power', amount: -8000, anchorDate: '2026-03-20' });
    const schedule = scheduleBetween([power], [tx({ date: '2026-03-20', recurringId: 'p' })], '2026-03-01', '2026-03-31', '2026-03-22');
    expect(freeToSpend(budget, schedule, context, '2026-03-22')?.billsDue).toBe(0);
  });

  it('is not shown without a budget or for another month', () => {
    expect(freeToSpend(computeMonthBudget(emptyData('EUR'), index, '2026-03'), [], context, '2026-03-22')).toBeNull();
    expect(freeToSpend(budget, [], context, '2026-04-01')).toBeNull();
  });
});

describe('defaults and demo data', () => {
  it('starts with a short, well-formed category list', () => {
    const { groups, categories } = defaultCategories();
    expect(categories.length).toBeLessThanOrEqual(20);
    expect(new Set(categories.map((item) => item.id)).size).toBe(categories.length);
    const groupIds = new Set(groups.map((group) => group.id));
    expect(categories.every((item) => groupIds.has(item.groupId))).toBe(true);
    expect(categories.filter((item) => item.kind === 'income').every((item) => item.groupId === 'grp_income')).toBe(true);
  });

  it('starts empty and not yet set up', () => {
    const data = emptyData('USD');
    expect(data.settings).toMatchObject({ baseCurrency: 'USD', onboarded: false });
    expect(data.accounts).toEqual([]);
    expect(data.transactions).toEqual([]);
  });

  const today = '2026-11-09';
  const data = demoData(today, 'EUR');

  it('is deterministic for a given day', () => {
    expect(demoData(today, 'EUR')).toEqual(data);
  });

  it('is internally consistent', () => {
    const accountIds = new Set(data.accounts.map((item) => item.id));
    const categoryIds = new Set(data.categories.map((item) => item.id));
    const txIds = new Set(data.transactions.map((item) => item.id));
    expect(txIds.size).toBe(data.transactions.length);
    for (const item of data.transactions) {
      expect(accountIds.has(item.accountId)).toBe(true);
      expect(item.date <= today).toBe(true);
      expect(Number.isInteger(item.amount)).toBe(true);
      if (item.categoryId) expect(categoryIds.has(item.categoryId)).toBe(true);
      expect(validateSplits(item)).toBeNull();
      if (item.kind === 'transfer') {
        const peer = data.transactions.find((other) => other.id === item.transferPeerId)!;
        expect(peer.amount).toBe(-item.amount);
        expect(peer.transferPeerId).toBe(item.id);
      }
    }
    for (const id of Object.keys(data.budgets)) expect(categoryIds.has(id)).toBe(true);
  });

  it('tells a plausible story', () => {
    const context = makeCtx(data);
    const worth = netWorth(data.accounts, accountBalances(data.accounts, data.transactions), context);
    expect(worth.assets).toBeGreaterThan(0);
    expect(worth.liabilities).toBeGreaterThan(0);
    const budget = computeMonthBudget(data, buildActivityIndex(data.transactions, context), '2026-10');
    expect(budget.totalBudgeted).toBeGreaterThan(200000);
    expect(budget.totalSpent).toBeGreaterThan(150000);
    expect(budget.incomeReceived).toBeGreaterThan(300000);
    expect(topCategories(budget, 3)[0].category.id).toBe('cat_housing');
    expect(data.transactions.some((item) => !item.reviewed)).toBe(true);
    expect(data.transactions.some((item) => item.status === 'pending')).toBe(true);
    // Untracked subscriptions are there to be discovered.
    const suggestions = detectRecurring(data.transactions, data.recurrings, data.accounts, today).map((item) => item.recurring.name);
    expect(suggestions).toEqual(expect.arrayContaining(['PulseGym', 'Tunely']));
  });

  it('scales amounts for currencies without decimals and picks a different travel currency', () => {
    const yen = demoData(today, 'JPY');
    expect(yen.accounts[0].openingBalance).toBe(215000);
    expect(demoData(today, 'GBP').accounts.find((item) => item.id === 'acc_travel')?.currency).toBe('EUR');
    expect(demoData(today, 'USD').settings.rates).toEqual({ GBP: 1.3 });
  });
});
