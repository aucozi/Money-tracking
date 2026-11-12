import { accountTypeFromName } from '@/domain/accounts';
import { addDays, diffDays } from '@/domain/dates';
import { accountBalances, openingBalanceFor } from '@/domain/networth';
import { namesFor } from '@/domain/sync/simplefin';
import type { RemoteAccount, RemoteTransaction } from '@/domain/sync/types';
import { normalizePayee } from '@/domain/transactions';
import type { Account, AccountType, AppData, Connection, Holding, ID, ISODate, Transaction } from '@/domain/types';
import { newId } from '@/domain/context';

import { automate, build } from './ops';

/**
 * Merging what a bank reports into the ledger. Pure functions: the network
 * side lives elsewhere and hands its results to these.
 *
 * The bank is the authority on amounts, dates, pending state and balances.
 * The person is the authority on names, categories, notes, tags and splits,
 * and nothing here ever overwrites those.
 */

export interface SyncSummary {
  added: number;
  /** Bank changed something about a transaction already on file. */
  updated: number;
  /** Recognised as something entered by hand or imported earlier, and linked instead of duplicated. */
  matched: number;
  /** Pending charges the bank dropped. */
  removed: number;
  accounts: number;
  problems: string[];
}

const emptySummary = (): SyncSummary => ({ added: 0, updated: 0, matched: 0, removed: 0, accounts: 0, problems: [] });

const prefixFor = (connectionId: ID, remoteAccountId: string) => `${connectionId}/${remoteAccountId}/`;

function similarPayee(a: string, b: string): boolean {
  const left = normalizePayee(a);
  const right = normalizePayee(b);
  if (!left || !right) return false;
  return left === right || (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left)));
}

function names(tx: Transaction): string[] {
  return [tx.payee, tx.rawPayee ?? ''].filter(Boolean);
}

function looksLike(local: Transaction, remote: RemoteTransaction): boolean {
  const { payee, rawPayee } = namesFor(remote);
  const candidates = [payee, rawPayee ?? '', remote.description];
  return names(local).some((mine) => candidates.some((theirs) => similarPayee(mine, theirs)));
}

/** Guess what kind of account this is; one that reports holdings is an investment account whatever it is called. */
export function guessAccountType(remote: Pick<RemoteAccount, 'name' | 'holdings' | 'balance'>): AccountType {
  return remote.holdings?.length ? 'investment' : accountTypeFromName(remote.name);
}

export type LinkChoice = { kind: 'new' } | { kind: 'existing'; accountId: ID } | { kind: 'skip' };

/** Record a new connection and what it offers. Nothing is imported until accounts are linked. */
export function addConnection(data: AppData, input: { id?: ID; name: string; remote: readonly RemoteAccount[] }): { data: AppData; id: ID } {
  const id = input.id ?? newId('conn_');
  const connection: Connection = {
    id,
    provider: 'simplefin',
    name: input.name.trim() || 'Bank connection',
    links: {},
    remoteAccounts: input.remote.map((account) => ({ id: account.remoteId, name: account.name, institution: account.institution, currency: account.currency })),
  };
  return { data: { ...data, connections: [...data.connections, connection] }, id };
}

/**
 * Decide which of a connection's accounts to follow. "new" creates a local
 * account to receive it; "existing" attaches it to one already here; "skip"
 * stops following it (its history stays).
 */
