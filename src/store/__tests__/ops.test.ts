import { budgetAmountFor } from '@/domain/budget';
import { readCSV, inferMapping, buildImportRows } from '@/domain/csv';
import { accountBalances } from '@/domain/networth';
import { scheduleBetween } from '@/domain/recurring';
import { demoData, emptyData } from '@/domain/seed';
import type { AppData } from '@/domain/types';

import * as ops from '../ops';

const today = '2026-11-09';

function base(): AppData {
  let data = emptyData('EUR');
  data = { ...data, settings: { ...data.settings, onboarded: true, rates: { USD: 0.9 } } };
  data = {
    ...data,
    accounts: [
      {
        id: 'cur',
        name: 'Current',
        type: 'checking',
        currency: 'EUR',
        openingBalance: 100000,
        openingDate: '2026-01-01',
        archived: false,
        includeInNetWorth: true,
      },
      { id: 'sav', name: 'Savings', type: 'savings', currency: 'EUR', openingBalance: 0, openingDate: '2026-01-01', archived: false, includeInNetWorth: true },
      { id: 'usd', name: 'Dollars', type: 'checking', currency: 'USD', openingBalance: 0, openingDate: '2026-01-01', archived: false, includeInNetWorth: true },
    ],
  };
  return data;
}
const balance = (data: AppData, id: string) => accountBalances(data.accounts, data.transactions).get(id);

describe('settings', () => {
  it('updates settings and exchange rates', () => {
    let data = ops.updateSettings(base(), { budgetMode: 'zero' });
    expect(data.settings.budgetMode).toBe('zero');
    data = ops.setRate(data, 'GBP', 1.2);
    expect(data.settings.rates).toEqual({ USD: 0.9, GBP: 1.2 });
    expect(ops.setRate(data, 'GBP', null).settings.rates).toEqual({ USD: 0.9 });
    expect(ops.setRate(data, 'GBP', 0).settings.rates).toEqual({ USD: 0.9 });
    expect(ops.setRate(data, 'GBP', NaN).settings.rates).toEqual({ USD: 0.9 });
  });
});

describe('accounts', () => {
  it('adds and edits accounts', () => {
    const { data, id } = ops.addAccount(base(), { name: '  Card ', type: 'credit', currency: 'EUR', openingBalance: -5000, openingDate: today, apr: 20 });
    const account = data.accounts.find((item) => item.id === id)!;
    expect(account).toMatchObject({ name: 'Card', type: 'credit', archived: false, includeInNetWorth: true, apr: 20 });
    expect(ops.updateAccount(data, id, { archived: true }).accounts.find((item) => item.id === id)?.archived).toBe(true);
    expect(ops.addAccount(base(), { name: ' ', type: 'cash', currency: 'EUR', openingBalance: 0, openingDate: today }).data.accounts.at(-1)?.name).toBe(
      'Account',
    );
  });

  it('reconciles to a statement balance without adding a transaction', () => {
    let data = ops.addTransaction(base(), { accountId: 'cur', date: today, amount: -2500, payee: 'Shop' }).data;
    expect(balance(data, 'cur')).toBe(97500);
    data = ops.reconcileAccount(data, 'cur', 98000);
    expect(balance(data, 'cur')).toBe(98000);
    expect(data.transactions).toHaveLength(1);
    expect(ops.reconcileAccount(data, 'nope', 1)).toBe(data);
  });

  it('removes an account together with everything that points at it', () => {
    let data = base();
    data = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -100, payee: 'A' }).data;
    data = ops.addTransfer(data, { fromAccountId: 'cur', toAccountId: 'sav', date: today, amount: 5000 }).data;
    data = ops.addRecurring(data, {
      name: 'Rent',
      amount: -90000,
      currency: 'EUR',
      accountId: 'cur',
      categoryId: null,
      frequency: 'monthly',
      anchorDate: today,
      matchText: 'Rent',
      tolerancePct: 10,
    }).data;
    data = ops.addGoal(data, { name: 'Buffer', targetAmount: 100000, createdDate: today, accountId: 'cur' }).data;
    data = ops.addRule(data, { enabled: true, conditions: { payeeMatch: 'contains', payeeText: 'x', accountId: 'cur' }, actions: { markReviewed: true } }).data;

    data = ops.deleteAccount(data, 'cur');
    expect(data.accounts.map((item) => item.id)).toEqual(['sav', 'usd']);
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]).toMatchObject({ accountId: 'sav', kind: 'transfer', transferPeerId: undefined });
    expect(data.recurrings[0].accountId).toBeUndefined();
    expect(data.goals[0].accountId).toBeUndefined();
    expect(data.rules[0].conditions.accountId).toBeUndefined();
  });
});

