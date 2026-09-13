import { test, expect } from '@playwright/test';

test('community shows snapshot evidence and collections, with shareable activity filters', async ({ page, request }) => {
  const { catalog } = await (await request.get('./internal/catalog.json')).json();
  const reuseTypes = new Set(['uses', 'produces', 'fork_of', 'derived_from']);
  const reuse = catalog.relations.filter((row: { type: string }) => reuseTypes.has(row.type));
  await page.goto('./community/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Research moves through people.');
  await expect(page.getByRole('button', { name: 'Curation', exact: true })).toBeEnabled();
  await expect(page.locator('.cp-activity-list article')).toHaveCount(catalog.relations.length + catalog.collections.length);
  if (catalog.relations.length) {
    await expect(page.getByRole('link', { name: 'Read the evidence', exact: true }).first()).toHaveAttribute('href', catalog.relations[0].evidence[0].url);
  }
  await page.getByRole('button', { name: 'Curation', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('activity')).toBe('curation');
  await expect(page.locator('.cp-activity-list article')).toHaveCount(catalog.collections.length);
  await expect(page.getByRole('link', { name: 'Read the selection basis', exact: true })).toHaveCount(catalog.collections.length);
  await page.getByRole('button', { name: 'Reuse', exact: true }).click();
  await expect(page.locator('.cp-activity-list article')).toHaveCount(reuse.length);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Curation', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cp-activity-list article')).toHaveCount(catalog.collections.length);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Curation', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cp-activity-list article')).toHaveCount(catalog.collections.length);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('community does not infer validation or collaboration from catalog activity', async ({ page }) => {
  await page.goto('./community/');
  for (const category of ['Validation', 'Collaboration']) {
    await page.getByRole('button', { name: category, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No documented activity yet', exact: true })).toBeVisible();
    await expect(page.locator('.cp-activity-list article')).toHaveCount(0);
    await expect(page.locator('.cp-empty')).toContainText('Scientific validation and collaboration are not inferred');
    await expect(page.getByRole('link', { name: 'Learn how to contribute', exact: true })).toBeVisible();
  }
});

test('contribute is a separate public flow with a scoped organization proposal', async ({ page, baseURL }) => {
  await page.goto('./community/');
  await page.locator('.cp-heading').getByRole('link', { name: 'Contribute', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your research already has a home.');
  await expect(page.locator('.cp-contribute-steps article')).toHaveCount(3);
  await expect(page.getByRole('group', { name: 'Activity type' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Share a public link', exact: true })).toHaveAttribute('href', new URL('submit/', baseURL).pathname);
  await expect(page.getByRole('link', { name: 'Propose an organization', exact: true })).toHaveAttribute('href', `${new URL('submit/', baseURL).pathname}?kind=organization`);
  await expect(page.getByRole('link', { name: 'Read the contribution guide', exact: true })).toHaveAttribute('href', 'https://github.com/imjszhang/aipoch-network/blob/main/CONTRIBUTING.md');
  await expect(page.locator('.cp-notice')).toContainText('without installing it');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('community and contribution remain useful without JavaScript', async ({ browser, baseURL, request }) => {
  const { catalog } = await (await request.get('./internal/catalog.json')).json();
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    await page.goto('./community/');
    await expect(page.locator('.cp-activity-list article')).toHaveCount(catalog.relations.length + catalog.collections.length);
    await expect(page.getByRole('button', { name: 'Curation', exact: true })).toBeDisabled();
    await page.locator('.cp-heading').getByRole('link', { name: 'Contribute', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your research already has a home.');
    await page.getByRole('link', { name: 'Share a public link', exact: true }).click();
    await expect(page).toHaveURL(/\/submit\/$/);
  } finally { await context.close(); }
});
