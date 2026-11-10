/**
 * Core data model. Everything here is plain JSON so the whole dataset can be
 * persisted, backed up and restored without any transformation.
 *
 * Conventions
 * - Money is an integer in the currency's minor unit (cents). Never a float.
 * - Amounts are signed: negative = money leaving the account, positive = money arriving.
 * - Dates are calendar dates ("YYYY-MM-DD") with no time or timezone, so a
 *   transaction never drifts to a neighbouring day.
 */

export type ID = string;
/** Calendar date, "YYYY-MM-DD". */
export type ISODate = string;
/** Calendar month, "YYYY-MM". */
export type MonthKey = string;
/** ISO 4217 code, e.g. "EUR". */
export type CurrencyCode = string;

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit' | 'loan' | 'investment' | 'other';

export interface Account {
  id: ID;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /** Balance on `openingDate`, before any recorded transaction. Negative for money owed. */
  openingBalance: number;
  openingDate: ISODate;
  archived: boolean;
  includeInNetWorth: boolean;
  /** Annual interest rate in percent, for credit and loan accounts. */
  apr?: number;
  /** Minimum monthly payment in minor units, for credit and loan accounts. */
  minPayment?: number;
}

export type CategoryKind = 'expense' | 'income';

export interface CategoryGroup {
  id: ID;
  name: string;
  kind: CategoryKind;
  sort: number;
}

export interface Category {
  id: ID;
  name: string;
  groupId: ID;
  kind: CategoryKind;
  icon: string;
  color: string;
  archived: boolean;
  /** Carry unspent (or overspent) budget into following months. */
  rollover: boolean;
  /** First month whose leftover is carried. Set when rollover is switched on. */
  rolloverFrom?: MonthKey;
  sort: number;
}

export interface Split {
  id: ID;
  amount: number;
  categoryId: ID | null;
  notes?: string;
}

export type TransactionStatus = 'pending' | 'cleared';
export type TransactionKind = 'standard' | 'transfer';

export interface Transaction {
  id: ID;
  accountId: ID;
  date: ISODate;
  /** Signed, in the account's currency. */
  amount: number;
  payee: string;
  /** Descriptor exactly as the bank exported it, kept so rules can be re-run. */
  rawPayee?: string;
  categoryId: ID | null;
  notes?: string;
  tags: string[];
  status: TransactionStatus;
  /** Transfers move money between your own accounts and never count as spending or income. */
  kind: TransactionKind;
  transferPeerId?: ID;
  /** When present, the parts replace `categoryId` and must add up to `amount`. */
  splits?: Split[];
  /** Budget this transaction evenly over N months starting with its own month. */
  spreadMonths?: number;
  reviewed: boolean;
  recurringId?: ID;
  /** Set on transactions that arrived through a bank connection: "connection/account/id". */
  remoteId?: string;
  /** What was actually charged when the purchase was made in another currency. */
  original?: { amount: number; currency: CurrencyCode };
  createdAt: number;
}

/** A budget amount that applies from `from` until the next entry. */
export interface BudgetEntry {
  from: MonthKey;
  amount: number;
}

export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'active' | 'paused' | 'archived';

export interface Recurring {
  id: ID;
  name: string;
  /** Signed like a transaction: negative for bills, positive for income. */
  amount: number;
  currency: CurrencyCode;
  accountId?: ID;
  categoryId: ID | null;
  frequency: Frequency;
  /** The first due date being tracked; later ones follow from it by `frequency`. */
  anchorDate: ISODate;
  endDate?: ISODate;
  status: RecurringStatus;
  /** Text an incoming transaction's payee must contain to be linked automatically. */
  matchText: string;
  /** How far the amount may differ and still be linked, in percent. */
  tolerancePct: number;
  /** Due dates the user chose to skip. */
  skipped: ISODate[];
}

export interface GoalContribution {
  id: ID;
  date: ISODate;
  amount: number;
}

export interface Goal {
  id: ID;
  name: string;
  icon: string;
  color: string;
  /** In the base currency. */
  targetAmount: number;
  targetDate?: ISODate;
  /** When set, progress follows this account's balance instead of manual contributions. */
  accountId?: ID;
  contributions: GoalContribution[];
  createdDate: ISODate;
  archived: boolean;
}

export type PayeeMatch = 'contains' | 'startsWith' | 'exact';

export interface RuleConditions {
  payeeText?: string;
  payeeMatch: PayeeMatch;
  /** Compared against the absolute amount, in the account's minor units. */
  amountMin?: number;
  amountMax?: number;
  accountId?: ID;
  direction?: 'expense' | 'income';
}

export interface RuleActions {
  categoryId?: ID;
  renameTo?: string;
  addTags?: string[];
  markReviewed?: boolean;
  markTransfer?: boolean;
}

export interface Rule {
  id: ID;
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
}

/** A position in an investment account: shares of a fund, a stock, a coin. */
export interface Holding {
  id: ID;
  accountId: ID;
  name: string;
  symbol?: string;
  /** May be fractional. */
  shares: number;
  /** What the whole position is worth now, in minor units of `currency`. */
  marketValue: number;
  /** What was paid for the whole position, when known. */
  costBasis?: number;
  currency: CurrencyCode;
  updatedAt: ISODate;
  /** Set when the holding comes from a bank connection; those are replaced on every sync. */
  remoteId?: string;
}

/** An account a connection offers, as the bank names it. */
export interface RemoteAccountInfo {
  id: string;
  name: string;
  institution?: string;
  currency: CurrencyCode;
}

/**
 * A link to a bank data service. The credential itself is never part of the
 * dataset: it lives in the device keychain and is left out of backups.
 */
export interface Connection {
  id: ID;
  provider: 'simplefin';
  name: string;
  /** Remote account id -> local account id. Remote accounts not listed here are not imported. */
  links: Record<string, ID>;
  /** What the connection offered last time, for choosing which accounts to import. */
  remoteAccounts: RemoteAccountInfo[];
  /** Milliseconds since the epoch. */
  lastSyncedAt?: number;
  lastError?: string;
}

export type BudgetMode = 'tracking' | 'zero';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  baseCurrency: CurrencyCode;
  /** How many units of the base currency one unit of each currency is worth. */
  rates: Record<CurrencyCode, number>;
  budgetMode: BudgetMode;
  theme: ThemePreference;
  onboarded: boolean;
  /** Include typical everyday spending when projecting balances. */
  forecastEverydaySpending: boolean;
}

export interface AppData {
  schemaVersion: number;
  settings: Settings;
  accounts: Account[];
  categoryGroups: CategoryGroup[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Record<ID, BudgetEntry[]>;
  recurrings: Recurring[];
  goals: Goal[];
  rules: Rule[];
  holdings: Holding[];
  connections: Connection[];
}

/** Version 2 added holdings and bank connections. Older data loads with both empty. */
export const SCHEMA_VERSION = 2;

export const LIABILITY_TYPES: readonly AccountType[] = ['credit', 'loan'];

export function isLiability(account: Pick<Account, 'type'>): boolean {
  return LIABILITY_TYPES.includes(account.type);
}

/** Accounts whose balance is spendable cash, used for forecasting. */
export function isCashAccount(account: Pick<Account, 'type'>): boolean {
  return account.type === 'checking' || account.type === 'savings' || account.type === 'cash';
}
