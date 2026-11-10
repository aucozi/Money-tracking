import { account, ctx, recurring, tx } from '@/test/factories';
import { debtsFromAccounts, payoffPlan, type Debt } from '../debt';
import { everydaySpendingPerDay, forecastBalance } from '../forecast';
import { goalProgress } from '../goals';
import { accountBalances, netWorth, netWorthHistory, openingBalanceFor } from '../networth';
import type { Goal } from '../types';

describe('accountBalances', () => {
  const accounts = [account({ id: 'cur', openingBalance: 100000, openingDate: '2026-01-01' }), account({ id: 'card', type: 'credit', openingBalance: -20000 })];
  const history = [
    tx({ accountId: 'cur', date: '2026-01-10', amount: -5000 }),
    tx({ accountId: 'cur', date: '2026-02-10', amount: 30000 }),
    tx({ accountId: 'cur', date: '2026-03-01', amount: -1000, status: 'pending' }),
    tx({ accountId: 'card', date: '2026-02-01', amount: -4000 }),
    tx({ accountId: 'gone', date: '2026-02-01', amount: -4000 }),
  ];

  it('adds every transaction to the opening balance', () => {
    const balances = accountBalances(accounts, history);
    expect(balances.get('cur')).toBe(124000);
    expect(balances.get('card')).toBe(-24000);
    expect(balances.has('gone')).toBe(false);
  });

  it('can leave out pending transactions', () => {
    expect(accountBalances(accounts, history, { includePending: false }).get('cur')).toBe(125000);
  });

  it('answers what the balance was on a past date', () => {
    expect(accountBalances(accounts, history, { asOf: '2026-01-31' }).get('cur')).toBe(95000);
    expect(accountBalances(accounts, history, { asOf: '2026-01-09' }).get('cur')).toBe(100000);
    expect(accountBalances(accounts, history, { asOf: '2025-12-31' }).get('cur')).toBe(0);
  });

  it('reconciles to a statement by moving the opening balance', () => {
    const current = accountBalances(accounts, history).get('cur')!;
    const opening = openingBalanceFor(accounts[0], current, 120000);
    expect(accountBalances([{ ...accounts[0], openingBalance: opening }], history).get('cur')).toBe(120000);
  });
});

describe('netWorth', () => {
  const accounts = [
    account({ id: 'cur', openingBalance: 100000 }),
    account({ id: 'usd', currency: 'USD', openingBalance: 100000 }),
    account({ id: 'card', type: 'credit', openingBalance: -30000 }),
    account({ id: 'over', openingBalance: -5000 }),
    account({ id: 'hidden', openingBalance: 999999, includeInNetWorth: false }),
    account({ id: 'closed', openingBalance: 999999, archived: true }),
  ];

  it('totals assets and debts in the base currency', () => {
    const worth = netWorth(accounts, accountBalances(accounts, []), ctx(accounts));
    // 1000 EUR + 1000 USD (900 EUR); card and the overdrawn account are debts
    expect(worth).toEqual({ assets: 190000, liabilities: 35000, net: 155000 });
  });

  it('builds a month-by-month history, measuring the current month as of today', () => {
    const history = [
      tx({ accountId: 'cur', date: '2026-01-15', amount: 10000 }),
      tx({ accountId: 'cur', date: '2026-02-15', amount: 10000 }),
      tx({ accountId: 'cur', date: '2026-03-20', amount: 10000 }),
    ];
    const points = netWorthHistory(accounts, history, ctx(accounts), ['2026-01', '2026-02', '2026-03'], '2026-03-10');
    expect(points.map((point) => [point.month, point.date, point.net])).toEqual([
      ['2026-01', '2026-01-31', 165000],
      ['2026-02', '2026-02-28', 175000],
      ['2026-03', '2026-03-10', 175000],
    ]);
  });
});

