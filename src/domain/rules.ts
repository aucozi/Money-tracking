import { newId } from './context';
import { normalizePayee } from './transactions';
import type { ID, Rule, Transaction } from './types';

const NOISE_PREFIXES = [
  /^(sq|sqc|tst|py|pp|sp|ic|dd|fs|cke|bt|zsk|in|ach)\s*\*+\s*/i,
  /^(paypal|google|apple\.com\/bill|amzn mktp|amazon mktplace)\s*\*+\s*/i,
  /^(card payment to|payment to|point of sale|debit card|credit card|direct debit|pos|card|visa|mastercard|contactless|online|recurring|purchase)\b[\s:.-]*(purchase|payment|debit|withdrawal|transaction)?[\s:.-]*/i,
  /^\d{2}[/.-]\d{2}\s+/,
];

const LOWERCASE_WORDS = new Set(['and', 'of', 'the', 'for', 'de', 'la', 'le', 'du', 'van', 'von', 'da', 'di', 'at']);

/**
 * Turn a raw bank descriptor into a readable merchant name.
 * "SQ *BLUE BOTTLE COFFEE #0423 SAN FRANCISCO CA" -> "Blue Bottle Coffee".
 * Deliberately conservative: when unsure it keeps the text rather than guess.
 */
export function cleanPayee(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  for (let pass = 0; pass < 3; pass += 1) {
    const before = text;
    for (const pattern of NOISE_PREFIXES) text = text.replace(pattern, '').trim();
    if (text === before) break;
  }

  text = text
    // Store numbers, reference numbers and card tails.
    .replace(/\s+#\s*\d+\b.*$/, '')
    .replace(/\s+(ref|reference|id|trn|auth|conf)[:#\s]*[a-z0-9-]{4,}\b.*$/i, '')
    .replace(/\s+x{2,}\d{2,}\b.*$/i, '')
    .replace(/\s+\d{5,}\b.*$/, '')
    .replace(/\s+\d{3,4}$/, '')
    // Trailing "CITY ST" or country code, and phone numbers.
    .replace(/\s+\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b.*$/, '')
    .replace(/\s+[A-Za-z .'-]{3,}\s+[A-Z]{2}(\s+[A-Z]{2,3})?$/, (match) => (/^\s+[A-Z .'-]+\s+[A-Z]{2}/.test(match) ? '' : match))
    .replace(/[\s*,-]+$/, '')
    .trim();

  if (!text) text = raw.replace(/\s+/g, ' ').trim();

  // Only re-case shouting or all-lowercase descriptors; mixed case is already deliberate.
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters && (letters === letters.toUpperCase() || letters === letters.toLowerCase())) {
    text = text
      .toLowerCase()
      .split(' ')
      .map((word, index) => {
        if (index > 0 && LOWERCASE_WORDS.has(word)) return word;
        if (/^[a-z]{1,3}$/.test(word) && !/[aeiouy]/.test(word)) return word.toUpperCase();
        return word.replace(/(^|[-'/.&])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
      })
      .join(' ');
  }
  return text;
}

type Matchable = Pick<Transaction, 'payee' | 'amount' | 'accountId' | 'kind'> & { rawPayee?: string };

export function ruleMatches(rule: Rule, tx: Matchable): boolean {
  if (!rule.enabled) return false;
  const { conditions } = rule;
  const wanted = conditions.payeeText ? normalizePayee(conditions.payeeText) : '';

  if (wanted) {
    const names = [normalizePayee(tx.payee), tx.rawPayee ? normalizePayee(tx.rawPayee) : ''].filter(Boolean);
    const hit = names.some((name) => {
      if (conditions.payeeMatch === 'exact') return name === wanted;
      if (conditions.payeeMatch === 'startsWith') return name.startsWith(wanted);
      return name.includes(wanted);
    });
    if (!hit) return false;
  }
  const size = Math.abs(tx.amount);
  if (conditions.amountMin !== undefined && size < conditions.amountMin) return false;
  if (conditions.amountMax !== undefined && size > conditions.amountMax) return false;
  if (conditions.accountId && conditions.accountId !== tx.accountId) return false;
  if (conditions.direction === 'expense' && tx.amount >= 0) return false;
  if (conditions.direction === 'income' && tx.amount <= 0) return false;
  return true;
}

/** A rule with no conditions would match everything, which is never what anyone means. */
export function ruleHasConditions(rule: Pick<Rule, 'conditions'>): boolean {
  const c = rule.conditions;
  return Boolean(c.payeeText?.trim() || c.amountMin !== undefined || c.amountMax !== undefined || c.accountId || c.direction);
}

export function ruleHasActions(rule: Pick<Rule, 'actions'>): boolean {
  const a = rule.actions;
  return Boolean(a.categoryId || a.renameTo?.trim() || a.addTags?.length || a.markReviewed || a.markTransfer);
}

export interface RuleResult<T> {
  tx: T;
  applied: ID[];
}

/**
 * Run rules top to bottom. The first rule to set a field wins, so order is the
 * priority; tags from every matching rule accumulate.
 */
export function applyRules<T extends Transaction>(tx: T, rules: readonly Rule[]): RuleResult<T> {
  let next: T = tx;
  const applied: ID[] = [];
  let categorySet = false;
  let renamed = false;

  for (const rule of rules) {
    // Match against the original so an earlier rename cannot hide a later rule.
    if (!ruleHasConditions(rule) || !ruleMatches(rule, tx)) continue;
    const { actions } = rule;
    let changed = false;

    if (actions.categoryId && !categorySet && !next.splits?.length) {
      if (next.categoryId !== actions.categoryId) next = { ...next, categoryId: actions.categoryId };
      categorySet = true;
      changed = true;
    }
    if (actions.renameTo?.trim() && !renamed) {
      next = { ...next, payee: actions.renameTo.trim(), rawPayee: next.rawPayee ?? tx.payee };
      renamed = true;
      changed = true;
    }
    if (actions.addTags?.length) {
      const merged = [...new Set([...next.tags, ...actions.addTags])];
      if (merged.length !== next.tags.length) next = { ...next, tags: merged };
      changed = true;
    }
    if (actions.markTransfer && next.kind !== 'transfer') {
      next = { ...next, kind: 'transfer', categoryId: null };
      changed = true;
    }
    if (actions.markReviewed) {
      if (!next.reviewed) next = { ...next, reviewed: true };
      changed = true;
    }
    if (changed) applied.push(rule.id);
  }
  return { tx: next, applied };
}

/** Transactions a rule would touch, for the "applies to N transactions" preview. */
export function previewRule(rule: Rule, transactions: readonly Transaction[]): Transaction[] {
  if (!ruleHasConditions(rule)) return [];
  const enabled = { ...rule, enabled: true };
  return transactions.filter((tx) => ruleMatches(enabled, tx));
}

/** The rule that "always put this merchant in this category" would create. */
export function ruleFromCategorisation(tx: Pick<Transaction, 'payee'>, categoryId: ID): Rule {
  return {
    id: newId('rule_'),
    enabled: true,
    conditions: { payeeText: tx.payee.trim(), payeeMatch: 'contains' },
    actions: { categoryId },
  };
}

/** One-line plain-language summary of a rule, shown in the rule list. */
export function describeRule(
  rule: Rule,
  names: { category: (id: ID) => string; account: (id: ID) => string; money: (minor: number) => string },
): { when: string; then: string } {
  const c = rule.conditions;
  const when: string[] = [];
  if (c.payeeText?.trim()) {
    const verb = c.payeeMatch === 'exact' ? 'is' : c.payeeMatch === 'startsWith' ? 'starts with' : 'contains';
    when.push(`payee ${verb} "${c.payeeText.trim()}"`);
  }
  if (c.amountMin !== undefined && c.amountMax !== undefined) {
    when.push(c.amountMin === c.amountMax ? `amount is ${names.money(c.amountMin)}` : `amount is ${names.money(c.amountMin)}–${names.money(c.amountMax)}`);
  } else if (c.amountMin !== undefined) when.push(`amount is at least ${names.money(c.amountMin)}`);
  else if (c.amountMax !== undefined) when.push(`amount is at most ${names.money(c.amountMax)}`);
  if (c.direction) when.push(c.direction === 'expense' ? 'money goes out' : 'money comes in');
  if (c.accountId) when.push(`account is ${names.account(c.accountId)}`);

  const a = rule.actions;
  const then: string[] = [];
  if (a.categoryId) then.push(`categorise as ${names.category(a.categoryId)}`);
  if (a.renameTo?.trim()) then.push(`rename to "${a.renameTo.trim()}"`);
  if (a.addTags?.length) then.push(`tag ${a.addTags.map((tag) => `#${tag}`).join(' ')}`);
  if (a.markTransfer) then.push('mark as transfer');
  if (a.markReviewed) then.push('mark as reviewed');

  return { when: when.join(' and ') || 'No conditions yet', then: then.join(', ') || 'No actions yet' };
}
