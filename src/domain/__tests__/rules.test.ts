import { rule, tx } from '@/test/factories';
import { applyRules, cleanPayee, describeRule, previewRule, ruleFromCategorisation, ruleHasActions, ruleHasConditions, ruleMatches } from '../rules';

describe('cleanPayee', () => {
  it.each([
    ['SQ *BLUE BOTTLE COFFEE #0423 SAN FRANCISCO CA', 'Blue Bottle Coffee'],
    ['TST* THE COPPER POT', 'The Copper Pot'],
    ['PAYPAL *STREAMBOX', 'Streambox'],
    ['POS PURCHASE GREENWAY MARKET 004512', 'Greenway Market'],
    ['CARD PAYMENT TO LUNA PIZZERIA', 'Luna Pizzeria'],
    ['VOLT FUEL 8123456789', 'Volt Fuel'],
    ['HELLO MOBILE REF: AB12345', 'Hello Mobile'],
    ['fibrenet', 'Fibrenet'],
    ['  Daily   Grind  Coffee ', 'Daily Grind Coffee'],
  ])('cleans %s', (raw, expected) => {
    expect(cleanPayee(raw)).toBe(expected);
  });

  it('leaves deliberate mixed case alone', () => {
    expect(cleanPayee('McDonald House')).toBe('McDonald House');
    expect(cleanPayee('eBay Marketplace')).toBe('eBay Marketplace');
  });

  it('keeps short acronyms and joining words readable', () => {
    expect(cleanPayee('BANK OF THE NORTH')).toBe('Bank of the North');
    expect(cleanPayee('NHS PRESCRIPTION')).toBe('NHS Prescription');
  });

  it('never returns an empty name for non-empty input', () => {
    expect(cleanPayee('#1234')).not.toBe('');
    expect(cleanPayee('')).toBe('');
  });
});

describe('ruleMatches', () => {
  const coffee = tx({ payee: 'Daily Grind Coffee', rawPayee: 'SQ *DAILY GRIND 0042', amount: -450, accountId: 'card' });

  it('matches on payee text in three ways', () => {
    expect(ruleMatches(rule({ conditions: { payeeText: 'grind', payeeMatch: 'contains' } }), coffee)).toBe(true);
    expect(ruleMatches(rule({ conditions: { payeeText: 'daily', payeeMatch: 'startsWith' } }), coffee)).toBe(true);
    expect(ruleMatches(rule({ conditions: { payeeText: 'grind', payeeMatch: 'startsWith' } }), coffee)).toBe(false);
    expect(ruleMatches(rule({ conditions: { payeeText: 'Daily Grind Coffee', payeeMatch: 'exact' } }), coffee)).toBe(true);
    expect(ruleMatches(rule({ conditions: { payeeText: 'Daily Grind', payeeMatch: 'exact' } }), coffee)).toBe(false);
  });

  it('also looks at the original bank descriptor', () => {
    expect(ruleMatches(rule({ conditions: { payeeText: '0042', payeeMatch: 'contains' } }), coffee)).toBe(true);
  });

  it('matches on amount range, account and direction', () => {
    expect(ruleMatches(rule({ conditions: { payeeMatch: 'contains', amountMin: 400, amountMax: 500 } }), coffee)).toBe(true);
    expect(ruleMatches(rule({ conditions: { payeeMatch: 'contains', amountMin: 451 } }), coffee)).toBe(false);
    expect(ruleMatches(rule({ conditions: { payeeMatch: 'contains', amountMax: 449 } }), coffee)).toBe(false);
    expect(ruleMatches(rule({ conditions: { payeeMatch: 'contains', accountId: 'card' } }), coffee)).toBe(true);
    expect(ruleMatches(rule({ conditions: { payeeMatch: 'contains', accountId: 'other' } }), coffee)).toBe(false);
    expect(ruleMatches(rule({ conditions: { payeeMatch: 'contains', direction: 'expense' } }), coffee)).toBe(true);
    expect(ruleMatches(rule({ conditions: { payeeMatch: 'contains', direction: 'income' } }), coffee)).toBe(false);
    expect(ruleMatches(rule({ conditions: { payeeMatch: 'contains', direction: 'income' } }), { ...coffee, amount: 450 })).toBe(true);
  });

  it('never matches when disabled', () => {
    expect(ruleMatches(rule({ enabled: false, conditions: { payeeText: 'grind', payeeMatch: 'contains' } }), coffee)).toBe(false);
  });
});

