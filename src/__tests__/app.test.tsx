import AsyncStorage from '@react-native-async-storage/async-storage';
import { userEvent } from '@testing-library/react-native';
import { act, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Alert } from 'react-native';

import { emptyData } from '@/domain/seed';
import { useUi } from '@/store/hooks';
import { flushSave, STORAGE_KEY, useStore } from '@/store/store';

/**
 * The whole app rendered through its real routes, as it runs on iPhone.
 * The browser suite in e2e/ covers the same flows on the web build.
 */

async function launch() {
  const app = await renderRouter('src/app', { initialUrl: '/' });
  await waitFor(() => expect(useStore.getState().hydrated).toBe(true));
  return app;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  useStore.setState({ data: emptyData('USD'), hydrated: false, loadError: null });
  useUi.setState({ txFilter: {} });
});

afterEach(async () => {
  await act(async () => {
    await flushSave();
  });
});

describe('first launch', () => {
  it('welcomes a new person and explains what makes the app different', async () => {
    await launch();
    expect(await screen.findByText('Waypoint')).toBeOnTheScreen();
    expect(screen.getByText('Any bank, any currency')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Start fresh' })).toBeOnTheScreen();
  });

  it('starts empty and points to adding an account', async () => {
    const user = userEvent.setup();
    await launch();
    await user.press(await screen.findByRole('button', { name: 'Start fresh' }));
    expect(await screen.findByText('Add your first account')).toBeOnTheScreen();
    expect(useStore.getState().data.settings.onboarded).toBe(true);
  });

  it('fills the dashboard from sample data', async () => {
    const user = userEvent.setup();
    await launch();
    await user.press(await screen.findByRole('button', { name: 'Explore with sample data' }));
    expect(await screen.findByText('Spent this month')).toBeOnTheScreen();
    expect(screen.getByText('6 transactions to review')).toBeOnTheScreen();
    expect(screen.getByText('Free to spend')).toBeOnTheScreen();
    expect(screen.getByText('Net worth')).toBeOnTheScreen();
  });
});

describe('returning to the app', () => {
  it('opens straight to the dashboard with saved data', async () => {
    const saved = emptyData('EUR');
    saved.settings.onboarded = true;
    saved.accounts.push({ id: 'acc', name: 'Girokonto', type: 'checking', currency: 'EUR', openingBalance: 123456, openingDate: '2026-01-01', archived: false, includeInNetWorth: true });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    await launch();
    expect(await screen.findByText('Spent this month')).toBeOnTheScreen();
    expect(screen.getByTestId('net-worth')).toHaveTextContent('€1,234.56');
  });

  it('explains the problem instead of wiping data it cannot read', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{"broken":');
    await launch();
    expect(await screen.findByText('Your saved data could not be opened')).toBeOnTheScreen();
    expect(screen.getByText(/Nothing has been deleted/)).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(STORAGE_KEY)).toBe('{"broken":');
  });
});

describe('recording money by hand', () => {
  async function withAccount() {
    const user = userEvent.setup();
    const app = await launch();
    await act(async () => {
      useStore.getState().startFresh('USD');
      useStore.getState().addAccount({ name: 'Everyday', type: 'checking', currency: 'USD', openingBalance: 100000, openingDate: '2026-01-01' });
    });
    return { user, app };
  }

  it('adds an expense through the form', async () => {
    const { user } = await withAccount();
    await user.press(await screen.findByTestId('fab-home'));
    await user.type(await screen.findByTestId('amount-input'), '12.50');
    await user.type(screen.getByTestId('payee-input'), 'Corner bakery');
    await user.press(screen.getByTestId('save-button'));

    await waitFor(() => expect(useStore.getState().data.transactions).toHaveLength(1));
    expect(useStore.getState().data.transactions[0]).toMatchObject({ amount: -1250, payee: 'Corner bakery', kind: 'standard', status: 'cleared', reviewed: true });
    expect(await screen.findByTestId('spent-this-month')).toHaveTextContent('$12.50');
  });

  it('refuses to save without an amount and says why', async () => {
    const { user } = await withAccount();
    await user.press(await screen.findByTestId('fab-home'));
    await user.press(await screen.findByTestId('save-button'));
    expect(await screen.findByText('A couple of things to fix')).toBeOnTheScreen();
    expect(useStore.getState().data.transactions).toHaveLength(0);
  });

  it('records income as money coming in', async () => {
    const { user } = await withAccount();
    await user.press(await screen.findByTestId('fab-home'));
    await user.press(await screen.findByRole('tab', { name: 'Income' }));
    await user.type(screen.getByTestId('amount-input'), '2000');
    await user.press(screen.getByTestId('save-button'));
    await waitFor(() => expect(useStore.getState().data.transactions).toHaveLength(1));
    expect(useStore.getState().data.transactions[0].amount).toBe(200000);
  });
});

describe('deleting', () => {
  it('asks with the system alert, and only deletes on a clear yes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const user = userEvent.setup();
    await launch();
    let id = '';
    await act(async () => {
      const store = useStore.getState();
      store.startFresh('USD');
      const accountId = store.addAccount({ name: 'Everyday', type: 'checking', currency: 'USD', openingBalance: 0, openingDate: '2026-01-01' });
      id = store.addTransaction({ accountId, date: '2026-11-09', amount: -900, payee: 'Cinema Nova' });
    });

    await user.press(await screen.findByTestId('tab-transactions'));
    await user.press(await screen.findByTestId(`tx-${id}`));
    await user.press(await screen.findByTestId('delete-button'));

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alert.mock.calls[0];
    expect(title).toBe('Delete this transaction?');
    expect(buttons?.map((button) => [button.text, button.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Delete', 'destructive'],
    ]);

    // Cancelling leaves everything as it was.
    await act(async () => buttons?.[0].onPress?.());
    expect(useStore.getState().data.transactions).toHaveLength(1);

    await user.press(screen.getByTestId('delete-button'));
    await act(async () => alert.mock.calls[1][2]?.[1].onPress?.());
    await waitFor(() => expect(useStore.getState().data.transactions).toHaveLength(0));
    alert.mockRestore();
  });
});