export function linkAccounts(
  data: AppData,
  connectionId: ID,
  choices: Readonly<Record<string, LinkChoice>>,
  remote: readonly RemoteAccount[],
  today: ISODate,
): AppData {
  const connection = data.connections.find((item) => item.id === connectionId);
  if (!connection) return data;
  const links = { ...connection.links };
  let accounts = data.accounts;

  for (const [remoteId, choice] of Object.entries(choices)) {
    const source = remote.find((account) => account.remoteId === remoteId);
    if (choice.kind === 'skip') {
      delete links[remoteId];
    } else if (choice.kind === 'existing') {
      const target = accounts.find((account) => account.id === choice.accountId);
      // An account can only follow one remote account, and only one in its own currency.
      const taken = data.connections.some((other) =>
        Object.entries(other.links).some(
          ([otherRemote, accountId]) => accountId === choice.accountId && !(other.id === connectionId && otherRemote === remoteId),
        ),
      );
      if (target && !taken && (!source || source.currency === target.currency)) links[remoteId] = target.id;
    } else if (source && !links[remoteId]) {
      const account: Account = {
        id: newId('acc_'),
        name: source.name,
        type: guessAccountType(source),
        currency: source.currency,
        openingBalance: 0,
        openingDate: today,
        archived: false,
        includeInNetWorth: true,
      };
      accounts = [...accounts, account];
      links[remoteId] = account.id;
    }
  }
  return {
    ...data,
    accounts,
    connections: data.connections.map((item) => (item.id === connectionId ? { ...item, links } : item)),
  };
}

/** Forget a connection. Accounts and their transactions stay exactly as they are. */
export function removeConnection(data: AppData, connectionId: ID): AppData {
  return { ...data, connections: data.connections.filter((connection) => connection.id !== connectionId) };
}

export function noteSyncFailure(data: AppData, connectionId: ID, message: string): AppData {
  return { ...data, connections: data.connections.map((item) => (item.id === connectionId ? { ...item, lastError: message } : item)) };
}

/**
 * Bring linked accounts up to date with what the bank reports.
 *
 * `since` is the first day the response covers; pending charges on or after it
 * that the bank no longer lists were dropped by the bank and are removed here.
 */
