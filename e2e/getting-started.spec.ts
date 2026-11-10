import { expect, test } from '@playwright/test';

import { goToTab, open, openWithAccount, pick, reload, savedData } from './helpers';

test('first run: welcome, first account, first transaction, and it is all still there after a restart', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Know where your money is')).toBeVisible();
  await page.getByTestId('start-fresh').click();

  // Empty state leads straight to adding an account.
  await page.getByTestId('add-first-account').click();
  await page.getByTestId('save-button').click();
  await expect(page.getByText('Give the account a name.')).toBeVisible();
  await page.getByTestId('account-name').fill('Everyday');
  await page.getByTestId('account-balance').fill('1500');
  await page.getByTestId('save-button').click();

  await goToTab(page, 'accounts');
  await expect(page.getByTestId('accounts-net-worth')).toHaveText('$1,500.00');

  // Record an expense by hand: no bank connection needed.
  await goToTab(page, 'index');
  await page.getByTestId('fab-home').click();
  await page.getByTestId('save-button').click();
  await expect(page.getByText('Enter an amount greater than zero.').first()).toBeVisible();
  await page.getByTestId('amount-input').fill('12.50');
  await page.getByTestId('payee-input').fill('Corner bakery');
  await page.getByTestId('category-field').click();
  await pick(page, 'pick-cat_dining');
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('spent-this-month')).toHaveText('$12.50');
  await goToTab(page, 'transactions');
  await expect(page.getByTestId('tx-summary')).toContainText('1 transaction');
  await expect(page.getByText('Corner bakery')).toBeVisible();
  await goToTab(page, 'accounts');
  await expect(page.getByTestId('accounts-net-worth')).toHaveText('$1,487.50');

  await reload(page);
  await expect(page.getByTestId('accounts-net-worth')).toHaveText('$1,487.50');
  await goToTab(page, 'index');
  await expect(page.getByTestId('spent-this-month')).toHaveText('$12.50');
  const data = await savedData(page);
  expect(data.transactions).toHaveLength(1);
  expect(data.transactions[0]).toMatchObject({ amount: -1250, payee: 'Corner bakery', categoryId: 'cat_dining', date: '2026-11-10' });
});

test('sample data fills every part of the app', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-demo').click();
  await expect(page.getByTestId('spent-this-month')).not.toHaveText('$0.00');
  await expect(page.getByTestId('review-card')).toContainText('6 transactions to review');
  await goToTab(page, 'budget');
  await expect(page.getByTestId('budget-row-cat_groceries')).toBeVisible();
  await goToTab(page, 'plan');
  await expect(page.getByTestId('bills-per-month')).toBeVisible();
  await goToTab(page, 'accounts');
  await expect(page.getByText('Travel wallet')).toBeVisible();
});

test('money moved between your own accounts is not spending', async ({ page }) => {
  await openWithAccount(page, 'Everyday', '1500');
  await goToTab(page, 'accounts');
  await page.getByTestId('add-account').click();
  await page.getByTestId('account-name').fill('Savings pot');
  await page.getByTestId('account-type').click();
  await page.getByText('Savings', { exact: false }).last().click();
  await page.getByTestId('save-button').click();

  await goToTab(page, 'index');
  await page.getByTestId('fab-home').click();
  await page.getByRole('tab', { name: 'Transfer' }).click();
  await page.getByTestId('amount-input').fill('400');
  await page.getByTestId('to-account-field').click();
  await page.getByText('Savings pot').last().click();
  await page.getByTestId('save-button').click();

  await expect(page.getByTestId('spent-this-month')).toHaveText('$0.00');
  const data = await savedData(page);
  expect(data.transactions.map((tx: { amount: number; kind: string }) => [tx.amount, tx.kind])).toEqual([
    [-40000, 'transfer'],
    [40000, 'transfer'],
  ]);
  await goToTab(page, 'accounts');
  await expect(page.getByTestId('accounts-net-worth')).toHaveText('$1,500.00');
  await expect(page.getByLabel('Everyday, $1,100.00')).toBeVisible();
  await expect(page.getByLabel('Savings pot, $400.00')).toBeVisible();
});