describe('netWorthHistory', () => {
  it('starts when the first account was opened instead of showing months of zero', () => {
    const accounts = [
      account({ id: 'a', openingBalance: 5000, openingDate: '2026-03-10' }),
      account({ id: 'b', openingBalance: 1000, openingDate: '2026-04-02' }),
    ];
    const points = netWorthHistory(accounts, [], ctx(accounts), ['2026-01', '2026-02', '2026-03', '2026-04'], '2026-04-20');
    expect(points.map((point) => [point.month, point.net])).toEqual([
      ['2026-03', 5000],
      ['2026-04', 6000],
    ]);
  });

  it('is empty when nothing counts towards net worth', () => {
    expect(netWorthHistory([], [], ctx([]), ['2026-01'], '2026-01-20')).toEqual([]);
    const hidden = [account({ includeInNetWorth: false })];
    expect(netWorthHistory(hidden, [], ctx(hidden), ['2026-01'], '2026-01-20')).toEqual([]);
  });
});

describe('forecastBalance', () => {
  const accounts = [
    account({ id: 'cur', openingBalance: 50000 }),
    account({ id: 'sav', type: 'savings', openingBalance: 100000 }),
    account({ id: 'card', type: 'credit', openingBalance: -20000 }),
  ];
  const rent = recurring({ id: 'rent', name: 'Rent', amount: -90000, anchorDate: '2026-01-01', accountId: 'cur' });
  const pay = recurring({ id: 'pay', name: 'Salary', amount: 200000, anchorDate: '2026-01-25', accountId: 'cur' });
  const base = { accounts, transactions: [], ctx: ctx(accounts), today: '2026-03-20', days: 30, everydaySpending: false };

  it('starts from cash accounts only', () => {
    const forecast = forecastBalance({ ...base, recurrings: [] });
    expect(forecast.start).toBe(150000);
    expect(forecast.end).toBe(150000);
    expect(forecast.points).toHaveLength(31);
    expect(forecast.firstNegative).toBeUndefined();
  });

  it('applies bills and income on their due dates and finds the low point', () => {
    const paidRent = tx({ accountId: 'cur', date: '2026-03-01', amount: -90000, recurringId: 'rent' });
    const forecast = forecastBalance({ ...base, transactions: [paidRent], recurrings: [rent, pay], accountIds: ['cur'] });
    expect(forecast.start).toBe(-40000);
    const on = (date: string) => forecast.points.find((point) => point.date === date)!;
    expect(on('2026-03-24').balance).toBe(-40000);
    expect(on('2026-03-25').balance).toBe(160000);
    expect(on('2026-04-01').balance).toBe(70000);
    expect(on('2026-04-01').events.map((event) => event.label)).toEqual(['Rent']);
    expect(forecast.low).toEqual({ date: '2026-03-20', balance: -40000 });
    expect(forecast.firstNegative).toBe('2026-03-20');
    expect(forecast.end).toBe(70000);
  });

  it('assumes overdue unpaid bills are paid today', () => {
    const forecast = forecastBalance({ ...base, recurrings: [rent], accountIds: ['cur'] });
    expect(forecast.points[0].balance).toBe(50000 - 90000);
    expect(forecast.events[0]).toMatchObject({ label: 'Rent', date: '2026-03-20', overdue: true });
  });

  it('does not count on income that is already late', () => {
    const forecast = forecastBalance({ ...base, recurrings: [pay], accountIds: ['cur'] });
    expect(forecast.points[0].balance).toBe(50000);
    expect(forecast.events.map((event) => event.date)).toEqual(['2026-03-25']);
  });

  it('leaves out bills paid from accounts that are not being projected', () => {
    const cardBill = recurring({ name: 'StreamBox', amount: -1399, anchorDate: '2026-03-25', accountId: 'card' });
    const anyAccount = recurring({ name: 'Gym', amount: -3000, anchorDate: '2026-03-26' });
    const forecast = forecastBalance({ ...base, recurrings: [cardBill, anyAccount] });
    expect(forecast.events.map((event) => event.label)).toEqual(['Gym']);
  });

  it('converts foreign-currency bills', () => {
    const usd = recurring({ name: 'Hosting', amount: -1000, currency: 'USD', anchorDate: '2026-03-25' });
    expect(forecastBalance({ ...base, recurrings: [usd] }).end).toBe(150000 - 900);
  });

  it('can subtract typical everyday spending', () => {
    const history = [
      tx({ accountId: 'card', date: '2026-02-20', amount: -6000 }),
      tx({ accountId: 'card', date: '2026-03-01', amount: -9000 }),
      tx({ accountId: 'card', date: '2026-03-10', amount: -14000 }),
      tx({ accountId: 'cur', date: '2026-03-05', amount: -90000, recurringId: 'x' }),
      tx({ accountId: 'cur', date: '2026-03-06', amount: -50000, kind: 'transfer' }),
      tx({ accountId: 'cur', date: '2026-03-07', amount: 300000 }),
    ];
    const perDay = everydaySpendingPerDay(history, base.ctx, '2026-03-20');
    // 290.00 of everyday spending over the 29 days since the first of those transactions.
    expect(perDay).toBe(1000);
    const forecast = forecastBalance({ ...base, transactions: history, recurrings: [], everydaySpending: true, accountIds: ['sav'] });
    expect(forecast.everydayPerDay).toBe(1000);
    expect(forecast.points[0].balance).toBe(100000);
    expect(forecast.end).toBe(100000 - 30 * 1000);
  });

  it('does not guess everyday spending from too little history', () => {
    expect(everydaySpendingPerDay([tx({ date: '2026-03-18', amount: -9000 })], base.ctx, '2026-03-20')).toBe(0);
    expect(everydaySpendingPerDay([], base.ctx, '2026-03-20')).toBe(0);
    expect(everydaySpendingPerDay([tx({ date: '2025-01-01', amount: -9000 })], base.ctx, '2026-03-20')).toBe(0);
  });
});

