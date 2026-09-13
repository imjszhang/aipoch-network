import { test, expect } from '@playwright/test';

test('client navigation loads the full catalog on demand and updates title and main focus', async ({ page }) => {
  const catalogs: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/internal/catalog.json')) catalogs.push(request.url()); });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Science Open to All', exact: true })).toBeVisible();
  expect(catalogs).toEqual([]);
  await page.locator('.ph-browse-links').getByRole('link').first().click();
  await expect(page).toHaveURL(/\/projects\/$/);
  await expect(page).toHaveTitle('Research projects | AIPOCH Network');
  await expect(page.locator('#content')).toBeFocused();
  expect(catalogs).toHaveLength(1);
  await page.locator('.results-list .row-title a').first().click();
  const name = await page.locator('h1').textContent();
  await expect(page).toHaveTitle(`${name} | AIPOCH Network`);
  expect(catalogs).toHaveLength(1);
  await page.goBack();
  await expect(page).toHaveTitle('Research projects | AIPOCH Network');
});

test('fast scroll then Back and Forward restores the departing page position', async ({ page }) => {
  await page.goto('./projects/');
  await page.locator('.results-list .row-title a').first().click();
  await expect(page.locator('#sources')).toBeVisible();
  const detailUrl = page.url();
  await page.evaluate(async () => { scrollTo(0, 700); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const y = await page.evaluate(() => scrollY);
  expect(y).toBeGreaterThan(500);
  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/$/);
  await page.goForward();
  await expect(page).toHaveURL(detailUrl);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
});

test('a changed catalog snapshot leaves readable content and an explicit refresh recovery', async ({ page, request }) => {
  const catalog = await (await request.get('./internal/catalog.json')).json();
  await page.route('**/internal/catalog.json', route => route.fulfill({ json: { ...catalog, snapshot_id: 'another-snapshot' } }));
  await page.goto('./projects/project~scipy/');
  await page.getByRole('button', { name: /^Connect to open: SciPy$/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'SciPy', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'The catalog has changed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh page', exact: true })).toBeVisible();
});
