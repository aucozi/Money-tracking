import type { CurrencyCode } from './types';

/** Currencies offered in pickers. Any other ISO code still works if imported. */
export const COMMON_CURRENCIES: { code: CurrencyCode; name: string }[] = [
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'CAD', name: 'Canadian dollar' },
  { code: 'AUD', name: 'Australian dollar' },
  { code: 'NZD', name: 'New Zealand dollar' },
  { code: 'CHF', name: 'Swiss franc' },
  { code: 'SEK', name: 'Swedish krona' },
  { code: 'NOK', name: 'Norwegian krone' },
  { code: 'DKK', name: 'Danish krone' },
  { code: 'PLN', name: 'Polish złoty' },
  { code: 'CZK', name: 'Czech koruna' },
  { code: 'HUF', name: 'Hungarian forint' },
  { code: 'RON', name: 'Romanian leu' },
  { code: 'TRY', name: 'Turkish lira' },
  { code: 'JPY', name: 'Japanese yen' },
  { code: 'CNY', name: 'Chinese yuan' },
  { code: 'HKD', name: 'Hong Kong dollar' },
  { code: 'SGD', name: 'Singapore dollar' },
  { code: 'KRW', name: 'South Korean won' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'AED', name: 'UAE dirham' },
  { code: 'ILS', name: 'Israeli shekel' },
  { code: 'ZAR', name: 'South African rand' },
  { code: 'MXN', name: 'Mexican peso' },
  { code: 'BRL', name: 'Brazilian real' },
  { code: 'KWD', name: 'Kuwaiti dinar' },
];

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'UGX', 'XAF', 'XOF', 'PYG', 'RWF']);
const THREE_DECIMAL = new Set(['KWD', 'BHD', 'OMR', 'JOD', 'TND']);

/** Number of digits after the decimal point for a currency. */
export function currencyDecimals(currency: CurrencyCode): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

function scale(currency: CurrencyCode): number {
  return 10 ** currencyDecimals(currency);
}

/** Convert a decimal amount (12.34) to minor units (1234). */
export function toMinor(major: number, currency: CurrencyCode): number {
  // Go through a fixed string so 1.005 * 100 style float error cannot round the wrong way.
  const decimals = currencyDecimals(currency);
  const sign = major < 0 ? -1 : 1;
  const shifted = Number(`${Math.abs(major)}e${decimals}`);
  const rounded = Math.round(Number.isFinite(shifted) ? shifted : Math.abs(major) * scale(currency));
  return rounded === 0 ? 0 : sign * rounded;
}

export function fromMinor(minor: number, currency: CurrencyCode): number {
  return minor / scale(currency);
}

export interface ParseOptions {
  /** 'auto' treats the last separator as the decimal point when both appear. */
  decimal?: '.' | ',' | 'auto';
}

/**
 * Parse what a person or a bank export wrote into minor units.
 * Accepts "1,234.56", "1.234,56", "1 234,56", "(45.00)", "45-", "€ -12", "+3".
 * Returns null when there is no number to read.
 */
export function parseAmount(input: string, currency: CurrencyCode, options: ParseOptions = {}): number | null {
  if (typeof input !== 'string') return null;
  let text = input.trim();
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  // Unicode minus and trailing minus are both common in bank exports.
  text = text.replace(/[−–]/g, '-');
  if (/-\s*$/.test(text)) {
    negative = true;
    text = text.replace(/-\s*$/, '');
  }
  if (/^[^\d.,]*-/.test(text)) negative = true;

  const body = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(body)) return null;

  const decimalMode = options.decimal ?? 'auto';
  let decimalSep: '.' | ',' | null;
  if (decimalMode === '.' || decimalMode === ',') {
    decimalSep = body.includes(decimalMode) ? decimalMode : null;
  } else {
    const lastDot = body.lastIndexOf('.');
    const lastComma = body.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      decimalSep = lastDot > lastComma ? '.' : ',';
    } else if (lastComma >= 0) {
      // "1,234" and "1,234,567" are grouped thousands; "12,5" and "0,99" are decimals.
      const groups = body.split(',');
      const grouped = groups.length > 2 || (groups[1].length === 3 && groups[0].length <= 3 && groups[0] !== '0');
      decimalSep = grouped ? null : ',';
    } else if (lastDot >= 0) {
      decimalSep = body.split('.').length > 2 ? null : '.';
    } else {
      decimalSep = null;
    }
  }

  let whole = body;
  let fraction = '';
  if (decimalSep) {
    const at = body.lastIndexOf(decimalSep);
    whole = body.slice(0, at);
    fraction = body.slice(at + 1).replace(/[.,]/g, '');
  }
  whole = whole.replace(/[.,]/g, '');

  const decimals = currencyDecimals(currency);
  const value = Number(`${whole || '0'}.${fraction || '0'}`);
  if (!Number.isFinite(value)) return null;
  const minor = toMinor(Number(value.toFixed(decimals + 2)), currency);
  return negative ? -minor : minor;
}

