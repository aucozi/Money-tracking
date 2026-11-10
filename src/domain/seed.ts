import { addDays, addMonths, addMonthsToKey, monthKey, monthStart, parts, makeDate, daysInMonth } from './dates';
import { currencyDecimals, toMinor } from './money';
import { linkRecurring } from './recurring';
import {
  SCHEMA_VERSION,
  type Account,
  type AppData,
  type BudgetEntry,
  type Category,
  type CategoryGroup,
  type CurrencyCode,
  type Goal,
  type ID,
  type ISODate,
  type Recurring,
  type Rule,
  type Transaction,
} from './types';

export const CATEGORY_COLORS = [
  '#0F766E', '#2563EB', '#D97706', '#DB2777', '#7C3AED', '#059669', '#DC2626', '#0891B2',
  '#CA8A04', '#4F46E5', '#EA580C', '#65A30D', '#BE185D', '#475569', '#9333EA', '#0D9488',
];

const GROUPS: { id: ID; name: string; kind: 'expense' | 'income' }[] = [
  { id: 'grp_essentials', name: 'Essentials', kind: 'expense' },
  { id: 'grp_lifestyle', name: 'Lifestyle', kind: 'expense' },
  { id: 'grp_other', name: 'Everything else', kind: 'expense' },
  { id: 'grp_income', name: 'Income', kind: 'income' },
];

const CATEGORIES: [id: ID, name: string, icon: string, groupId: ID][] = [
  ['cat_housing', 'Housing', '🏠', 'grp_essentials'],
  ['cat_groceries', 'Groceries', '🛒', 'grp_essentials'],
  ['cat_utilities', 'Utilities', '💡', 'grp_essentials'],
  ['cat_transport', 'Transport', '🚌', 'grp_essentials'],
  ['cat_health', 'Health', '🩺', 'grp_essentials'],
  ['cat_insurance', 'Insurance', '🛡️', 'grp_essentials'],
  ['cat_dining', 'Dining out', '🍽️', 'grp_lifestyle'],
  ['cat_shopping', 'Shopping', '🛍️', 'grp_lifestyle'],
  ['cat_entertainment', 'Entertainment', '🎬', 'grp_lifestyle'],
  ['cat_subscriptions', 'Subscriptions', '🔁', 'grp_lifestyle'],
  ['cat_travel', 'Travel', '✈️', 'grp_lifestyle'],
  ['cat_personal', 'Personal care', '💈', 'grp_lifestyle'],
  ['cat_gifts', 'Gifts', '🎁', 'grp_other'],
  ['cat_fees', 'Fees & charges', '🏦', 'grp_other'],
  ['cat_other', 'Other', '📦', 'grp_other'],
  ['cat_salary', 'Salary', '💼', 'grp_income'],
  ['cat_income_other', 'Other income', '💰', 'grp_income'],
];

/** A deliberately short starting list. People add what they need; nobody prunes 60 defaults. */
export function defaultCategories(): { groups: CategoryGroup[]; categories: Category[] } {
  const groups = GROUPS.map((group, index) => ({ ...group, sort: index }));
  const categories = CATEGORIES.map(([id, name, icon, groupId], index): Category => ({
    id,
    name,
    icon,
    groupId,
    kind: groupId === 'grp_income' ? 'income' : 'expense',
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    archived: false,
    rollover: false,
    sort: index,
  }));
  return { groups, categories };
}

export function emptyData(baseCurrency: CurrencyCode): AppData {
  const { groups, categories } = defaultCategories();
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      baseCurrency,
      rates: {},
      budgetMode: 'tracking',
      theme: 'system',
      onboarded: false,
      forecastEverydaySpending: true,
    },
    accounts: [],
    categoryGroups: groups,
    categories,
    transactions: [],
    budgets: {},
    recurrings: [],
    goals: [],
    rules: [],
    holdings: [],
    connections: [],
  };
}

/** Small deterministic generator so the demo looks the same on every run for a given date. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A realistic household to explore the app with: five months of history,
 * bills, budgets, goals, a foreign-currency wallet, a loan and a credit card.
 * Merchant names are invented.
 */
