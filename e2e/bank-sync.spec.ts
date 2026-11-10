import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { goToTab, open, openWithSampleData, savedData } from './helpers';

const ACCESS_URL = 'https://demo:demo@beta-bridge.simplefin.org/simplefin';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

/**
 * Stand in for SimpleFIN's demo bank, answering with a response recorded from
 * the real one, so these tests do not depend on someone else's server.
 * `npm run check:bank-sync` exercises the real thing.
 */
async function fakeBank(page: Page) {
  const body = await readFile('src/test/fixtures/simplefin-demo-v2.json', 'utf8');
  const seen = { claims: 0, fetches: 0, authorization: '' };
  await page.route('https://beta-bridge.simplefin.org/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.method() === 'POST') {
      seen.claims += 1;
      return route.fulfill({ status: 200, headers: cors, contentType: 'text/plain', body: ACCESS_URL });
    }
    seen.fetches += 1;
    seen.authorization = request.headers().authorization ?? '';
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body });
  });
  return seen;
}

test('connecting a bank brings in accounts, transactions and holdings, and stays in step', async ({ page }) => {
  const bank = await fakeBank(page);
  await open(page);
  await page.getByTestId('start-fresh').click();
  await goToTab(page, 'accounts');
  await page.getByTestId('open-connections').click();
  await page.getByTestId('connect-demo').click();

  // Choose what to follow: everything except the empty account.
  await expect(page.getByTestId('link-sheet')).toBeVisible();
  await page.getByTestId('link-Demo Empty Account').click();
  await page.getByText('Do not follow').last().click();
  await page.getByTestId('save-links').click();
  await expect(page.getByTestId('toast')).toContainText('6 new transactions');
  expect(bank.claims).toBe(1);
  expect(bank.authorization).toBe('Basic ZGVtbzpkZW1v');

  await expect(page.getByText('2 of 3 accounts followed')).toBeVisible();
  await expect(page.getByText('Up to date')).toBeVisible();

  // Balances match the bank to the cent, and the brokerage position came with it.
  await page.getByRole('link', { name: 'Home, back' }).click();
  await expect(page.getByLabel('SimpleFIN Checking, $24,302.23')).toBeVisible();
  await expect(page.getByLabel('SimpleFIN Savings, $114,125.51')).toBeVisible();
  await expect(page.getByTestId('accounts-net-worth')).toHaveText('$138,427.74');
  await page.getByTestId('open-investments').click();
  await expect(page.getByTestId('portfolio-value')).toHaveText('$105,884.80');
  await expect(page.getByText('AAPL · Shares of Apple')).toBeVisible();
  await expect(page.getByText('550 shares · $192.52 each')).toBeVisible();

  // New transactions wait in the review inbox with readable names.
  await page.getByRole('link', { name: 'Home, back' }).click();
  await goToTab(page, 'transactions');
  await page.getByTestId('quick-review').click();
  await expect(page.getByTestId('tx-summary')).toContainText('6 transactions');
  await expect(page.getByText("John's Fishin Shack").first()).toBeVisible();

  // The access key never enters the dataset; it is stored separately.
  const data = await savedData(page);
  expect(JSON.stringify(data)).not.toContain('demo:demo');
  expect(data.connections[0]).toMatchObject({ name: 'SimpleFIN Demo', provider: 'simplefin' });
  expect(data.transactions.every((tx: { remoteId?: string }) => tx.remoteId?.startsWith(data.connections[0].id))).toBe(true);

  // Syncing again finds nothing new and duplicates nothing.
  await goToTab(page, 'accounts');
  await page.getByTestId('connections-row').click();
  await page.getByTestId('sync-now').click();
  await expect(page.getByTestId('toast')).toContainText('Already up to date');
  expect((await savedData(page)).transactions).toHaveLength(6);
});

test('a transaction entered by hand is matched when the bank reports it', async ({ page }) => {
  await fakeBank(page);
  await open(page);
  await page.getByTestId('start-fresh').click();
  await page.getByTestId('add-first-account').click();
  await page.getByTestId('account-name').fill('My checking');
  await page.getByTestId('save-button').click();

  // Recorded by hand the day it happened, under my own name for it.
  await page.getByTestId('fab-home').click();
  await page.getByTestId('amount-input').fill('117.78');
  await page.getByTestId('payee-input').fill('Weekly shop');
  await page.getByTestId('save-button').click();

  await goToTab(page, 'accounts');
  await page.getByTestId('open-connections').click();
  await page.getByTestId('connect-demo').click();
  await page.getByTestId('link-Demo Savings').click();
  await page.getByText('Do not follow').last().click();
  await page.getByTestId('link-Demo Empty Account').click();
  await page.getByText('Do not follow').last().click();
  await page.getByTestId('link-Demo Checking').click();
  await page.getByText('Continue "My checking"').last().click();
  await page.getByTestId('save-links').click();
  await expect(page.getByTestId('toast')).toContainText('2 new transactions');

  const data = await savedData(page);
  expect(data.accounts).toHaveLength(1);
  expect(data.transactions).toHaveLength(3);
  const mine = data.transactions.find((tx: { payee: string }) => tx.payee === 'Weekly shop');
  expect(mine).toMatchObject({ amount: -11778, rawPayee: 'LOCAL GROCER STORE #1133' });
  expect(mine.remoteId).toContain('/Demo Checking/');
});

test('a bank that refuses the token is explained, and nothing is saved', async ({ page }) => {
  await page.route('https://beta-bridge.simplefin.org/**', (route) => route.fulfill({ status: 403, headers: cors, body: 'Forbidden' }));
  await open(page);
  await page.getByTestId('start-fresh').click();
  await goToTab(page, 'accounts');
  await page.getByTestId('open-connections').click();
  await page.getByTestId('token-input').fill('not a real token');
  await page.getByTestId('connect-button').click();
  await expect(page.getByText('That does not look like a SimpleFIN token.')).toBeVisible();
  await page.getByTestId('connect-demo').click();
  await expect(page.getByText(/This token has already been used/)).toBeVisible();
  expect((await savedData(page)).connections).toEqual([]);
});

test('holdings kept by hand show value and gain, and the account balance follows them', async ({ page }) => {
  await openWithSampleData(page);
  await goToTab(page, 'accounts');
  await expect(page.getByLabel('Index funds, $8,480.00')).toBeVisible();
  await page.getByTestId('open-investments').click();
  await expect(page.getByTestId('portfolio-value')).toHaveText('$8,480.00');
  // 8,480 now against 7,155 paid.
  await expect(page.getByTestId('portfolio-gain')).toContainText('+$1,325.00 · +18.5%');

  await page.getByTestId('add-holding-acc_invest').click();
  await page.getByTestId('save-button').click();
  await expect(page.getByText('Give it a name or a ticker symbol.')).toBeVisible();
  await page.getByTestId('holding-symbol').fill('gold');
  await page.getByTestId('holding-name').fill('Physical gold');
  await page.getByTestId('holding-shares').fill('2.5');
  await page.getByTestId('holding-value').fill('1520');
  await page.getByTestId('holding-cost').fill('1400');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('portfolio-value')).toHaveText('$10,000.00');
  await expect(page.getByText('GOLD · Physical gold')).toBeVisible();
  await expect(page.getByText('2.5 shares · $608.00 each')).toBeVisible();
  await page.getByRole('link', { name: 'Home, back' }).click();
  await expect(page.getByLabel('Index funds, $10,000.00')).toBeVisible();
});