export interface FormatOptions {
  /** 'always' prefixes positive amounts with "+"; 'never' drops the sign. */
  sign?: 'auto' | 'always' | 'never';
  /** Drop the decimals, for headline figures. */
  whole?: boolean;
  locale?: string;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: CurrencyCode, whole: boolean, locale?: string): Intl.NumberFormat {
  const key = `${locale ?? ''}|${currency}|${whole}`;
  let found = formatters.get(key);
  if (!found) {
    const decimals = whole ? 0 : currencyDecimals(currency);
    try {
      found = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch {
      // Unknown code: fall back to a plain number so the amount is still readable.
      found = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    formatters.set(key, found);
  }
  return found;
}

export function formatMoney(minor: number, currency: CurrencyCode, options: FormatOptions = {}): string {
  const { sign = 'auto', whole = false, locale } = options;
  const value = fromMinor(Math.abs(minor), currency);
  const text = formatter(currency, whole, locale).format(value);
  if (sign === 'never' || minor === 0) return text;
  if (minor < 0) return `−${text}`;
  return sign === 'always' ? `+${text}` : text;
}

/** Decimal text for an amount field, e.g. 1234 -> "12.34". */
export function toInputString(minor: number, currency: CurrencyCode): string {
  return fromMinor(Math.abs(minor), currency).toFixed(currencyDecimals(currency));
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/**
 * Split an integer amount into parts proportional to `weights` without losing
 * or inventing a cent. Leftover units go to the parts with the largest remainders.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const weightSum = sum(weights);
  if (weightSum <= 0) throw new Error('allocate: weights must add up to more than zero');
  const sign = total < 0 ? -1 : 1;
  const absolute = Math.abs(total);
  const exact = weights.map((weight) => (absolute * weight) / weightSum);
  const parts = exact.map(Math.floor);
  let remainder = absolute - sum(parts);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
    parts[order[i].index] += 1;
    remainder -= 1;
  }
  return parts.map((part) => (part === 0 ? 0 : part * sign));
}

export type Rates = Record<CurrencyCode, number>;

/** Units of base currency per one unit of `currency`. Missing rates count as 1. */
export function rateFor(currency: CurrencyCode, base: CurrencyCode, rates: Rates): number {
  if (currency === base) return 1;
  const rate = rates[currency];
  return typeof rate === 'number' && rate > 0 ? rate : 1;
}

export function hasRate(currency: CurrencyCode, base: CurrencyCode, rates: Rates): boolean {
  return currency === base || (typeof rates[currency] === 'number' && rates[currency] > 0);
}

/** Convert between any two currencies through the base currency. */
export function convert(
  minor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  base: CurrencyCode,
  rates: Rates,
): number {
  if (from === to) return minor;
  const inBase = fromMinor(minor, from) * rateFor(from, base, rates);
  return toMinor(inBase / rateFor(to, base, rates), to);
}

export type Change = { kind: 'none' } | { kind: 'new' } | { kind: 'percent'; value: number };

/**
 * Change from `previous` to `current`. With nothing to compare against there is
 * no meaningful percentage, so this says "new" instead of a nonsense number.
 */
export function percentChange(current: number, previous: number): Change {
  if (previous === 0) return current === 0 ? { kind: 'none' } : { kind: 'new' };
  return { kind: 'percent', value: ((current - previous) / Math.abs(previous)) * 100 };
}

export function formatChange(change: Change): string {
  if (change.kind === 'none') return 'No change';
  if (change.kind === 'new') return 'New';
  const rounded = Math.round(change.value);
  if (rounded === 0) return 'No change';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
}
