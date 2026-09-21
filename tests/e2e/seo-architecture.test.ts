import { test, expect, type Page } from '@playwright/test';

const browseArtifact = /\/internal\/ui\/v1\/[^/]+\/[^/]+\/browse\.json$/;
const searchArtifact = /\/internal\/ui\/v1\/[^/]+\/[^/]+\/search\.json$/;
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search directory', exact: true });

test('all browse entrances carry their final noindex policy before scripts execute', async ({ page, request }) => {
  for (const section of ['explore', 'projects', 'capabilities', 'organizations', 'researchers', 'collections', 'sources']) {
    const response = await request.get(`./browse/${section}/?field=3.2`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<meta name="robots" content="noindex, follow"/);
    expect(html).not.toMatch(/<link[^>]+rel="canonical"/);
    expect(html).toContain(`/${section}/"`);
  }
  await page.goto('./browse/capabilities/?field=3.2');
  await expect(search(page)).toBeEnabled();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await page.reload();
  await expect(search(page)).toBeEnabled();
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test('legacy filter links migrate before directory data and retain conditions and repairable values', async ({ page }) => {
  const dataRequestDocuments: string[] = [];
  page.on('request', request => {
    if (browseArtifact.test(request.url()) || searchArtifact.test(request.url())) dataRequestDocuments.push(new URL(page.url()).pathname);
  });
  await page.goto('./capabilities/?field=3.2&resource_type=tool&utm_source=readme#content');
  await expect(page).toHaveURL(/\/browse\/capabilities\/\?field=3\.2&resource_type=tool#content$/);
  await expect(search(page)).toBeEnabled();
  expect(dataRequestDocuments.length).toBeGreaterThan(0);
  expect(dataRequestDocuments.every(path => path.endsWith('/browse/capabilities/'))).toBe(true);
  await page.goto('./projects/?field=bad&field=3.2&sort=stars');
  await expect(page.locator('.directory-filter-errors')).toContainText('repeated');
  expect(new URL(page.url()).searchParams.getAll('field')).toEqual(['bad', '3.2']);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test('clearing filters restores the canonical directory policy without leaving a noindex state behind', async ({ page, request }) => {
  const raw = await (await request.get('./projects/')).text();
  const robots = raw.match(/<meta name="robots" content="([^"]+)"/)![1];
  const canonical = raw.match(/<link rel="canonical" href="([^"]+)"/)![1];
  await page.goto('./projects/');
  await expect(search(page)).toBeEnabled();
  await search(page).fill('no-such-research-architecture-check');
  await expect(page.getByRole('heading', { name: 'No matching entries', exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', robots);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
  await expect(page.locator('.results-list > *')).toHaveCount(8);
});

test('blocked discovery data does not block mobile navigation or ordinary detail links', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fullCatalogRequests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/internal/catalog.json')) fullCatalogRequests.push(request.url()); });
  await page.route('**/internal/ui/**', route => route.abort());
  await page.goto('./projects/');
  await expect(page.locator('.results-list > *')).toHaveCount(8);
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(menu).toBeEnabled();
  await menu.click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  const title = await page.locator('.results-list .row-title a').first().textContent();
  await page.locator('.results-list .row-title a').first().click();
  await expect(page.getByRole('heading', { name: title!, level: 1, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Community', exact: true }).click();
  await expect(page).toHaveURL(/\/community\/$/);
  await expect(page.locator('h1')).toBeVisible();
  expect(fullCatalogRequests).toEqual([]);
});

test('search failure leaves discipline filtering available and retry keeps the query', async ({ page }) => {
  await page.route(searchArtifact, route => route.abort());
  await page.goto('./browse/projects/?q=scipy');
  await expect(search(page)).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: 'Search is unavailable' })).toBeVisible();
  const toggle = page.getByRole('button', { name: 'Filters', exact: true });
  const mobile = await toggle.isVisible();
  if (mobile) await toggle.click();
  const field = (mobile ? page.getByRole('dialog', { name: 'Refine results', exact: true }) : page.getByRole('complementary', { name: 'Directory filters', exact: true })).getByLabel('Research discipline', { exact: true });
  await expect(field).toBeEnabled();
  await field.selectOption('1.1');
  const apply = page.getByRole('button', { name: /^Show \d+ entries$/ });
  if (await apply.isVisible()) await apply.click();
  await expect(search(page)).toHaveValue('scipy');
  expect(new URL(page.url()).searchParams.get('field')).toBe('1.1');
  await expect(page.locator('.results-list > *').first()).toBeVisible();
  await page.unroute(searchArtifact);
  await page.getByRole('button', { name: 'Retry search', exact: true }).click();
  await expect(page.locator('.results-list .row-title a')).toHaveText(['SciPy']);
  await expect(search(page)).toHaveValue('scipy');
});

test('search starts while browse is pending and its successful result is reused after browse retry', async ({ page }) => {
  let searchRequests = 0;
  page.on('request', request => { if (searchArtifact.test(request.url())) searchRequests++; });
  await page.route(browseArtifact, route => route.abort());
  const searchCompleted = page.waitForResponse(response => searchArtifact.test(response.url()) && response.ok());
  await page.goto('./browse/projects/?q=scipy');
  await searchCompleted;
  await expect(page.getByRole('button', { name: 'Retry catalog', exact: true })).toBeVisible();
  await expect(page.locator('.results-list > *')).toHaveCount(8);
  await page.unroute(browseArtifact);
  await page.getByRole('button', { name: 'Retry catalog', exact: true }).click();
  await expect(page.locator('.results-list .row-title a')).toHaveText(['SciPy']);
  expect(searchRequests).toBe(1);
  await expect(search(page)).toHaveValue('scipy');
});

test('switching directory sections reuses the same browse data and search index', async ({ page }) => {
  let browseRequests = 0, searchRequests = 0, documents = 0;
  page.on('request', request => {
    if (browseArtifact.test(request.url())) browseRequests++;
    if (searchArtifact.test(request.url())) searchRequests++;
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
  });
  await page.goto('./projects/');
  await expect(search(page)).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: 'Loading search index' })).toHaveCount(0);
  for (const label of ['Capabilities', 'Organizations', 'Projects']) {
    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: label, exact: true }).click();
    await expect(search(page)).toBeEnabled();
    await expect(page.getByRole('status').filter({ hasText: 'Loading search index' })).toHaveCount(0);
  }
  expect(browseRequests).toBe(1);
  expect(searchRequests).toBe(1);
  expect(documents).toBe(1);
});
