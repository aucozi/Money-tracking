import { buildCtx, type Ctx } from '@/domain/context';
import type { Account, Category, Recurring, Rule, Transaction } from '@/domain/types';

let sequence = 0;
const next = (prefix: string) => `${prefix}${(sequence += 1)}`;

export function account(overrides: Partial<Account> = {}): Account {
  return {
    id: next('acc'),
    name: 'Current',
    type: 'checking',
    currency: 'EUR',
    openingBalance: 0,
    openingDate: '2026-01-01',
    archived: false,
    includeInNetWorth: true,
    ...overrides,
  };
}

export function tx(overrides: Partial<Transaction> = {}): Transaction {
  const id = overrides.id ?? next('tx');
  return {
    id,
    accountId: 'acc',
    date: '2026-03-10',
    amount: -1000,
    payee: 'Shop',
    categoryId: null,
    tags: [],
    status: 'cleared',
    kind: 'standard',
    reviewed: true,
    createdAt: sequence,
    ...overrides,
  };
}

export function category(overrides: Partial<Category> = {}): Category {
  return {
    id: next('cat'),
    name: 'Groceries',
    groupId: 'grp',
    kind: 'expense',
    icon: '🛒',
    color: '#000000',
    archived: false,
    rollover: false,
    sort: sequence,
    ...overrides,
  };
}

export function recurring(overrides: Partial<Recurring> = {}): Recurring {
  return {
    id: next('rec'),
    name: 'Rent',
    amount: -90000,
    currency: 'EUR',
    categoryId: null,
    frequency: 'monthly',
    anchorDate: '2026-01-01',
    status: 'active',
    matchText: 'Rent',
    tolerancePct: 10,
    skipped: [],
    ...overrides,
  };
}

export function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: next('rule'),
    enabled: true,
    conditions: { payeeMatch: 'contains' },
    actions: {},
    ...overrides,
  };
}

/** EUR base with USD worth 0.9 EUR and GBP worth 1.2 EUR. */
export function ctx(accounts: Account[] = [account({ id: 'acc' })]): Ctx {
  return buildCtx('EUR', { USD: 0.9, GBP: 1.2 }, accounts);
}