describe('categories', () => {
  it('adds groups and categories that inherit the group kind', () => {
    const grouped = ops.addGroup(base(), ' Side hustle ', 'income');
    expect(grouped.data.categoryGroups.at(-1)).toMatchObject({ name: 'Side hustle', kind: 'income' });
    const added = ops.addCategory(grouped.data, { name: 'Etsy', groupId: grouped.id, icon: '🧶' });
    expect(added.data.categories.at(-1)).toMatchObject({ name: 'Etsy', kind: 'income', icon: '🧶', archived: false, rollover: false });
    expect(ops.addCategory(grouped.data, { name: 'x', groupId: 'nope', icon: '' }).id).toBe('');
    expect(ops.addCategory(grouped.data, { name: ' ', groupId: grouped.id, icon: '' }).data.categories.at(-1)).toMatchObject({
      name: 'New category',
      icon: '🏷️',
    });
    expect(ops.addGroup(base(), '', 'expense').data.categoryGroups.at(-1)?.name).toBe('New group');
  });

  it('moves a category between groups, keeping its kind in step', () => {
    const data = ops.updateCategory(base(), 'cat_other', { groupId: 'grp_income', name: 'Misc' });
    expect(data.categories.find((item) => item.id === 'cat_other')).toMatchObject({ groupId: 'grp_income', kind: 'income', name: 'Misc' });
    expect(ops.updateCategory(base(), 'cat_other', { groupId: 'nope' })).toEqual(base());
    expect(ops.updateGroup(base(), 'grp_other', { name: 'Rest' }).categoryGroups.find((item) => item.id === 'grp_other')?.name).toBe('Rest');
  });

  it('only deletes empty groups', () => {
    const data = base();
    expect(ops.deleteGroup(data, 'grp_other')).toBe(data);
    const { data: withGroup, id } = ops.addGroup(data, 'Empty', 'expense');
    expect(ops.deleteGroup(withGroup, id).categoryGroups).toHaveLength(data.categoryGroups.length);
  });

  it('deletes a category without losing transactions or leaving loose ends', () => {
    let data = base();
    data = ops.setBudget(data, 'cat_dining', '2026-11', 20000, 'forward');
    data = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -1000, payee: 'Cafe', categoryId: 'cat_dining' }).data;
    data = ops.addTransaction(data, {
      accountId: 'cur',
      date: today,
      amount: -3000,
      payee: 'Mixed',
      splits: [
        { id: 'a', amount: -1000, categoryId: 'cat_dining' },
        { id: 'b', amount: -2000, categoryId: 'cat_groceries' },
      ],
    }).data;
    data = ops.addRecurring(data, {
      name: 'Lunch club',
      amount: -1500,
      currency: 'EUR',
      categoryId: 'cat_dining',
      frequency: 'weekly',
      anchorDate: today,
      matchText: 'Lunch club',
      tolerancePct: 10,
    }).data;
    data = ops.addRule(data, { enabled: true, conditions: { payeeMatch: 'contains', payeeText: 'cafe' }, actions: { categoryId: 'cat_dining' } }).data;
    data = ops.addRule(data, {
      enabled: true,
      conditions: { payeeMatch: 'contains', payeeText: 'bar' },
      actions: { categoryId: 'cat_dining', addTags: ['night'] },
    }).data;

    data = ops.deleteCategory(data, 'cat_dining');
    expect(data.categories.some((item) => item.id === 'cat_dining')).toBe(false);
    expect(data.budgets.cat_dining).toBeUndefined();
    expect(data.transactions).toHaveLength(2);
    expect(data.transactions[0].categoryId).toBeNull();
    expect(data.transactions[1].splits?.map((split) => split.categoryId)).toEqual([null, 'cat_groceries']);
    expect(data.recurrings[0].categoryId).toBeNull();
    // The rule that only set this category is gone; the one with another action survives without it.
    expect(data.rules).toHaveLength(1);
    expect(data.rules[0].actions).toEqual({ categoryId: undefined, addTags: ['night'] });
  });

  it('switches rollover on from a month and off again', () => {
    let data = ops.setRollover(base(), 'cat_travel', true, '2026-11');
    expect(data.categories.find((item) => item.id === 'cat_travel')).toMatchObject({ rollover: true, rolloverFrom: '2026-11' });
    data = ops.setRollover(data, 'cat_travel', false, '2026-12');
    expect(data.categories.find((item) => item.id === 'cat_travel')?.rollover).toBe(false);
  });

  it('sets budgets and removes the record when the budget is cleared', () => {
    let data = ops.setBudget(base(), 'cat_groceries', '2026-11', 40000, 'forward');
    expect(budgetAmountFor(data.budgets.cat_groceries, '2026-12')).toBe(40000);
    data = ops.setBudget(data, 'cat_groceries', '2026-11', 0, 'forward');
    expect(data.budgets.cat_groceries).toBeUndefined();
  });
});

