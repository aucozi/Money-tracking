import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { goToTab, openWithSampleData, pick, savedData } from './helpers';

test.beforeEach(async ({ page }) => {
  await openWithSampleData(page);
  await goToTab(page, 'transactions');
});

test('search narrows the list and the totals follow', async ({ page }) => {
  await expect(page.getByTestId('tx-summary')).toContainText('transactions');
  await page.getByTestId('tx-search').fill('#lisbon-trip');
  await expect(page.getByTestId('tx-summary')).toContainText('3 transactions');
  await expect(page.getByText('Hotel Alba')).toBeVisible();

  await page.getByTestId('tx-search').fill('no such merchant anywhere');
  await expect(page.getByText('Nothing matches')).toBeVisible();
  await page.getByTestId('clear-filter').click();
  await expect(page.getByTestId('tx-summary')).toContainText(/^\d{3} transactions/);
});

test('the review inbox can be cleared one by one or all at once', async ({ page }) => {
  await page.getByTestId('quick-review').click();
  await expect(page.getByTestId('tx-summary')).toContainText('6 transactions');

  await page.getByLabel('Mark ATM withdrawal as reviewed').click();
  await expect(page.getByTestId('tx-summary')).toContainText('5 transactions');

  await page.getByTestId('review-all').click();
  await expect(page.getByTestId('tx-summary')).toContainText('0 transactions');
  await goToTab(page, 'index');
  await expect(page.getByTestId('review-card')).toHaveCount(0);
});

test('categorising a transaction can create a rule that fixes the others too', async ({ page }) => {
  await page.getByTestId('tx-search').fill('Paper Lantern');
  // Sample data has these filed under Shopping, with the newest one still uncategorised.
  await page.getByLabel(/Paper Lantern Books.*Uncategorized/).click();
  await page.getByTestId('category-field').click();
  await pick(page, 'pick-cat_entertainment');
  await page.getByTestId('make-rule-toggle').click();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('toast')).toContainText('Rule saved and applied to');

  const data = await savedData(page);
  const books = data.transactions.filter((tx: { payee: string }) => tx.payee === 'Paper Lantern Books');
  expect(books.length).toBeGreaterThan(1);
  expect(books.every((tx: { categoryId: string }) => tx.categoryId === 'cat_entertainment')).toBe(true);
  expect(data.rules.at(-1)).toMatchObject({
    enabled: true,
    conditions: { payeeText: 'Paper Lantern Books', payeeMatch: 'contains' },
    actions: { categoryId: 'cat_entertainment' },
  });
});

test('a receipt can be split between categories, and the parts must add up', async ({ page }) => {
  await page.getByTestId('fab-transactions').click();
  await page.getByTestId('amount-input').fill('60');
  await page.getByTestId('payee-input').fill('Superstore');
  await page.getByTestId('show-more').click();
  await page.getByTestId('split-toggle').click();
  await expect(page.getByTestId('split-status')).toContainText('needs an amount');

  await page.getByTestId('split-amount-0').fill('45');
  await page.getByTestId('split-amount-1').fill('10');
  await expect(page.getByTestId('split-status')).toContainText('$5.00 still to assign');
  await page.getByTestId('save-button').click();
  await expect(page.getByText('A couple of things to fix')).toBeVisible();

  await page.getByTestId('split-amount-1').fill('15');
  await expect(page.getByTestId('split-status')).toContainText('The parts add up.');
  await page.getByTestId('split-category-0').click();
  await pick(page, 'pick-cat_groceries');
  await page.getByTestId('split-category-1').click();
  await pick(page, 'pick-cat_shopping');
  await page.getByTestId('save-button').click();

  const data = await savedData(page);
  const saved = data.transactions.at(-1);
  expect(saved).toMatchObject({ payee: 'Superstore', amount: -6000, categoryId: null });
  expect(saved.splits.map((split: { amount: number; categoryId: string }) => [split.amount, split.categoryId])).toEqual([
    [-4500, 'cat_groceries'],
    [-1500, 'cat_shopping'],
  ]);
});

test('several transactions can be selected and categorised together', async ({ page }) => {
  await page.getByTestId('quick-uncategorized').click();
  const rows = page.locator('[data-testid^="tx-demo_"]');
  const before = await rows.count();
  expect(before).toBeGreaterThanOrEqual(3);

  await rows.nth(0).click({ delay: 700 }); // long press starts selecting
  await expect(page.getByTestId('bulk-bar')).toContainText('1 selected');
  await rows.nth(1).click();
  await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');
  await page.getByTestId('bulk-categorize').click();
  await pick(page, 'pick-cat_other');

  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
  await expect(rows).toHaveCount(before - 2);
});

test('deleting asks first and removes both sides of a transfer', async ({ page }) => {
  const before = (await savedData(page)).transactions.length;
  await page.getByTestId('quick-transfer').click();
  await page.locator('[data-testid^="tx-demo_"]').first().click();
  await expect(page.getByText(/Linked to/)).toBeVisible();
  await page.getByTestId('delete-button').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('is deleted too');
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect((await savedData(page)).transactions.length).toBe(before);

  await page.getByTestId('delete-button').click();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('toast')).toContainText('Deleted');
  expect((await savedData(page)).transactions.length).toBe(before - 2);
});

test('export gives exactly the filtered transactions as a CSV file', async ({ page }) => {
  await page.getByTestId('tx-search').fill('#lisbon-trip');
  await expect(page.getByTestId('tx-summary')).toContainText('3 transactions');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-filtered').click()]);
  expect(download.suggestedFilename()).toBe('waypoint-transactions-2026-11-10.csv');
  const lines = (await readFile(await download.path(), 'utf8')).split('\r\n');
  expect(lines[0]).toBe('Date,Payee,Amount,Currency,Account,Category,Group,Type,Status,Tags,Notes,Original payee,Split');
  expect(lines).toHaveLength(4);
  expect(lines.slice(1).every((line) => line.includes('lisbon-trip'))).toBe(true);
  expect(lines.some((line) => line.includes('Travel wallet') && line.includes('GBP'))).toBe(true);
});

test('filters combine account and date range', async ({ page }) => {
  await page.getByTestId('open-filters').click();
  await page.getByTestId('account-field').click();
  await page.getByText('Travel wallet').last().click();
  await page.getByTestId('apply-filters').click();
  await expect(page.getByTestId('tx-summary')).toContainText('2 transactions');
  await expect(page.getByTestId('open-filters')).toContainText('Filters · 1');
});
