import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { validateData } from '@/domain/backup';
import type { ImportRow } from '@/domain/csv';
import { demoData, emptyData } from '@/domain/seed';
import type { AppData, ID, ISODate, MonthKey, Rule, Settings, Transaction } from '@/domain/types';

import * as ops from './ops';
import * as sync from './sync';

export const STORAGE_KEY = 'waypoint/data/v1';
const RECOVERY_KEY = 'waypoint/data/unreadable';

interface State {
  data: AppData;
  /** False until saved data has been read from the device. */
  hydrated: boolean;
  /** Set when saved data could not be read. The unreadable copy is kept aside, never deleted. */
  loadError: string | null;
}

interface Actions {
  hydrate: () => Promise<void>;
  startFresh: (baseCurrency: string) => void;
  loadDemo: (baseCurrency: string, today: ISODate) => void;
  restore: (data: AppData) => void;
  eraseEverything: () => void;

  updateSettings: (patch: Partial<Settings>) => void;
  setRate: (currency: string, rate: number | null) => void;

  addAccount: (input: ops.NewAccount) => ID;
  updateAccount: (id: ID, patch: Parameters<typeof ops.updateAccount>[2]) => void;
  reconcileAccount: (id: ID, target: number) => void;
  deleteAccount: (id: ID) => void;

  addGroup: (name: string, kind: 'expense' | 'income') => ID;
  updateGroup: (id: ID, patch: Parameters<typeof ops.updateGroup>[2]) => void;
  deleteGroup: (id: ID) => void;
  addCategory: (input: ops.NewCategory) => ID;
  updateCategory: (id: ID, patch: Parameters<typeof ops.updateCategory>[2]) => void;
  deleteCategory: (id: ID) => void;
  setRollover: (id: ID, on: boolean, month: MonthKey) => void;
  setBudget: (categoryId: ID, month: MonthKey, amount: number, scope: 'month' | 'forward') => void;

  addTransaction: (input: ops.NewTransaction) => ID;
  addTransfer: (input: ops.NewTransfer) => ID;
  updateTransaction: (id: ID, patch: Parameters<typeof ops.updateTransaction>[2]) => void;
  updateTransactions: (ids: readonly ID[], patch: Partial<Pick<Transaction, 'categoryId' | 'reviewed' | 'status'>>) => void;
  deleteTransactions: (ids: readonly ID[]) => void;
  importTransactions: (accountId: ID, rows: readonly ImportRow[], options: { keepBalance: boolean }) => number;

  addRecurring: (input: ops.NewRecurring) => ID;
  updateRecurring: (id: ID, patch: Parameters<typeof ops.updateRecurring>[2]) => void;
  deleteRecurring: (id: ID) => void;
  skipOccurrence: (id: ID, date: ISODate, skip?: boolean) => void;
  markPaid: (id: ID, due: ISODate, today: ISODate, accountId?: ID) => ID;

  addGoal: (input: ops.NewGoal) => ID;
  updateGoal: (id: ID, patch: Parameters<typeof ops.updateGoal>[2]) => void;
  deleteGoal: (id: ID) => void;
  contribute: (id: ID, amount: number, date: ISODate) => void;

  addHolding: (input: ops.NewHolding) => ID;
  updateHolding: (id: ID, patch: Parameters<typeof ops.updateHolding>[2]) => void;
  deleteHolding: (id: ID) => void;
  linkAccounts: (connectionId: ID, choices: Parameters<typeof sync.linkAccounts>[2], remote: Parameters<typeof sync.linkAccounts>[3], today: ISODate) => void;

  addRule: (rule: Omit<Rule, 'id'>) => ID;
  updateRule: (id: ID, patch: Parameters<typeof ops.updateRule>[2]) => void;
  deleteRule: (id: ID) => void;
  moveRule: (id: ID, direction: -1 | 1) => void;
  applyRuleToExisting: (id: ID) => number;
}

export type Store = State & Actions;