describe('goalProgress', () => {
  const goal = (overrides: Partial<Goal> = {}): Goal => ({
    id: 'g',
    name: 'Trip',
    icon: '✈️',
    color: '#000',
    targetAmount: 240000,
    contributions: [],
    createdDate: '2026-01-01',
    archived: false,
    ...overrides,
  });
  const none = new Map<string, number>();

  it('tracks manual contributions and what is needed each month', () => {
    const progress = goalProgress(
      goal({
        targetDate: '2026-12-31',
        contributions: [
          { id: 'a', date: '2026-02-01', amount: 60000 },
          { id: 'b', date: '2026-03-01', amount: 20000 },
        ],
      }),
      [],
      none,
      ctx(),
      '2026-04-01',
    );
    expect(progress).toMatchObject({ saved: 80000, remaining: 160000, monthsLeft: 9, monthlyNeeded: 17778, state: 'on-track' });
    expect(progress.fraction).toBeCloseTo(1 / 3);
  });

  it('says when a goal is behind schedule or past its date', () => {
    expect(
      goalProgress(goal({ targetDate: '2026-12-31', contributions: [{ id: 'a', date: '2026-02-01', amount: 10000 }] }), [], none, ctx(), '2026-07-01').state,
    ).toBe('behind');
    const late = goalProgress(goal({ targetDate: '2026-03-01' }), [], none, ctx(), '2026-04-01');
    expect(late).toMatchObject({ state: 'behind', monthsLeft: 0, monthlyNeeded: 240000 });
  });

  it('follows a linked account balance in the base currency', () => {
    const savings = account({ id: 'sav', currency: 'GBP' });
    const progress = goalProgress(goal({ accountId: 'sav' }), [savings], new Map([['sav', 100000]]), ctx([savings]), '2026-04-01');
    expect(progress).toMatchObject({ saved: 120000, remaining: 120000, state: 'open', monthlyNeeded: null });
    expect(goalProgress(goal({ accountId: 'sav' }), [savings], new Map([['sav', -500]]), ctx([savings]), '2026-04-01').saved).toBe(0);
  });

  it('recognises a finished goal', () => {
    const done = goalProgress(goal({ contributions: [{ id: 'a', date: '2026-02-01', amount: 250000 }] }), [], none, ctx(), '2026-04-01');
    expect(done).toMatchObject({ state: 'done', fraction: 1, remaining: 0 });
  });

  it('copes with a goal that has no target yet', () => {
    expect(goalProgress(goal({ targetAmount: 0 }), [], none, ctx(), '2026-04-01')).toMatchObject({ fraction: 0, state: 'open' });
  });
});