describe('transactions', () => {
  it('adds a transaction with sensible defaults', () => {
    const { data, id } = ops.addTransaction(base(), { accountId: 'cur', date: today, amount: -1250, payee: '  Cafe  ' });
    expect(data.transactions[0]).toMatchObject({ id, payee: 'Cafe', categoryId: null, tags: [], status: 'cleared', kind: 'standard', reviewed: true });
    expect(ops.addTransaction(base(), { accountId: 'cur', date: today, amount: -1, payee: '' }).data.transactions[0].payee).toBe('Unnamed');
  });

  it('keeps entry order for rows added in the same instant', () => {
    let data = base();
    for (const payee of ['a', 'b', 'c']) data = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -1, payee }).data;
    const stamps = data.transactions.map((tx) => tx.createdAt);
    expect([...stamps].sort((x, y) => x - y)).toEqual(stamps);
    expect(new Set(stamps).size).toBe(3);
  });

  it('runs rules on new transactions but respects a category chosen by hand', () => {
    let data = ops.addRule(base(), {
      enabled: true,
      conditions: { payeeMatch: 'contains', payeeText: 'market' },
      actions: { categoryId: 'cat_groceries', addTags: ['food'] },
    }).data;
    data = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -1000, payee: 'Greenway Market' }).data;
    data = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -1000, payee: 'Flea Market', categoryId: 'cat_gifts' }).data;
    data = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -1000, payee: 'Night Market' }, { automate: false }).data;
    expect(data.transactions.map((tx) => [tx.categoryId, tx.tags])).toEqual([
      ['cat_groceries', ['food']],
      ['cat_gifts', ['food']],
      [null, []],
    ]);
  });

  it('links new transactions to the recurring item they pay and borrows its category', () => {
    let data = ops.addRecurring(base(), {
      name: 'StreamBox',
      amount: -1399,
      currency: 'EUR',
      categoryId: 'cat_subscriptions',
      frequency: 'monthly',
      anchorDate: '2026-11-08',
      matchText: 'streambox',
      tolerancePct: 10,
    }).data;
    data = ops.addTransaction(data, { accountId: 'cur', date: '2026-11-08', amount: -1399, payee: 'STREAMBOX.COM' }).data;
    expect(data.transactions[0]).toMatchObject({ recurringId: data.recurrings[0].id, categoryId: 'cat_subscriptions' });
  });

  it('records a transfer as a linked pair that nets to zero', () => {
    const { data, id } = ops.addTransfer(base(), { fromAccountId: 'cur', toAccountId: 'sav', date: today, amount: 25000, notes: 'Monthly' });
    const [out, into] = data.transactions;
    expect(out).toMatchObject({ id, accountId: 'cur', amount: -25000, kind: 'transfer', payee: 'To Savings', transferPeerId: into.id, notes: 'Monthly' });
    expect(into).toMatchObject({ accountId: 'sav', amount: 25000, kind: 'transfer', payee: 'From Current', transferPeerId: out.id });
    expect(balance(data, 'cur')).toBe(75000);
    expect(balance(data, 'sav')).toBe(25000);
  });

  it('converts a transfer between currencies, or uses the amount that actually arrived', () => {
    const converted = ops.addTransfer(base(), { fromAccountId: 'cur', toAccountId: 'usd', date: today, amount: 9000 }).data;
    expect(converted.transactions[1].amount).toBe(10000);
    const exact = ops.addTransfer(base(), { fromAccountId: 'cur', toAccountId: 'usd', date: today, amount: 9000, toAmount: 9875, payee: 'FX' }).data;
    expect(exact.transactions.map((tx) => [tx.amount, tx.payee])).toEqual([
      [-9000, 'FX'],
      [9875, 'FX'],
    ]);
  });

  it('refuses a transfer to the same or an unknown account', () => {
    expect(ops.addTransfer(base(), { fromAccountId: 'cur', toAccountId: 'cur', date: today, amount: 1 }).id).toBe('');
    expect(ops.addTransfer(base(), { fromAccountId: 'cur', toAccountId: 'nope', date: today, amount: 1 }).id).toBe('');
  });

  it('keeps both sides of a transfer in step when one is edited', () => {
    let { data, id } = ops.addTransfer(base(), { fromAccountId: 'cur', toAccountId: 'sav', date: today, amount: 25000 });
    data = ops.updateTransaction(data, id, { amount: -30000, date: '2026-11-10', status: 'pending' });
    expect(data.transactions[1]).toMatchObject({ amount: 30000, date: '2026-11-10', status: 'pending' });

    // Across currencies the other side keeps its own amount.
    let fx = ops.addTransfer(base(), { fromAccountId: 'cur', toAccountId: 'usd', date: today, amount: 9000 });
    fx = { ...fx, data: ops.updateTransaction(fx.data, fx.id, { amount: -9500 }) };
    expect(fx.data.transactions[1].amount).toBe(10000);
  });

  it('dissolves the pair when one side stops being a transfer', () => {
    let { data, id } = ops.addTransfer(base(), { fromAccountId: 'cur', toAccountId: 'sav', date: today, amount: 25000 });
    data = ops.updateTransaction(data, id, { kind: 'standard', categoryId: 'cat_other' });
    expect(data.transactions[0]).toMatchObject({ kind: 'standard', categoryId: 'cat_other', transferPeerId: undefined });
    expect(data.transactions[1]).toMatchObject({ kind: 'transfer', transferPeerId: undefined });
  });

  it('normalises edits: transfers have no category, splits replace it, a spread needs two months', () => {
    let { data, id } = ops.addTransaction(base(), { accountId: 'cur', date: today, amount: -3000, payee: 'Shop', categoryId: 'cat_other', spreadMonths: 6 });
    data = ops.updateTransaction(data, id, {
      splits: [
        { id: 'a', amount: -1000, categoryId: 'cat_gifts' },
        { id: 'b', amount: -2000, categoryId: 'cat_other' },
      ],
    });
    expect(data.transactions[0]).toMatchObject({ categoryId: null, spreadMonths: 6 });
    data = ops.updateTransaction(data, id, { splits: [], categoryId: 'cat_gifts', spreadMonths: 1 });
    expect(data.transactions[0]).toMatchObject({ categoryId: 'cat_gifts', splits: undefined, spreadMonths: undefined });
    data = ops.updateTransaction(data, id, { kind: 'transfer' });
    expect(data.transactions[0]).toMatchObject({ kind: 'transfer', categoryId: null });
    expect(ops.updateTransaction(data, 'nope', { amount: 1 })).toBe(data);
  });

  it('updates many at once, leaving transfers and splits uncategorised', () => {
    let data = base();
    const a = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -100, payee: 'A', reviewed: false });
    const b = ops.addTransaction(a.data, {
      accountId: 'cur',
      date: today,
      amount: -100,
      payee: 'B',
      reviewed: false,
      splits: [
        { id: 'x', amount: -50, categoryId: null },
        { id: 'y', amount: -50, categoryId: null },
      ],
    });
    const c = ops.addTransfer(b.data, { fromAccountId: 'cur', toAccountId: 'sav', date: today, amount: 100 });
    const d = ops.addTransaction(c.data, { accountId: 'cur', date: today, amount: -100, payee: 'D', reviewed: false });
    data = ops.updateTransactions(d.data, [a.id, b.id, c.id], { categoryId: 'cat_other', reviewed: true });
    const byId = new Map(data.transactions.map((tx) => [tx.id, tx]));
    expect(byId.get(a.id)).toMatchObject({ categoryId: 'cat_other', reviewed: true });
    expect(byId.get(b.id)).toMatchObject({ categoryId: null, reviewed: true });
    expect(byId.get(c.id)).toMatchObject({ categoryId: null, reviewed: true });
    expect(byId.get(d.id)).toMatchObject({ categoryId: null, reviewed: false });
  });

  it('deletes both sides of a transfer together', () => {
    let { data, id } = ops.addTransfer(base(), { fromAccountId: 'cur', toAccountId: 'sav', date: today, amount: 100 });
    const extra = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -5, payee: 'Keep' });
    data = ops.deleteTransactions(extra.data, [id]);
    expect(data.transactions.map((tx) => tx.payee)).toEqual(['Keep']);
  });
});

