import { expect, test } from '@playwright/test';

import { drag, goToTab, openWithSampleData, pick, savedData } from './helpers';

test.beforeEach(async ({ page }) => {
  await openWithSampleData(page);
});

test('swiping a transaction left offers category and delete', async ({ page }) => {
  await goToTab(page, 'transactions');
  await page.getByTestId('tx-search').fill('Luna Pizzeria');
  const row = page.locator('[data-testid^="tx-demo_"]').first();
  const id = (await row.getAttribute('data-testid'))!.slice(3);
  const before = (await savedData(page)).transactions.length;

  await drag(page, row, 300, -180);
  await page.getByTestId(`swipe-categorize-${id}`).click();
  await pick(page, 'pick-cat_dining');
  await expect(page.getByTestId('toast')).toContainText('Categorized');
  expect((await savedData(page)).transactions.find((tx: { id: string }) => tx.id === id)).toMatchObject({ categoryId: 'cat_dining', reviewed: true });

  await drag(page, row, 300, -180);
  await page.getByTestId(`swipe-delete-${id}`).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Delete 1 transaction?');
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('toast')).toContainText('Deleted');
  expect((await savedData(page)).transactions.length).toBe(before - 1);
});

test('swiping a transaction right marks it reviewed', async ({ page }) => {
  await goToTab(page, 'transactions');
  await page.getByTestId('quick-review').click();
  await expect(page.getByTestId('tx-summary')).toContainText('6 transactions');
  await drag(page, page.locator('[data-testid^="tx-demo_"]').first(), 40, 200);
  await expect(page.getByTestId('tx-summary')).toContainText('5 transactions');
});

test('the chosen quick filter is always on screen', async ({ page }) => {
  await goToTab(page, 'transactions');
  // The last chips start beyond the right edge of an iPhone.
  await expect(page.getByTestId('quick-transfer')).not.toBeInViewport();
  await page.getByTestId('quick-filters').evaluate((node) => node.scrollTo({ left: 10_000 }));
  await page.getByTestId('quick-transfer').click();
  await expect(page.getByTestId('quick-transfer')).toBeInViewport({ ratio: 1 });

  // A filter set from another screen is brought into view as well.
  await page.getByTestId('quick-filters').evaluate((node) => node.scrollTo({ left: 10_000 }));
  await goToTab(page, 'index');
  await page.getByTestId('review-card').click();
  await expect(page.getByTestId('quick-review')).toBeInViewport({ ratio: 1 });
});

test('dragging across the spending chart reads off a day', async ({ page }) => {
  await expect(page.getByTestId('spent-label')).toHaveText('Spent this month');
  const total = await page.getByTestId('spent-this-month').innerText();
  const lift = await drag(page, page.getByRole('img', { name: /Spending so far this month/ }), 20, 40, true);
  await expect(page.getByTestId('spent-label')).toContainText(/Spent by \d+ Nov/);
  await expect(page.getByTestId('spent-this-month')).not.toHaveText(total);
  await lift();
  await expect(page.getByTestId('spent-label')).toHaveText('Spent this month');
  await expect(page.getByTestId('spent-this-month')).toHaveText(total);
});

test('a price rise is pointed out until the new price is accepted', async ({ page }) => {
  await expect(page.getByText('StreamBox went up')).toBeVisible();
  await page.getByTestId('open-subscriptions-home').click();
  await expect(page.getByTestId('subscriptions-monthly')).toHaveText('$1,400.90');
  await expect(page.getByTestId('subscriptions-yearly')).toHaveText('$16,811');
  await expect(page.getByTestId('subscriptions-screen')).toContainText('$13.99 became $15.99 on 8 Nov. That is $24.00 more over a year.');

  await page.getByTestId('accept-price-rec_stream').click();
  await expect(page.getByTestId('toast')).toContainText('StreamBox updated');
  await expect(page.getByTestId('subscriptions-monthly')).toHaveText('$1,402.90');
  await expect(page.getByText('StreamBox went up')).toHaveCount(0);
  expect((await savedData(page)).recurrings.find((item: { id: string }) => item.id === 'rec_stream').amount).toBe(-1599);

  // It is reachable from the bills list too, and each one opens the bill itself.
  await page.goBack();
  await goToTab(page, 'plan');
  await page.getByTestId('open-subscriptions').click();
  await page.getByTestId('subscription-rec_rent').click();
  await expect(page.getByTestId('recurring-name')).toHaveValue('Harbour Lettings');
});

test('last month is summed up, and leads to the transactions behind it', async ({ page }) => {
  await page.getByTestId('review-last-month').click();
  await expect(page.getByTestId('review-month')).toHaveText('October 2026');
  await expect(page.getByTestId('review-kept')).toHaveText('$342.71');
  await expect(page.getByTestId('review-income')).toHaveText('$3,370.00');
  await expect(page.getByTestId('review-spent')).toHaveText('$3,027.29');
  await expect(page.getByTestId('review-compare')).toContainText('2% higher than in September');
  await expect(page.getByTestId('review-budget')).toContainText('budgets held');

  await page.getByTestId('review-previous').click();
  await expect(page.getByTestId('review-month')).toHaveText('September 2026');
  await page.getByTestId('review-next').click();
  await page.getByTestId('review-next').click();
  await expect(page.getByTestId('review-month')).toHaveText('November 2026');
  await expect(page.getByTestId('review-next')).toBeDisabled();
  await expect(page.getByTestId('review-screen')).toContainText('Spent beyond income so far');

  await page.getByTestId('review-previous').click();
  await page.getByTestId('review-transactions').click();
  // The list is narrowed to October. Its totals count each transaction whole, so they sit a little
  // apart from the review's, which nets refunds and takes spread purchases by their share.
  await expect(page.getByTestId('tx-summary')).toContainText('58 transactions');
  await expect(page.getByTestId('open-filters')).toContainText('Filters · 2');
});
