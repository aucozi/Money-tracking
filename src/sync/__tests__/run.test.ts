import { emptyData } from '@/domain/seed';
import { SIMPLEFIN_DEMO_TOKEN, SimpleFinError } from '@/domain/sync/simplefin';
import { accountBalances } from '@/domain/networth';
import { useStore } from '@/store/store';
import demo from '@/test/fixtures/simplefin-demo-v2.json';

import { claimAccessUrl, fetchSnapshot } from '../client';
import { connect, disconnect, syncAll, syncConnection, useSync } from '../run';

// The keychain is native; an in-memory stand-in is enough to prove what is stored where.
const mockVault = new Map<string, string>();
jest.mock('@/platform/secrets', () => ({
  saveSecret: async (name: string, value: string) => void mockVault.set(name, value),
  readSecret: async (name: string) => mockVault.get(name) ?? null,
  deleteSecret: async (name: string) => void mockVault.delete(name),
}));

const ACCESS = 'https://demo:demo@beta-bridge.simplefin.org/simplefin';
const reply = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, text: async () => String(body), json: async () => (typeof body === 'string' ? JSON.parse(body) : body) }) as Response;

/** A stand-in bank that answers like the SimpleFIN demo server. */
function fakeBank(accounts: unknown = demo) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === 'POST') return reply(200, ACCESS);
    return reply(200, accounts);
  });
  global.fetch = impl as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  mockVault.clear();
  useStore.setState({ data: { ...emptyData('USD'), settings: { ...emptyData('USD').settings, onboarded: true } }, hydrated: true, loadError: null });
  useSync.setState({ running: false, offered: {} });
});

describe('client', () => {
  it('claims a token with a POST and returns the access URL', async () => {
    const calls = fakeBank();
    expect(await claimAccessUrl(SIMPLEFIN_DEMO_TOKEN)).toBe(ACCESS);
    expect(calls[0]).toMatchObject({ url: 'https://beta-bridge.simplefin.org/simplefin/claim/DEMO', init: { method: 'POST' } });
  });

  it('explains a token that was already used, and other failures', async () => {
    global.fetch = jest.fn(async () => reply(403, 'Forbidden')) as unknown as typeof fetch;
    await expect(claimAccessUrl(SIMPLEFIN_DEMO_TOKEN)).rejects.toThrow(/already been used/);
    global.fetch = jest.fn(async () => reply(500, 'oops')) as unknown as typeof fetch;
    await expect(claimAccessUrl(SIMPLEFIN_DEMO_TOKEN)).rejects.toThrow(/error 500/);
    global.fetch = jest.fn(async () => reply(200, 'not a url')) as unknown as typeof fetch;
    await expect(claimAccessUrl(SIMPLEFIN_DEMO_TOKEN)).rejects.toThrow(SimpleFinError);
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(claimAccessUrl(SIMPLEFIN_DEMO_TOKEN)).rejects.toThrow(/Check that you are online/);
    await expect(claimAccessUrl('garbage')).rejects.toThrow(/does not look like a SimpleFIN token/);
  });

  it('sends credentials in a header, never in the address', async () => {
    const calls = fakeBank();
    const snapshot = await fetchSnapshot(ACCESS, { startDate: 1790000000 }, '2026-11-10');
    expect(snapshot.accounts).toHaveLength(3);
    expect(calls[0].url).toBe('https://beta-bridge.simplefin.org/simplefin/accounts?version=2&pending=1&start-date=1790000000');
    expect(calls[0].url).not.toContain('demo:demo');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Basic ZGVtbzpkZW1v');
  });

  it('turns HTTP failures into plain explanations', async () => {
    for (const [status, message] of [[403, /Access may have been revoked/], [402, /subscription/], [503, /error 503/]] as const) {
      global.fetch = jest.fn(async () => reply(status, '')) as unknown as typeof fetch;
      await expect(fetchSnapshot(ACCESS, {}, '2026-11-10')).rejects.toThrow(message);
    }
    global.fetch = jest.fn(async () => reply(200, '<html>')) as unknown as typeof fetch;
    await expect(fetchSnapshot(ACCESS, {}, '2026-11-10')).rejects.toThrow(/could not be read/);
  });
});

