import { makeCtx } from '@/domain/context';
import { portfolio, pricePerShare, formatFraction } from '@/domain/investments';
import { accountBalances } from '@/domain/networth';
import { emptyData } from '@/domain/seed';
import { parseAccountSet } from '@/domain/sync/simplefin';
import type { RemoteAccount, RemoteTransaction } from '@/domain/sync/types';
import type { AppData } from '@/domain/types';
import demo from '@/test/fixtures/simplefin-demo-v2.json';

import * as ops from '../ops';
import { addConnection, applySync, guessAccountType, linkAccounts, noteSyncFailure, removeConnection, syncWindowStart } from '../sync';

const today = '2026-11-10';
const options = { today, since: '2026-10-01', now: Date.UTC(2026, 10, 10, 9) };

const remoteTx = (overrides: Partial<RemoteTransaction> = {}): RemoteTransaction => ({
  remoteId: 't1', date: '2026-11-08', amount: -1250, description: 'CORNER BAKERY', pending: false, ...overrides,
});
const remoteAccount = (overrides: Partial<RemoteAccount> = {}): RemoteAccount => ({
  remoteId: 'chk', name: 'Everyday', institution: 'My Bank', currency: 'USD', balance: 100000, balanceDate: today, transactions: [], ...overrides,
});

/** A dataset with one connection whose "chk" account is linked to a new local account. */
function connected(remote: RemoteAccount[] = [remoteAccount()]) {
  let data: AppData = { ...emptyData('USD'), settings: { ...emptyData('USD').settings, onboarded: true } };
  const added = addConnection(data, { id: 'conn', name: 'My Bank', remote });
  data = linkAccounts(added.data, 'conn', Object.fromEntries(remote.map((account) => [account.remoteId, { kind: 'new' as const }])), remote, today);
  const accountId = data.connections[0].links[remote[0].remoteId];
  return { data, accountId };
}
const sync = (data: AppData, remote: RemoteAccount[], extra: Partial<typeof options> = {}) => applySync(data, 'conn', remote, { ...options, ...extra });
const balance = (data: AppData, id: string) => accountBalances(data.accounts, data.transactions).get(id);