describe('applyRules', () => {
  const base = tx({ payee: 'CityRide', amount: -1200, categoryId: null, reviewed: false });

  it('applies category, rename, tags and flags', () => {
    const { tx: result, applied } = applyRules(base, [
      rule({
        id: 'r1',
        conditions: { payeeText: 'cityride', payeeMatch: 'contains' },
        actions: { categoryId: 'transport', renameTo: 'City Ride', addTags: ['rides'], markReviewed: true },
      }),
    ]);
    expect(result).toMatchObject({ categoryId: 'transport', payee: 'City Ride', rawPayee: 'CityRide', tags: ['rides'], reviewed: true });
    expect(applied).toEqual(['r1']);
  });

  it('lets the first matching rule win and still merges tags', () => {
    const { tx: result, applied } = applyRules(base, [
      rule({ id: 'first', conditions: { payeeText: 'city', payeeMatch: 'contains' }, actions: { categoryId: 'transport', addTags: ['a'] } }),
      rule({ id: 'second', conditions: { payeeText: 'ride', payeeMatch: 'contains' }, actions: { categoryId: 'fun', addTags: ['b'] } }),
    ]);
    expect(result.categoryId).toBe('transport');
    expect(result.tags).toEqual(['a', 'b']);
    expect(applied).toEqual(['first', 'second']);
  });

  it('still matches later rules after an earlier rule renamed the payee', () => {
    const { tx: result } = applyRules(base, [
      rule({ conditions: { payeeText: 'cityride', payeeMatch: 'contains' }, actions: { renameTo: 'Taxi' } }),
      rule({ conditions: { payeeText: 'cityride', payeeMatch: 'contains' }, actions: { categoryId: 'transport' } }),
    ]);
    expect(result).toMatchObject({ payee: 'Taxi', categoryId: 'transport' });
  });

  it('can mark a transaction as a transfer, clearing its category', () => {
    const { tx: result } = applyRules(tx({ payee: 'To savings', categoryId: 'x' }), [
      rule({ conditions: { payeeText: 'savings', payeeMatch: 'contains' }, actions: { markTransfer: true } }),
    ]);
    expect(result).toMatchObject({ kind: 'transfer', categoryId: null });
  });

  it('leaves split transactions categorised as they are', () => {
    const split = tx({
      payee: 'CityRide',
      splits: [
        { id: 'a', amount: -500, categoryId: 'x' },
        { id: 'b', amount: -500, categoryId: 'y' },
      ],
    });
    const { tx: result } = applyRules(split, [rule({ conditions: { payeeText: 'cityride', payeeMatch: 'contains' }, actions: { categoryId: 'transport' } })]);
    expect(result.categoryId).toBeNull();
  });

  it('ignores rules with no conditions and returns the same object when nothing applies', () => {
    const { tx: result, applied } = applyRules(base, [
      rule({ actions: { categoryId: 'x' } }),
      rule({ conditions: { payeeText: 'nope', payeeMatch: 'contains' }, actions: { categoryId: 'y' } }),
    ]);
    expect(result).toBe(base);
    expect(applied).toEqual([]);
  });
});

describe('rule helpers', () => {
  it('knows whether a rule is complete', () => {
    expect(ruleHasConditions(rule())).toBe(false);
    expect(ruleHasConditions(rule({ conditions: { payeeText: '  ', payeeMatch: 'contains' } }))).toBe(false);
    expect(ruleHasConditions(rule({ conditions: { payeeMatch: 'contains', amountMin: 0 } }))).toBe(true);
    expect(ruleHasActions(rule())).toBe(false);
    expect(ruleHasActions(rule({ actions: { addTags: [] } }))).toBe(false);
    expect(ruleHasActions(rule({ actions: { markReviewed: true } }))).toBe(true);
  });

  it('previews matches even while the rule is disabled', () => {
    const items = [tx({ payee: 'Greenway Market' }), tx({ payee: 'Cinema' })];
    const draft = rule({ enabled: false, conditions: { payeeText: 'market', payeeMatch: 'contains' } });
    expect(previewRule(draft, items)).toHaveLength(1);
    expect(previewRule(rule(), items)).toEqual([]);
  });

  it('builds a rule from a categorisation', () => {
    const created = ruleFromCategorisation({ payee: ' Greenway Market ' }, 'food');
    expect(created.conditions).toEqual({ payeeText: 'Greenway Market', payeeMatch: 'contains' });
    expect(created.actions).toEqual({ categoryId: 'food' });
    expect(created.enabled).toBe(true);
  });

  it('describes rules in plain language', () => {
    const names = { category: () => 'Groceries', account: () => 'Card', money: (minor: number) => `€${minor / 100}` };
    expect(
      describeRule(
        rule({
          conditions: { payeeText: 'market', payeeMatch: 'contains', amountMin: 500, amountMax: 5000, direction: 'expense', accountId: 'a' },
          actions: { categoryId: 'food', renameTo: 'Market', addTags: ['weekly'], markReviewed: true, markTransfer: true },
        }),
        names,
      ),
    ).toEqual({
      when: 'payee contains "market" and amount is €5–€50 and money goes out and account is Card',
      then: 'categorise as Groceries, rename to "Market", tag #weekly, mark as transfer, mark as reviewed',
    });
    expect(describeRule(rule({ conditions: { payeeText: 'x', payeeMatch: 'exact', amountMin: 100, amountMax: 100, direction: 'income' } }), names).when).toBe(
      'payee is "x" and amount is €1 and money comes in',
    );
    expect(describeRule(rule({ conditions: { payeeText: 'x', payeeMatch: 'startsWith', amountMin: 100 } }), names).when).toBe(
      'payee starts with "x" and amount is at least €1',
    );
    expect(describeRule(rule({ conditions: { payeeMatch: 'contains', amountMax: 100 } }), names).when).toBe('amount is at most €1');
    expect(describeRule(rule(), names)).toEqual({ when: 'No conditions yet', then: 'No actions yet' });
  });
});
