import { setBudgetAmount } from '@/domain/budget';
import { newId } from '@/domain/context';
import type { ImportRow } from '@/domain/csv';
import { diffDays } from '@/domain/dates';
import { convert } from '@/domain/money';
import { accountBalances, openingBalanceFor } from '@/domain/networth';
import { linkRecurring, matchWindow } from '@/domain/recurring';
import { applyRules, previewRule, ruleHasActions } from '@/domain/rules';
import { CATEGORY_COLORS } from '@/domain/seed';
import type {
  Account,
  AppData,
  Category,
  CategoryGroup,
  CategoryKind,
  Goal,
  Holding,
  ID,
  ISODate,
  MonthKey,
  Recurring,
  Rule,
  Settings,
  Transaction,
} from '@/domain/types';

/**
 * Every change to the dataset is a pure function from the old data to the new.
 * The store only wires these up, which keeps the rules of the app testable
 * without rendering anything.
 */

const replace = <T extends { id: ID }>(items: readonly T[], id: ID, patch: NoInfer<Partial<Omit<T, 'id'>>>): T[] =>
  items.map((item) => (item.id === id ? { ...item, ...patch } : item));

// ── Settings ────────────────────────────────────────────────────────────────

export function updateSettings(data: AppData, patch: Partial<Settings>): AppData {
  return { ...data, settings: { ...data.settings, ...patch } };
}

export function setRate(data: AppData, currency: string, rate: number | null): AppData {
  const rates = { ...data.settings.rates };
  if (rate === null || !(rate > 0) || !Number.isFinite(rate)) delete rates[currency];
  else rates[currency] = rate;
  return updateSettings(data, { rates });
}

// ── Accounts ────────────────────────────────────────────────────────────────

export type NewAccount = Pick<Account, 'name' | 'type' | 'currency' | 'openingBalance' | 'openingDate'> &
  Partial<Pick<Account, 'apr' | 'minPayment' | 'includeInNetWorth'>>;

export function addAccount(data: AppData, input: NewAccount): { data: AppData; id: ID } {
  const id = newId('acc_');
  const account: Account = {
    id,
    archived: false,
    includeInNetWorth: true,
    ...input,
    name: input.name.trim() || 'Account',
  };
  return { data: { ...data, accounts: [...data.accounts, account] }, id };
}

export function updateAccount(data: AppData, id: ID, patch: Partial<Omit<Account, 'id'>>): AppData {
  return { ...data, accounts: replace(data.accounts, id, patch) };
}

/** Move the opening balance so that the account's balance today equals `target`. */
export function reconcileAccount(data: AppData, id: ID, target: number): AppData {
  const account = data.accounts.find((item) => item.id === id);
  if (!account) return data;
  const current = accountBalances([account], data.transactions).get(id) ?? 0;
  return updateAccount(data, id, { openingBalance: openingBalanceFor(account, current, target) });
}

/** Remove an account with its transactions, and every reference to it. */
export function deleteAccount(data: AppData, id: ID): AppData {
  const removed = new Set(data.transactions.filter((tx) => tx.accountId === id).map((tx) => tx.id));
  return {
    ...data,
    accounts: data.accounts.filter((account) => account.id !== id),
    transactions: data.transactions
      .filter((tx) => tx.accountId !== id)
      .map((tx) => (tx.transferPeerId && removed.has(tx.transferPeerId) ? { ...tx, transferPeerId: undefined } : tx)),
    recurrings: data.recurrings.map((item) => (item.accountId === id ? { ...item, accountId: undefined } : item)),
    goals: data.goals.map((goal) => (goal.accountId === id ? { ...goal, accountId: undefined } : goal)),
    rules: data.rules.map((rule) =>
      rule.conditions.accountId === id ? { ...rule, conditions: { ...rule.conditions, accountId: undefined } } : rule,
    ),
    holdings: data.holdings.filter((holding) => holding.accountId !== id),
    connections: data.connections.map((connection) => ({
      ...connection,
      links: Object.fromEntries(Object.entries(connection.links).filter(([, accountId]) => accountId !== id)),
    })),
  };
}

