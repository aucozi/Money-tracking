import { account, category, ctx, tx } from '@/test/factories';
import { sum } from '../money';
import {
  activityFor,
  allTags,
  budgetImpacts,
  buildActivityIndex,
  filterTransactions,
  findDuplicates,
  groupByDay,
  isFilterActive,
  normalizePayee,
  parseTags,
  partsOf,
  sortNewestFirst,
  totalsOf,
  typeOf,
  UNCATEGORIZED,
  UNCATEGORIZED_INCOME,
  validateSplits,
} from '../transactions';

describe('splits', () => {
  const split = tx({
    amount: -8460,
    splits: [
      { id: 'a', amount: -6140, categoryId: 'food' },
      { id: 'b', amount: -2320, categoryId: 'home' },
    ],
  });

  it('uses the splits as the parts of a transaction', () => {
    expect(partsOf(split)).toEqual([
      { categoryId: 'food', amount: -6140 },
      { categoryId: 'home', amount: -2320 },
    ]);
    expect(partsOf(tx({ amount: -500, categoryId: 'food' }))).toEqual([{ categoryId: 'food', amount: -500 }]);
  });

  it('accepts splits that add up', () => {
    expect(validateSplits(split)).toBeNull();
    expect(validateSplits(tx())).toBeNull();
  });

  it('explains what is wrong with bad splits', () => {
    expect(validateSplits({ amount: -100, splits: [{ id: 'a', amount: -100, categoryId: null }] })).toMatch(/at least two/);
    expect(
      validateSplits({ amount: -100, splits: [{ id: 'a', amount: -60, categoryId: null }, { id: 'b', amount: -30, categoryId: null }] }),
    ).toMatch(/add up/);
    expect(
      validateSplits({ amount: -100, splits: [{ id: 'a', amount: -100, categoryId: null }, { id: 'b', amount: 0, categoryId: null }] }),
    ).toMatch(/needs an amount/);
    expect(
      validateSplits({ amount: -100, splits: [{ id: 'a', amount: -150, categoryId: null }, { id: 'b', amount: 50, categoryId: null }] }),
    ).toMatch(/same direction/);
  });
});

describe('budgetImpacts', () => {
  it('puts an ordinary transaction in its own month', () => {
    expect(budgetImpacts(tx({ date: '2026-03-10', amount: -500, categoryId: 'food' }))).toEqual([
      { month: '2026-03', categoryId: 'food', amount: -500 },
    ]);
  });

  it('ignores transfers', () => {
    expect(budgetImpacts(tx({ kind: 'transfer' }))).toEqual([]);
  });

  it('spreads a purchase over months without losing a cent', () => {
    const impacts = budgetImpacts(tx({ date: '2026-11-06', amount: -46801, categoryId: 'ins', spreadMonths: 12 }));
    expect(impacts).toHaveLength(12);
    expect(impacts[0].month).toBe('2026-11');
    expect(impacts[11].month).toBe('2027-10');
    expect(sum(impacts.map((impact) => impact.amount))).toBe(-46801);
    expect(Math.max(...impacts.map((i) => i.amount)) - Math.min(...impacts.map((i) => i.amount))).toBeLessThanOrEqual(1);
  });

  it('spreads each part of a split', () => {
    const impacts = budgetImpacts(
      tx({
        date: '2026-01-15',
        amount: -300,
        spreadMonths: 3,
        splits: [
          { id: 'a', amount: -200, categoryId: 'x' },
          { id: 'b', amount: -100, categoryId: 'y' },
        ],
      }),
    );
    expect(impacts).toHaveLength(6);
    expect(sum(impacts.filter((i) => i.categoryId === 'x').map((i) => i.amount))).toBe(-200);
    expect(sum(impacts.filter((i) => i.categoryId === 'y').map((i) => i.amount))).toBe(-100);
    expect(sum(impacts.map((i) => i.amount))).toBe(-300);
    expect(new Set(impacts.map((i) => i.month))).toEqual(new Set(['2026-01', '2026-02', '2026-03']));
  });
});

