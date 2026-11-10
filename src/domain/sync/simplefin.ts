import { parseAmount } from '../money';
import { cleanPayee } from '../rules';
import type { ISODate } from '../types';

import { decodeBase64, encodeBase64 } from './base64';
import type { RemoteAccount, RemoteHolding, RemoteSnapshot, RemoteTransaction, SyncIssue } from './types';

/**
 * SimpleFIN (https://www.simplefin.org/protocol.html) lets a person share
 * read-only bank data with an app using a token they create themselves. The
 * app talks to the SimpleFIN server directly, so no developer key or backend
 * sits in between. This module is the protocol only: no network calls.
 */

/** Where a person goes to create a token. */
export const SIMPLEFIN_CREATE_URL = 'https://bridge.simplefin.org/simplefin/create';
/** A public, reusable token for SimpleFIN's demo bank. */
export const SIMPLEFIN_DEMO_TOKEN = 'aHR0cHM6Ly9iZXRhLWJyaWRnZS5zaW1wbGVmaW4ub3JnL3NpbXBsZWZpbi9jbGFpbS9ERU1P';
/** The service recommends asking for no more than 45 days of history at a time. */
export const SIMPLEFIN_MAX_DAYS = 44;

export class SimpleFinError extends Error {}

const isSecure = (url: string) => /^https:\/\/[^\s/]+/i.test(url);

/** A setup token is a Base64-encoded URL to claim once. Only https is ever accepted. */
export function claimUrlFromToken(token: string): string {
  const decoded = decodeBase64(token.trim());
  if (!decoded || !isSecure(decoded.trim())) {
    throw new SimpleFinError('That does not look like a SimpleFIN token. Copy the whole token and paste it again.');
  }
  return decoded.trim();
}

export interface Access {
  /** Server root without credentials or a trailing slash. */
  baseUrl: string;
  /** The value for an Authorization header. */
  authorization: string;
}

/** Split an access URL ("https://user:pass@host/path") into a plain URL and a Basic auth header. */
export function parseAccessUrl(accessUrl: string): Access {
  const match = /^https:\/\/([^:@/\s]+):([^@/\s]+)@([^\s]+)$/i.exec(accessUrl.trim());
  if (!match) throw new SimpleFinError('The bank connection did not return a usable address. Create a new token and try again.');
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  return {
    baseUrl: `https://${match[3].replace(/\/+$/, '')}`,
    authorization: `Basic ${encodeBase64(`${decode(match[1])}:${decode(match[2])}`)}`,
  };
}

export interface AccountsQuery {
  /** Only transactions on or after this moment (seconds since the epoch). */
  startDate?: number;
  balancesOnly?: boolean;
}