// ── Categories ──────────────────────────────────────────────────────────────

export function addGroup(data: AppData, name: string, kind: CategoryKind): { data: AppData; id: ID } {
  const id = newId('grp_');
  const sort = Math.max(-1, ...data.categoryGroups.map((group) => group.sort)) + 1;
  const group: CategoryGroup = { id, name: name.trim() || 'New group', kind, sort };
  return { data: { ...data, categoryGroups: [...data.categoryGroups, group] }, id };
}

export function updateGroup(data: AppData, id: ID, patch: Partial<Pick<CategoryGroup, 'name' | 'sort'>>): AppData {
  return { ...data, categoryGroups: replace(data.categoryGroups, id, patch) };
}

/** A group can only go once nothing is filed under it. */
export function deleteGroup(data: AppData, id: ID): AppData {
  if (data.categories.some((category) => category.groupId === id)) return data;
  return { ...data, categoryGroups: data.categoryGroups.filter((group) => group.id !== id) };
}

export type NewCategory = Pick<Category, 'name' | 'groupId' | 'icon'> & Partial<Pick<Category, 'color'>>;

export function addCategory(data: AppData, input: NewCategory): { data: AppData; id: ID } {
  const group = data.categoryGroups.find((item) => item.id === input.groupId);
  if (!group) return { data, id: '' };
  const id = newId('cat_');
  const sort = Math.max(-1, ...data.categories.map((category) => category.sort)) + 1;
  const category: Category = {
    id,
    name: input.name.trim() || 'New category',
    groupId: group.id,
    kind: group.kind,
    icon: input.icon || '🏷️',
    color: input.color ?? CATEGORY_COLORS[data.categories.length % CATEGORY_COLORS.length],
    archived: false,
    rollover: false,
    sort,
  };
  return { data: { ...data, categories: [...data.categories, category] }, id };
}

export function updateCategory(
  data: AppData,
  id: ID,
  patch: Partial<Pick<Category, 'name' | 'icon' | 'color' | 'archived' | 'groupId' | 'sort'>>,
): AppData {
  let next = patch as Partial<Category>;
  if (patch.groupId) {
    const group = data.categoryGroups.find((item) => item.id === patch.groupId);
    if (!group) return data;
    next = { ...patch, kind: group.kind };
  }
  return { ...data, categories: replace(data.categories, id, next) };
}

/** Switch rollover on from `month` (its leftover is the first to carry), or off. */
export function setRollover(data: AppData, id: ID, on: boolean, month: MonthKey): AppData {
  return {
    ...data,
    categories: replace(data.categories, id, on ? { rollover: true, rolloverFrom: month } : { rollover: false }),
  };
}

/** Delete a category. Its transactions stay, uncategorised, and nothing is left pointing at it. */
export function deleteCategory(data: AppData, id: ID): AppData {
  const { [id]: _removed, ...budgets } = data.budgets;
  return {
    ...data,
    budgets,
    categories: data.categories.filter((category) => category.id !== id),
    transactions: data.transactions.map((tx) => {
      const usedInSplit = tx.splits?.some((split) => split.categoryId === id);
      if (tx.categoryId !== id && !usedInSplit) return tx;
      return {
        ...tx,
        categoryId: tx.categoryId === id ? null : tx.categoryId,
        splits: tx.splits?.map((split) => (split.categoryId === id ? { ...split, categoryId: null } : split)),
      };
    }),
    recurrings: data.recurrings.map((item) => (item.categoryId === id ? { ...item, categoryId: null } : item)),
    rules: data.rules
      .map((rule) => (rule.actions.categoryId === id ? { ...rule, actions: { ...rule.actions, categoryId: undefined } } : rule))
      .filter(ruleHasActions),
  };
}

// ── Budgets ─────────────────────────────────────────────────────────────────

