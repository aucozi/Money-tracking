import { account, recurring, tx } from '@/test/factories';
import {
  detectRecurring,
  linkRecurring,
  matchWindow,
  monthlyEquivalent,
  nextOccurrence,
  occurrencesBetween,
  scheduleBetween,
  upcoming,
} from '../recurring';

describe('occurrencesBetween', () => {
  it('lists monthly due dates', () => {
    const rent = recurring({ frequency: 'monthly', anchorDate: '2026-01-05' });
    expect(occurrencesBetween(rent, '2026-02-01', '2026-04-30')).toEqual(['2026-02-05', '2026-03-05', '2026-04-05']);
  });

  it('keeps a month-end bill on the last day without drifting', () => {
    const bill = recurring({ frequency: 'monthly', anchorDate: '2026-01-31' });
    expect(occurrencesBetween(bill, '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31',
    ]);
  });

  it('handles weekly, fortnightly, quarterly and yearly schedules', () => {
    expect(occurrencesBetween(recurring({ frequency: 'weekly', anchorDate: '2026-03-02' }), '2026-03-01', '2026-03-31')).toEqual([
      '2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30',
    ]);
    expect(occurrencesBetween(recurring({ frequency: 'biweekly', anchorDate: '2026-03-02' }), '2026-03-10', '2026-04-15')).toEqual([
      '2026-03-16', '2026-03-30', '2026-04-13',
    ]);
    expect(occurrencesBetween(recurring({ frequency: 'quarterly', anchorDate: '2026-01-18' }), '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-18', '2026-04-18', '2026-07-18', '2026-10-18',
    ]);
    expect(occurrencesBetween(recurring({ frequency: 'yearly', anchorDate: '2024-02-29' }), '2025-01-01', '2028-12-31')).toEqual([
      '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29',
    ]);
  });

  it('never lists a date before the first due date or after the end date', () => {
    const bill = recurring({ frequency: 'monthly', anchorDate: '2026-03-10', endDate: '2026-05-10' });
    expect(occurrencesBetween(bill, '2026-01-01', '2026-12-31')).toEqual(['2026-03-10', '2026-04-10', '2026-05-10']);
    expect(occurrencesBetween(bill, '2026-06-01', '2026-12-31')).toEqual([]);
    expect(occurrencesBetween(bill, '2026-01-01', '2026-02-28')).toEqual([]);
    expect(occurrencesBetween(bill, '2026-05-01', '2026-04-01')).toEqual([]);
  });

  it('stays correct far from the first due date', () => {
    const weekly = recurring({ frequency: 'weekly', anchorDate: '2020-01-06' });
    expect(occurrencesBetween(weekly, '2026-11-09', '2026-11-22')).toEqual(['2026-11-09', '2026-11-16']);
    const monthly = recurring({ frequency: 'monthly', anchorDate: '2015-01-31' });
    expect(occurrencesBetween(monthly, '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-31']);
    const yearly = recurring({ frequency: 'yearly', anchorDate: '2001-06-15' });
    expect(occurrencesBetween(yearly, '2026-01-01', '2026-12-31')).toEqual(['2026-06-15']);
  });

  it('finds the next due date', () => {
    const rent = recurring({ frequency: 'monthly', anchorDate: '2026-01-05' });
    expect(nextOccurrence(rent, '2026-03-05')).toBe('2026-03-05');
    expect(nextOccurrence(rent, '2026-03-06')).toBe('2026-04-05');
    expect(nextOccurrence(recurring({ frequency: 'yearly', anchorDate: '2026-01-05' }), '2026-01-06')).toBe('2027-01-05');
    expect(nextOccurrence(recurring({ anchorDate: '2026-01-05', endDate: '2026-02-05' }), '2026-03-01')).toBeNull();
  });
});

describe('monthlyEquivalent', () => {
  it('turns any cycle into a monthly set-aside amount', () => {
    expect(monthlyEquivalent({ amount: -11900, frequency: 'yearly' })).toBe(-992);
    expect(monthlyEquivalent({ amount: -18600, frequency: 'quarterly' })).toBe(-6200);
    expect(monthlyEquivalent({ amount: -1000, frequency: 'monthly' })).toBe(-1000);
    expect(monthlyEquivalent({ amount: -1000, frequency: 'weekly' })).toBe(-4333);
    expect(monthlyEquivalent({ amount: 100000, frequency: 'biweekly' })).toBe(216667);
  });
});