export const useStore = create<Store>((set, get) => {
  /** Apply a pure change to the dataset. */
  const change = (fn: (data: AppData) => AppData) => set((state) => ({ data: fn(state.data) }));
  /** Apply a change that also produces a value (usually the new id). */
  const produce = <T>(fn: (data: AppData) => { data: AppData } & T): T => {
    const result = fn(get().data);
    set({ data: result.data });
    return result;
  };

  return {
    data: emptyData('USD'),
    hydrated: false,
    loadError: null,

    hydrate: async () => {
      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          set({ data: validateData(JSON.parse(raw)), hydrated: true, loadError: null });
          return;
        }
        set({ hydrated: true, loadError: null });
      } catch (error) {
        // Never overwrite data we could not read: park it so it can still be recovered.
        if (raw) await AsyncStorage.setItem(RECOVERY_KEY, raw).catch(() => undefined);
        set({ hydrated: true, loadError: error instanceof Error ? error.message : 'Saved data could not be read.' });
      }
    },

    startFresh: (baseCurrency) => set({ data: { ...emptyData(baseCurrency), settings: { ...emptyData(baseCurrency).settings, onboarded: true } } }),
    loadDemo: (baseCurrency, today) => set({ data: demoData(today, baseCurrency) }),
    // A backup never contains bank credentials, so restored connections have to be made again.
    restore: (data) => set({ data: { ...data, connections: [] }, loadError: null }),
    eraseEverything: () => set((state) => ({ data: emptyData(state.data.settings.baseCurrency) })),

    updateSettings: (patch) => change((data) => ops.updateSettings(data, patch)),
    setRate: (currency, rate) => change((data) => ops.setRate(data, currency, rate)),

    addAccount: (input) => produce((data) => ops.addAccount(data, input)).id,
    updateAccount: (id, patch) => change((data) => ops.updateAccount(data, id, patch)),
    reconcileAccount: (id, target) => change((data) => ops.reconcileAccount(data, id, target)),
    deleteAccount: (id) => change((data) => ops.deleteAccount(data, id)),

    addGroup: (name, kind) => produce((data) => ops.addGroup(data, name, kind)).id,
    updateGroup: (id, patch) => change((data) => ops.updateGroup(data, id, patch)),
    deleteGroup: (id) => change((data) => ops.deleteGroup(data, id)),
    addCategory: (input) => produce((data) => ops.addCategory(data, input)).id,
    updateCategory: (id, patch) => change((data) => ops.updateCategory(data, id, patch)),
    deleteCategory: (id) => change((data) => ops.deleteCategory(data, id)),
    setRollover: (id, on, month) => change((data) => ops.setRollover(data, id, on, month)),
    setBudget: (categoryId, month, amount, scope) => change((data) => ops.setBudget(data, categoryId, month, amount, scope)),

    addTransaction: (input) => produce((data) => ops.addTransaction(data, input)).id,
    addTransfer: (input) => produce((data) => ops.addTransfer(data, input)).id,
    updateTransaction: (id, patch) => change((data) => ops.updateTransaction(data, id, patch)),
    updateTransactions: (ids, patch) => change((data) => ops.updateTransactions(data, ids, patch)),
    deleteTransactions: (ids) => change((data) => ops.deleteTransactions(data, ids)),
    importTransactions: (accountId, rows, options) => produce((data) => ops.importTransactions(data, accountId, rows, options)).imported,

    addRecurring: (input) => produce((data) => ops.addRecurring(data, input)).id,
    updateRecurring: (id, patch) => change((data) => ops.updateRecurring(data, id, patch)),
    deleteRecurring: (id) => change((data) => ops.deleteRecurring(data, id)),
    skipOccurrence: (id, date, skip) => change((data) => ops.skipOccurrence(data, id, date, skip)),
    markPaid: (id, due, today, accountId) => produce((data) => ops.markPaid(data, id, due, today, accountId)).id,

    addGoal: (input) => produce((data) => ops.addGoal(data, input)).id,
    updateGoal: (id, patch) => change((data) => ops.updateGoal(data, id, patch)),
    deleteGoal: (id) => change((data) => ops.deleteGoal(data, id)),
    contribute: (id, amount, date) => change((data) => ops.contribute(data, id, amount, date)),

    addHolding: (input) => produce((data) => ops.addHolding(data, input)).id,
    updateHolding: (id, patch) => change((data) => ops.updateHolding(data, id, patch)),
    deleteHolding: (id) => change((data) => ops.deleteHolding(data, id)),
    linkAccounts: (connectionId, choices, remote, today) => change((data) => sync.linkAccounts(data, connectionId, choices, remote, today)),

    addRule: (rule) => produce((data) => ops.addRule(data, rule)).id,
    updateRule: (id, patch) => change((data) => ops.updateRule(data, id, patch)),
    deleteRule: (id) => change((data) => ops.deleteRule(data, id)),
    moveRule: (id, direction) => change((data) => ops.moveRule(data, id, direction)),
    applyRuleToExisting: (id) => produce((data) => ops.applyRuleToExisting(data, id)).changed,
  };
});

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: AppData | null = null;

/** Write any unsaved change to the device now. Call when the app goes to the background. */
export async function flushSave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!pending) return;
  const data = pending;
  pending = null;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Save after every change, shortly after the last one in a burst. Nothing is
 * written before saved data has been read, so a slow start can never replace
 * real data with the empty default.
 */
export function startAutosave(delayMs = 250): () => void {
  return useStore.subscribe((state, previous) => {
    if (!state.hydrated || state.loadError || state.data === previous.data) return;
    pending = state.data;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flushSave();
    }, delayMs);
  });
}