describe('payoffPlan', () => {
  const card: Debt = { id: 'card', name: 'Card', balance: 300000, apr: 22, minPayment: 9000 };
  const loan: Debt = { id: 'loan', name: 'Loan', balance: 100000, apr: 6, minPayment: 5000 };

  it('pays off an interest-free debt in exact instalments', () => {
    const plan = payoffPlan([{ id: 'a', name: 'A', balance: 120000, apr: 0, minPayment: 10000 }], 0, 'avalanche');
    expect(plan).toMatchObject({ feasible: true, months: 12, totalInterest: 0, totalPaid: 120000, monthlyPayment: 10000 });
    expect(plan.timeline[0]).toBe(120000);
    expect(plan.timeline[12]).toBe(0);
  });

  it('charges interest monthly', () => {
    const plan = payoffPlan([{ id: 'a', name: 'A', balance: 100000, apr: 12, minPayment: 50000 }], 0, 'avalanche');
    // Month 1: +1000 interest, -50000. Month 2: +510, -50000. Month 3: +15 and cleared.
    expect(plan.months).toBe(3);
    expect(plan.totalInterest).toBe(1000 + 510 + 15);
    expect(plan.totalPaid).toBe(100000 + plan.totalInterest);
  });

  it('targets the highest rate first with avalanche and the smallest balance with snowball', () => {
    const avalanche = payoffPlan([card, loan], 20000, 'avalanche');
    const snowball = payoffPlan([card, loan], 20000, 'snowball');
    expect(avalanche.order.map((step) => step.id)).toEqual(['card', 'loan']);
    expect(snowball.order.map((step) => step.id)).toEqual(['loan', 'card']);
    expect(avalanche.totalInterest).toBeLessThan(snowball.totalInterest);
    expect(avalanche.feasible && snowball.feasible).toBe(true);
    expect(avalanche.monthlyPayment).toBe(34000);
  });

  it('rolls freed-up payments into the next debt', () => {
    const withExtra = payoffPlan([card, loan], 20000, 'snowball');
    const without = payoffPlan([card, loan], 0, 'snowball');
    expect(withExtra.months).toBeLessThan(without.months);
    // Every month pays the full budget until the last one.
    expect(withExtra.totalPaid).toBeGreaterThan((withExtra.months - 1) * withExtra.monthlyPayment);
    expect(withExtra.totalPaid).toBeLessThanOrEqual(withExtra.months * withExtra.monthlyPayment);
  });

  it('reports when payments never clear the debt', () => {
    const plan = payoffPlan([{ id: 'a', name: 'A', balance: 1000000, apr: 30, minPayment: 10000 }], 0, 'avalanche');
    expect(plan.feasible).toBe(false);
    expect(payoffPlan([{ id: 'a', name: 'A', balance: 1000, apr: 0, minPayment: 0 }], 0, 'snowball').feasible).toBe(false);
  });

  it('handles having no debt', () => {
    expect(payoffPlan([], 5000, 'avalanche')).toMatchObject({ feasible: true, months: 0, timeline: [0], order: [] });
    expect(payoffPlan([{ ...card, balance: 0 }], 0, 'avalanche').months).toBe(0);
  });

  it('reads debts from credit and loan accounts that carry a balance', () => {
    const accounts = [
      account({ id: 'card', name: 'Card', type: 'credit', apr: 22, minPayment: 3500 }),
      account({ id: 'usd', name: 'US loan', type: 'loan', currency: 'USD', apr: 5, minPayment: 10000 }),
      account({ id: 'clear', type: 'credit' }),
      account({ id: 'cur', type: 'checking' }),
      account({ id: 'old', type: 'loan', archived: true }),
    ];
    const balances = new Map([
      ['card', -64000],
      ['usd', -100000],
      ['clear', 0],
      ['cur', -500],
      ['old', -900],
    ]);
    expect(debtsFromAccounts(accounts, balances, ctx(accounts))).toEqual([
      { id: 'card', name: 'Card', balance: 64000, apr: 22, minPayment: 3500 },
      { id: 'usd', name: 'US loan', balance: 90000, apr: 5, minPayment: 9000 },
    ]);
  });
});