describe('connecting', () => {
  it('records what the connection offers without importing anything yet', () => {
    const { data, id } = addConnection(emptyData('USD'), { name: ' My Bank ', remote: [remoteAccount(), remoteAccount({ remoteId: 'sav', name: 'Savings' })] });
    expect(data.connections[0]).toEqual({
      id, provider: 'simplefin', name: 'My Bank', links: {},
      remoteAccounts: [
        { id: 'chk', name: 'Everyday', institution: 'My Bank', currency: 'USD' },
        { id: 'sav', name: 'Savings', institution: 'My Bank', currency: 'USD' },
      ],
    });
    expect(data.accounts).toEqual([]);
    expect(addConnection(emptyData('USD'), { name: '', remote: [] }).data.connections[0].name).toBe('Bank connection');
  });

  it('creates accounts for the ones chosen, attaches to existing ones, and skips the rest', () => {
    const remote = [remoteAccount(), remoteAccount({ remoteId: 'sav', name: 'Rainy day savings' }), remoteAccount({ remoteId: 'old', name: 'Old account' })];
    let data = ops.addAccount(emptyData('USD'), { name: 'My savings', type: 'savings', currency: 'USD', openingBalance: 5000, openingDate: '2026-01-01' }).data;
    const existing = data.accounts[0].id;
    data = addConnection(data, { id: 'conn', name: 'Bank', remote }).data;
    data = linkAccounts(data, 'conn', { chk: { kind: 'new' }, sav: { kind: 'existing', accountId: existing }, old: { kind: 'skip' } }, remote, today);

    expect(data.accounts).toHaveLength(2);
    expect(data.accounts[1]).toMatchObject({ name: 'Everyday', type: 'checking', currency: 'USD', openingBalance: 0, openingDate: today });
    expect(data.connections[0].links).toEqual({ chk: data.accounts[1].id, sav: existing });

    // Choosing again changes nothing; skipping later stops following but keeps the account.
    const again = linkAccounts(data, 'conn', { chk: { kind: 'new' } }, remote, today);
    expect(again.accounts).toHaveLength(2);
    const unlinked = linkAccounts(data, 'conn', { chk: { kind: 'skip' } }, remote, today);
    expect(unlinked.connections[0].links).toEqual({ sav: existing });
    expect(unlinked.accounts).toHaveLength(2);
    expect(linkAccounts(data, 'nope', {}, remote, today)).toBe(data);
  });

  it('will not attach an account in another currency, or one that already follows a bank account', () => {
    const remote = [remoteAccount(), remoteAccount({ remoteId: 'eur', name: 'Euro', currency: 'EUR' })];
    let data = ops.addAccount(emptyData('USD'), { name: 'Dollars', type: 'checking', currency: 'USD', openingBalance: 0, openingDate: today }).data;
    const dollars = data.accounts[0].id;
    data = addConnection(data, { id: 'conn', name: 'Bank', remote }).data;
    data = linkAccounts(data, 'conn', { eur: { kind: 'existing', accountId: dollars } }, remote, today);
    expect(data.connections[0].links).toEqual({});
    data = linkAccounts(data, 'conn', { chk: { kind: 'existing', accountId: dollars } }, remote, today);
    data = linkAccounts(data, 'conn', { eur: { kind: 'existing', accountId: dollars } }, [remote[0], { ...remote[1], currency: 'USD' }], today);
    expect(data.connections[0].links).toEqual({ chk: dollars });
  });

  it('guesses the kind of account from its name', () => {
    const guess = (name: string, extra: Partial<RemoteAccount> = {}) => guessAccountType(remoteAccount({ name, ...extra }));
    expect(guess('Everyday Checking')).toBe('checking');
    expect(guess('High-Yield Savings')).toBe('savings');
    expect(guess('Platinum Visa Card')).toBe('credit');
    expect(guess('Auto Loan')).toBe('loan');
    expect(guess('Roth IRA')).toBe('investment');
    expect(guess('Account 4411', { holdings: [{ remoteId: 'h', name: 'Fund', shares: 1, marketValue: 100, currency: 'USD' }] })).toBe('investment');
  });

  it('forgets a connection but keeps its accounts and history', () => {
    const { data } = connected([remoteAccount({ transactions: [remoteTx()] })]);
    const synced = sync(data, [remoteAccount({ transactions: [remoteTx()] })]).data;
    const after = removeConnection(synced, 'conn');
    expect(after.connections).toEqual([]);
    expect(after.accounts).toHaveLength(1);
    expect(after.transactions).toHaveLength(1);
  });
});