describe('scheduleBetween', () => {
  const rent = recurring({ id: 'rent', name: 'Rent', frequency: 'monthly', anchorDate: '2026-01-01' });

  it('marks each due date as paid, overdue, due or upcoming', () => {
    const paid = tx({ id: 'p1', date: '2026-02-02', recurringId: 'rent' });
    const schedule = scheduleBetween([rent], [paid], '2026-02-01', '2026-05-31', '2026-04-01');
    expect(schedule.map((item) => [item.date, item.state])).toEqual([
      ['2026-02-01', 'paid'],
      ['2026-03-01', 'overdue'],
      ['2026-04-01', 'due'],
      ['2026-05-01', 'upcoming'],
    ]);
    expect(schedule[0].paidBy?.id).toBe('p1');
  });

  it('lets one payment settle only one due date, the nearest', () => {
    const weekly = recurring({ id: 'w', frequency: 'weekly', anchorDate: '2026-03-02' });
    const schedule = scheduleBetween([weekly], [tx({ date: '2026-03-10', recurringId: 'w' })], '2026-03-01', '2026-03-20', '2026-03-20');
    expect(schedule.map((item) => item.state)).toEqual(['overdue', 'paid', 'overdue']);
  });

  it('accepts early and late payments within the window, and no further', () => {
    expect(matchWindow('monthly')).toBe(12);
    const early = scheduleBetween([rent], [tx({ date: '2026-02-25', recurringId: 'rent' })], '2026-03-01', '2026-03-31', '2026-03-15');
    expect(early[0].state).toBe('paid');
    const tooFar = scheduleBetween([rent], [tx({ date: '2026-03-14', recurringId: 'rent' })], '2026-03-01', '2026-03-31', '2026-03-15');
    expect(tooFar[0].state).toBe('overdue');
    expect(matchWindow('weekly')).toBeLessThan(matchWindow('biweekly'));
    expect(matchWindow('yearly')).toBe(20);
  });

  it('attributes two payments to two consecutive due dates', () => {
    const payments = [tx({ date: '2026-02-01', recurringId: 'rent' }), tx({ date: '2026-03-03', recurringId: 'rent' })];
    const schedule = scheduleBetween([rent], payments, '2026-02-01', '2026-03-31', '2026-03-31');
    expect(schedule.map((item) => item.state)).toEqual(['paid', 'paid']);
  });

  it('respects skipped dates and ignores paused or archived items', () => {
    const skipped = { ...rent, skipped: ['2026-03-01'] };
    expect(scheduleBetween([skipped], [], '2026-03-01', '2026-03-31', '2026-03-15')[0].state).toBe('skipped');
    expect(scheduleBetween([{ ...rent, status: 'paused' }], [], '2026-03-01', '2026-03-31', '2026-03-15')).toEqual([]);
    expect(scheduleBetween([{ ...rent, status: 'archived' }], [], '2026-03-01', '2026-03-31', '2026-03-15')).toEqual([]);
  });

  it('sorts by date, then name', () => {
    const a = recurring({ name: 'B bill', anchorDate: '2026-03-05' });
    const b = recurring({ name: 'A bill', anchorDate: '2026-03-05' });
    const c = recurring({ name: 'C bill', anchorDate: '2026-03-02' });
    const names = scheduleBetween([a, b, c], [], '2026-03-01', '2026-03-31', '2026-03-01').map((item) => item.recurring.name);
    expect(names).toEqual(['C bill', 'A bill', 'B bill']);
  });
});

describe('upcoming', () => {
  it('lists what needs attention: recent unpaid items and those due soon', () => {
    const rent = recurring({ id: 'rent', name: 'Rent', anchorDate: '2026-01-01' });
    const gym = recurring({ id: 'gym', name: 'Gym', anchorDate: '2026-01-20' });
    const yearly = recurring({ id: 'y', name: 'Domain', frequency: 'yearly', anchorDate: '2026-12-25' });
    const paid = tx({ date: '2026-03-01', recurringId: 'rent' });
    const list = upcoming([rent, gym, yearly], [paid], '2026-03-10', 30);
    expect(list.map((item) => [item.recurring.name, item.date, item.state])).toEqual([
      ['Gym', '2026-02-20', 'overdue'],
      ['Gym', '2026-03-20', 'upcoming'],
      ['Rent', '2026-04-01', 'upcoming'],
    ]);
  });
});

describe('linkRecurring', () => {
  const stream = recurring({ id: 's', name: 'StreamBox', matchText: 'StreamBox', amount: -1399, tolerancePct: 10 });

  it('links a payment whose name and amount fit', () => {
    expect(linkRecurring(tx({ payee: 'STREAMBOX.COM', amount: -1399 }), 'EUR', [stream])?.id).toBe('s');
    expect(linkRecurring(tx({ payee: 'Other', rawPayee: 'PAYPAL *STREAMBOX', amount: -1450 }), 'EUR', [stream])?.id).toBe('s');
  });

  it('does not link when the amount is too far off, the sign differs or the name is different', () => {
    expect(linkRecurring(tx({ payee: 'StreamBox', amount: -1600 }), 'EUR', [stream])).toBeUndefined();
    expect(linkRecurring(tx({ payee: 'StreamBox', amount: 1399 }), 'EUR', [stream])).toBeUndefined();
    expect(linkRecurring(tx({ payee: 'Tunely', amount: -1399 }), 'EUR', [stream])).toBeUndefined();
  });

  it('skips transfers, archived items and items with nothing to match on', () => {
    expect(linkRecurring(tx({ payee: 'StreamBox', amount: -1399, kind: 'transfer' }), 'EUR', [stream])).toBeUndefined();
    expect(linkRecurring(tx({ payee: 'StreamBox', amount: -1399 }), 'EUR', [{ ...stream, status: 'archived' }])).toBeUndefined();
    expect(linkRecurring(tx({ payee: 'StreamBox', amount: -1399 }), 'EUR', [{ ...stream, matchText: '  ' }])).toBeUndefined();
  });

  it('matches on name alone when the currencies differ', () => {
    expect(linkRecurring(tx({ payee: 'StreamBox', amount: -1599 }), 'USD', [stream])?.id).toBe('s');
  });
});

