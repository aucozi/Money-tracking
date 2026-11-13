import { expect, type Locator, type Page } from '@playwright/test';

/** The day every test runs on, so sample data and "today" never drift. */
export const TODAY = '2026-11-10';

export async function open(page: Page) {
  // Start the clock on that day and let it run: animations need time to pass to finish.
  await page.clock.install({ time: new Date(`${TODAY}T10:00:00`) });
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

/**
 * Drag a finger sideways across an element, starting `from` pixels in from its left edge and
 * travelling `by` pixels (negative goes left). With `hold`, the finger stays down so the test can
 * look at what the drag shows; the returned function lifts it.
 */
export async function drag(page: Page, target: Locator, from: number, by: number, hold = false) {
  const box = await target.boundingBox();
  if (!box) throw new Error('Nothing to drag: the element is not on screen');
  const session = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2;
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
    session.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x: box.x + x, y }] });
  await send('touchStart', from);
  const steps = Math.max(4, Math.ceil(Math.abs(by) / 10));
  for (let step = 1; step <= steps; step += 1) {
    await send('touchMove', from + (by * step) / steps);
    await page.waitForTimeout(16);
  }
  const lift = () => send('touchEnd');
  if (!hold) await lift();
  return lift;
}