describe('activity index', () => {
  it('totals by month and category in the base currency', () => {
    const accounts = [account({ id: 'eur' }), account({ id: 'usd', currency: 'USD' })];
    const index = buildActivityIndex(
      [
        tx({ accountId: 'eur', date: '2026-03-01', amount: -1000, categoryId: 'food' }),
        tx({ accountId: 'usd', date: '2026-03-02', amount: -1000, categoryId: 'food' }),
        tx({ accountId: 'eur', date: '2026-03-03', amount: 300, categoryId: 'food' }),
        tx({ accountId: 'eur', date: '2026-04-01', amount: -500, categoryId: 'food' }),
        tx({ accountId: 'eur', date: '2026-03-05', amount: -999, kind: 'transfer' }),
      ],
      ctx(accounts),
    );
    // 1000 EUR + 1000 USD (= 900 EUR) - 300 EUR refund
    expect(activityFor(index, '2026-03', 'food')).toBe(-1600);
    expect(activityFor(index, '2026-04', 'food')).toBe(-500);
    expect(activityFor(index, '2026-05', 'food')).toBe(0);
  });

  it('keeps uncategorised income and spending apart', () => {
    const index = buildActivityIndex(
      [tx({ amount: -700, categoryId: null }), tx({ amount: 700, categoryId: null })],
      ctx(),
    );
    expect(activityFor(index, '2026-03', UNCATEGORIZED)).toBe(-700);
    expect(activityFor(index, '2026-03', UNCATEGORIZED_INCOME)).toBe(700);
  });
});

describe('filterTransactions', () => {
  const accounts = [account({ id: 'cur', name: 'Current' }), account({ id: 'card', name: 'Visa card' })];
  const categories = [category({ id: 'food', name: 'Groceries' }), category({ id: 'fun', name: 'Entertainment' })];
  const lookup = { accounts, categories };
  const items = [
    tx({ id: '1', accountId: 'cur', date: '2026-03-01', amount: -1250, payee: 'Greenway Market', categoryId: 'food', tags: ['weekly'] }),
    tx({ id: '2', accountId: 'card', date: '2026-03-05', amount: -3000, payee: 'Cinema Nova', categoryId: 'fun', notes: 'Date night', status: 'pending', reviewed: false }),
    tx({ id: '3', accountId: 'cur', date: '2026-03-09', amount: 250000, payee: 'Employer', categoryId: null }),
    tx({ id: '4', accountId: 'cur', date: '2026-03-12', amount: -20000, payee: 'To savings', kind: 'transfer' }),
    tx({ id: '5', accountId: 'card', date: '2026-03-15', amount: -900, payee: 'Mystery', categoryId: null, rawPayee: 'SQ *MYSTERY 0042', reviewed: false }),
    tx({
      id: '6', accountId: 'card', date: '2026-03-20', amount: -5000, payee: 'Superstore', categoryId: null,
      splits: [{ id: 'a', amount: -4000, categoryId: 'food' }, { id: 'b', amount: -1000, categoryId: 'fun' }],
    }),
  ];
  const ids = (filter: Parameters<typeof filterTransactions>[1]) => filterTransactions(items, filter, lookup).map((item) => item.id);

  it('returns everything for an empty filter', () => {
    expect(ids({})).toHaveLength(6);
    expect(isFilterActive({})).toBe(false);
    expect(isFilterActive({ query: '  ' })).toBe(false);
    expect(isFilterActive({ type: 'expense' })).toBe(true);
  });

  it('searches payee, original descriptor, notes, tags, category, account and amount', () => {
    expect(ids({ query: 'greenway' })).toEqual(['1']);
    expect(ids({ query: 'sq mystery' })).toEqual(['5']);
    expect(ids({ query: 'date night' })).toEqual(['2']);
    expect(ids({ query: '#weekly' })).toEqual(['1']);
    expect(ids({ query: 'groceries' })).toEqual(['1', '6']);
    expect(ids({ query: 'visa' })).toEqual(['2', '5', '6']);
    expect(ids({ query: '12.50' })).toEqual(['1']);
    expect(ids({ query: 'uncategorized' })).toEqual(['3', '5']);
    expect(ids({ query: 'pending' })).toEqual(['2']);
    expect(ids({ query: 'nothing matches this' })).toEqual([]);
  });

  it('filters by account, date range, status and review state', () => {
    expect(ids({ accountIds: ['card'] })).toEqual(['2', '5', '6']);
    expect(ids({ from: '2026-03-05', to: '2026-03-12' })).toEqual(['2', '3', '4']);
    expect(ids({ status: 'pending' })).toEqual(['2']);
    expect(ids({ needsReview: true })).toEqual(['2', '5']);
  });

  it('filters by type', () => {
    expect(ids({ type: 'income' })).toEqual(['3']);
    expect(ids({ type: 'transfer' })).toEqual(['4']);
    expect(ids({ type: 'expense' })).toEqual(['1', '2', '5', '6']);
    expect(typeOf({ kind: 'standard', amount: 0 })).toBe('expense');
  });

  it('filters by category, including split parts and uncategorised', () => {
    expect(ids({ categoryIds: ['food'] })).toEqual(['1', '6']);
    expect(ids({ categoryIds: ['fun'] })).toEqual(['2', '6']);
    expect(ids({ categoryIds: [UNCATEGORIZED] })).toEqual(['3', '5']);
  });

  it('filters by tags and combines conditions', () => {
    expect(ids({ tags: ['Weekly'] })).toEqual(['1']);
    expect(ids({ tags: ['weekly', 'other'] })).toEqual([]);
    expect(ids({ accountIds: ['card'], needsReview: true, query: 'mystery' })).toEqual(['5']);
  });
});