describe('importing', () => {
  const file = readCSV(
    'Date,Description,Amount,Category\n2026-11-01,SQ *GREENWAY MARKET 0412,-45.00,\n2026-11-02,Employer Ltd,2000.00,salary\n2026-11-03,StreamBox,-13.99,Nonsense',
  );
  const rows = buildImportRows(file, inferMapping(file), { currency: 'EUR', dateOrder: 'YMD', decimal: '.', flipSign: false }).rows;

  it('adds rows as unreviewed transactions, keeping the bank descriptor and matching categories by name', () => {
    const result = ops.importTransactions(base(), 'cur', rows, { keepBalance: false });
    expect(result.imported).toBe(3);
    expect(result.data.transactions.map((tx) => [tx.payee, tx.rawPayee, tx.categoryId, tx.reviewed])).toEqual([
      ['Greenway Market', 'SQ *GREENWAY MARKET 0412', null, false],
      ['Employer Ltd', undefined, 'cat_salary', false],
      ['StreamBox', undefined, null, false],
    ]);
    expect(balance(result.data, 'cur')).toBe(100000 - 4500 + 200000 - 1399);
  });

  it('can treat the rows as history the balance already includes', () => {
    const result = ops.importTransactions(base(), 'cur', rows, { keepBalance: true });
    expect(balance(result.data, 'cur')).toBe(100000);
    expect(result.data.transactions).toHaveLength(3);
  });

  it('applies rules and bill matching to imported rows', () => {
    let data = ops.addRule(base(), {
      enabled: true,
      conditions: { payeeMatch: 'contains', payeeText: '0412' },
      actions: { categoryId: 'cat_groceries', markReviewed: true },
    }).data;
    data = ops.addRecurring(data, {
      name: 'StreamBox',
      amount: -1399,
      currency: 'EUR',
      categoryId: 'cat_subscriptions',
      frequency: 'monthly',
      anchorDate: '2026-11-03',
      matchText: 'StreamBox',
      tolerancePct: 5,
    }).data;
    const result = ops.importTransactions(data, 'cur', rows, { keepBalance: false });
    expect(result.data.transactions[0]).toMatchObject({ categoryId: 'cat_groceries', reviewed: true });
    expect(result.data.transactions[2]).toMatchObject({ categoryId: 'cat_subscriptions', recurringId: data.recurrings[0].id });
  });

  it('does nothing for an unknown account or an empty file', () => {
    const data = base();
    expect(ops.importTransactions(data, 'nope', rows, { keepBalance: false })).toEqual({ data, imported: 0, ids: [] });
    expect(ops.importTransactions(data, 'cur', [], { keepBalance: false }).imported).toBe(0);
  });
});

