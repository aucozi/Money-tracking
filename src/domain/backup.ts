import { toCSV } from './csv';
import { isValidDate } from './dates';
import { currencyDecimals, fromMinor } from './money';
import { partsOf } from './transactions';
import { SCHEMA_VERSION, type AppData, type Transaction } from './types';

type ExportLookup = Pick<AppData, 'accounts' | 'categories' | 'categoryGroups'>;

export const CSV_HEADERS = [
  'Date',
  'Payee',
  'Amount',
  'Currency',
  'Account',
  'Category',
  'Group',
  'Type',
  'Status',
  'Tags',
  'Notes',
  'Original payee',
  'Split',
];

/**
 * Export exactly the transactions passed in, so a filtered list exports as
 * filtered. A split transaction becomes one row per part.
 */
export function transactionsToCSV(transactions: readonly Transaction[], data: ExportLookup): string {
  const accounts = new Map(data.accounts.map((account) => [account.id, account]));
  const categories = new Map(data.categories.map((category) => [category.id, category]));
  const groups = new Map(data.categoryGroups.map((group) => [group.id, group.name]));
  const rows: (string | number)[][] = [CSV_HEADERS];

  for (const tx of transactions) {
    const account = accounts.get(tx.accountId);
    const currency = account?.currency ?? '';
    const decimals = currency ? currencyDecimals(currency) : 2;
    const parts = partsOf(tx);
    parts.forEach((part, index) => {
      const category = part.categoryId ? categories.get(part.categoryId) : undefined;
      const split = tx.splits?.[index];
      rows.push([
        tx.date,
        tx.payee,
        (currency ? fromMinor(part.amount, currency) : part.amount / 100).toFixed(decimals),
        currency,
        account?.name ?? '',
        tx.kind === 'transfer' ? '' : (category?.name ?? 'Uncategorized'),
        category ? (groups.get(category.groupId) ?? '') : '',
        tx.kind === 'transfer' ? 'Transfer' : part.amount > 0 ? 'Income' : 'Expense',
        tx.status === 'pending' ? 'Pending' : 'Cleared',
        tx.tags.join(' '),
        [tx.notes, split?.notes].filter(Boolean).join(' — '),
        tx.rawPayee ?? '',
        parts.length > 1 ? `${index + 1}/${parts.length}` : '',
      ]);
    });
  }
  return toCSV(rows);
}

export const BACKUP_MARKER = 'waypoint-backup';

export interface BackupFile {
  format: typeof BACKUP_MARKER;
  schemaVersion: number;
  exportedAt: string;
  data: AppData;
}

/** The whole dataset as readable JSON. Nothing is held back, so a restore is complete. */
export function createBackup(data: AppData, now: Date = new Date()): string {
  const file: BackupFile = {
    format: BACKUP_MARKER,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    data,
  };
  return JSON.stringify(file, null, 2);
}

export class BackupError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value);
const isText = (value: unknown): value is string => typeof value === 'string';

function list(source: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = source[key];
  if (!Array.isArray(value)) throw new BackupError(`This backup has no ${key} list.`);
  value.forEach((item, index) => {
    if (!isObject(item) || !isText(item.id) || !item.id) {
      throw new BackupError(`Item ${index + 1} in ${key} is not valid.`);
    }
  });
  return value as Record<string, unknown>[];
}

/**
 * Read a backup, checking everything that the app later relies on. Throws a
 * BackupError with a plain-language reason rather than loading damaged data.
 */
export function parseBackup(text: string): AppData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('This file is not a Waypoint backup (it is not valid JSON).');
  }
  if (!isObject(parsed) || parsed.format !== BACKUP_MARKER || !isObject(parsed.data)) {
    throw new BackupError('This file is not a Waypoint backup.');
  }
  if (!isInteger(parsed.schemaVersion) || parsed.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError('This backup was made by a newer version of Waypoint. Update the app to restore it.');
  }
  return validateData(parsed.data);
}