export function accountsUrl(access: Access, query: AccountsQuery = {}): string {
  const params = ['version=2', 'pending=1'];
  if (query.startDate !== undefined) params.push(`start-date=${Math.floor(query.startDate)}`);
  if (query.balancesOnly) params.push('balances-only=1');
  return `${access.baseUrl}/accounts?${params.join('&')}`;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** Messages come from outside: keep them short, single-line and free of control characters. */
function sanitize(message: unknown): string {
  return text(message)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function dateFromEpoch(seconds: unknown): ISODate | null {
  const value = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function parseTransaction(raw: unknown, currency: string, fallbackDate: ISODate): RemoteTransaction | null {
  if (!isObject(raw)) return null;
  const remoteId = text(raw.id);
  const amount = parseAmount(text(raw.amount), currency, { decimal: '.' });
  if (!remoteId || amount === null) return null;
  const posted = dateFromEpoch(raw.posted);
  const pending = raw.pending === true || posted === null;
  const description = sanitize(raw.description) || 'Unknown';
  const payee = sanitize(raw.payee);
  const memo = sanitize(raw.memo);
  return {
    remoteId,
    // A pending charge has no posting date yet; use when it happened, or failing that the balance date.
    date: (pending ? dateFromEpoch(raw.transacted_at) : null) ?? posted ?? dateFromEpoch(raw.transacted_at) ?? fallbackDate,
    amount,
    payee: payee || undefined,
    description,
    memo: memo && memo !== description ? memo : undefined,
    pending,
  };
}

function parseHolding(raw: unknown, accountCurrency: string): RemoteHolding | null {
  if (!isObject(raw)) return null;
  const currency = /^[A-Z]{3}$/.test(text(raw.currency)) ? text(raw.currency) : accountCurrency;
  const marketValue = parseAmount(text(raw.market_value), currency, { decimal: '.' });
  const shares = Number(text(raw.shares));
  if (!text(raw.id) || marketValue === null || !Number.isFinite(shares)) return null;
  const costBasis = parseAmount(text(raw.cost_basis), currency, { decimal: '.' });
  const symbol = sanitize(raw.symbol).toUpperCase();
  return {
    remoteId: text(raw.id),
    name: sanitize(raw.description) || symbol || 'Holding',
    symbol: symbol || undefined,
    shares,
    marketValue,
    // A cost basis of zero means "unknown" far more often than "free".
    costBasis: costBasis !== null && costBasis > 0 ? costBasis : undefined,
    currency,
  };
}

/**
 * Read an /accounts response. Understands both protocol versions, skips what it
 * cannot read instead of failing, and turns the server's errors into messages
 * that are safe to show.
 */
export function parseAccountSet(payload: unknown, today: ISODate): RemoteSnapshot {
  if (!isObject(payload) || !Array.isArray(payload.accounts)) {
    throw new SimpleFinError('The bank connection sent a reply that could not be read. Try again later.');
  }
  const issues: SyncIssue[] = [];

  // Version 2 reports structured errors; version 1 a list of plain strings.
  for (const raw of Array.isArray(payload.errlist) ? payload.errlist : []) {
    if (!isObject(raw)) continue;
    const code = text(raw.code);
    // "gen.api" is advice for the developer about how the API is being called, not for the person.
    if (code === 'gen.api') continue;
    const message = sanitize(raw.msg);
    if (message) issues.push({ message, needsAttention: /auth/.test(code), remoteAccountId: text(raw.account_id) || undefined });
  }
  if (!Array.isArray(payload.errlist)) {
    for (const raw of Array.isArray(payload.errors) ? payload.errors : []) {
      const message = sanitize(raw);
      if (message) issues.push({ message, needsAttention: /auth|log ?in|credential|reconnect/i.test(message) });
    }
  }

  const connectionNames = new Map<string, string>();
  for (const raw of Array.isArray(payload.connections) ? payload.connections : []) {
    if (isObject(raw) && text(raw.conn_id)) connectionNames.set(text(raw.conn_id), sanitize(raw.name) || sanitize(raw.org_name));
  }

  const accounts: RemoteAccount[] = [];
  for (const raw of payload.accounts) {
    if (!isObject(raw) || !text(raw.id)) continue;
    const name = sanitize(raw.name) || 'Account';
    const currency = text(raw.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      // Points and miles are identified by a URL instead of a currency code.
      issues.push({ message: `${name} was skipped because it is not held in a currency.`, needsAttention: false, remoteAccountId: text(raw.id) });
      continue;
    }
    const balance = parseAmount(text(raw.balance), currency, { decimal: '.' });
    if (balance === null) {
      issues.push({ message: `${name} was skipped because its balance could not be read.`, needsAttention: false, remoteAccountId: text(raw.id) });
      continue;
    }
    const balanceDate = dateFromEpoch(raw['balance-date']) ?? today;
    const organisation = isObject(raw.org) ? sanitize(raw.org.name) || sanitize(raw.org.domain) : '';
    const transactions = (Array.isArray(raw.transactions) ? raw.transactions : [])
      .map((item) => parseTransaction(item, currency, balanceDate))
      .filter((item): item is RemoteTransaction => item !== null);
    accounts.push({
      remoteId: text(raw.id),
      name,
      institution: connectionNames.get(text(raw.conn_id)) || organisation || undefined,
      currency,
      balance,
      balanceDate,
      transactions,
      holdings: Array.isArray(raw.holdings)
        ? raw.holdings.map((item) => parseHolding(item, currency)).filter((item): item is RemoteHolding => item !== null)
        : undefined,
    });
  }
  return { accounts, issues };
}

/** The name to show for a transaction, and the raw bank text to keep alongside it. */
export function namesFor(tx: RemoteTransaction): { payee: string; rawPayee?: string } {
  const payee = tx.payee || cleanPayee(tx.description) || 'Unknown';
  const raw = tx.memo ?? tx.description;
  return { payee, rawPayee: raw && raw !== payee ? raw : undefined };
}
