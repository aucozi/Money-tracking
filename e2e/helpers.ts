import { expect, type Page } from '@playwright/test';

/** The day every test runs on, so sample data and "today" never drift. */
export const TODAY = '2026-11-10';

export async function open(page: Page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T10:00:00`));
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
}

/** Start with the invented household. */
export async function openWithSampleData(page: Page) {
  await open(page);
  await page.getByTestId('start-demo').click();
  await expect(page.getByTestId('home')).toBeVisible();
}

/** Start empty and add one current account. */
export async function openWithAccount(page: Page, name = 'Everyday', balance = '1500') {
  await open(page);
  await page.getByTestId('start-fresh').click();
  await page.getByTestId('add-first-account').click();
  await page.getByTestId('account-name').fill(name);
  await page.getByTestId('account-balance').fill(balance);
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('toast')).toContainText('Account added');
}

export async function goToTab(page: Page, tab: 'index' | 'transactions' | 'budget' | 'plan' | 'accounts') {
  await page.getByTestId(`tab-${tab}`).click();
}

/** Wait until the debounced save has reached storage, then reload the app. */
export async function reload(page: Page) {
  await page.waitForTimeout(500);
  await page.reload();
}

/** Read the dataset the app has saved. */
export async function savedData(page: Page) {
  await page.waitForTimeout(500);
  return page.evaluate(() => JSON.parse(window.localStorage.getItem('waypoint/data/v1') ?? 'null'));
}

/** Choose an item in an open sheet, then wait for the sheet to finish closing. */
export async function pick(page: Page, testId: string) {
  await page.getByTestId(testId).last().click();
  await expect(page.getByTestId(testId)).toHaveCount(0);
}
