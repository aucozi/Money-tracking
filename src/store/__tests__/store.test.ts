import AsyncStorage from '@react-native-async-storage/async-storage';

import { emptyData } from '@/domain/seed';

import { flushSave, startAutosave, STORAGE_KEY, useStore } from '../store';

const reset = () => useStore.setState({ data: emptyData('USD'), hydrated: false, loadError: null });

describe('store persistence', () => {
  let stop: () => void;

  beforeEach(async () => {
    await AsyncStorage.clear();
    reset();
    stop = startAutosave(10);
  });
  afterEach(async () => {
    await flushSave();
    stop();
  });

  it('starts empty when nothing has been saved', async () => {
    await useStore.getState().hydrate();
    expect(useStore.getState()).toMatchObject({ hydrated: true, loadError: null });
    expect(useStore.getState().data.settings.onboarded).toBe(false);
  });

  it('saves changes and reads them back on the next launch', async () => {
    await useStore.getState().hydrate();
    useStore.getState().startFresh('EUR');
    const accountId = useStore.getState().addAccount({ name: 'Current', type: 'checking', currency: 'EUR', openingBalance: 5000, openingDate: '2026-11-09' });
    useStore.getState().addTransaction({ accountId, date: '2026-11-09', amount: -1250, payee: 'Cafe' });
    await flushSave();

    reset();
    await useStore.getState().hydrate();
    const { data } = useStore.getState();
    expect(data.settings).toMatchObject({ baseCurrency: 'EUR', onboarded: true });
    expect(data.accounts).toHaveLength(1);
    expect(data.transactions[0]).toMatchObject({ payee: 'Cafe', amount: -1250 });
  });

  it('never writes the empty default over saved data before loading it', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...emptyData('GBP'), settings: { ...emptyData('GBP').settings, onboarded: true } }));
    // A change made before hydration must not be persisted.
    useStore.getState().startFresh('USD');
    await flushSave();
    expect(JSON.parse((await AsyncStorage.getItem(STORAGE_KEY))!).settings.baseCurrency).toBe('GBP');
    await useStore.getState().hydrate();
    expect(useStore.getState().data.settings.baseCurrency).toBe('GBP');
  });

  it('keeps unreadable data aside instead of destroying it', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{"oops":');
    await useStore.getState().hydrate();
    expect(useStore.getState().hydrated).toBe(true);
    expect(useStore.getState().loadError).toBeTruthy();
    expect(await AsyncStorage.getItem('waypoint/data/unreadable')).toBe('{"oops":');
    // And nothing is saved over the original while in this state.
    useStore.getState().startFresh('USD');
    await flushSave();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('{"oops":');
  });

  it('rejects saved data that fails validation', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: { baseCurrency: 'EUR' } }));
    await useStore.getState().hydrate();
    expect(useStore.getState().loadError).toMatch(/accounts/);
  });

  it('loads demo data, restores a backup and erases on request', async () => {
    await useStore.getState().hydrate();
    useStore.getState().loadDemo('EUR', '2026-11-09');
    expect(useStore.getState().data.transactions.length).toBeGreaterThan(100);
    const snapshot = useStore.getState().data;
    useStore.getState().eraseEverything();
    expect(useStore.getState().data).toMatchObject({ transactions: [], accounts: [] });
    expect(useStore.getState().data.settings).toMatchObject({ baseCurrency: 'EUR', onboarded: false });
    useStore.getState().restore({ ...snapshot, connections: [{ id: 'c', provider: 'simplefin', name: 'Bank', links: {}, remoteAccounts: [] }] });
    // Everything comes back except bank connections, whose credentials are never in a backup.
    expect(useStore.getState().data).toEqual({ ...snapshot, connections: [] });
  });

  it('exposes every operation as an action', async () => {
    await useStore.getState().hydrate();
    const s = useStore.getState();
    s.startFresh('EUR');
    const a = s.addAccount({ name: 'A', type: 'checking', currency: 'EUR', openingBalance: 0, openingDate: '2026-11-01' });
    const b = s.addAccount({ name: 'B', type: 'savings', currency: 'EUR', openingBalance: 0, openingDate: '2026-11-01' });
    s.updateAccount(a, { name: 'Main' });
    s.reconcileAccount(a, 1000);
    s.updateSettings({ budgetMode: 'zero' });
    s.setRate('USD', 0.9);
    const group = s.addGroup('Pets', 'expense');
    s.updateGroup(group, { name: 'Animals' });
    const category = s.addCategory({ name: 'Vet', groupId: group, icon: '🐕' });
    s.updateCategory(category, { name: 'Vet bills' });
    s.setRollover(category, true, '2026-11');
    s.setBudget(category, '2026-11', 5000, 'forward');
    const tx = s.addTransaction({ accountId: a, date: '2026-11-09', amount: -700, payee: 'Vet' });
    s.updateTransaction(tx, { notes: 'checkup' });
    s.updateTransactions([tx], { categoryId: category });
    const transfer = s.addTransfer({ fromAccountId: a, toAccountId: b, date: '2026-11-09', amount: 100 });
    const recurring = s.addRecurring({
      name: 'Insurance',
      amount: -2000,
      currency: 'EUR',
      categoryId: category,
      frequency: 'monthly',
      anchorDate: '2026-11-15',
      matchText: 'Insurance',
      tolerancePct: 10,
    });
    s.updateRecurring(recurring, { amount: -2100 });
    s.skipOccurrence(recurring, '2026-12-15');
    const payment = s.markPaid(recurring, '2026-11-15', '2026-11-09');
    const goal = s.addGoal({ name: 'Kennel', targetAmount: 9000, createdDate: '2026-11-09' });
    s.updateGoal(goal, { name: 'New kennel' });
    s.contribute(goal, 500, '2026-11-09');
    const rule = s.addRule({ enabled: true, conditions: { payeeMatch: 'contains', payeeText: 'vet' }, actions: { addTags: ['pets'] } });
    s.updateRule(rule, { enabled: true });
    s.moveRule(rule, 1);
    expect(s.applyRuleToExisting(rule)).toBe(1);
    expect(s.importTransactions(a, [{ line: 2, date: '2026-11-02', amount: -300, payee: 'Shop', rawPayee: 'Shop' }], { keepBalance: false })).toBe(1);

    let data = useStore.getState().data;
    expect(data.accounts.find((item) => item.id === a)?.name).toBe('Main');
    expect(data.transactions.find((item) => item.id === tx)).toMatchObject({ notes: 'checkup', categoryId: category, tags: ['pets'] });
    expect(data.transactions.find((item) => item.id === payment)?.recurringId).toBe(recurring);
    expect(data.goals[0].contributions).toHaveLength(1);
    expect(data.settings).toMatchObject({ budgetMode: 'zero', rates: { USD: 0.9 } });

    s.deleteTransactions([transfer]);
    s.deleteRule(rule);
    s.deleteGoal(goal);
    s.deleteRecurring(recurring);
    s.deleteCategory(category);
    s.deleteGroup(group);
    s.deleteAccount(b);
    data = useStore.getState().data;
    expect(data.rules).toEqual([]);
    expect(data.goals).toEqual([]);
    expect(data.recurrings).toEqual([]);
    expect(data.categoryGroups.some((item) => item.id === group)).toBe(false);
    expect(data.accounts.map((item) => item.id)).toEqual([a]);
    expect(data.transactions.some((item) => item.kind === 'transfer')).toBe(false);
  });
});