describe('applySync', () => {
  it('brings in new transactions unreviewed, with readable names and the bank text kept', () => {
    const { data, accountId } = connected();
    const result = sync(data, [remoteAccount({ transactions: [remoteTx({ description: 'SQ *CORNER BAKERY 0412' }), remoteTx({ remoteId: 't2', amount: 250000, description: 'Payroll', payee: 'Employer Inc', memo: 'ACH EMPLOYER INC PAYROLL' })] })]);
    expect(result.summary).toMatchObject({ added: 2, updated: 0, matched: 0, removed: 0, accounts: 1, problems: [] });
    expect(result.data.transactions.map((tx) => [tx.payee, tx.rawPayee, tx.amount, tx.reviewed, tx.status, tx.remoteId, tx.accountId])).toEqual([
      ['Corner Bakery', 'SQ *CORNER BAKERY 0412', -1250, false, 'cleared', 'conn/chk/t1', accountId],
      ['Employer Inc', 'ACH EMPLOYER INC PAYROLL', 250000, false, 'cleared', 'conn/chk/t2', accountId],
    ]);
    expect(result.data.connections[0]).toMatchObject({ lastSyncedAt: options.now, lastError: undefined });
  });

  it('makes the balance match the bank, whatever history it has seen', () => {
    const { data, accountId } = connected();
    const result = sync(data, [remoteAccount({ balance: 98750, transactions: [remoteTx()] })]);
    expect(balance(result.data, accountId)).toBe(98750);
    // The account now starts on the day of its earliest transaction, so history charts include it.
    expect(result.data.accounts[0].openingDate).toBe('2026-11-08');
  });

  it('adds nothing when the same data arrives again', () => {
    const remote = [remoteAccount({ transactions: [remoteTx(), remoteTx({ remoteId: 't2', amount: -500 })] })];
    const first = sync(connected().data, remote);
    const second = sync(first.data, remote);
    expect(second.summary).toMatchObject({ added: 0, updated: 0, matched: 0, removed: 0 });
    expect(second.data.transactions).toEqual(first.data.transactions);
  });

  it('applies rules and bill matching to what arrives', () => {
    let { data } = connected();
    data = ops.addRule(data, { enabled: true, conditions: { payeeMatch: 'contains', payeeText: 'bakery' }, actions: { categoryId: 'cat_dining', markReviewed: true } }).data;
    data = ops.addRecurring(data, { name: 'StreamBox', amount: -1399, currency: 'USD', categoryId: 'cat_subscriptions', frequency: 'monthly', anchorDate: '2026-11-08', matchText: 'streambox', tolerancePct: 10 }).data;
    const result = sync(data, [remoteAccount({ transactions: [remoteTx(), remoteTx({ remoteId: 't2', amount: -1399, description: 'STREAMBOX.COM' })] })]);
    expect(result.data.transactions[0]).toMatchObject({ categoryId: 'cat_dining', reviewed: true });
    expect(result.data.transactions[1]).toMatchObject({ categoryId: 'cat_subscriptions', recurringId: data.recurrings[0].id });
  });

  it('follows a pending charge as it changes and then clears', () => {
    const { data } = connected();
    const pending = sync(data, [remoteAccount({ transactions: [remoteTx({ pending: true })] })]);
    expect(pending.data.transactions[0].status).toBe('pending');
    const cleared = sync(pending.data, [remoteAccount({ transactions: [remoteTx({ amount: -1400, date: '2026-11-09' })] })]);
    expect(cleared.summary).toMatchObject({ added: 0, updated: 1 });
    expect(cleared.data.transactions).toHaveLength(1);
    expect(cleared.data.transactions[0]).toMatchObject({ status: 'cleared', amount: -1400, date: '2026-11-09' });
  });

  it('never overwrites the name, category, notes or tags a person set', () => {
    const { data } = connected();
    const first = sync(data, [remoteAccount({ transactions: [remoteTx({ pending: true })] })]);
    const id = first.data.transactions[0].id;
    const edited = ops.updateTransaction(first.data, id, { payee: 'Bakery on the corner', categoryId: 'cat_dining', notes: 'Croissants', tags: ['treat'], reviewed: true });
    const second = sync(edited, [remoteAccount({ transactions: [remoteTx({ amount: -1300 })] })]);
    expect(second.data.transactions[0]).toMatchObject({
      payee: 'Bakery on the corner', categoryId: 'cat_dining', notes: 'Croissants', tags: ['treat'], reviewed: true, amount: -1300, status: 'cleared',
    });
  });

  it('recognises a pending charge that posts under a new id, even with a tip added', () => {
    const { data } = connected();
    const first = sync(data, [remoteAccount({ transactions: [remoteTx({ remoteId: 'pend-1', amount: -5000, description: 'LUNA PIZZERIA', pending: true })] })]);
    const categorised = ops.updateTransaction(first.data, first.data.transactions[0].id, { categoryId: 'cat_dining' });
    const second = sync(categorised, [remoteAccount({ transactions: [remoteTx({ remoteId: 'post-9', amount: -6000, date: '2026-11-10', description: 'LUNA PIZZERIA 0412' })] })]);
    expect(second.summary).toMatchObject({ added: 0, updated: 1, removed: 0 });
    expect(second.data.transactions).toHaveLength(1);
    expect(second.data.transactions[0]).toMatchObject({ remoteId: 'conn/chk/post-9', amount: -6000, status: 'cleared', categoryId: 'cat_dining' });
  });

  it('removes a pending charge the bank dropped, but only within the period it reported on', () => {
    const { data } = connected();
    const first = sync(data, [remoteAccount({ transactions: [remoteTx({ remoteId: 'hold', amount: -10000, description: 'HOTEL DEPOSIT', pending: true }), remoteTx()] })]);
    const second = sync(first.data, [remoteAccount({ transactions: [remoteTx()] })]);
    expect(second.summary.removed).toBe(1);
    expect(second.data.transactions.map((tx) => tx.payee)).toEqual(['Corner Bakery']);
    // Outside the reported period, silence says nothing, so the charge stays.
    const narrow = sync(first.data, [remoteAccount({ transactions: [remoteTx()] })], { since: '2026-11-09' });
    expect(narrow.data.transactions).toHaveLength(2);
  });

  it('does not treat an unrelated new charge as the posted version of a pending one', () => {
    const { data } = connected();
    const first = sync(data, [remoteAccount({ transactions: [remoteTx({ remoteId: 'pend', amount: -5000, description: 'LUNA PIZZERIA', pending: true })] })]);
    const second = sync(first.data, [remoteAccount({ transactions: [remoteTx({ remoteId: 'other', amount: -5000, description: 'HARDWARE STORE' })] })]);
    expect(second.summary).toMatchObject({ added: 1, removed: 1 });
    expect(second.data.transactions.map((tx) => tx.payee)).toEqual(['Hardware Store']);
  });

  it('links to a transaction entered by hand instead of duplicating it', () => {
    let { data, accountId } = connected();
    data = ops.addTransaction(data, { accountId, date: '2026-11-07', amount: -1250, payee: 'Corner bakery', categoryId: 'cat_dining', status: 'pending' }).data;
    const result = sync(data, [remoteAccount({ transactions: [remoteTx({ description: 'SQ *CORNER BAKERY 0412' })] })]);
    expect(result.summary).toMatchObject({ added: 0, matched: 1 });
    expect(result.data.transactions).toHaveLength(1);
    expect(result.data.transactions[0]).toMatchObject({
      payee: 'Corner bakery', categoryId: 'cat_dining', date: '2026-11-08', status: 'cleared', remoteId: 'conn/chk/t1', rawPayee: 'SQ *CORNER BAKERY 0412',
    });
  });

  it('matches by amount and day when the names differ, but keeps genuinely separate purchases', () => {
    let { data, accountId } = connected();
    data = ops.addTransaction(data, { accountId, date: '2026-11-08', amount: -1250, payee: 'Breakfast' }).data;
    data = ops.addTransaction(data, { accountId, date: '2026-11-05', amount: -1250, payee: 'Parking' }).data;
    const result = sync(data, [remoteAccount({ transactions: [remoteTx(), remoteTx({ remoteId: 't2' })] })]);
    // One bank row pairs with "Breakfast" (same day); the second is new; "Parking" three days earlier under another name is left alone.
    expect(result.summary).toMatchObject({ added: 1, matched: 1 });
    expect(result.data.transactions.map((tx) => [tx.payee, tx.remoteId])).toEqual([
      ['Breakfast', 'conn/chk/t1'],
      ['Parking', undefined],
      ['Corner Bakery', 'conn/chk/t2'],
    ]);
  });

  it('only touches linked accounts, and reports a currency mismatch instead of guessing', () => {
    const remote = [remoteAccount(), remoteAccount({ remoteId: 'sav', name: 'Savings', transactions: [remoteTx()] })];
    let data = addConnection(emptyData('USD'), { id: 'conn', name: 'Bank', remote }).data;
    data = linkAccounts(data, 'conn', { chk: { kind: 'new' } }, remote, today);
    const result = sync(data, remote);
    expect(result.summary).toMatchObject({ added: 0, accounts: 1 });

    const mismatch = sync(data, [remoteAccount({ currency: 'EUR', transactions: [remoteTx()] })]);
    expect(mismatch.summary.problems).toEqual(['Everyday is in EUR but Everyday is in USD, so it was not updated.']);
    expect(mismatch.data.transactions).toEqual([]);
    expect(mismatch.data.connections[0].lastError).toMatch(/not updated/);
    expect(applySync(data, 'nope', remote, options).data).toBe(data);
  });

  it('records problems the bank reported and clears them after a clean sync', () => {
    const { data } = connected();
    const failed = sync(data, [remoteAccount()], { issues: ['Authentication failed for My Bank'] } as never);
    expect(failed.data.connections[0].lastError).toBe('Authentication failed for My Bank');
    expect(sync(failed.data, [remoteAccount()]).data.connections[0].lastError).toBeUndefined();
    expect(noteSyncFailure(data, 'conn', 'No connection').connections[0].lastError).toBe('No connection');
  });

  it('keeps holdings in step with the bank and leaves hand-entered ones alone', () => {
    const holding = { remoteId: 'h1', name: 'Shares of Apple', symbol: 'AAPL', shares: 10, marketValue: 200000, costBasis: 150000, currency: 'USD' };
    const remote = [remoteAccount({ remoteId: 'inv', name: 'Brokerage', balance: 250000, holdings: [holding] })];
    let { data, accountId } = connected(remote);
    expect(data.accounts[0].type).toBe('investment');
    data = ops.addHolding(data, { accountId, name: 'Company stock', shares: 5, marketValue: 50000, currency: 'USD', updatedAt: today }).data;

    const first = sync(data, remote);
    expect(first.data.holdings.map((item) => [item.name, item.marketValue, item.remoteId])).toEqual([
      ['Company stock', 50000, undefined],
      ['Shares of Apple', 200000, 'h1'],
    ]);
    expect(balance(first.data, accountId)).toBe(250000);

    const id = first.data.holdings[1].id;
    const second = sync(first.data, [remoteAccount({ remoteId: 'inv', name: 'Brokerage', balance: 265000, holdings: [{ ...holding, shares: 11, marketValue: 215000 }, { ...holding, remoteId: 'h2', name: 'Index fund', symbol: 'VTI', marketValue: 0 }] })]);
    expect(second.data.holdings.map((item) => [item.name, item.shares, item.marketValue])).toEqual([
      ['Company stock', 5, 50000],
      ['Shares of Apple', 11, 215000],
      ['Index fund', 10, 0],
    ]);
    expect(second.data.holdings[1].id).toBe(id);
    expect(balance(second.data, accountId)).toBe(265000);

    // Sold everything: the bank lists no holdings, so the synced ones go.
    const sold = sync(second.data, [remoteAccount({ remoteId: 'inv', name: 'Brokerage', balance: 50000, holdings: [] })]);
    expect(sold.data.holdings.map((item) => item.name)).toEqual(['Company stock']);
    // A service that says nothing about holdings changes nothing.
    expect(sync(second.data, [remoteAccount({ remoteId: 'inv', name: 'Brokerage', balance: 265000 })]).data.holdings).toHaveLength(3);
  });

  it('imports the live demo bank end to end', () => {
    const snapshot = parseAccountSet(demo, today);
    let data = addConnection(emptyData('USD'), { id: 'conn', name: 'SimpleFIN Demo', remote: snapshot.accounts }).data;
    data = linkAccounts(data, 'conn', Object.fromEntries(snapshot.accounts.map((account) => [account.remoteId, { kind: 'new' as const }])), snapshot.accounts, today);
    const result = sync(data, snapshot.accounts);
    expect(result.summary).toMatchObject({ added: 6, accounts: 3, problems: [] });
    const byName = new Map(result.data.accounts.map((account) => [account.name, account]));
    expect(balance(result.data, byName.get('SimpleFIN Checking')!.id)).toBe(2430223);
    expect(balance(result.data, byName.get('SimpleFIN Savings')!.id)).toBe(11412551);
    expect(byName.get('SimpleFIN Savings')!.type).toBe('investment');
    expect(result.data.holdings).toEqual([expect.objectContaining({ symbol: 'AAPL', shares: 550, marketValue: 10588480, costBasis: 5500 })]);
  });
});

