import { account, category, ctx, tx } from '@/test/factories';
import { makeCtx } from '../context';
import { monthReview } from '../review';
import { demoData, emptyData } from '../seed';
import { buildActivityIndex } from '../transactions';

describe('monthReview', () => {
  const food = category({ id: 'food', name: 'Food' });
  const fun = category({ id: 'fun', name: 'Fun' });
  const pay = category({ id: 'pay', name: 'Salary', kind: 'income', groupId: 'inc' });
  const accounts = [account({ id: 'acc' }), account({ id: 'usd', currency: 'USD' })];
  const context = ctx(accounts);
  const transactions = [
    tx({ date: '2026-02-03', amount: -20000, categoryId: 'food' }),
    tx({ date: '2026-02-10', amount: -5000, categoryId: 'fun' }),
    tx({ date: '2026-03-01', amount: 200000, categoryId: 'pay', payee: 'Employer' }),
    tx({ id: 'big', date: '2026-03-02', amount: -30000, categoryId: 'food', payee: 'Market' }),
    tx({ date: '2026-03-02', amount: -1000, categoryId: 'food', payee: 'market' }),
    tx({ id: 'trip', accountId: 'usd', date: '2026-03-05', amount: -10000, categoryId: null, payee: 'Hotel' }),
    tx({ date: '2026-03-09', amount: -70000, kind: 'transfer', payee: 'To savings' }),
    tx({ date: '2026-03-20', amount: -4000, categoryId: 'food', payee: 'Later' }),
  ];
  const data = {
    ...emptyData('EUR'),
    categories: [food, fun, pay],
    categoryGroups: [
      { id: 'grp', name: 'Everyday', kind: 'expense' as const, sort: 0 },
      { id: 'inc', name: 'Income', kind: 'income' as const, sort: 1 },
    ],
    budgets: { food: [{ from: '2026-01', amount: 25000 }], fun: [{ from: '2026-01', amount: 8000 }] },
    transactions,
  };
  const index = buildActivityIndex(transactions, context);

  it('sums up a finished month and compares it with the one before', () => {
    const review = monthReview(data, index, context, '2026-03', '2026-04-02');
    expect(review).toMatchObject({
      complete: true,
      days: 31,
      income: 200000,
      spent: 44000,
      kept: 156000,
      savingsRate: 0.78,
      previous: { income: 0, spent: 25000, kept: -25000 },
      spentChange: { kind: 'percent', value: 76 },
      transactions: 4,
      perDay: 1419,
      quietDays: 28,
    });
    expect(review.categories.map((row) => [row.category.id, row.spent, row.previous])).toEqual([
      ['food', 35000, 20000],
      ['fun', 0, 5000],
    ]);
    expect(review.movers.map((row) => row.category.id)).toEqual(['food', 'fun']);
    expect(review.biggest.map((item) => [item.tx.id, item.amount])).toEqual([
      ['big', 30000],
      ['trip', 9000],
      [expect.any(String), 4000],
    ]);
    expect(review.merchants).toEqual([{ payee: 'Market', total: 31000, count: 2 }]);
    expect(review.budget).toMatchObject({ budgeted: 33000, spent: 44000, within: 1 });
    expect(review.budget?.over.map((row) => row.category.id)).toEqual(['food']);
  });

  it('only counts the days so far while the month is running', () => {
    const review = monthReview(data, index, context, '2026-03', '2026-03-10');
    expect(review).toMatchObject({ complete: false, days: 10, quietDays: 8, perDay: 4400 });
  });

  it('copes with a month that has nothing in it and no budget', () => {
    const review = monthReview({ ...data, budgets: {} }, index, context, '2026-06', '2026-08-01');
    expect(review).toMatchObject({ income: 0, spent: 0, kept: 0, savingsRate: null, spentChange: { kind: 'none' }, transactions: 0, budget: null });
    expect(review.categories).toEqual([]);
    expect(review.biggest).toEqual([]);
    expect(monthReview(data, index, context, '2026-09', '2026-08-01').days).toBe(0);
  });

  it('agrees with the dashboard on the sample data', () => {
    const sample = demoData('2026-11-10', 'USD');
    const sampleCtx = makeCtx(sample);
    const review = monthReview(sample, buildActivityIndex(sample.transactions, sampleCtx), sampleCtx, '2026-10', '2026-11-10');
    expect(review.complete).toBe(true);
    expect(review.kept).toBe(review.income - review.spent);
    expect(review.categories[0].category.name).toBe('Housing');
    expect(review.biggest[0].tx.payee).toBe('Harbour Lettings');
    expect(review.merchants.length).toBeGreaterThan(0);
  });
});