export function setBudget(data: AppData, categoryId: ID, month: MonthKey, amount: number, scope: 'month' | 'forward'): AppData {
  const entries = setBudgetAmount(data.budgets[categoryId], month, amount, scope);
  const budgets = { ...data.budgets };
  if (entries.length === 0) delete budgets[categoryId];
  else budgets[categoryId] = entries;
  return { ...data, budgets };
}

// ── Transactions ────────────────────────────────────────────────────────────

export type NewTransaction = Pick<Transaction, 'accountId' | 'date' | 'amount' | 'payee'> &
  Partial<Omit<Transaction, 'id' | 'createdAt' | 'accountId' | 'date' | 'amount' | 'payee'>>;

function currencyOf(data: AppData, accountId: ID): string {
  return data.accounts.find((account) => account.id === accountId)?.currency ?? data.settings.baseCurrency;
}

/** Run rules and bill matching over a transaction that has just arrived. */
export function automate(data: AppData, tx: Transaction): Transaction {
  let next = applyRules(tx, data.rules).tx;
  // A category chosen by hand (or named in the file) outranks any rule.
  if (tx.categoryId !== null && next.kind === 'standard') next = { ...next, categoryId: tx.categoryId };
  if (!next.recurringId && next.kind === 'standard') {
    const match = linkRecurring(next, currencyOf(data, next.accountId), data.recurrings);
    if (match) {
      next = { ...next, recurringId: match.id };
      if (next.categoryId === null && !next.splits?.length && match.categoryId) {
        next = { ...next, categoryId: match.categoryId };
      }
    }
  }
  return next;
}

let created = 0;
/** Strictly increasing, so rows entered within the same millisecond keep their order. */
function stamp(): number {
  created = Math.max(created + 1, Date.now());
  return created;
}

export function build(input: NewTransaction): Transaction {
  return {
    categoryId: null,
    tags: [],
    status: 'cleared',
    kind: 'standard',
    reviewed: true,
    ...input,
    payee: input.payee.trim() || 'Unnamed',
    id: newId('tx_'),
    createdAt: stamp(),
  };
}

export function addTransaction(
  data: AppData,
  input: NewTransaction,
  options: { automate?: boolean } = {},
): { data: AppData; id: ID } {
  let tx = build(input);
  if (options.automate ?? true) tx = automate(data, tx);
  return { data: { ...data, transactions: [...data.transactions, tx] }, id: tx.id };
}

export interface NewTransfer {
  fromAccountId: ID;
  toAccountId: ID;
  date: ISODate;
  /** Positive amount leaving the source account, in its currency. */
  amount: number;
  /** Amount arriving, in the destination's currency. Defaults to a conversion at the stored rate. */
  toAmount?: number;
  payee?: string;
  notes?: string;
  status?: Transaction['status'];
}

/** Record money moving between two of your own accounts as a linked pair. */
export function addTransfer(data: AppData, input: NewTransfer): { data: AppData; id: ID } {
  const from = data.accounts.find((account) => account.id === input.fromAccountId);
  const to = data.accounts.find((account) => account.id === input.toAccountId);
  if (!from || !to || from.id === to.id) return { data, id: '' };
  const amount = Math.abs(input.amount);
  const arriving =
    input.toAmount !== undefined
      ? Math.abs(input.toAmount)
      : convert(amount, from.currency, to.currency, data.settings.baseCurrency, data.settings.rates);
  const shared = {
    date: input.date,
    kind: 'transfer' as const,
    notes: input.notes,
    status: input.status ?? ('cleared' as const),
    categoryId: null,
  };
  const out = build({ ...shared, accountId: from.id, amount: -amount, payee: input.payee?.trim() || `To ${to.name}` });
  const into = build({ ...shared, accountId: to.id, amount: arriving, payee: input.payee?.trim() || `From ${from.name}` });
  out.transferPeerId = into.id;
  into.transferPeerId = out.id;
  return { data: { ...data, transactions: [...data.transactions, out, into] }, id: out.id };
}

/**
 * Edit a transaction. For a linked transfer the date and status follow on the
 * other side, and so does the amount when both accounts use the same currency.
 */
