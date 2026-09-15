import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startVerificationServer } from '../../scripts/verification-site.js';

test.describe('independent synthetic catalog states', () => {
  test.describe.configure({ mode: 'serial' });
  let directory: string;
  let server: Awaited<ReturnType<typeof startVerificationServer>>;
  const address = (path: string) => new URL(path, server.url).href;
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    directory = await mkdtemp(join(tmpdir(), 'aipoch-browser-states-'));
    const base = process.env.TEST_BASE ?? '/';
    // Run production React SSR through tsx; Playwright's JSX transform is for component fixtures.
    await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/verification-site.ts', '--output', directory, '--base', base, '--large-collection']);
    server = await startVerificationServer(join(directory, 'site'), base);
  });
  test.afterAll(async () => { await server?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  });

  test('individual researcher has a real static route, profile identity and owned source', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    expect((await page.goto(address('researchers/actor~github~84/')))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Synthetic independent researcher', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/benchmark-researcher');
    await expect(page.locator('.source-record')).toHaveCount(1);
    await expect(page.locator('.source-record')).toContainText('Synthetic public source 3');
    await page.reload();
    await expect(page.locator('.source-record')).toContainText('Synthetic public source 3');
    expect(errors).toEqual([]);
  });

  test('organization lists both reviewed sources and preserves the exact curation scope', async ({ page }) => {
    expect((await page.goto(address('organizations/actor~github~42/')))?.status()).toBe(200);
    await expect(page.locator('.source-record')).toHaveCount(2);
    await expect(page.locator('#sources')).toContainText('Synthetic public source 1');
    await expect(page.locator('#sources')).toContainText('Synthetic public source 2');
    await expect(page.locator('#sources')).not.toContainText('Synthetic public source 3');
    await expect(page.locator('.claim-record')).toContainText('catalog-curation:source:github:1,source:github:2');
    await expect(page.locator('.claim-record')).toContainText('organization curation · verified');
    await expect(page.locator('.claim-record a')).toHaveAttribute('href', 'https://github.com/benchmark-org/synthetic-source-1/issues/1');
    await expect(page.locator('#evidence')).not.toContainText('scientific validation · verified');
    const scope = page.locator('.glance').getByText('Source repositories', { exact: true });
    await expect(scope.locator('xpath=following-sibling::dd[1]')).toHaveText('2');
  });

  test('capability access, runtime documentation and upstream download are explicit without invented execution success', async ({ page }) => {
    await page.goto(address('capabilities/resource~method-0/'));
    await expect(page.getByRole('heading', { name: 'Access conditions', exact: true })).toBeVisible();
    await expect(page.locator('#overview')).toContainText('Requires an approved local dataset; no data is hosted by AIPOCH.');
    await expect(page.getByRole('link', { name: 'Read execution guidance' })).toHaveAttribute('href', 'https://github.com/benchmark-org/synthetic-source-1/blob/main/RUNNING.md');
    await expect(page.getByRole('link', { name: 'Upstream download' })).toHaveAttribute('href', 'https://github.com/benchmark-org/synthetic-source-1/releases/download/synthetic-v1/method.zip');
    await expect(page.locator('#evidence')).toContainText('capability · unverified');
    await expect(page.locator('#evidence')).toContainText('Documentation only; execution has not been verified.');
    await expect(page.locator('body')).not.toContainText('Execution succeeded');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);
    await expect(page.locator('#community').getByRole('link', { name: 'Contribute on GitHub' })).toHaveAttribute('href', 'https://github.com/benchmark-org/synthetic-source-1');
    await expect(page.locator('#community').getByRole('link', { name: 'Upstream issues' })).toHaveAttribute('href', 'https://github.com/benchmark-org/synthetic-source-1/issues');
    await expect(page.locator('#community').getByRole('link', { name: 'Upstream discussions' })).toHaveAttribute('href', 'https://github.com/benchmark-org/synthetic-source-1/discussions');
    await page.goto(address('capabilities/resource~method-2/'));
    await expect(page.locator('#community').getByRole('link', { name: 'Contribute on GitHub' })).toHaveAttribute('href', 'https://github.com/benchmark-researcher/synthetic-source-3');
    await expect(page.locator('#community').getByRole('link', { name: /Upstream issues|Upstream discussions/ })).toHaveCount(0);
  });

  test('withdrawn and superseded records retain explicit static states including both historical actor routes', async ({ page }) => {
    for (const path of ['capabilities/resource~withdrawn/', 'researchers/actor~github~999/', 'organizations/actor~github~999/']) {
      expect((await page.goto(address(path)))?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: 'Entry withdrawn', exact: true })).toBeVisible();
      await expect(page.locator('.source-record')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveCount(0);
    }
    expect((await page.goto(address('capabilities/resource~old-method/')))?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Entry superseded', exact: true })).toBeVisible();
    await expect(page.locator('main')).toContainText('resource:method-0');
    await expect(page.locator('main').getByRole('link', { name: /resource:method-0/ })).toHaveAttribute('href', /capabilities\/resource~method-0\/$/);
  });

  test('a collection can link to an individual researcher without a blank or broken page', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(address('collections/collection~synthetic/'));
    await page.locator('#outputs').getByRole('link', { name: 'Synthetic independent researcher' }).click();
    await expect(page.getByRole('heading', { name: 'Synthetic independent researcher', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('large organization and collection previews link to complete scoped, paginated directories', async ({ page }) => {
    for (const fixture of [
      { path: 'organizations/actor~github~42/', parameter: 'organization', id: 'actor:github:42', total: 63 },
      { path: 'collections/collection~synthetic/', parameter: 'collection', id: 'collection:synthetic', total: 93 },
    ]) {
      await page.goto(address(fixture.path));
      await expect(page.locator('.related-preview-summary')).toContainText(`Showing 20 of ${fixture.total} related entries.`);
      const previewLinks = fixture.parameter === 'organization' ? page.locator('#outputs .capability-card, #outputs .project-row') : page.locator('#outputs > p a');
      await expect(previewLinks).toHaveCount(20);
      await page.getByRole('link', { name: `View all ${fixture.total} related entries` }).click();
      await expect(page.locator('.results-heading h2 b')).toHaveText(String(fixture.total));
      expect(new URL(page.url()).searchParams.get(fixture.parameter)).toBe(fixture.id);
      await expect(page.locator('.results-list > *')).toHaveCount(8);
      await page.getByRole('navigation', { name: 'Results pages' }).getByRole('link', { name: 'Next', exact: true }).click();
      await expect(page.locator('.pagination')).toContainText('Page 2');
      await page.reload();
      await expect(page.locator('.results-heading h2 b')).toHaveText(String(fixture.total));
      await expect(page.getByLabel('Active filters', { exact: true })).toContainText(fixture.parameter === 'organization' ? 'Synthetic research organization' : 'Synthetic methods collection');
      await page.getByRole('button', { name: 'Clear all', exact: true }).click();
      await expect(page.locator('.results-heading h2 b')).toHaveText('100');
      expect(new URL(page.url()).searchParams.has(fixture.parameter)).toBe(false);
    }
  });

  test('shared catalog failures keep SSR readable and retry only a matching, bounded snapshot', async ({ page, request }) => {
    const catalogResponse = await request.get(address('internal/catalog.json'));
    const valid = await catalogResponse.json();
    let mode: 'failed' | 'mismatched' | 'oversized' | 'valid' = 'failed';
    await page.route('**/internal/catalog.json', route => mode === 'failed' ? route.abort()
      : mode === 'mismatched' ? route.fulfill({ json: { ...valid, snapshot_id: 'different-snapshot' } })
      : mode === 'oversized' ? route.fulfill({ headers: { 'content-type': 'application/json', 'content-length': '32000001' }, body: '{}' })
      : route.fulfill({ json: valid }));
    await page.goto(address('explore/'));
    await expect(page.getByRole('heading', { name: 'Catalog controls unavailable', exact: true })).toBeVisible();
    await expect(page.locator('.results-list > *')).toHaveCount(8);
    for (const next of ['mismatched', 'oversized'] as const) {
      mode = next;
      await page.getByRole('button', { name: 'Retry catalog', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Catalog controls unavailable', exact: true })).toBeVisible();
      await expect(page.locator('.results-list > *')).toHaveCount(8);
    }
    mode = 'valid';
    await page.getByRole('button', { name: 'Retry catalog', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Catalog controls unavailable', exact: true })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search directory' }).fill('zzzz-absent');
    await expect(page.getByRole('heading', { name: 'No matching entries', exact: true })).toBeVisible();
  });

  test('200% text keeps resource controls and organization content within the viewport', async ({ page }, info) => {
    for (const path of ['capabilities/resource~method-0/', 'organizations/actor~github~42/']) {
      await page.goto(address(path));
      await page.addStyleTag({ content: ':root { font-size: 200% !important; }' });
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('.glance')).toHaveCount(1);
      for (const card of await page.locator('.glance').all()) {
        expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await page.getByRole('navigation', { name: 'Entry sections' }).getByRole('link', { name: 'Evidence', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Claims & evidence', exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`text-200-${path.split('/')[0]}-${info.project.name}.png`), fullPage: true });
    }
  });

  test('static profile and withdrawal content remain readable without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    try {
      const page = await context.newPage();
      await page.goto(address('researchers/actor~github~84/'));
      await expect(page.getByRole('heading', { name: 'Synthetic independent researcher', exact: true })).toBeVisible();
      await page.goto(address('capabilities/resource~withdrawn/'));
      await expect(page.getByRole('heading', { name: 'Entry withdrawn', exact: true })).toBeVisible();
      await page.goto(address('explore/'));
      await expect(page.locator('.results-list > *')).toHaveCount(8);
      await page.locator('.results-list a').first().click();
      await expect(page.locator('h1')).toContainText('Synthetic');
    } finally { await context.close(); }
  });
});
