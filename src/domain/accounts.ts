import type { AccountType } from './types';

/** Guess what kind of account this is from its name. A starting point; the person can change it. */
export function accountTypeFromName(name: string): AccountType {
  const text = name.toLowerCase();
  if (/invest|brokerage|401|\bira\b|\broth\b|pension|\bisa\b|\bstocks?\b|\bshares\b|retirement|crypto|coinbase/.test(text)) return 'investment';
  if (/credit|card|visa|mastercard|amex/.test(text)) return 'credit';
  if (/loan|mortgage|lease/.test(text)) return 'loan';
  if (/sav|deposit|money market|reserve/.test(text)) return 'savings';
  if (/\bcash\b|wallet|venmo|paypal/.test(text)) return 'cash';
  return 'checking';
}