export function updateTransaction(data: AppData, id: ID, patch: Partial<Omit<Transaction, 'id' | 'createdAt'>>): AppData {
  const current = data.transactions.find((tx) => tx.id === id);
  if (!current) return data;
  let next: Transaction = { ...current, ...patch };
  if (next.kind === 'transfer') next = { ...next, categoryId: null, splits: undefined, spreadMonths: undefined, recurringId: undefined };
  if (!next.splits?.length) next = { ...next, splits: undefined };
  else next = { ...next, categoryId: null };
  if (!next.spreadMonths || next.spreadMonths < 2) next = { ...next, spreadMonths: undefined };

  let transactions = replace(data.transactions, id, next);
  const peer = current.transferPeerId ? data.transactions.find((tx) => tx.id === current.transferPeerId) : undefined;
  if (peer) {
    if (next.kind !== 'transfer') {
      // No longer a transfer: the pair is dissolved and the other side stands alone.
      transactions = replace(transactions, id, { transferPeerId: undefined });
      transactions = replace(transactions, peer.id, { transferPeerId: undefined });
    } else {
      const sameCurrency = currencyOf(data, peer.accountId) === currencyOf(data, next.accountId);
      transactions = replace(transactions, peer.id, {
        date: next.date,
        status: next.status,
        ...(sameCurrency && patch.amount !== undefined ? { amount: -next.amount } : {}),
      });
    }
  }
  return { ...data, transactions };
}

export function updateTransactions(
  data: AppData,
  ids: readonly ID[],
  patch: Partial<Pick<Transaction, 'categoryId' | 'reviewed' | 'status'>>,
): AppData {
  const selected = new Set(ids);
  return {
    ...data,
    transactions: data.transactions.map((tx) => {
      if (!selected.has(tx.id)) return tx;
      const next = { ...tx, ...patch };
      // A category has no meaning on a transfer or on a split, so leave those alone.
      if (patch.categoryId !== undefined && (tx.kind === 'transfer' || tx.splits?.length)) next.categoryId = tx.categoryId;
      return next;
    }),
  };
}

/** Delete transactions. Both sides of a linked transfer go together. */
export function deleteTransactions(data: AppData, ids: readonly ID[]): AppData {
  const doomed = new Set(ids);
  for (const tx of data.transactions) {
    if (doomed.has(tx.id) && tx.transferPeerId) doomed.add(tx.transferPeerId);
  }
  return { ...data, transactions: data.transactions.filter((tx) => !doomed.has(tx.id)) };
}

export interface ImportOutcome {
  data: AppData;
  imported: number;
  ids: ID[];
}

/**
 * Add rows read from a CSV file. Imported rows arrive unreviewed unless a rule
 * says otherwise. With `keepBalance` the rows are treated as history that the
 * account's balance already reflects, so the balance does not move.
 */
export function importTransactions(
  data: AppData,
  accountId: ID,
  rows: readonly ImportRow[],
  options: { keepBalance: boolean },
): ImportOutcome {
  const account = data.accounts.find((item) => item.id === accountId);
  if (!account || rows.length === 0) return { data, imported: 0, ids: [] };
  const categoryByName = new Map(
    data.categories.filter((category) => !category.archived).map((category) => [category.name.toLowerCase(), category.id]),
  );

  const added: Transaction[] = [];
  let total = 0;
  for (const row of rows) {
    const tx = automate(
      data,
      build({
        accountId,
        date: row.date,
        amount: row.amount,
        payee: row.payee,
        rawPayee: row.rawPayee && row.rawPayee !== row.payee ? row.rawPayee : undefined,
        categoryId: (row.categoryName && categoryByName.get(row.categoryName.toLowerCase())) || null,
        notes: row.notes,
        reviewed: false,
      }),
    );
    added.push(tx);
    total += tx.amount;
  }

  let next: AppData = { ...data, transactions: [...data.transactions, ...added] };
  if (options.keepBalance) {
    next = updateAccount(next, accountId, { openingBalance: account.openingBalance - total });
  }
  return { data: next, imported: added.length, ids: added.map((tx) => tx.id) };
}

