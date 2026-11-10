import { useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { makeCtx } from '@/domain/context';
import { todayISO } from '@/domain/dates';
import { accountBalances } from '@/domain/networth';
import { buildActivityIndex, type TxFilter } from '@/domain/transactions';
import type { ISODate } from '@/domain/types';

import { useStore } from './store';

export const useData = () => useStore((state) => state.data);

/** Today's date, refreshed whenever the app comes back to the foreground. */
export function useToday(): ISODate {
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => {
    const refresh = () => setToday((current) => (current === todayISO() ? current : todayISO()));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const timer = setInterval(refresh, 60_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, []);
  return today;
}

/** The current time, refreshed every half minute, for labels like "5 minutes ago". */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useCtx() {
  const settings = useStore((state) => state.data.settings);
  const accounts = useStore((state) => state.data.accounts);
  return useMemo(() => makeCtx({ settings, accounts }), [settings, accounts]);
}

export function useActivityIndex() {
  const transactions = useStore((state) => state.data.transactions);
  const ctx = useCtx();
  return useMemo(() => buildActivityIndex(transactions, ctx), [transactions, ctx]);
}

/** Current balance of every account, in its own currency. */
export function useBalances() {
  const accounts = useStore((state) => state.data.accounts);
  const transactions = useStore((state) => state.data.transactions);
  return useMemo(() => accountBalances(accounts, transactions), [accounts, transactions]);
}

interface UiState {
  /** The filter on the Transactions tab; other screens set it before navigating there. */
  txFilter: TxFilter;
  setTxFilter: (filter: TxFilter) => void;
}

export const useUi = create<UiState>((set) => ({
  txFilter: {},
  setTxFilter: (txFilter) => set({ txFilter }),
}));
