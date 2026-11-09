import { convert, type Rates } from './money';
import type { Account, AppData, CurrencyCode, ID } from './types';

/** Everything needed to express any amount in the base currency. */
export interface Ctx {
  base: CurrencyCode;
  rates: Rates;
  currencyOf: Map<ID, CurrencyCode>;
}

export function makeCtx(data: Pick<AppData, 'settings' | 'accounts'>): Ctx {
  return buildCtx(data.settings.baseCurrency, data.settings.rates, data.accounts);
}

export function buildCtx(base: CurrencyCode, rates: Rates, accounts: readonly Account[]): Ctx {
  return { base, rates, currencyOf: new Map(accounts.map((account) => [account.id, account.currency])) };
}

/** Convert an amount held in `accountId`'s currency into the base currency. */
export function toBase(amount: number, accountId: ID, ctx: Ctx): number {
  const currency = ctx.currencyOf.get(accountId) ?? ctx.base;
  return convert(amount, currency, ctx.base, ctx.base, ctx.rates);
}

export function currencyToBase(amount: number, currency: CurrencyCode, ctx: Ctx): number {
  return convert(amount, currency, ctx.base, ctx.base, ctx.rates);
}

let counter = 0;

/** Short unique id. Random enough for a single-device dataset, and sortable by creation. */
export function newId(prefix = ''): ID {
  counter = (counter + 1) % 1_000_000;
  const random = Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${random}`;
}
