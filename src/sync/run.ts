import { create } from 'zustand';

import { newId } from '@/domain/context';
import { todayISO } from '@/domain/dates';
import { SIMPLEFIN_MAX_DAYS, SimpleFinError } from '@/domain/sync/simplefin';
import type { RemoteAccount } from '@/domain/sync/types';
import type { ID } from '@/domain/types';
import { deleteSecret, readSecret, saveSecret } from '@/platform/secrets';
import { useStore } from '@/store/store';
import { addConnection, applySync, noteSyncFailure, removeConnection, syncWindowStart, type SyncSummary } from '@/store/sync';

import { claimAccessUrl, fetchSnapshot } from './client';

/** Banks refresh about once a day and the service limits requests, so there is no point asking more often than this. */
export const AUTO_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;

interface SyncState {
  running: boolean;
  /** What the linking screen needs after a new connection is made. */
  offered: Record<ID, RemoteAccount[]>;
}

export const useSync = create<SyncState>(() => ({ running: false, offered: {} }));

const epochSeconds = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
const reason = (error: unknown) => (error instanceof SimpleFinError ? error.message : 'Something went wrong while syncing. Try again later.');

/**
 * Claim a setup token and remember the connection. The credential goes to the
 * keychain; only the list of accounts on offer goes into the dataset.
 */
export async function connect(token: string): Promise<{ connectionId: ID; accounts: RemoteAccount[] }> {
  const accessUrl = await claimAccessUrl(token);
  const today = todayISO();
  const snapshot = await fetchSnapshot(accessUrl, { balancesOnly: true }, today);
  if (snapshot.accounts.length === 0) {
    throw new SimpleFinError(snapshot.issues[0]?.message ?? 'This connection has no accounts yet. Add a bank in SimpleFIN first, then connect again.');
  }
  const connectionId = newId('conn_');
  await saveSecret(connectionId, accessUrl);
  const name = snapshot.accounts.find((account) => account.institution)?.institution ?? 'Bank connection';
  useStore.setState((state) => ({ data: addConnection(state.data, { id: connectionId, name, remote: snapshot.accounts }).data }));
  useSync.setState((state) => ({ offered: { ...state.offered, [connectionId]: snapshot.accounts } }));
  return { connectionId, accounts: snapshot.accounts };
}

/** Fetch and merge one connection. Failures are recorded on the connection and returned, never thrown. */
export async function syncConnection(connectionId: ID): Promise<SyncSummary | { error: string }> {
  const connection = useStore.getState().data.connections.find((item) => item.id === connectionId);
  if (!connection) return { error: 'This connection no longer exists.' };
  const today = todayISO();
  const since = syncWindowStart(connection, today, SIMPLEFIN_MAX_DAYS);
  try {
    const accessUrl = await readSecret(connectionId);
    if (!accessUrl) throw new SimpleFinError('The saved access for this connection is missing on this device. Connect again with a new token.');
    const snapshot = await fetchSnapshot(accessUrl, { startDate: epochSeconds(since) }, today);
    let summary: SyncSummary | undefined;
    useStore.setState((state) => {
      const result = applySync(state.data, connectionId, snapshot.accounts, {
        today,
        since,
        now: Date.now(),
        issues: snapshot.issues.map((issue) => issue.message),
      });
      summary = result.summary;
      return { data: result.data };
    });
    useSync.setState((state) => ({ offered: { ...state.offered, [connectionId]: snapshot.accounts } }));
    return summary as SyncSummary;
  } catch (error) {
    const message = reason(error);
    useStore.setState((state) => ({ data: noteSyncFailure(state.data, connectionId, message) }));
    return { error: message };
  }
}

export interface SyncAllResult {
  added: number;
  errors: string[];
  synced: number;
}

/**
 * Sync every connection. With `onlyIfStale`, connections heard from recently
 * are left alone, which is what runs when the app opens.
 */
export async function syncAll(options: { onlyIfStale?: boolean } = {}): Promise<SyncAllResult> {
  const result: SyncAllResult = { added: 0, errors: [], synced: 0 };
  if (useSync.getState().running) return result;
  const due = useStore
    .getState()
    .data.connections.filter((connection) => Object.keys(connection.links).length > 0)
    .filter((connection) => !options.onlyIfStale || !connection.lastSyncedAt || Date.now() - connection.lastSyncedAt > AUTO_SYNC_INTERVAL_MS);
  if (due.length === 0) return result;

  useSync.setState({ running: true });
  try {
    for (const connection of due) {
      const outcome = await syncConnection(connection.id);
      if ('error' in outcome) {
        result.errors.push(outcome.error);
      } else {
        result.synced += 1;
        result.added += outcome.added;
        result.errors.push(...outcome.problems);
      }
    }
  } finally {
    useSync.setState({ running: false });
  }
  return result;
}

/** Forget a connection and erase its credential from the keychain. Accounts and history stay. */
export async function disconnect(connectionId: ID): Promise<void> {
  await deleteSecret(connectionId).catch(() => undefined);
  useStore.setState((state) => ({ data: removeConnection(state.data, connectionId) }));
  useSync.setState((state) => {
    const { [connectionId]: _gone, ...offered } = state.offered;
    return { offered };
  });
}
