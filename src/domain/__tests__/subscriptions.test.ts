import { account, ctx, recurring, tx } from '@/test/factories';
import { demoData } from '../seed';
import { makeCtx } from '../context';
import { priceChange, subscriptions } from '../subscriptions';

const paid = (...amounts: number[]) => amounts.map((amount, index) => ({ date: `2026-0${index + 1}-08`, amount }));

describe('priceChange', () => {
  const stream = recurring({ amount: -1399 });

  it('reports a price that held and then moved, with what it adds up to over a year', () => {
    expect(priceChange(stream, paid(1399, 1399, 1599), '2026-03-20')).toEqual({ from: 1399, to: 1599, date: '2026-03-08', perYear: 2400 });
    expect(priceChange(recurring({ amount: -1399, frequency: 'yearly' }), paid(1399, 1599), '2026-02-20')?.perYear).toBe(200);
    expect(priceChange(stream, paid(1399, 1399, 1199), '2026-03-20')).toMatchObject({ to: 1199, perYear: -2400 });
  });

  it('says nothing when the price is unchanged or there is no earlier payment', () => {
    expect(priceChange(stream, paid(1399, 1399, 1399), '2026-03-20')).toBeUndefined();
    expect(priceChange(stream, paid(1599), '2026-01-20')).toBeUndefined();
    expect(priceChange(stream, [], '2026-01-20')).toBeUndefined();
  });

  it('leaves alone bills that are different every time', () => {
    expect(priceChange(recurring({ amount: -9600 }), paid(9100, 10400, 9800), '2026-03-20')).toBeUndefined();
  });

  it('ignores a difference of under one percent', () => {
    expect(priceChange(stream, paid(1399, 1399, 1405), '2026-03-20')).toBeUndefined();
  });

  it('stops once the tracked amount matches the new price, or the change is old news', () => {
    expect(priceChange(recurring({ amount: -1599 }), paid(1399, 1399, 1599), '2026-03-20')).toBeUndefined();
    expect(priceChange(stream, paid(1399, 1399, 1599), '2026-06-01')).toBeUndefined();
  });
});

describe('subscriptions', () => {
  const accounts = [account({ id: 'acc' }), account({ id: 'usd', currency: 'USD' })];
  const context = ctx(accounts);

  it('adds up what regular payments cost per month and per year, most expensive first', () => {
    const summary = subscriptions(
      [
        recurring({ id: 'stream', name: 'Stream', amount: -1200 }),
        recurring({ id: 'cloud', name: 'Cloud', amount: -12000, frequency: 'yearly' }),
        recurring({ id: 'gym', name: 'Gym', amount: -1000, frequency: 'weekly' }),
        recurring({ id: 'pay', name: 'Salary', amount: 300000 }),
        recurring({ id: 'old', name: 'Old', amount: -5000, status: 'paused' }),
      ],
      [],
      accounts,
      context,
      '2026-03-10',
    );
    expect(summary.items.map((item) => [item.recurring.id, item.monthly, item.yearly])).toEqual([
      ['gym', 4333, 52000],
      ['stream', 1200, 14400],
      ['cloud', 1000, 12000],
    ]);
    expect(summary).toMatchObject({ monthly: 6533, yearly: 78400, increases: [] });
    expect(summary.items[0]).toMatchObject({ payments: 0, lastPaid: undefined });
    expect(summary.items[1].next).toBe('2026-04-01');
  });

  it('converts other currencies and finds the latest payment and price rises', () => {
    const summary = subscriptions(
      [recurring({ id: 'stream', amount: -1000, currency: 'USD' }), recurring({ id: 'news', amount: -500 })],
      [
        tx({ recurringId: 'news', date: '2026-02-03', amount: -500 }),
        tx({ recurringId: 'news', date: '2026-01-03', amount: -500 }),
        tx({ recurringId: 'news', date: '2026-03-03', amount: -700 }),
        tx({ recurringId: 'news', date: '2026-03-04', amount: 700 }),
        tx({ recurringId: 'stream', accountId: 'acc', date: '2026-02-03', amount: -900 }),
        tx({ recurringId: 'stream', accountId: 'acc', date: '2026-03-03', amount: -950 }),
      ],
      accounts,
      context,
      '2026-03-10',
    );
    const [stream, news] = summary.items;
    expect(stream).toMatchObject({ monthly: 900, payments: 2 });
    // Paid from a euro account while tracked in dollars: the amounts cannot be compared.
    expect(stream.change).toBeUndefined();
    expect(news).toMatchObject({ payments: 3, lastPaid: { date: '2026-03-03', amount: 700 }, change: { from: 500, to: 700, perYear: 2400 } });
    expect(summary.increases.map((item) => item.recurring.id)).toEqual(['news']);
  });

  it('points out the price rise in the sample data', () => {
    const data = demoData('2026-11-10', 'USD');
    const summary = subscriptions(data.recurrings, data.transactions, data.accounts, makeCtx(data), '2026-11-10');
    expect(summary.increases.map((item) => [item.recurring.name, item.change?.from, item.change?.to])).toEqual([['StreamBox', 1399, 1599]]);
    expect(summary.items[0].recurring.name).toBe('Harbour Lettings');
  });
});