// ── Recurring ───────────────────────────────────────────────────────────────

export type NewRecurring = Omit<Recurring, 'id' | 'status' | 'skipped'> & Partial<Pick<Recurring, 'status'>>;

/** Track a recurring item and link the past payments that belong to it. */
export function addRecurring(data: AppData, input: NewRecurring): { data: AppData; id: ID } {
  const id = newId('rec_');
  const recurring: Recurring = { status: 'active', skipped: [], ...input, id, name: input.name.trim() || 'Recurring' };
  const transactions = data.transactions.map((tx) => {
    if (tx.recurringId || tx.kind !== 'standard') return tx;
    return linkRecurring(tx, currencyOf(data, tx.accountId), [recurring]) ? { ...tx, recurringId: id } : tx;
  });
  return { data: { ...data, recurrings: [...data.recurrings, recurring], transactions }, id };
}

export function updateRecurring(data: AppData, id: ID, patch: Partial<Omit<Recurring, 'id'>>): AppData {
  return { ...data, recurrings: replace(data.recurrings, id, patch) };
}

export function deleteRecurring(data: AppData, id: ID): AppData {
  return {
    ...data,
    recurrings: data.recurrings.filter((item) => item.id !== id),
    transactions: data.transactions.map((tx) => (tx.recurringId === id ? { ...tx, recurringId: undefined } : tx)),
  };
}

export function skipOccurrence(data: AppData, id: ID, date: ISODate, skip = true): AppData {
  const recurring = data.recurrings.find((item) => item.id === id);
  if (!recurring) return data;
  const skipped = recurring.skipped.filter((item) => item !== date);
  if (skip) skipped.push(date);
  return updateRecurring(data, id, { skipped: skipped.sort() });
}

/** Record the payment for one due date. Returns the data unchanged if there is no account to pay from. */
export function markPaid(data: AppData, id: ID, due: ISODate, today: ISODate, accountId?: ID): { data: AppData; id: ID } {
  const recurring = data.recurrings.find((item) => item.id === id);
  const account =
    data.accounts.find((item) => item.id === (accountId ?? recurring?.accountId)) ??
    data.accounts.find((item) => !item.archived);
  if (!recurring || !account) return { data, id: '' };
  // Dated today when that still counts for this due date, otherwise on the due date itself.
  const date = Math.abs(diffDays(due, today)) <= matchWindow(recurring.frequency) ? today : due;
  return addTransaction(
    data,
    {
      accountId: account.id,
      date,
      amount: convert(recurring.amount, recurring.currency, account.currency, data.settings.baseCurrency, data.settings.rates),
      payee: recurring.name,
      categoryId: recurring.categoryId,
      recurringId: recurring.id,
    },
    { automate: false },
  );
}

// ── Goals ───────────────────────────────────────────────────────────────────

export type NewGoal = Pick<Goal, 'name' | 'targetAmount' | 'createdDate'> &
  Partial<Pick<Goal, 'icon' | 'color' | 'targetDate' | 'accountId'>>;

export function addGoal(data: AppData, input: NewGoal): { data: AppData; id: ID } {
  const id = newId('goal_');
  const goal: Goal = {
    icon: '🎯',
    color: CATEGORY_COLORS[data.goals.length % CATEGORY_COLORS.length],
    contributions: [],
    archived: false,
    ...input,
    id,
    name: input.name.trim() || 'Goal',
  };
  return { data: { ...data, goals: [...data.goals, goal] }, id };
}

export function updateGoal(data: AppData, id: ID, patch: Partial<Omit<Goal, 'id'>>): AppData {
  return { ...data, goals: replace(data.goals, id, patch) };
}

export function deleteGoal(data: AppData, id: ID): AppData {
  return { ...data, goals: data.goals.filter((goal) => goal.id !== id) };
}