describe('syncWindowStart', () => {
  it('asks for the most history allowed the first time, then overlaps the last sync', () => {
    expect(syncWindowStart({}, today, 44)).toBe('2026-09-27');
    expect(syncWindowStart({ lastSyncedAt: Date.UTC(2026, 10, 9, 12) }, today, 44)).toBe('2026-10-30');
    expect(syncWindowStart({ lastSyncedAt: Date.UTC(2026, 0, 1) }, today, 44)).toBe('2026-09-27');
  });
});

describe('holdings kept by hand', () => {
  function withBrokerage() {
    let data: AppData = { ...emptyData('USD'), settings: { ...emptyData('USD').settings, rates: { EUR: 1.1 } } };
    const added = ops.addAccount(data, { name: 'Brokerage', type: 'investment', currency: 'USD', openingBalance: 0, openingDate: '2026-01-01' });
    data = added.data;
    return { data, accountId: added.id };
  }

  it('makes the account worth what its holdings are worth', () => {
    let { data, accountId } = withBrokerage();
    const fund = ops.addHolding(data, { accountId, name: ' World fund ', symbol: ' vwrl ', shares: 12.5, marketValue: 150000, costBasis: 120000, currency: 'USD', updatedAt: today });
    data = fund.data;
    expect(data.holdings[0]).toMatchObject({ name: 'World fund', symbol: 'VWRL' });
    expect(balance(data, accountId)).toBe(150000);

    data = ops.addHolding(data, { accountId, name: 'Euro bond fund', shares: 10, marketValue: 100000, currency: 'EUR', updatedAt: today }).data;
    expect(balance(data, accountId)).toBe(150000 + 110000);

    data = ops.updateHolding(data, fund.id, { marketValue: 180000, shares: 13 });
    expect(balance(data, accountId)).toBe(180000 + 110000);
    data = ops.deleteHolding(data, fund.id);
    expect(balance(data, accountId)).toBe(110000);
    expect(ops.updateHolding(data, 'nope', { shares: 1 })).toBe(data);
    expect(ops.deleteHolding(data, 'nope')).toBe(data);
  });

  it('removes holdings with their account, and leaves a bank-synced account balance to the bank', () => {
    let { data, accountId } = withBrokerage();
    data = ops.addHolding(data, { accountId, name: 'Fund', shares: 1, marketValue: 5000, currency: 'USD', updatedAt: today }).data;
    expect(ops.deleteAccount(data, accountId).holdings).toEqual([]);

    const linked = { ...data, connections: [{ id: 'c', provider: 'simplefin' as const, name: 'Bank', links: { r: accountId }, remoteAccounts: [] }] };
    expect(ops.isSynced(linked, accountId)).toBe(true);
    const more = ops.addHolding(linked, { accountId, name: 'Extra', shares: 1, marketValue: 99900, currency: 'USD', updatedAt: today }).data;
    expect(balance(more, accountId)).toBe(5000);
    expect(ops.deleteAccount(linked, accountId).connections[0].links).toEqual({});
  });
});

