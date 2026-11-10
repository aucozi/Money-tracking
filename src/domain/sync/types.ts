import type { CurrencyCode, ISODate } from '../types';

/**
 * What any bank data service gives us, in one shape. A new service only has to
 * produce these; merging them into the ledger is shared.
 */
export interface RemoteTransaction {
  remoteId: string;
  date: ISODate;
  /** Signed minor units: negative for money leaving the account. */
  amount: number;
  /** A readable name for who was paid, when the service provides one. */
  payee?: string;
  /** What the transaction was for, as the bank describes it. */
  description: string;
  /** The raw statement text, when given separately. */
  memo?: string;
  pending: boolean;
}

export interface RemoteHolding {
  remoteId: string;
  name: string;
  symbol?: string;
  shares: number;
  marketValue: number;
  costBasis?: number;
  currency: CurrencyCode;
}

export interface RemoteAccount {
  remoteId: string;
  name: string;
  institution?: string;
  currency: CurrencyCode;
  /** Signed minor units, as the bank reports it. */
  balance: number;
  balanceDate: ISODate;
  transactions: RemoteTransaction[];
  /** Undefined when the service says nothing about holdings for this account. */
  holdings?: RemoteHolding[];
}

export interface SyncIssue {
  /** Safe to show: already trimmed and stripped of control characters. */
  message: string;
  /** True when the person has to act, e.g. sign in to the bank again. */
  needsAttention: boolean;
  remoteAccountId?: string;
}

export interface RemoteSnapshot {
  accounts: RemoteAccount[];
  issues: SyncIssue[];
}