describe('recurring items', () => {
  const rent = {
    name: 'Landlord',
    amount: -90000,
    currency: 'EUR',
    accountId: 'cur',
    categoryId: 'cat_housing',
    frequency: 'monthly' as const,
    anchorDate: '2026-11-01',
    matchText: 'landlord',
    tolerancePct: 5,
  };

  it('links past payments when an item starts being tracked', () => {
    let data = ops.addTransaction(base(), { accountId: 'cur', date: '2026-11-01', amount: -90000, payee: 'Landlord Ltd' }).data;
    data = ops.addTransaction(data, { accountId: 'cur', date: '2026-11-02', amount: -500, payee: 'Landlord Ltd' }).data;
    const added = ops.addRecurring(data, rent);
    expect(added.data.transactions.map((tx) => tx.recurringId)).toEqual([added.id, undefined]);
    expect(added.data.recurrings[0]).toMatchObject({ status: 'active', skipped: [] });
  });

  it('marks a due date as paid by recording the payment', () => {
    const added = ops.addRecurring(base(), rent);
    const paid = ops.markPaid(added.data, added.id, '2026-11-01', today);
    expect(paid.data.transactions[0]).toMatchObject({
      accountId: 'cur',
      date: today,
      amount: -90000,
      payee: 'Landlord',
      categoryId: 'cat_housing',
      recurringId: added.id,
    });
    const schedule = scheduleBetween(paid.data.recurrings, paid.data.transactions, '2026-11-01', '2026-11-30', today);
    expect(schedule[0].state).toBe('paid');
  });

  it('dates the payment on the due date when today is too far away to count', () => {
    const added = ops.addRecurring(base(), { ...rent, anchorDate: '2026-09-01' });
    const paid = ops.markPaid(added.data, added.id, '2026-09-01', today);
    expect(paid.data.transactions[0].date).toBe('2026-09-01');
  });

  it('pays in the account currency and falls back to any open account', () => {
    const added = ops.addRecurring(base(), { ...rent, accountId: undefined, amount: -900 });
    expect(ops.markPaid(added.data, added.id, '2026-11-01', today, 'usd').data.transactions[0]).toMatchObject({ accountId: 'usd', amount: -1000 });
    expect(ops.markPaid(added.data, added.id, '2026-11-01', today).data.transactions[0].accountId).toBe('cur');
    expect(ops.markPaid(added.data, 'nope', '2026-11-01', today).id).toBe('');
    expect(ops.markPaid({ ...added.data, accounts: [] }, added.id, '2026-11-01', today).id).toBe('');
  });

  it('skips and un-skips a due date', () => {
    const added = ops.addRecurring(base(), rent);
    let data = ops.skipOccurrence(added.data, added.id, '2026-12-01');
    data = ops.skipOccurrence(data, added.id, '2026-11-01');
    expect(data.recurrings[0].skipped).toEqual(['2026-11-01', '2026-12-01']);
    data = ops.skipOccurrence(data, added.id, '2026-12-01', false);
    expect(data.recurrings[0].skipped).toEqual(['2026-11-01']);
    expect(ops.skipOccurrence(data, 'nope', '2026-12-01')).toBe(data);
  });

  it('pauses, edits and deletes, unlinking payments on delete', () => {
    const added = ops.addRecurring(base(), rent);
    let data = ops.markPaid(added.data, added.id, '2026-11-01', today).data;
    data = ops.updateRecurring(data, added.id, { status: 'paused' });
    expect(data.recurrings[0].status).toBe('paused');
    data = ops.deleteRecurring(data, added.id);
    expect(data.recurrings).toEqual([]);
    expect(data.transactions[0].recurringId).toBeUndefined();
  });
});