/** Add money to (or, with a negative amount, take money out of) a goal. */
export function contribute(data: AppData, id: ID, amount: number, date: ISODate): AppData {
  const goal = data.goals.find((item) => item.id === id);
  if (!goal || amount === 0) return data;
  return updateGoal(data, id, { contributions: [...goal.contributions, { id: newId('con_'), date, amount }] });
}

// ── Rules ───────────────────────────────────────────────────────────────────

export function addRule(data: AppData, rule: Omit<Rule, 'id'>): { data: AppData; id: ID } {
  const id = newId('rule_');
  return { data: { ...data, rules: [...data.rules, { ...rule, id }] }, id };
}

export function updateRule(data: AppData, id: ID, patch: Partial<Omit<Rule, 'id'>>): AppData {
  return { ...data, rules: replace(data.rules, id, patch) };
}

export function deleteRule(data: AppData, id: ID): AppData {
  return { ...data, rules: data.rules.filter((rule) => rule.id !== id) };
}

/** Move a rule up (-1) or down (+1). Earlier rules win, so order is priority. */
export function moveRule(data: AppData, id: ID, direction: -1 | 1): AppData {
  const index = data.rules.findIndex((rule) => rule.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= data.rules.length) return data;
  const rules = [...data.rules];
  [rules[index], rules[target]] = [rules[target], rules[index]];
  return { ...data, rules };
}

/** Run one rule over the transactions already on file. Returns how many it changed. */
export function applyRuleToExisting(data: AppData, id: ID): { data: AppData; changed: number } {
  const rule = data.rules.find((item) => item.id === id);
  if (!rule) return { data, changed: 0 };
  const targets = new Set(previewRule(rule, data.transactions).map((tx) => tx.id));
  let changed = 0;
  const transactions = data.transactions.map((tx) => {
    if (!targets.has(tx.id)) return tx;
    const next = applyRules(tx, [{ ...rule, enabled: true }]).tx;
    if (next !== tx) changed += 1;
    return next;
  });
  return { data: { ...data, transactions }, changed };
}

// ── Holdings ────────────────────────────────────────────────────────────────

/** True when a bank connection keeps this account up to date. */
export function isSynced(data: Pick<AppData, 'connections'>, accountId: ID): boolean {
  return data.connections.some((connection) => Object.values(connection.links).includes(accountId));
}

/**
 * For an investment account kept by hand, the balance is what its holdings are
 * worth. A synced account takes its balance from the bank instead.
 */
function followHoldings(data: AppData, accountId: ID): AppData {
  const account = data.accounts.find((item) => item.id === accountId);
  if (!account || account.type !== 'investment' || isSynced(data, accountId)) return data;
  const own = data.holdings.filter((holding) => holding.accountId === accountId);
  if (own.length === 0) return data;
  const value = own.reduce(
    (total, holding) => total + convert(holding.marketValue, holding.currency, account.currency, data.settings.baseCurrency, data.settings.rates),
    0,
  );
  return reconcileAccount(data, accountId, value);
}

export type NewHolding = Omit<Holding, 'id' | 'remoteId'>;

export function addHolding(data: AppData, input: NewHolding): { data: AppData; id: ID } {
  const id = newId('hold_');
  const holding: Holding = { ...input, id, name: input.name.trim() || input.symbol || 'Holding', symbol: input.symbol?.trim().toUpperCase() || undefined };
  return { data: followHoldings({ ...data, holdings: [...data.holdings, holding] }, input.accountId), id };
}

export function updateHolding(data: AppData, id: ID, patch: Partial<Omit<Holding, 'id' | 'accountId'>>): AppData {
  const holding = data.holdings.find((item) => item.id === id);
  if (!holding) return data;
  return followHoldings({ ...data, holdings: replace(data.holdings, id, patch) }, holding.accountId);
}

export function deleteHolding(data: AppData, id: ID): AppData {
  const holding = data.holdings.find((item) => item.id === id);
  if (!holding) return data;
  return followHoldings({ ...data, holdings: data.holdings.filter((item) => item.id !== id) }, holding.accountId);
}