describe('ordering and totals', () => {
  it('sorts newest first, latest entry first within a day', () => {
    const sorted = sortNewestFirst([
      tx({ id: 'a', date: '2026-03-01', createdAt: 1 }),
      tx({ id: 'b', date: '2026-03-02', createdAt: 2 }),
      tx({ id: 'c', date: '2026-03-02', createdAt: 3 }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('groups by day with a net total that ignores transfers', () => {
    const groups = groupByDay(
      [
        tx({ date: '2026-03-02', amount: -500 }),
        tx({ date: '2026-03-02', amount: 200 }),
        tx({ date: '2026-03-02', amount: -9999, kind: 'transfer' }),
        tx({ date: '2026-03-01', amount: -100 }),
      ],
      ctx(),
    );
    expect(groups.map((group) => [group.date, group.items.length, group.total])).toEqual([
      ['2026-03-02', 3, -300],
      ['2026-03-01', 1, -100],
    ]);
  });

  it('totals spending and income in the base currency', () => {
    const accounts = [account({ id: 'eur' }), account({ id: 'gbp', currency: 'GBP' })];
    const totals = totalsOf(
      [
        tx({ accountId: 'eur', amount: -1000 }),
        tx({ accountId: 'gbp', amount: -1000 }),
        tx({ accountId: 'eur', amount: 5000 }),
        tx({ accountId: 'eur', amount: -7000, kind: 'transfer' }),
      ],
      ctx(accounts),
    );
    expect(totals).toEqual({ count: 4, spent: 2200, income: 5000, net: 2800 });
  });
});

describe('findDuplicates', () => {
  const existing = [
    tx({ id: 'e1', accountId: 'a', date: '2026-03-01', amount: -450, payee: 'Daily Grind Coffee' }),
    tx({ id: 'e2', accountId: 'a', date: '2026-03-03', amount: -2380, payee: 'Luna Pizzeria', rawPayee: 'SQ *LUNA PIZZERIA 0412', status: 'pending' }),
  ];
  const incoming = (date: string, amount: number, payee: string, rawPayee?: string) => ({ accountId: 'a', date, amount, payee, rawPayee });

  it('flags a row that is already on file', () => {
    expect(findDuplicates([incoming('2026-03-01', -450, 'DAILY GRIND COFFEE')], existing)).toEqual(['exact']);
  });

  it('keeps a second genuine identical purchase', () => {
    const rows = [incoming('2026-03-01', -450, 'Daily Grind Coffee'), incoming('2026-03-01', -450, 'Daily Grind Coffee')];
    expect(findDuplicates(rows, existing)).toEqual(['exact', null]);
  });

  it('flags a pending charge that reappears with a shifted date', () => {
    expect(findDuplicates([incoming('2026-03-05', -2380, 'Luna Pizzeria', 'SQ *LUNA PIZZERIA 0412')], existing)).toEqual(['likely']);
  });

  it('does not match a different account, amount, merchant or a distant date', () => {
    expect(findDuplicates([{ ...incoming('2026-03-01', -450, 'Daily Grind Coffee'), accountId: 'b' }], existing)).toEqual([null]);
    expect(findDuplicates([incoming('2026-03-01', -451, 'Daily Grind Coffee')], existing)).toEqual([null]);
    expect(findDuplicates([incoming('2026-03-02', -450, 'Someone Else')], existing)).toEqual([null]);
    expect(findDuplicates([incoming('2026-03-20', -450, 'Daily Grind Coffee')], existing)).toEqual([null]);
  });

  it('lets one existing transaction explain only one incoming row', () => {
    const rows = [incoming('2026-03-02', -450, 'Daily Grind Coffee'), incoming('2026-03-02', -450, 'Daily Grind Coffee')];
    expect(findDuplicates(rows, existing)).toEqual(['likely', null]);
  });
});

describe('tags and names', () => {
  it('normalises payees for matching', () => {
    expect(normalizePayee('  Café—Zürich #12 ')).toBe('cafe zurich 12');
  });

  it('parses tags from free text', () => {
    expect(parseTags('Trip 2026, #work,work,  ')).toEqual(['trip-2026', 'work']);
    expect(parseTags('')).toEqual([]);
  });

  it('lists tags by how often they are used', () => {
    expect(allTags([tx({ tags: ['b', 'a'] }), tx({ tags: ['a'] }), tx({ tags: ['c'] })])).toEqual(['a', 'b', 'c']);
  });
});