describe('connecting and syncing', () => {
  it('keeps the credential in the keychain and out of the dataset', async () => {
    fakeBank();
    const { connectionId, accounts } = await connect(SIMPLEFIN_DEMO_TOKEN);
    expect(accounts.map((account) => account.name)).toEqual(['SimpleFIN Savings', 'SimpleFIN Checking', 'SimpleFIN Empty Account']);
    expect(mockVault.get(connectionId)).toBe(ACCESS);
    const { data } = useStore.getState();
    expect(data.connections[0]).toMatchObject({ id: connectionId, name: 'SimpleFIN Demo', links: {} });
    expect(JSON.stringify(data)).not.toContain('demo:demo');
    expect(useSync.getState().offered[connectionId]).toHaveLength(3);
  });

  it('imports the chosen accounts and then stays in step', async () => {
    fakeBank();
    const { connectionId, accounts } = await connect(SIMPLEFIN_DEMO_TOKEN);
    useStore.getState().linkAccounts(connectionId, { 'Demo Checking': { kind: 'new' }, 'Demo Savings': { kind: 'new' } }, accounts, '2026-11-10');
    const first = await syncConnection(connectionId);
    expect(first).toMatchObject({ added: 6, accounts: 2, problems: [] });

    const { data } = useStore.getState();
    const checking = data.accounts.find((account) => account.name === 'SimpleFIN Checking')!;
    expect(accountBalances(data.accounts, data.transactions).get(checking.id)).toBe(2430223);
    expect(data.holdings[0]).toMatchObject({ symbol: 'AAPL', marketValue: 10588480 });
    expect(data.connections[0].lastSyncedAt).toEqual(expect.any(Number));

    // Nothing new at the bank: nothing changes here.
    expect(await syncConnection(connectionId)).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(useStore.getState().data.transactions).toHaveLength(6);
  });

  it('syncs on opening only when the last sync is stale, and never twice at once', async () => {
    const calls = fakeBank();
    const { connectionId, accounts } = await connect(SIMPLEFIN_DEMO_TOKEN);
    expect(await syncAll()).toEqual({ added: 0, errors: [], synced: 0 }); // nothing linked yet
    useStore.getState().linkAccounts(connectionId, { 'Demo Checking': { kind: 'new' } }, accounts, '2026-11-10');
    expect(await syncAll({ onlyIfStale: true })).toMatchObject({ added: 3, synced: 1 });
    const before = calls.length;
    expect(await syncAll({ onlyIfStale: true })).toMatchObject({ synced: 0 });
    expect(calls.length).toBe(before);
    expect(await syncAll()).toMatchObject({ synced: 1, added: 0 });

    useSync.setState({ running: true });
    expect(await syncAll()).toMatchObject({ synced: 0 });
  });

  it('records a failure on the connection without losing anything', async () => {
    fakeBank();
    const { connectionId, accounts } = await connect(SIMPLEFIN_DEMO_TOKEN);
    useStore.getState().linkAccounts(connectionId, { 'Demo Checking': { kind: 'new' } }, accounts, '2026-11-10');
    await syncConnection(connectionId);
    global.fetch = jest.fn(async () => reply(403, '')) as unknown as typeof fetch;
    const outcome = await syncAll();
    expect(outcome.errors[0]).toMatch(/Access may have been revoked/);
    expect(useStore.getState().data.connections[0].lastError).toMatch(/Access may have been revoked/);
    expect(useStore.getState().data.transactions).toHaveLength(3);
    expect(useSync.getState().running).toBe(false);

    mockVault.clear();
    expect(await syncConnection(connectionId)).toEqual({ error: expect.stringMatching(/missing on this device/) });
    expect(await syncConnection('nope')).toEqual({ error: 'This connection no longer exists.' });
  });

  it('refuses a connection that has no accounts', async () => {
    fakeBank({ errlist: [{ code: 'con.auth', msg: 'Sign in to My Bank again' }], accounts: [] });
    await expect(connect(SIMPLEFIN_DEMO_TOKEN)).rejects.toThrow('Sign in to My Bank again');
    expect(useStore.getState().data.connections).toEqual([]);
    expect(mockVault.size).toBe(0);
  });

  it('disconnecting erases the credential and keeps the history', async () => {
    fakeBank();
    const { connectionId, accounts } = await connect(SIMPLEFIN_DEMO_TOKEN);
    useStore.getState().linkAccounts(connectionId, { 'Demo Checking': { kind: 'new' } }, accounts, '2026-11-10');
    await syncConnection(connectionId);
    await disconnect(connectionId);
    expect(mockVault.size).toBe(0);
    const { data } = useStore.getState();
    expect(data.connections).toEqual([]);
    expect(data.accounts).toHaveLength(1);
    expect(data.transactions).toHaveLength(3);
  });
});