describe('detectRecurring', () => {
  const accounts = [account({ id: 'acc', currency: 'EUR' })];
  const monthly = (payee: string, amounts: number[], day = 3, extra = {}) =>
    amounts.map((amount, i) => tx({ accountId: 'acc', payee, amount, date: `2026-0${i + 1}-${String(day).padStart(2, '0')}`, ...extra }));

  it('suggests a regular monthly payment with its next due date', () => {
    const history = monthly('PulseGym', [-3490, -3490, -3490, -3490], 3, { categoryId: 'health' });
    const [suggestion, ...rest] = detectRecurring(history, [], accounts, '2026-04-20');
    expect(rest).toEqual([]);
    expect(suggestion.seen).toBe(4);
    expect(suggestion.lastDate).toBe('2026-04-03');
    expect(suggestion.recurring).toMatchObject({
      name: 'PulseGym', amount: -3490, currency: 'EUR', frequency: 'monthly', anchorDate: '2026-05-03',
      categoryId: 'health', accountId: 'acc', status: 'active', matchText: 'PulseGym',
    });
  });

  it('tolerates bills whose amount varies a little', () => {
    const [suggestion] = detectRecurring(monthly('Brightside Energy', [-9000, -10400, -8700, -9900]), [], accounts, '2026-04-20');
    expect(suggestion.recurring.frequency).toBe('monthly');
    expect(suggestion.recurring.tolerancePct).toBeGreaterThanOrEqual(15);
  });

  it('detects weekly, quarterly and yearly cycles', () => {
    const weekly = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'].map((date) => tx({ accountId: 'acc', payee: 'Veg box', amount: -1500, date }));
    expect(detectRecurring(weekly, [], accounts, '2026-03-25')[0].recurring.frequency).toBe('weekly');
    const quarterly = ['2025-10-18', '2026-01-18'].map((date) => tx({ accountId: 'acc', payee: 'Shield Insurance', amount: -18600, date }));
    expect(detectRecurring(quarterly, [], accounts, '2026-02-01')[0].recurring).toMatchObject({ frequency: 'quarterly', anchorDate: '2026-04-18' });
    const yearly = ['2025-02-10', '2026-02-11'].map((date) => tx({ accountId: 'acc', payee: 'CloudKeep', amount: -11900, date }));
    expect(detectRecurring(yearly, [], accounts, '2026-06-01')[0].recurring).toMatchObject({ frequency: 'yearly', anchorDate: '2027-02-11' });
    const income = ['2026-01-25', '2026-02-25', '2026-03-25'].map((date) => tx({ accountId: 'acc', payee: 'Employer', amount: 325000, date }));
    expect(detectRecurring(income, [], accounts, '2026-04-01')[0].recurring.amount).toBe(325000);
  });

  it('does not suggest irregular spending, wildly varying amounts or too little evidence', () => {
    const irregular = ['2026-01-03', '2026-01-09', '2026-02-20', '2026-03-01'].map((date) => tx({ accountId: 'acc', payee: 'Cafe', amount: -500, date }));
    expect(detectRecurring(irregular, [], accounts, '2026-03-05')).toEqual([]);
    expect(detectRecurring(monthly('Market', [-2000, -9000, -4000, -15000]), [], accounts, '2026-04-20')).toEqual([]);
    expect(detectRecurring(monthly('PulseGym', [-3490, -3490]), [], accounts, '2026-02-20')).toEqual([]);
  });

  it('does not mistake a weekly habit with changing prices for a bill', () => {
    const fuel = ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23'].map((date, i) => tx({ accountId: 'acc', payee: 'Volt Fuel', amount: -3000 - i * 700, date }));
    expect(detectRecurring(fuel, [], accounts, '2026-03-25')).toEqual([]);
  });

  it('does not suggest things already tracked, already linked, stopped, or transfers', () => {
    const history = monthly('PulseGym', [-3490, -3490, -3490, -3490]);
    expect(detectRecurring(history, [recurring({ matchText: 'pulsegym' })], accounts, '2026-04-20')).toEqual([]);
    expect(detectRecurring(history.map((item) => ({ ...item, recurringId: 'x' })), [], accounts, '2026-04-20')).toEqual([]);
    expect(detectRecurring(history, [], accounts, '2026-09-01')).toEqual([]);
    expect(detectRecurring(history.map((item) => ({ ...item, kind: 'transfer' as const })), [], accounts, '2026-04-20')).toEqual([]);
  });

  it('lists the biggest commitments first', () => {
    const history = [...monthly('PulseGym', [-3490, -3490, -3490]), ...monthly('Landlord', [-90000, -90000, -90000], 1)];
    expect(detectRecurring(history, [], accounts, '2026-03-20').map((item) => item.recurring.name)).toEqual(['Landlord', 'PulseGym']);
  });
});