export function validateData(source: Record<string, unknown>): AppData {
  const settings = source.settings;
  if (!isObject(settings) || !isText(settings.baseCurrency) || !/^[A-Z]{3}$/.test(settings.baseCurrency)) {
    throw new BackupError('This backup has no valid base currency.');
  }

  const accounts = list(source, 'accounts');
  const accountIds = new Set<string>();
  accounts.forEach((account, index) => {
    if (!isText(account.name) || !isText(account.currency) || !isInteger(account.openingBalance)) {
      throw new BackupError(`Account ${index + 1} is missing its name, currency or opening balance.`);
    }
    if (!isText(account.openingDate) || !isValidDate(account.openingDate)) {
      throw new BackupError(`Account "${account.name}" has no valid opening date.`);
    }
    accountIds.add(account.id as string);
  });

  const categories = list(source, 'categories');
  const categoryIds = new Set(categories.map((category) => category.id as string));
  const groups = list(source, 'categoryGroups');
  const groupIds = new Set(groups.map((group) => group.id as string));
  categories.forEach((category) => {
    if (!isText(category.name) || !isText(category.groupId) || !groupIds.has(category.groupId)) {
      throw new BackupError(`Category "${String(category.name)}" does not belong to a group.`);
    }
  });

  const transactions = list(source, 'transactions');
  transactions.forEach((tx, index) => {
    const label = `Transaction ${index + 1}`;
    if (!isText(tx.accountId) || !accountIds.has(tx.accountId)) throw new BackupError(`${label} belongs to an account that is not in the backup.`);
    if (!isText(tx.date) || !isValidDate(tx.date)) throw new BackupError(`${label} has no valid date.`);
    if (!isInteger(tx.amount)) throw new BackupError(`${label} has no valid amount.`);
    if (!isText(tx.payee)) throw new BackupError(`${label} has no payee.`);
    if (tx.categoryId !== null && !(isText(tx.categoryId) && categoryIds.has(tx.categoryId))) {
      throw new BackupError(`${label} uses a category that is not in the backup.`);
    }
    if (!Array.isArray(tx.tags)) tx.tags = [];
    if (tx.status !== 'pending') tx.status = 'cleared';
    if (tx.kind !== 'transfer') tx.kind = 'standard';
    if (typeof tx.reviewed !== 'boolean') tx.reviewed = true;
    if (!isInteger(tx.createdAt)) tx.createdAt = 0;
  });

  const recurrings = list(source, 'recurrings');
  recurrings.forEach((item) => {
    if (!isText(item.name) || !isInteger(item.amount) || !isText(item.anchorDate) || !isValidDate(item.anchorDate)) {
      throw new BackupError(`Recurring item "${String(item.name)}" is not valid.`);
    }
    if (!Array.isArray(item.skipped)) item.skipped = [];
  });

  const goals = list(source, 'goals');
  goals.forEach((goal) => {
    if (!isText(goal.name) || !isInteger(goal.targetAmount)) throw new BackupError(`Goal "${String(goal.name)}" is not valid.`);
    if (!Array.isArray(goal.contributions)) goal.contributions = [];
  });

  const rules = list(source, 'rules');
  rules.forEach((rule, index) => {
    if (!isObject(rule.conditions) || !isObject(rule.actions)) throw new BackupError(`Rule ${index + 1} is not valid.`);
  });

  if (!isObject(source.budgets)) throw new BackupError('This backup has no budgets.');
  for (const [categoryId, entries] of Object.entries(source.budgets)) {
    if (!Array.isArray(entries) || entries.some((entry) => !isObject(entry) || !isText(entry.from) || !isInteger(entry.amount))) {
      throw new BackupError(`The budget for category ${categoryId} is not valid.`);
    }
  }

  const rates: Record<string, number> = {};
  if (isObject(settings.rates)) {
    for (const [code, rate] of Object.entries(settings.rates)) {
      if (typeof rate === 'number' && rate > 0 && Number.isFinite(rate)) rates[code] = rate;
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      baseCurrency: settings.baseCurrency,
      rates,
      budgetMode: settings.budgetMode === 'zero' ? 'zero' : 'tracking',
      theme: settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : 'system',
      onboarded: true,
      forecastEverydaySpending: settings.forecastEverydaySpending !== false,
    },
    accounts: accounts as unknown as AppData['accounts'],
    categoryGroups: groups as unknown as AppData['categoryGroups'],
    categories: categories as unknown as AppData['categories'],
    transactions: transactions as unknown as AppData['transactions'],
    budgets: source.budgets as AppData['budgets'],
    recurrings: recurrings as unknown as AppData['recurrings'],
    goals: goals as unknown as AppData['goals'],
    rules: rules as unknown as AppData['rules'],
  };
}
