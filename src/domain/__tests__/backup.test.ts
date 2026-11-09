import { BackupError, createBackup, CSV_HEADERS, parseBackup, transactionsToCSV } from '../backup';
import { parseCSV } from '../csv';
import { demoData, emptyData } from '../seed';
import { SCHEMA_VERSION, type AppData } from '../types';

const sample = (): AppData => demoData('2026-11-09', 'EUR');

describe('transactionsToCSV', () => {
  const data = sample();

  it('writes one row per transaction with readable names', () => {
    const coffee = data.transactions.find((tx) => tx.payee === 'Daily Grind Coffee' && tx.status === 'pending')!;
    const rows = parseCSV(transactionsToCSV([coffee], data));
    expect(rows[0]).toEqual(CSV_HEADERS);
    expect(rows[1]).toEqual(['2026-11-09', 'Daily Grind Coffee', '-4.60', 'EUR', 'Credit card', 'Dining out', 'Lifestyle', 'Expense', 'Pending', '', '', '', '']);
  });

  it('writes a row per split part', () => {
    const split = data.transactions.find((tx) => tx.splits)!;
    const rows = parseCSV(transactionsToCSV([split], data)).slice(1);
    expect(rows.map((row) => [row[2], row[5], row[10], row[12]])).toEqual([
      ['-61.40', 'Groceries', '', '1/2'],
      ['-23.20', 'Shopping', 'Cleaning supplies', '2/2'],
    ]);
  });

  it('labels transfers, income, uncategorised rows, tags and foreign-currency accounts', () => {
    const pick = (test: (tx: AppData['transactions'][number]) => boolean) => data.transactions.find(test)!;
    const rows = parseCSV(
      transactionsToCSV(
        [
          pick((tx) => tx.kind === 'transfer' && tx.amount < 0),
          pick((tx) => tx.payee === 'Northfield Studio'),
          pick((tx) => tx.payee === 'ATM withdrawal'),
          pick((tx) => tx.accountId === 'acc_travel'),
        ],
        data,
      ),
    ).slice(1);
    expect(rows[0].slice(5, 8)).toEqual(['', '', 'Transfer']);
    expect(rows[1].slice(5, 8)).toEqual(['Salary', 'Income', 'Income']);
    expect(rows[2].slice(5, 8)).toEqual(['Uncategorized', '', 'Expense']);
    expect(rows[3].slice(2, 5)).toEqual(['-42.00', 'GBP', 'Travel wallet']);
    expect(rows[3][9]).toBe('lisbon-trip');
  });

  it('exports only what it is given', () => {
    expect(parseCSV(transactionsToCSV([], data))).toEqual([CSV_HEADERS]);
    expect(parseCSV(transactionsToCSV(data.transactions.slice(0, 7), data))).toHaveLength(8);
  });
});

describe('backup and restore', () => {
  it('restores exactly what was backed up', () => {
    const data = sample();
    const restored = parseBackup(createBackup(data, new Date('2026-11-09T10:00:00Z')));
    expect(restored).toEqual(data);
  });

  it('round-trips an empty dataset and marks it as set up', () => {
    const restored = parseBackup(createBackup(emptyData('USD')));
    expect(restored.settings).toMatchObject({ baseCurrency: 'USD', onboarded: true, budgetMode: 'tracking', theme: 'system' });
    expect(restored.transactions).toEqual([]);
    expect(restored.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('fills in defaults for optional fields and drops unusable rates', () => {
    const file = JSON.parse(createBackup(sample()));
    const tx = file.data.transactions[0];
    delete tx.tags;
    delete tx.reviewed;
    tx.status = 'weird';
    tx.kind = 'weird';
    delete tx.createdAt;
    file.data.settings.rates = { GBP: 1.2, BAD: -1, WORSE: 'x' };
    file.data.settings.theme = 'neon';
    file.data.settings.budgetMode = 'zero';
    delete file.data.recurrings[0].skipped;
    delete file.data.goals[0].contributions;
    const restored = parseBackup(JSON.stringify(file));
    expect(restored.transactions[0]).toMatchObject({ tags: [], reviewed: true, status: 'cleared', kind: 'standard', createdAt: 0 });
    expect(restored.settings.rates).toEqual({ GBP: 1.2 });
    expect(restored.settings.theme).toBe('system');
    expect(restored.settings.budgetMode).toBe('zero');
    expect(restored.recurrings[0].skipped).toEqual([]);
    expect(restored.goals[0].contributions).toEqual([]);
  });

  const broken = (mutate: (file: { schemaVersion: number; format: string; data: any }) => void) => {
    const file = JSON.parse(createBackup(sample()));
    mutate(file);
    return JSON.stringify(file);
  };

  it.each<[string, string, RegExp]>([
    ['not JSON', 'hello', /not valid JSON/],
    ['some other JSON', '{"a":1}', /not a Waypoint backup/],
    ['an array', '[]', /not a Waypoint backup/],
    ['a newer version', broken((f) => { f.schemaVersion = SCHEMA_VERSION + 1; }), /newer version/],
    ['no currency', broken((f) => { f.data.settings.baseCurrency = 'euro'; }), /base currency/],
    ['no accounts', broken((f) => { delete f.data.accounts; }), /no accounts list/],
    ['a bad account', broken((f) => { f.data.accounts[0].openingBalance = 1.5; }), /Account 1 is missing/],
    ['a bad opening date', broken((f) => { f.data.accounts[0].openingDate = '2026-02-31'; }), /opening date/],
    ['an item with no id', broken((f) => { f.data.accounts[0].id = ''; }), /Item 1 in accounts/],
    ['an orphan category', broken((f) => { f.data.categories[0].groupId = 'nope'; }), /does not belong to a group/],
    ['an orphan transaction', broken((f) => { f.data.transactions[2].accountId = 'nope'; }), /Transaction 3 belongs to an account/],
    ['a bad date', broken((f) => { f.data.transactions[0].date = '2026-13-01'; }), /Transaction 1 has no valid date/],
    ['a fractional amount', broken((f) => { f.data.transactions[0].amount = 10.5; }), /no valid amount/],
    ['a missing payee', broken((f) => { delete f.data.transactions[0].payee; }), /no payee/],
    ['an unknown category', broken((f) => { f.data.transactions[0].categoryId = 'nope'; }), /category that is not in the backup/],
    ['a bad recurring item', broken((f) => { f.data.recurrings[0].anchorDate = 'soon'; }), /Recurring item/],
    ['a bad goal', broken((f) => { f.data.goals[0].targetAmount = 'lots'; }), /Goal/],
    ['a bad rule', broken((f) => { f.data.rules[0].conditions = null; }), /Rule 1/],
    ['no budgets', broken((f) => { f.data.budgets = []; }), /no budgets/],
    ['a bad budget', broken((f) => { f.data.budgets.cat_housing = [{ from: '2026-01', amount: 'x' }]; }), /budget for category/],
  ])('refuses %s with a clear reason', (_name, text, message) => {
    expect(() => parseBackup(text)).toThrow(BackupError);
    expect(() => parseBackup(text)).toThrow(message);
  });
});