describe('goals', () => {
  it('adds, funds, edits and deletes a goal', () => {
    const added = ops.addGoal(base(), { name: ' Bike ', targetAmount: 80000, createdDate: today });
    expect(added.data.goals[0]).toMatchObject({ name: 'Bike', icon: '🎯', contributions: [], archived: false });
    let data = ops.contribute(added.data, added.id, 10000, today);
    data = ops.contribute(data, added.id, -2500, today);
    data = ops.contribute(data, added.id, 0, today);
    expect(data.goals[0].contributions.map((item) => item.amount)).toEqual([10000, -2500]);
    expect(ops.contribute(data, 'nope', 5, today)).toBe(data);
    data = ops.updateGoal(data, added.id, { targetDate: '2027-06-01' });
    expect(data.goals[0].targetDate).toBe('2027-06-01');
    expect(ops.deleteGoal(data, added.id).goals).toEqual([]);
  });
});

describe('rules', () => {
  const draft = { enabled: true, conditions: { payeeMatch: 'contains' as const, payeeText: 'cityride' }, actions: { categoryId: 'cat_transport' } };

  it('adds, edits, reorders and deletes rules', () => {
    let data = base();
    const first = ops.addRule(data, draft);
    const second = ops.addRule(first.data, { ...draft, actions: { addTags: ['x'] } });
    data = ops.moveRule(second.data, second.id, -1);
    expect(data.rules.map((rule) => rule.id)).toEqual([second.id, first.id]);
    expect(ops.moveRule(data, second.id, -1)).toBe(data);
    expect(ops.moveRule(data, first.id, 1)).toBe(data);
    expect(ops.moveRule(data, 'nope', 1)).toBe(data);
    data = ops.updateRule(data, first.id, { enabled: false });
    expect(data.rules[1].enabled).toBe(false);
    expect(ops.deleteRule(data, first.id).rules.map((rule) => rule.id)).toEqual([second.id]);
  });

  it('applies a rule to transactions already on file and counts what changed', () => {
    let data = base();
    for (const payee of ['CityRide', 'CityRide', 'Cafe']) data = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -1000, payee }).data;
    data = ops.addTransaction(data, { accountId: 'cur', date: today, amount: -1000, payee: 'CityRide', categoryId: 'cat_transport' }).data;
    const rule = ops.addRule(data, draft);
    const result = ops.applyRuleToExisting(rule.data, rule.id);
    expect(result.changed).toBe(2);
    expect(result.data.transactions.map((tx) => tx.categoryId)).toEqual(['cat_transport', 'cat_transport', null, 'cat_transport']);
    expect(ops.applyRuleToExisting(result.data, rule.id).changed).toBe(0);
    expect(ops.applyRuleToExisting(result.data, 'nope').changed).toBe(0);
  });
});

describe('demo data', () => {
  it('survives every destructive operation without dangling references', () => {
    let data = demoData(today, 'EUR');
    data = ops.deleteCategory(data, 'cat_groceries');
    data = ops.deleteAccount(data, 'acc_card');
    data = ops.deleteRecurring(data, 'rec_rent');
    const accountIds = new Set(data.accounts.map((item) => item.id));
    const categoryIds = new Set(data.categories.map((item) => item.id));
    const txIds = new Set(data.transactions.map((item) => item.id));
    const recurringIds = new Set(data.recurrings.map((item) => item.id));
    for (const tx of data.transactions) {
      expect(accountIds.has(tx.accountId)).toBe(true);
      if (tx.categoryId) expect(categoryIds.has(tx.categoryId)).toBe(true);
      for (const split of tx.splits ?? []) if (split.categoryId) expect(categoryIds.has(split.categoryId)).toBe(true);
      if (tx.transferPeerId) expect(txIds.has(tx.transferPeerId)).toBe(true);
      if (tx.recurringId) expect(recurringIds.has(tx.recurringId)).toBe(true);
    }
    for (const rule of data.rules) if (rule.actions.categoryId) expect(categoryIds.has(rule.actions.categoryId)).toBe(true);
  });
});