export function applySync(
  data: AppData,
  connectionId: ID,
  remote: readonly RemoteAccount[],
  options: { today: ISODate; since: ISODate; now: number; issues?: readonly string[] },
): { data: AppData; summary: SyncSummary } {
  const connection = data.connections.find((item) => item.id === connectionId);
  const summary = emptySummary();
  if (!connection) return { data, summary };
  summary.problems.push(...(options.issues ?? []));

  let transactions = data.transactions;
  let accounts = data.accounts;
  let holdings = data.holdings;

  for (const source of remote) {
    const accountId = connection.links[source.remoteId];
    const account = accounts.find((item) => item.id === accountId);
    if (!account) continue;
    if (account.currency !== source.currency) {
      summary.problems.push(`${source.name} is in ${source.currency} but ${account.name} is in ${account.currency}, so it was not updated.`);
      continue;
    }
    summary.accounts += 1;

    const prefix = prefixFor(connectionId, source.remoteId);
    const mine = transactions.filter((tx) => tx.accountId === account.id);
    const known = new Map(mine.filter((tx) => tx.remoteId?.startsWith(prefix)).map((tx) => [tx.remoteId as string, tx]));
    const listed = new Set(source.transactions.map((tx) => prefix + tx.remoteId));
    // Pending charges we hold that the bank no longer lists: either dropped, or about to return posted under a new id.
    const orphaned = [...known.values()].filter((tx) => tx.status === 'pending' && !listed.has(tx.remoteId as string) && tx.date >= options.since);
    const byHand = mine.filter((tx) => !tx.remoteId);
    const claimed = new Set<ID>();
    const changes = new Map<ID, Transaction>();
    const additions: Transaction[] = [];

    for (const incoming of source.transactions) {
      const remoteId = prefix + incoming.remoteId;
      const status = incoming.pending ? ('pending' as const) : ('cleared' as const);
      const current = known.get(remoteId);

      if (current) {
        if (current.amount !== incoming.amount || current.date !== incoming.date || current.status !== status) {
          changes.set(current.id, { ...current, amount: incoming.amount, date: incoming.date, status });
          summary.updated += 1;
        }
        continue;
      }

      // A pending charge that has now posted under a new id, perhaps with a tip added.
      const posted = orphaned.find((tx) => {
        if (claimed.has(tx.id) || Math.sign(tx.amount) !== Math.sign(incoming.amount)) return false;
        const drift = Math.abs(Math.abs(tx.amount) - Math.abs(incoming.amount)) / Math.max(1, Math.abs(tx.amount));
        return drift <= 0.25 && Math.abs(diffDays(tx.date, incoming.date)) <= 10 && looksLike(tx, incoming);
      });
      if (posted) {
        claimed.add(posted.id);
        changes.set(posted.id, { ...posted, remoteId, amount: incoming.amount, date: incoming.date, status });
        summary.updated += 1;
        continue;
      }

      // Something already entered by hand or imported from a file: link it rather than duplicate it.
      const manual = byHand.find((tx) => {
        if (claimed.has(tx.id) || tx.amount !== incoming.amount || Math.abs(diffDays(tx.date, incoming.date)) > 4) return false;
        return tx.date === incoming.date || looksLike(tx, incoming);
      });
      if (manual) {
        claimed.add(manual.id);
        const { rawPayee } = namesFor(incoming);
        changes.set(manual.id, { ...manual, remoteId, date: incoming.date, status, rawPayee: manual.rawPayee ?? rawPayee });
        summary.matched += 1;
        continue;
      }

      const { payee, rawPayee } = namesFor(incoming);
      additions.push(
        automate(data, build({ accountId: account.id, date: incoming.date, amount: incoming.amount, payee, rawPayee, status, reviewed: false, remoteId })),
      );
      summary.added += 1;
    }

    const dropped = new Set(orphaned.filter((tx) => !claimed.has(tx.id)).map((tx) => tx.id));
    summary.removed += dropped.size;
    transactions = [...transactions.filter((tx) => !dropped.has(tx.id)).map((tx) => changes.get(tx.id) ?? tx), ...additions];

    // History may reach back before the day the account was added here.
    const earliest = additions.reduce((first, tx) => (tx.date < first ? tx.date : first), account.openingDate);
    const balance = accountBalances([account], transactions).get(account.id) ?? 0;
    const reconciled: Account = { ...account, openingDate: earliest, openingBalance: openingBalanceFor(account, balance, source.balance) };
    accounts = accounts.map((item) => (item.id === account.id ? reconciled : item));

    if (source.holdings) {
      const previous = new Map(
        holdings.filter((holding) => holding.accountId === account.id && holding.remoteId).map((holding) => [holding.remoteId as string, holding]),
      );
      const fresh: Holding[] = source.holdings.map((item) => ({
        id: previous.get(item.remoteId)?.id ?? newId('hold_'),
        accountId: account.id,
        name: item.name,
        symbol: item.symbol,
        shares: item.shares,
        marketValue: item.marketValue,
        costBasis: item.costBasis,
        currency: item.currency,
        updatedAt: source.balanceDate > options.today ? options.today : source.balanceDate,
        remoteId: item.remoteId,
      }));
      // Holdings the bank reports replace the ones it reported before; ones added by hand are kept.
      holdings = [...holdings.filter((holding) => holding.accountId !== account.id || !holding.remoteId), ...fresh];
    }
  }

  const offered = remote.map((account) => ({ id: account.remoteId, name: account.name, institution: account.institution, currency: account.currency }));
  const connections = data.connections.map((item) =>
    item.id === connectionId
      ? { ...item, remoteAccounts: offered.length > 0 ? offered : item.remoteAccounts, lastSyncedAt: options.now, lastError: summary.problems[0] }
      : item,
  );
  return { data: { ...data, transactions, accounts, holdings, connections }, summary };
}

/** How far back to ask the bank for, given when we last heard from it. */
export function syncWindowStart(connection: Pick<Connection, 'lastSyncedAt'>, today: ISODate, maxDays: number): ISODate {
  if (!connection.lastSyncedAt) return addDays(today, -maxDays);
  const last = new Date(connection.lastSyncedAt).toISOString().slice(0, 10);
  // Overlap by ten days so late corrections and pending charges that post are picked up.
  const from = addDays(last, -10);
  const limit = addDays(today, -maxDays);
  return from < limit ? limit : from;
}