describe('portfolio', () => {
  const data = { ...emptyData('USD'), settings: { ...emptyData('USD').settings, rates: { EUR: 1.1 } } };
  const ctx = makeCtx(data);
  const holding = (overrides: object) => ({ id: 'h', accountId: 'a', name: 'Fund', shares: 10, marketValue: 100000, currency: 'USD', updatedAt: today, ...overrides });

  it('values holdings in the main currency, with gain where the cost is known', () => {
    const result = portfolio(
      [
        holding({ id: '1', name: 'Tech', marketValue: 300000, costBasis: 200000 }),
        holding({ id: '2', name: 'Euro fund', marketValue: 100000, costBasis: 110000, currency: 'EUR' }),
        holding({ id: '3', name: 'Gift shares', marketValue: 90000 }),
      ],
      ctx,
    );
    expect(result.value).toBe(300000 + 110000 + 90000);
    expect(result.cost).toBe(200000 + 121000);
    expect(result.gain).toBe(100000 - 11000);
    expect(result.gainFraction).toBeCloseTo(89000 / 321000);
    expect(result.partialCost).toBe(true);
    expect(result.holdings.map((view) => [view.holding.name, view.value, view.gain])).toEqual([
      ['Tech', 300000, 100000],
      ['Euro fund', 110000, -11000],
      ['Gift shares', 90000, null],
    ]);
    expect(result.holdings[0].weight).toBeCloseTo(0.6);
    expect(result.holdings[0].gainFraction).toBeCloseTo(0.5);
  });

  it('can look at one account, and copes with nothing held', () => {
    const all = [holding({ id: '1', accountId: 'a' }), holding({ id: '2', accountId: 'b', marketValue: 5000 })];
    expect(portfolio(all, ctx, 'b').value).toBe(5000);
    expect(portfolio([], ctx)).toMatchObject({ holdings: [], value: 0, cost: 0, gain: null, gainFraction: null, partialCost: false });
    expect(portfolio([holding({ marketValue: 0 })], ctx).holdings[0].weight).toBe(0);
  });

  it('works out a price per share and formats changes', () => {
    expect(pricePerShare({ marketValue: 10588480, shares: 550 })).toBe(19252);
    expect(pricePerShare({ marketValue: 100, shares: 0 })).toBeNull();
    expect(formatFraction(0.1234)).toBe('+12.3%');
    expect(formatFraction(-0.04)).toBe('−4.0%');
    expect(formatFraction(19.2)).toBe('+1920%');
  });
});
