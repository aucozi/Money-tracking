import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { goToTab, open, openWithAccount, openWithSampleData, pick, reload, savedData } from './helpers';

// A European export: semicolons, day-first dates, decimal commas, a preamble and a raw card descriptor.
const BANK_EXPORT = [
  'Account statement;;;',
  'IBAN: XX00 0000 0000;;;',
  '',
  'Booking date;Beneficiary;Amount;Currency',
  '03.11.2026;SQ *CORNER BAKERY 0412;-4,50;USD',
  '04.11.2026;Landlord Ltd;-1.150,00;USD',
  '05.11.2026;Employer GmbH;3.250,00;USD',
  'not a date;Broken row;-1,00;USD',
].join('\n');

test('a CSV from any bank imports cleanly, and importing it twice adds nothing', async ({ page }) => {
  await openWithAccount(page, 'Everyday', '2000');
  await goToTab(page, 'transactions');
  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-text').fill(BANK_EXPORT);

  // Columns, date order and decimal commas are worked out from the file itself.
  await expect(page.getByTestId('map-date')).toContainText('Booking date');
  await expect(page.getByTestId('map-payee')).toContainText('Beneficiary');
  await expect(page.getByTestId('map-date-order')).toContainText('Day first');
  await expect(page.getByText('3 to import')).toBeVisible();
  await expect(page.getByText('1 could not be read.')).toBeVisible();
  await expect(page.getByText('Line 8: Could not read the date "not a date".')).toBeVisible();
  await expect(page.getByText('Corner Bakery', { exact: true })).toBeVisible();

  await page.getByTestId('run-import').click();
  await expect(page.getByTestId('toast')).toContainText('Imported 3 transactions');
  // Lands in the review inbox for that account.
  await expect(page.getByTestId('tx-summary')).toContainText('3 transactions');

  let data = await savedData(page);
  expect(
    data.transactions.map((tx: { date: string; amount: number; payee: string; rawPayee?: string; reviewed: boolean }) => [
      tx.date,
      tx.amount,
      tx.payee,
      tx.rawPayee,
      tx.reviewed,
    ]),
  ).toEqual([
    ['2026-11-03', -450, 'Corner Bakery', 'SQ *CORNER BAKERY 0412', false],
    ['2026-11-04', -115000, 'Landlord Ltd', undefined, false],
    ['2026-11-05', 325000, 'Employer GmbH', undefined, false],
  ]);
  // A first import is history: the balance entered by hand is left as it was.
  await goToTab(page, 'accounts');
  await expect(page.getByTestId('accounts-net-worth')).toHaveText('$2,000.00');

  await goToTab(page, 'transactions');
  await page.getByTestId('open-import').click();
  await page.getByTestId('csv-text').fill(BANK_EXPORT);
  await expect(page.getByText('0 to import')).toBeVisible();
  await expect(page.getByText('3 already in Waypoint and skipped.')).toBeVisible();
  await expect(page.getByTestId('run-import')).toBeDisabled();
  data = await savedData(page);
  expect(data.transactions).toHaveLength(3);
});

test('rules are yours to see, reorder, edit and delete', async ({ page }) => {
  await openWithSampleData(page);
  await page.getByTestId('open-settings').click();
  await page.getByTestId('open-rules').click();
  await expect(page.getByTestId('rule-when-0')).toHaveText('payee contains "Market"');

  await page.getByTestId('rule-down-0').click();
  await expect(page.getByTestId('rule-when-1')).toHaveText('payee contains "Market"');

  await page.getByTestId('add-rule').click();
  await page.getByTestId('save-button').click();
  await expect(page.getByText('Add at least one condition')).toBeVisible();
  await page.getByTestId('rule-payee').fill('volt fuel');
  await expect(page.getByTestId('rule-matches')).toContainText(/Matches \d+ transactions you already have/);
  await page.getByTestId('rule-tags').fill('car');
  await page.getByTestId('save-apply-button').click();
  await expect(page.getByTestId('toast')).toContainText(/Rule saved · \d+ transactions updated/);

  let data = await savedData(page);
  expect(data.rules).toHaveLength(4);
  const fuel = data.transactions.filter((tx: { payee: string }) => tx.payee === 'Volt Fuel');
  expect(fuel.length).toBeGreaterThan(10);
  expect(fuel.every((tx: { tags: string[] }) => tx.tags.includes('car'))).toBe(true);

  await page.getByTestId('rule-edit-3').click();
  await page.getByTestId('delete-button').click();
  await page.getByTestId('confirm-yes').click();
  data = await savedData(page);
  expect(data.rules).toHaveLength(3);
});

