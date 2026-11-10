import demoV1 from '@/test/fixtures/simplefin-demo-v1.json';
import demoV2 from '@/test/fixtures/simplefin-demo-v2.json';

import { decodeBase64, encodeBase64 } from '../sync/base64';
import { accountsUrl, claimUrlFromToken, namesFor, parseAccessUrl, parseAccountSet, SIMPLEFIN_DEMO_TOKEN, SimpleFinError } from '../sync/simplefin';

const today = '2026-11-10';

describe('base64', () => {
  it('encodes and decodes, with or without padding', () => {
    expect(encodeBase64('demo:demo')).toBe('ZGVtbzpkZW1v');
    expect(encodeBase64('a')).toBe('YQ==');
    expect(encodeBase64('ab')).toBe('YWI=');
    expect(encodeBase64('user:pä$$')).toBe('dXNlcjpww6QkJA==');
    expect(decodeBase64('YQ==')).toBe('a');
    expect(decodeBase64('YWI')).toBe('ab');
    expect(decodeBase64(' ZGVtbzpk\nZW1v ')).toBe('demo:demo');
    expect(decodeBase64(encodeBase64('https://example.com/claim/Ünïcode'))).toBe('https://example.com/claim/Ünïcode');
  });

  it('rejects text that is not Base64', () => {
    expect(decodeBase64('')).toBeNull();
    expect(decodeBase64('not base64!')).toBeNull();
    expect(decodeBase64('A')).toBeNull();
    expect(decodeBase64('/w==')).toBeNull(); // not valid UTF-8
  });
});

describe('tokens and access URLs', () => {
  it('decodes a setup token into the URL to claim', () => {
    expect(claimUrlFromToken(SIMPLEFIN_DEMO_TOKEN)).toBe('https://beta-bridge.simplefin.org/simplefin/claim/DEMO');
    expect(claimUrlFromToken(`  ${SIMPLEFIN_DEMO_TOKEN}\n`)).toBe('https://beta-bridge.simplefin.org/simplefin/claim/DEMO');
  });

  it('refuses anything that is not an https URL', () => {
    expect(() => claimUrlFromToken('hello')).toThrow(SimpleFinError);
    expect(() => claimUrlFromToken(encodeBase64('http://insecure.example/claim/x'))).toThrow(/does not look like/);
    expect(() => claimUrlFromToken(encodeBase64('javascript:alert(1)'))).toThrow(SimpleFinError);
    expect(() => claimUrlFromToken('')).toThrow(SimpleFinError);
  });

  it('splits an access URL into an address and credentials', () => {
    expect(parseAccessUrl('https://demo:demo@beta-bridge.simplefin.org/simplefin')).toEqual({
      baseUrl: 'https://beta-bridge.simplefin.org/simplefin',
      authorization: 'Basic ZGVtbzpkZW1v',
    });
    expect(parseAccessUrl(' https://us%40er:p%3Ass@bank.example/sfin/ \n')).toEqual({
      baseUrl: 'https://bank.example/sfin',
      authorization: `Basic ${encodeBase64('us@er:p:ss')}`,
    });
  });

  it('refuses access URLs without credentials or without https', () => {
    expect(() => parseAccessUrl('https://bank.example/sfin')).toThrow(SimpleFinError);
    expect(() => parseAccessUrl('http://a:b@bank.example/sfin')).toThrow(SimpleFinError);
    expect(() => parseAccessUrl('Forbidden')).toThrow(SimpleFinError);
  });

  it('builds the accounts request', () => {
    const access = parseAccessUrl('https://demo:demo@beta-bridge.simplefin.org/simplefin');
    expect(accountsUrl(access)).toBe('https://beta-bridge.simplefin.org/simplefin/accounts?version=2&pending=1');
    expect(accountsUrl(access, { startDate: 1790000000.7, balancesOnly: true })).toBe(
      'https://beta-bridge.simplefin.org/simplefin/accounts?version=2&pending=1&start-date=1790000000&balances-only=1',
    );
  });
});