export function demoData(today: ISODate, baseCurrency: CurrencyCode): AppData {
  const data = emptyData(baseCurrency);
  data.settings.onboarded = true;
  const random = mulberry32(20260101);
  // Amounts below are written for a two-decimal currency; yen-style currencies need bigger numbers.
  const factor = currencyDecimals(baseCurrency) === 0 ? 100 : 1;
  const m = (major: number) => toMinor(major * factor, baseCurrency);
  const between = (low: number, high: number) => low + random() * (high - low);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];

  const thisMonth = monthKey(today);
  const firstMonth = addMonthsToKey(thisMonth, -5);
  const start = monthStart(firstMonth);
  const foreign: CurrencyCode = baseCurrency === 'GBP' ? 'EUR' : 'GBP';
  data.settings.rates = { [foreign]: baseCurrency === 'GBP' ? 0.85 : baseCurrency === 'USD' ? 1.3 : 1.17 };

  const accounts: Account[] = [
    { id: 'acc_everyday', name: 'Everyday account', type: 'checking', currency: baseCurrency, openingBalance: m(2150), openingDate: start, archived: false, includeInNetWorth: true },
    { id: 'acc_savings', name: 'Rainy day savings', type: 'savings', currency: baseCurrency, openingBalance: m(8400), openingDate: start, archived: false, includeInNetWorth: true },
    { id: 'acc_card', name: 'Credit card', type: 'credit', currency: baseCurrency, openingBalance: m(-640), openingDate: start, archived: false, includeInNetWorth: true, apr: 21.9, minPayment: m(35) },
    { id: 'acc_loan', name: 'Car loan', type: 'loan', currency: baseCurrency, openingBalance: m(-7200), openingDate: start, archived: false, includeInNetWorth: true, apr: 6.4, minPayment: m(245) },
    { id: 'acc_travel', name: 'Travel wallet', type: 'cash', currency: foreign, openingBalance: 26000, openingDate: start, archived: false, includeInNetWorth: true },
  ];
  // An index-fund account kept by hand, to show holdings and gains. Fund names are invented.
  const funds: [id: string, name: string, symbol: string, shares: number, value: number, cost: number][] = [
    ['hold_world', 'Global Shares Index', 'GLSI', 41.5, 5240, 4310],
    ['hold_bonds', 'Short-Term Bond Fund', 'STBF', 60, 1830, 1865],
    ['hold_tech', 'Northwind Technology', 'NWT', 12, 1410, 980],
  ];
  accounts.push({
    id: 'acc_invest', name: 'Index funds', type: 'investment', currency: baseCurrency,
    openingBalance: funds.reduce((total, fund) => total + m(fund[4]), 0), openingDate: start, archived: false, includeInNetWorth: true,
  });
  data.holdings = funds.map(([id, name, symbol, shares, value, cost]) => ({
    id, accountId: 'acc_invest', name, symbol, shares, marketValue: m(value), costBasis: m(cost), currency: baseCurrency, updatedAt: today,
  }));
  data.accounts = accounts;

  const recurrings: Recurring[] = [];
  const addRecurring = (
    id: string, name: string, amount: number, frequency: Recurring['frequency'], firstDue: ISODate,
    categoryId: ID | null, tolerancePct = 10, accountId: ID = 'acc_everyday',
  ) => {
    recurrings.push({
      id, name, amount, currency: baseCurrency, accountId, categoryId, frequency,
      anchorDate: firstDue, status: 'active', matchText: name, tolerancePct, skipped: [],
    });
  };
  const dayIn = (month: string, day: number): ISODate => {
    const year = Number(month.slice(0, 4));
    const mm = Number(month.slice(5, 7));
    return makeDate(year, mm, Math.min(day, daysInMonth(year, mm)));
  };
  addRecurring('rec_rent', 'Harbour Lettings', m(-1150), 'monthly', dayIn(firstMonth, 1), 'cat_housing');
  addRecurring('rec_salary', 'Northfield Studio', m(3250), 'monthly', dayIn(firstMonth, 25), 'cat_salary');
  addRecurring('rec_energy', 'Brightside Energy', m(-96), 'monthly', dayIn(firstMonth, 10), 'cat_utilities', 35);
  addRecurring('rec_mobile', 'Hello Mobile', m(-29), 'monthly', dayIn(firstMonth, 14), 'cat_utilities');
  addRecurring('rec_internet', 'FibreNet', m(-39.99), 'monthly', dayIn(firstMonth, 5), 'cat_utilities');
  addRecurring('rec_stream', 'StreamBox', m(-13.99), 'monthly', dayIn(firstMonth, 8), 'cat_subscriptions', 10, 'acc_card');
  addRecurring('rec_insurance', 'Shield Insurance', m(-186), 'quarterly', dayIn(firstMonth, 18), 'cat_insurance');
  addRecurring('rec_cloud', 'CloudKeep', m(-119), 'yearly', addMonths(dayIn(thisMonth, 21), 1), 'cat_subscriptions', 10, 'acc_card');
  data.recurrings = recurrings;

  data.rules = [
    { id: 'rule_groceries', enabled: true, conditions: { payeeText: 'Market', payeeMatch: 'contains' }, actions: { categoryId: 'cat_groceries' } },
    { id: 'rule_rides', enabled: true, conditions: { payeeText: 'CityRide', payeeMatch: 'contains' }, actions: { categoryId: 'cat_transport', addTags: ['rides'] } },
    { id: 'rule_coffee', enabled: true, conditions: { payeeText: 'Daily Grind', payeeMatch: 'contains', amountMax: m(12) }, actions: { categoryId: 'cat_dining' } },
  ] satisfies Rule[];

  const transactions: Transaction[] = [];
  let sequence = 0;
  const add = (
    accountId: ID, date: ISODate, amount: number, payee: string, categoryId: ID | null,
    extra: Partial<Transaction> = {},
  ): Transaction => {
    sequence += 1;
    const tx: Transaction = {
      id: `demo_${sequence}`,
      accountId, date, amount, payee, categoryId,
      tags: [], status: 'cleared', kind: 'standard', reviewed: true, createdAt: sequence,
      ...extra,
    };
    if (tx.kind === 'standard') {
      const match = linkRecurring(tx, baseCurrency, recurrings);
      if (match && accountId !== 'acc_travel') tx.recurringId = match.id;
    }
    transactions.push(tx);
    return tx;
  };
  const transfer = (from: ID, to: ID, date: ISODate, amount: number, label: string) => {
    const out = add(from, date, -amount, label, null, { kind: 'transfer' });
    const into = add(to, date, amount, label, null, { kind: 'transfer' });
    out.transferPeerId = into.id;
    into.transferPeerId = out.id;
  };

  const groceries = ['Greenway Market', 'Fresh Basket Market', 'Corner Market'];
  const dining = ['Noodle House', 'Luna Pizzeria', 'The Copper Pot', 'Saffron Kitchen'];
  const shopping = ['Homeware & Co', 'Paper Lantern Books', 'Stitch & Thread', 'Gadget Lane'];
  const fun = ['Cinema Nova', 'Boulder Climbing', 'Riverside Bowling'];

  for (let offset = 0; offset <= 5; offset += 1) {
    const month = addMonthsToKey(firstMonth, offset);
    const upTo = (day: number) => dayIn(month, day) <= today;
    const length = daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));

    if (upTo(1)) add('acc_everyday', dayIn(month, 1), m(-1150), 'Harbour Lettings', 'cat_housing');
    if (upTo(3)) add('acc_card', dayIn(month, 3), m(-34.9), 'PulseGym', 'cat_health');
    if (upTo(5)) add('acc_everyday', dayIn(month, 5), m(-39.99), 'FibreNet', 'cat_utilities');
    if (upTo(8)) add('acc_card', dayIn(month, 8), m(-13.99), 'StreamBox', 'cat_subscriptions');
    if (upTo(10)) add('acc_everyday', dayIn(month, 10), m(-Math.round(between(78, 118))), 'Brightside Energy', 'cat_utilities');
    if (upTo(14)) add('acc_everyday', dayIn(month, 14), m(-29), 'Hello Mobile', 'cat_utilities');
    if (upTo(17)) add('acc_card', dayIn(month, 17), m(-9.99), 'Tunely', 'cat_subscriptions');
    if (offset % 3 === 0 && upTo(18)) add('acc_everyday', dayIn(month, 18), m(-186), 'Shield Insurance', 'cat_insurance');
    if (upTo(20)) transfer('acc_everyday', 'acc_loan', dayIn(month, 20), m(245), 'Car loan payment');
    if (upTo(22)) transfer('acc_everyday', 'acc_card', dayIn(month, 22), m(Math.round(between(1040, 1180))), 'Credit card payment');
    if (upTo(25)) add('acc_everyday', dayIn(month, 25), m(3250), 'Northfield Studio', 'cat_salary');
    if (upTo(26)) transfer('acc_everyday', 'acc_savings', dayIn(month, 26), m(300), 'To savings');

    for (let day = 1; day <= length; day += 1) {
      const date = dayIn(month, day);
      if (date > today) break;
      const roll = random();
      if (day % 4 === 2) add('acc_card', date, m(-between(28, 92)), pick(groceries), 'cat_groceries');
      if (roll < 0.34) add('acc_card', date, m(-between(3.4, 6.2)), 'Daily Grind Coffee', 'cat_dining');
      if (roll > 0.74) add('acc_card', date, m(-between(14, 58)), pick(dining), 'cat_dining');
      if (day % 7 === 3) add('acc_everyday', date, m(-between(22, 48)), 'Volt Fuel', 'cat_transport');
      if (day % 9 === 4) add('acc_card', date, m(-between(7, 19)), 'CityRide', 'cat_transport', { tags: ['rides'] });
      if (day % 11 === 6) add('acc_card', date, m(-between(18, 130)), pick(shopping), 'cat_shopping');
      if (day % 13 === 9) add('acc_card', date, m(-between(11, 34)), pick(fun), 'cat_entertainment');
      if (day === 16 && offset % 2 === 1) add('acc_everyday', date, m(-between(12, 40)), 'Pharma Plus', 'cat_health');
    }
  }

  // A few transactions that show off what the model can express.
  const lastMonth = addMonthsToKey(thisMonth, -1);
  add('acc_card', dayIn(lastMonth, 12), m(-84.6), 'Greenway Market', null, {
    splits: [
      { id: 'split_1', amount: m(-61.4), categoryId: 'cat_groceries' },
      { id: 'split_2', amount: m(-23.2), categoryId: 'cat_shopping', notes: 'Cleaning supplies' },
    ],
  });
  add('acc_everyday', dayIn(addMonthsToKey(thisMonth, -3), 6), m(-468), 'Shield Insurance — home', 'cat_insurance', {
    spreadMonths: 12,
    notes: 'Paid once a year, budgeted monthly',
    recurringId: undefined,
  });
  add('acc_card', dayIn(lastMonth, 19), m(-142.5), 'Hotel Alba', 'cat_travel', {
    tags: ['lisbon-trip'],
    original: { amount: 12350, currency: 'EUR' === baseCurrency ? 'GBP' : 'EUR' },
  });
  add('acc_travel', dayIn(lastMonth, 20), -4200, 'Tram & museum passes', 'cat_travel', { tags: ['lisbon-trip'] });
  add('acc_travel', dayIn(lastMonth, 21), -6850, 'Dinner by the river', 'cat_dining', { tags: ['lisbon-trip'] });
  add('acc_card', dayIn(lastMonth, 27), m(38), 'Stitch & Thread', 'cat_shopping', { notes: 'Refund for returned jumper' });
  add('acc_everyday', dayIn(lastMonth, 9), m(120), 'Marketplace sale', 'cat_income_other');

  // Fresh activity that still needs a look.
  const recent = (daysAgo: number) => addDays(today, -daysAgo);
  add('acc_card', recent(0), m(-4.6), 'Daily Grind Coffee', 'cat_dining', { status: 'pending', reviewed: false });
  add('acc_card', recent(0), m(-23.8), 'Luna Pizzeria', null, { status: 'pending', reviewed: false, rawPayee: 'SQ *LUNA PIZZERIA 0412' });
  add('acc_card', recent(1), m(-67.2), 'Fresh Basket Market', 'cat_groceries', { reviewed: false });
  add('acc_everyday', recent(1), m(-45), 'ATM withdrawal', null, { reviewed: false });
  add('acc_card', recent(2), m(-18.5), 'Paper Lantern Books', null, { reviewed: false });
  add('acc_everyday', recent(3), m(60), 'J. Marlow', null, { reviewed: false, notes: 'Paid back for concert tickets' });

  data.transactions = transactions;

  const budget = (categoryId: ID, amount: number, extra: BudgetEntry[] = []) => {
    data.budgets[categoryId] = [{ from: firstMonth, amount: m(amount) }, ...extra];
  };
  budget('cat_housing', 1150);
  budget('cat_groceries', 420, [{ from: addMonthsToKey(thisMonth, -1), amount: m(460) }]);
  budget('cat_utilities', 190);
  budget('cat_transport', 170);
  budget('cat_health', 60);
  budget('cat_insurance', 105);
  budget('cat_dining', 260);
  budget('cat_shopping', 180);
  budget('cat_entertainment', 70);
  budget('cat_subscriptions', 40);
  budget('cat_travel', 120);
  budget('cat_gifts', 40);
  budget('cat_salary', 3250);
  data.categories = data.categories.map((category) =>
    category.id === 'cat_travel' || category.id === 'cat_gifts'
      ? { ...category, rollover: true, rolloverFrom: addMonthsToKey(thisMonth, -4) }
      : category,
  );

  const tripDate = addMonths(today, 7);
  data.goals = [
    {
      id: 'goal_buffer', name: 'Six-month buffer', icon: '🛟', color: '#0F766E', targetAmount: m(12000),
      accountId: 'acc_savings', contributions: [], createdDate: start, archived: false,
    },
    {
      id: 'goal_trip', name: 'Summer in Japan', icon: '🗾', color: '#DB2777', targetAmount: m(2400),
      targetDate: makeDate(parts(tripDate).year, parts(tripDate).month, 1),
      contributions: [0, 1, 2, 3].map((n) => ({
        id: `contrib_${n}`, date: dayIn(addMonthsToKey(thisMonth, n - 4), 27), amount: m(180),
      })),
      createdDate: dayIn(addMonthsToKey(thisMonth, -4), 1), archived: false,
    },
  ] satisfies Goal[];

  return data;
}
