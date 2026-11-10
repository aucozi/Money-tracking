import { expect, test } from '@playwright/test';

import { goToTab, openWithSampleData, savedData } from './helpers';

test.beforeEach(async ({ page }) => {
  await openWithSampleData(page);
});

test('changing a budget for one month leaves every other month alone', async ({ page }) => {
  await goToTab(page, 'budget');
  await page.getByTestId('budget-row-cat_dining').click();
  await page.getByTestId('budget-amount').fill('300');
  await page.getByRole('tab', { name: 'This month only' }).click();
  await page.getByTestId('budget-save').click();
  await expect(page.getByTestId('budget-row-cat_dining')).toContainText('/ $300');

  await page.getByLabel('Next month').click();
  await expect(page.getByTestId('budget-row-cat_dining')).toContainText('/ $260');
  await page.getByLabel('Previous month').click();
  await page.getByLabel('Previous month').click();
  await expect(page.getByText('October 2026', { exact: true })).toBeVisible();
  await expect(page.getByTestId('budget-row-cat_dining')).toContainText('/ $260');
});

test('raising a budget going forward never rewrites past months', async ({ page }) => {
  await goToTab(page, 'budget');
  await page.getByTestId('budget-row-cat_groceries').click();
  await page.getByTestId('budget-amount').fill('500');
  await page.getByTestId('budget-save').click();
  await page.getByLabel('Next month').click();
  await expect(page.getByTestId('budget-row-cat_groceries')).toContainText('/ $500');
  for (let i = 0; i < 3; i += 1) await page.getByLabel('Previous month').click();
  await expect(page.getByText('September 2026', { exact: true })).toBeVisible();
  // September keeps the budget it had at the time.
  await expect(page.getByTestId('budget-row-cat_groceries')).toContainText('/ $420');
});

test('rollover carries what was not spent into the next month', async ({ page }) => {
  await goToTab(page, 'budget');
  await expect(page.getByTestId('budget-row-cat_gifts')).toContainText('carried');
  await page.getByTestId('budget-row-cat_gifts').click();
  await expect(page.getByTestId('budget-sheet')).toContainText('On since July 2026');
});

test('zero-based mode shows income still to assign', async ({ page }) => {
  await goToTab(page, 'budget');
  await page.getByRole('tab', { name: 'Plan every dollar' }).click();
  // 3,250 expected income minus 2,845 assigned across categories.
  await expect(page.getByTestId('left-to-assign')).toHaveText('$405.00');
  await page.getByTestId('budget-row-cat_other').click();
  await page.getByTestId('budget-amount').fill('405');
  await page.getByTestId('budget-save').click();
  await expect(page.getByTestId('left-to-assign')).toHaveText('$0.00');
  await expect(page.getByText('Every bit of income has a job this month.')).toBeVisible();
});

test('a bill can be marked paid, which records the payment and clears it from the list', async ({ page }) => {
  await goToTab(page, 'plan');
  const bill = page.locator('[data-testid^="bill-rec_mobile-"]');
  await expect(bill).toHaveCount(2); // this month and next
  await bill.first().click();
  await page.getByTestId('mark-paid').click();
  await expect(page.getByTestId('toast')).toContainText('Recorded');
  await expect(bill).toHaveCount(1);

  const data = await savedData(page);
  expect(data.transactions.at(-1)).toMatchObject({ payee: 'Hello Mobile', amount: -2900, recurringId: 'rec_mobile', date: '2026-11-10' });
});

test('regular payments found in the history can be tracked with one tap', async ({ page }) => {
  await goToTab(page, 'plan');
  await expect(page.getByText('Looks regular')).toBeVisible();
  // Weekly fuel at a different price each time is a habit, not a bill.
  await expect(page.getByTestId('track-Volt Fuel')).toHaveCount(0);
  await page.getByTestId('track-PulseGym').click();
  await expect(page.getByTestId('toast')).toContainText('Tracking PulseGym');
  await expect(page.getByTestId('track-PulseGym')).toHaveCount(0);

  const data = await savedData(page);
  const gym = data.recurrings.find((item: { name: string }) => item.name === 'PulseGym');
  expect(gym).toMatchObject({ frequency: 'monthly', amount: -3490, anchorDate: '2026-12-03' });
  // Past payments are linked, so the history counts as paid.
  expect(data.transactions.filter((tx: { recurringId?: string }) => tx.recurringId === gym.id).length).toBeGreaterThanOrEqual(5);
});

test('the forecast projects cash forward and responds to its settings', async ({ page }) => {
  await goToTab(page, 'plan');
  await page.getByRole('tab', { name: 'Forecast' }).click();
  const end = page.getByTestId('forecast-end');
  const withEveryday = await end.textContent();
  await expect(page.getByText('You stay above zero the whole way')).toBeVisible();

  await page.getByRole('switch', { name: 'Include everyday spending' }).click();
  await expect(end).not.toHaveText(withEveryday!);
  const billsOnly = await end.textContent();

  await page.getByRole('tab', { name: '90 days' }).click();
  await expect(end).not.toHaveText(billsOnly!);
  await expect(page.getByText('What moves it')).toBeVisible();
});

test('a goal can be created and paid into', async ({ page }) => {
  await goToTab(page, 'plan');
  await page.getByRole('tab', { name: 'Goals' }).click();
  await page.getByTestId('add-goal').click();
  await page.getByTestId('goal-name').fill('New bike');
  await page.getByTestId('goal-target').fill('900');
  await page.getByTestId('save-button').click();
  await expect(page.getByText('New bike')).toBeVisible();

  await page.getByText('New bike').click();
  await page.getByTestId('goal-contribution').fill('150');
  await page.getByTestId('goal-add').click();
  await expect(page.getByTestId('goal-saved')).toHaveText('$150.00');
  await page.getByTestId('goal-contribution').fill('50');
  await page.getByTestId('goal-withdraw').click();
  await expect(page.getByTestId('goal-saved')).toHaveText('$100.00');
});

test('paying extra towards debt brings the debt-free date forward', async ({ page }) => {
  await goToTab(page, 'plan');
  await page.getByRole('tab', { name: 'Debt' }).click();
  const date = page.getByTestId('debt-free-date');
  const before = await date.textContent();
  await page.getByTestId('debt-extra').fill('200');
  await expect(date).not.toHaveText(before!);
  await expect(page.getByText(/gets you there \d+ months sooner/)).toBeVisible();
  await page.getByRole('tab', { name: 'Smallest first' }).click();
  await expect(page.getByText(/Order of attack/)).toBeVisible();
});

test('a budget row leads to exactly the transactions behind it', async ({ page }) => {
  await goToTab(page, 'budget');
  await page.getByLabel('Previous month').click();
  await page.getByTestId('budget-row-cat_travel').click();
  await page.getByText('See these transactions').click();
  // October's travel spending: the hotel and the tram passes from the Lisbon trip.
  await expect(page.getByTestId('tx-summary')).toContainText('2 transactions');
  await expect(page.getByText('Hotel Alba')).toBeVisible();
  await expect(page.getByTestId('open-filters')).toContainText('Filters · 3');
});