describe('parseAccountSet', () => {
  it('reads the live demo response (protocol version 2)', () => {
    const { accounts, issues } = parseAccountSet(demoV2, today);
    expect(issues).toEqual([]);
    expect(accounts.map((account) => [account.remoteId, account.name, account.institution, account.currency, account.balance])).toEqual([
      ['Demo Savings', 'SimpleFIN Savings', 'SimpleFIN Demo', 'USD', 11412551],
      ['Demo Checking', 'SimpleFIN Checking', 'SimpleFIN Demo', 'USD', 2430223],
      ['Demo Empty Account', 'SimpleFIN Empty Account', 'SimpleFIN Demo', 'USD', 0],
    ]);
    const [savings, checking, empty] = accounts;
    expect(savings.balanceDate).toBe('2026-11-11');
    expect(checking.transactions[0]).toEqual({
      remoteId: '1794297600',
      date: '2026-11-10',
      amount: -6554,
      payee: "John's Fishin Shack",
      description: 'Fishing bait',
      memo: 'JOHNS FISHIN SHACK BAIT',
      pending: false,
    });
    expect(savings.holdings).toEqual([
      {
        remoteId: '25bc4910-4cb4-437b-9924-ee98003651c5',
        name: 'Shares of Apple',
        symbol: 'AAPL',
        shares: 550,
        marketValue: 10588480,
        costBasis: 5500,
        currency: 'USD',
      },
    ]);
    expect(empty.transactions).toEqual([]);
    expect(empty.holdings).toEqual([]);
  });

  it('reads the older response shape (protocol version 1)', () => {
    const { accounts, issues } = parseAccountSet(demoV1, today);
    expect(issues).toEqual([]);
    expect(accounts).toHaveLength(3);
    expect(accounts[0].institution).toBe('SimpleFIN Demo');
    expect(accounts[1].transactions).toHaveLength(3);
  });

  it('treats a transaction with no posting date as pending', () => {
    const { accounts } = parseAccountSet(
      {
        errlist: [],
        accounts: [
          {
            id: 'a',
            name: 'Card',
            currency: 'usd',
            balance: '-120.50',
            'balance-date': 1794355200,
            transactions: [
              { id: 'p1', posted: 0, amount: '-12.00', description: 'SQ *CORNER BAKERY 0412', transacted_at: 1794182400 },
              { id: 'p2', posted: 1794268800, amount: '-8.00', description: 'Cafe', pending: true },
              { id: 'p3', posted: 0, amount: '-1.00', description: 'No dates at all' },
            ],
          },
        ],
      },
      today,
    );
    expect(accounts[0].currency).toBe('USD');
    expect(accounts[0].balance).toBe(-12050);
    expect(accounts[0].holdings).toBeUndefined();
    expect(accounts[0].transactions.map((tx) => [tx.remoteId, tx.date, tx.pending])).toEqual([
      ['p1', '2026-11-09', true],
      ['p2', '2026-11-10', true],
      ['p3', '2026-11-11', true],
    ]);
  });

  it('turns server errors into safe messages and says which need attention', () => {
    const { issues } = parseAccountSet(
      {
        errlist: [
          { code: 'con.auth', msg: 'Authentication failed for My Bank\n- Jim\u0007', conn_id: 'c1' },
          { code: 'act.failed', msg: 'Failed to get all transactions. Try again later.', account_id: 'a1' },
          { code: 'gen.api', msg: 'Requested date range exceeds recommended range of 45 days.' },
          { code: 'gen.', msg: '' },
          'nonsense',
        ],
        accounts: [],
      },
      today,
    );
    expect(issues).toEqual([
      { message: 'Authentication failed for My Bank - Jim', needsAttention: true, remoteAccountId: undefined },
      { message: 'Failed to get all transactions. Try again later.', needsAttention: false, remoteAccountId: 'a1' },
    ]);
    const old = parseAccountSet({ errors: ['Please log in to My Bank again', 'x'.repeat(500)], accounts: [] }, today);
    expect(old.issues[0]).toEqual({ message: 'Please log in to My Bank again', needsAttention: true });
    expect(old.issues[1].message).toHaveLength(200);
  });

  it('skips what it cannot read and says so', () => {
    const { accounts, issues } = parseAccountSet(
      {
        errlist: [],
        accounts: [
          { id: 'miles', name: 'Air miles', currency: 'https://example.com/miles', balance: '5000', 'balance-date': 1 },
          { id: 'bad', name: 'Broken', currency: 'USD', balance: 'n/a' },
          { name: 'No id', currency: 'USD', balance: '1' },
          'junk',
          {
            id: 'ok',
            name: '',
            currency: 'EUR',
            balance: '10',
            'balance-date': 'soon',
            transactions: [
              { id: '', amount: '1', description: 'no id' },
              { id: 't', amount: 'x', description: 'bad amount' },
              null,
              { id: 'good', posted: 1794297600, amount: '5.5', description: '' },
            ],
            holdings: [
              { id: 'h', market_value: '100.00', shares: '2', currency: 'zzz', cost_basis: '0.00' },
              { id: '', market_value: '1', shares: '1' },
              { id: 'x', market_value: '1', shares: 'many' },
            ],
          },
        ],
      },
      today,
    );
    expect(issues.map((issue) => issue.message)).toEqual([
      'Air miles was skipped because it is not held in a currency.',
      'Broken was skipped because its balance could not be read.',
    ]);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ remoteId: 'ok', name: 'Account', currency: 'EUR', balance: 1000, balanceDate: today });
    expect(accounts[0].transactions).toEqual([
      { remoteId: 'good', date: '2026-11-10', amount: 550, payee: undefined, description: 'Unknown', memo: undefined, pending: false },
    ]);
    expect(accounts[0].holdings).toEqual([
      { remoteId: 'h', name: 'Holding', symbol: undefined, shares: 2, marketValue: 10000, costBasis: undefined, currency: 'EUR' },
    ]);
  });

  it('refuses a reply that is not an account set', () => {
    expect(() => parseAccountSet('Forbidden', today)).toThrow(SimpleFinError);
    expect(() => parseAccountSet({ accounts: 'none' }, today)).toThrow(/could not be read/);
    expect(() => parseAccountSet(null, today)).toThrow(SimpleFinError);
  });
});

describe('namesFor', () => {
  const base = { remoteId: 'x', date: today, amount: -100, pending: false };

  it('prefers the payee the service gives and keeps the raw statement text', () => {
    expect(namesFor({ ...base, payee: "John's Fishin Shack", description: 'Fishing bait', memo: 'JOHNS FISHIN SHACK BAIT' })).toEqual({
      payee: "John's Fishin Shack",
      rawPayee: 'JOHNS FISHIN SHACK BAIT',
    });
  });

  it('cleans up the description when there is no payee', () => {
    expect(namesFor({ ...base, description: 'SQ *CORNER BAKERY 0412' })).toEqual({ payee: 'Corner Bakery', rawPayee: 'SQ *CORNER BAKERY 0412' });
    expect(namesFor({ ...base, description: 'Rent' })).toEqual({ payee: 'Rent', rawPayee: undefined });
  });
});