test('accounts in other currencies are converted with a rate you set', async ({ page }) => {
  await openWithAccount(page, 'Everyday', '1000');
  await goToTab(page, 'accounts');
  await page.getByTestId('add-account').click();
  await page.getByTestId('account-name').fill('Euro account');
  await page.getByTestId('currency-field').click();
  await page.getByText('EUR · Euro').last().click();
  await page.getByTestId('account-balance').fill('500');
  await page.getByTestId('save-button').click();

  // Without a rate the app says so instead of quietly guessing.
  await expect(page.getByText('Set an exchange rate for EUR')).toBeVisible();
  await expect(page.getByText('Rate needed')).toBeVisible();

  await page.getByText('Open exchange rates').click();
  await page.getByTestId('rate-EUR').fill('1.1');
  await page.getByRole('link', { name: 'Home, back' }).click();
  await expect(page.getByTestId('accounts-net-worth')).toHaveText('$1,550.00');
  await expect(page.getByText('Rate needed')).toHaveCount(0);
  await expect(page.getByText('About $550.00')).toBeVisible();
});

test('a backup restores everything after the data is erased', async ({ page }) => {
  await openWithSampleData(page);
  const original = await savedData(page);
  await page.getByTestId('open-settings').click();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save-backup').click()]);
  expect(download.suggestedFilename()).toBe('waypoint-backup-2026-11-10.json');
  const path = await download.path();
  const backup = JSON.parse(await readFile(path, 'utf8'));
  expect(backup.format).toBe('waypoint-backup');
  expect(backup.data.transactions).toHaveLength(original.transactions.length);

  await page.getByTestId('erase-all').click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('There is no copy anywhere else');
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('welcome')).toBeVisible();

  await page.getByTestId('start-fresh').click();
  await page.getByTestId('open-settings').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('restore-backup').click()]);
  await chooser.setFiles(path);
  await expect(page.getByTestId('confirm-dialog')).toContainText(`${original.accounts.length} accounts and ${original.transactions.length} transactions`);
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('toast')).toContainText('Backup restored');

  const restored = await savedData(page);
  expect(restored.transactions).toEqual(original.transactions);
  expect(restored.budgets).toEqual(original.budgets);
  expect(restored.recurrings).toEqual(original.recurrings);
});

test('a file that is not a backup is refused without touching the data', async ({ page }) => {
  await openWithSampleData(page);
  const before = await savedData(page);
  await page.getByTestId('open-settings').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByTestId('restore-backup').click()]);
  await chooser.setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
  await expect(page.getByTestId('toast')).toContainText('This file is not a Waypoint backup.');
  expect(await savedData(page)).toEqual(before);
});

test('dark appearance can be chosen and is remembered', async ({ page }) => {
  await open(page);
  await page.getByTestId('start-fresh').click();
  await page.getByTestId('open-settings').click();
  const background = () => page.getByTestId('settings-screen').evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(await background()).toBe('rgb(242, 242, 247)');
  await page.getByRole('tab', { name: 'Dark' }).click();
  expect(await background()).toBe('rgb(0, 0, 0)');
  await reload(page);
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  expect(await background()).toBe('rgb(0, 0, 0)');
});

test('categories can be added and used straight away', async ({ page }) => {
  await openWithAccount(page);
  await goToTab(page, 'budget');
  await page.getByTestId('open-categories').click();
  await page.getByTestId('add-category-grp_lifestyle').click();
  await page.getByTestId('category-name').fill('Pets');
  await page.getByTestId('category-icon').fill('🐕');
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('categories-screen').getByText('Pets')).toBeVisible();

  const data = await savedData(page);
  const pets = data.categories.find((category: { name: string }) => category.name === 'Pets');
  expect(pets).toMatchObject({ groupId: 'grp_lifestyle', kind: 'expense', icon: '🐕' });

  await page.goto('/');
  await page.getByTestId('fab-home').click();
  await page.getByTestId('amount-input').fill('30');
  await page.getByTestId('category-field').click();
  await pick(page, `pick-${pets.id}`);
  await page.getByTestId('save-button').click();
  await goToTab(page, 'budget');
  await expect(page.getByTestId(`budget-row-${pets.id}`)).toContainText('$30.00');
});
