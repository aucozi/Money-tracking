// Regenerates the screenshots in docs/screenshots from the web build.
//   npm run build:web && npx serve -s dist -l 4173 &   then   node scripts/screenshots.mjs
import { chromium, devices } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const out = new URL('../docs/screenshots/', import.meta.url).pathname;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function session(colorScheme) {
  const context = await browser.newContext({ ...devices['iPhone 15'], colorScheme });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-11-10T10:00:00'));
  await page.goto(base);
  await page.getByTestId('start-demo').click();
  const shot = async (name) => {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}${name}.png` });
  };
  return { page, shot, close: () => context.close() };
}

const light = await session('light');
await light.shot('home');
await light.page.getByTestId('tab-transactions').click();
await light.shot('transactions');
await light.page.getByTestId('tab-budget').click();
await light.page.getByTestId('budget-row-cat_dining').evaluate((node) => node.scrollIntoView({ block: 'center' }));
await light.shot('budget');
await light.page.getByTestId('tab-plan').click();
await light.shot('bills');
await light.page.getByRole('tab', { name: 'Forecast' }).click();
await light.shot('forecast');
await light.page.getByRole('tab', { name: 'Debt' }).click();
await light.shot('debt');
await light.page.getByTestId('tab-accounts').click();
await light.shot('accounts');
await light.page.getByTestId('open-investments').click();
await light.shot('investments');
await light.close();

const dark = await session('dark');
await dark.shot('home-dark');
await dark.close();

await browser.close();
console.log(`Screenshots written to ${out}`);
