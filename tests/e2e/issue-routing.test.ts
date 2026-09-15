import { test, expect } from '@playwright/test';

test('request groups lead to separate GitHub forms without requiring a connection', async ({ page }) => {
  await page.goto('./contribute/');
  const section = page.getByLabel('Choose a request type');
  await expect(section).toBeVisible();
  const links = await section.locator('a[href*="issues/new"]').evaluateAll(anchors => anchors.map(a => (a as HTMLAnchorElement).href));
  expect(links).toHaveLength(8);
  expect(new Set(links.map(url => new URL(url).searchParams.get('template'))).size).toBe(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${process.env.TEST_RESULTS_DIR ?? 'test-results'}/contribute-${test.info().project.name}.png`, fullPage: true });
});

test('source-less collection correction retains its target and has a separate draft type', async ({ page }) => {
  await page.goto('./submit/?intent=correction&entry=collection%3Aresearch-foundations');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Correct catalog content');
  await expect(page.getByLabel('Public GitHub repository or organization URL', { exact: false })).toHaveValue('');
  await page.getByLabel('Requested correction', { exact: false }).fill('Clarify the selection basis.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('h2[tabindex]')).toBeFocused();
  await expect.poll(() => page.locator('h2[tabindex]').evaluate(el => el.getBoundingClientRect().top - (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0))).toBeGreaterThanOrEqual(0);
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await page.getByRole('checkbox').focus();
  await page.keyboard.press('Space');
  await page.getByRole('button', { name: 'Continue' }).click();
  const url = new URL((await page.getByRole('link', { name: 'Open GitHub draft' }).getAttribute('href'))!);
  expect(url.searchParams.get('title')).toBe('[纠错] collection:research-foundations');
  expect(url.searchParams.get('labels')).toBe('catalog:correction,stage:triage');
  expect(url.searchParams.get('body')).toBe(await page.locator('.draft').textContent());
  expect(url.searchParams.get('body')).not.toContain('candidate for community indexing');
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${process.env.TEST_RESULTS_DIR ?? 'test-results'}/correction-${test.info().project.name}.png`, fullPage: true });
});

test('unknown correction targets stay unavailable instead of creating another source', async ({ page }) => {
  for (const suffix of ['&entry=project%3Amissing', '']) {
    await page.goto(`./submit/?intent=correction${suffix}`);
    await expect(page.getByRole('alert')).toContainText('This catalog entry is unavailable');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'use the correction form on GitHub' })).toHaveAttribute('href', /template=correction-or-withdrawal.yml/);
  }
});
