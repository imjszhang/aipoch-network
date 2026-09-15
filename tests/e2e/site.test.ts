import { test, expect } from '@playwright/test';

test('anonymous home is useful without GitHub API or a client', async ({ page }, testInfo) => {
  const unexpected: string[] = [], errors: string[] = [], catalogs: string[] = [];
  page.on('request', request => { if (new URL(request.url()).origin !== new URL(testInfo.project.use.baseURL!).origin) unexpected.push(request.url()); if (request.url().endsWith('/internal/catalog.json')) catalogs.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page).toHaveTitle('Science Open to All | AIPOCH Network');
  await expect(page.getByRole('heading', { name: 'Science Open to All' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Join with Open-Science' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Explore AIPOCH Network' })).toBeVisible();
  await expect(page.locator('img[alt="Open-Science product screenshot showing research files and generated scientific artifacts"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A question. A project. A next step.' })).toBeVisible();
  await expect(page.locator('.ph-project-row')).toHaveCount(3);
  await expect(page.locator('.ph-workbench-card')).toBeVisible();
  expect(await page.evaluate(width => document.documentElement.scrollWidth <= width, page.viewportSize()!.width)).toBe(true);
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  // Public reading uses the small server-rendered subgraph, not the complete catalog.
  expect(catalogs).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`home-${testInfo.project.name}.png`), fullPage: true });
});

test('search, filters, sort, query links and reset select real records', async ({ page }) => {
  await page.goto('./explore/?q=scipy');
  await expect(page.getByRole('searchbox', { name: 'Search directory' })).toHaveValue('scipy');
  await expect(page.locator('.results-list')).toContainText('SciPy');
  await expect(page.locator('.results-list')).not.toContainText('Biopython');
  await page.getByRole('button', { name: 'Capabilities', exact: true }).click();
  await expect(page.locator('.results-list > *')).toHaveCount(2);
  await expect(page.locator('.results-list')).toContainText('SciPy scientific computing library');
  await expect(page.locator('.results-list')).toContainText('SciPy tutorial at a reviewed revision');
  await page.getByRole('searchbox', { name: 'Search directory' }).fill('no-such-research-zzzz');
  await expect(page.getByRole('heading', { name: 'No matching entries' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  if (await filters.isVisible()) await filters.click();
  await page.getByRole('combobox', { name: 'Research area', exact: true }).selectOption('Bioinformatics');
  const apply = page.getByRole('button', { name: /^Show \d+ entries$/ });
  if (await apply.isVisible()) await apply.click();
  await expect(page.locator('.results-list')).toContainText('Biopython');
  await expect(page.locator('.results-list')).not.toContainText('SciPy');
  await page.getByLabel('Sort results').selectOption('title');
  await page.reload();
  if (await filters.isVisible()) await filters.click();
  await expect(page.getByRole('combobox', { name: 'Research area', exact: true })).toHaveValue('Bioinformatics');
});

test('project and capability have distinct static deep links, provenance and unknowns', async ({ page }) => {
  const response = await page.goto('./projects/project~biopython/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Biopython', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sources & versions', exact: true })).toBeVisible();
  await expect(page.getByText('From the source repository', { exact: true })).toBeVisible();
  await expect(page.locator('.source-record')).toContainText('Unknown — check the source terms');
  await page.goto('./capabilities/resource~biopython-library/');
  await expect(page.getByRole('heading', { name: 'Inputs', exact: true })).toBeVisible();
  await expect(page.locator('#evidence')).toContainText('No maintainer acknowledgement or scientific validation');
  await expect(page.locator('.source-record a').filter({ hasText: 'Download source' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View on GitHub', exact: false })).toHaveAttribute('href', 'https://github.com/biopython/biopython');
});

test('GitHub proposal reviews exact content and only opens a draft', async ({ page }) => {
  await page.goto('./submit/');
  await page.getByLabel('Public GitHub repository or organization URL', { exact: false }).fill('https://example.com/not-github');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.getByRole('alert')).toContainText('github.com');
  await page.getByLabel('Public GitHub repository or organization URL', { exact: false }).fill('https://github.com/scipy/scipy');
  await page.getByLabel('Research context', { exact: false }).fill('Review numerical methods & research tools.');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Continue', exact: false })).toBeDisabled();
  await expect(page.getByLabel('Exact public draft for review')).toContainText('https://github.com/scipy/scipy');
  await expect(page.getByLabel('Exact public draft for review')).toContainText('Review numerical methods & research tools.');
  await expect(page.getByRole('link', { name: 'imjszhang/aipoch-network', exact: true })).toHaveAttribute('href', 'https://github.com/imjszhang/aipoch-network');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.locator('.draft')).toContainText('Review numerical methods & research tools.');
  const draft = await page.getByRole('link', { name: 'Open GitHub draft' }).getAttribute('href');
  expect(new URL(draft!).searchParams.get('body')).toContain('https://github.com/scipy/scipy');
  expect(new URL(draft!).searchParams.get('labels')).toBe('catalog:submission,stage:triage');
  await page.context().route('https://github.com/imjszhang/aipoch-network/issues/new*', route => route.fulfill({ contentType: 'text/html', body: '<h1>Local test of an external draft</h1>' }));
  const opened = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open GitHub draft' }).click();
  const draftPage = await opened;
  await expect(draftPage).toHaveURL(draft!);
  await draftPage.close();
  await expect(page.locator('.draft')).toContainText('Review numerical methods & research tools.');
  await expect(page.getByText('Review and submit on GitHub', { exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Successfully published');
});

test('static server returns actual 404 and the catalog is readable', async ({ page, request }) => {
  const response = await page.goto('./does-not-exist/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Entry not found' })).toBeVisible();
  const catalog = await request.get('./catalog/v1/manifest.json');
  expect(catalog.status()).toBe(200);
  expect((await catalog.json()).collections.resources.length).toBeGreaterThan(0);
});

test('keyboard navigation and search failure remain usable', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.route('**/internal/search.json', route => route.abort());
  await page.goto('./explore/');
  await expect(page.getByRole('status').filter({ hasText: 'Search is unavailable' })).toContainText('Search is unavailable');
  await expect(page.locator('.results-list > *').first()).toBeVisible();
  await page.getByRole('button', { name: 'Retry search' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Search is unavailable' })).toContainText('Search is unavailable');
});

test('corrections retain their target and edits invalidate prior content review', async ({ page }) => {
  await page.goto('./projects/project~scipy/');
  await page.getByRole('link', { name: 'Suggest a correction' }).click();
  await expect(page.getByLabel('Public GitHub repository or organization URL', { exact: false })).toHaveValue('https://github.com/scipy/scipy');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.locator('.draft')).toContainText('Catalog correction');
  await expect(page.locator('.draft')).toContainText('project:scipy');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByLabel('Requested correction', { exact: false }).fill('Updated context');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Continue', exact: false })).toBeDisabled();
});

test('long Unicode drafts use an explicit copy-and-paste path without losing content', async ({ page }) => {
  await page.goto('./submit/');
  const note = '科研资料与公开数据'.repeat(180);
  await page.getByLabel('Public GitHub repository or organization URL', { exact: false }).fill('https://github.com/scipy/scipy');
  await page.getByLabel('Research context', { exact: false }).fill(note);
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.locator('.draft')).toContainText(note);
  await expect(page.getByText('This draft is too long for a GitHub link.', { exact: false })).toBeVisible();
  const href = await page.getByRole('link', { name: 'Open GitHub draft' }).getAttribute('href');
  expect(href!.length).toBeLessThan(7500);
  expect(new URL(href!).searchParams.has('body')).toBe(false);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Test: clipboard denied'); } } }));
  await page.getByRole('button', { name: 'Copy draft', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copy is unavailable' })).toBeVisible();
  await expect(page.locator('.draft')).toContainText(note);
});

test('navigation and core text fit with enlarged text', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.addStyleTag({ content: ':root { font-size: 200% !important; }' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe('32px');
  expect(await page.evaluate(width => document.documentElement.scrollWidth <= width, page.viewportSize()!.width)).toBe(true);
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  }
});

test('a reviewed source path and a cross-repository relation preserve their exact evidence', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./capabilities/resource~scipy-tutorial/');
  await expect(page.locator('#sources')).toContainText('documentation');
  await expect(page.locator('#sources').getByRole('link', { name: 'doc/source/tutorial/index.rst', exact: false })).toHaveAttribute('href',
    'https://github.com/scipy/scipy/tree/0b94e98b820b255de843dba3c411fc4dd2604206/doc/source/tutorial/index.rst');
  await page.goto('./projects/project~scanpy/');
  await expect(page.locator('#sources .source-record')).toHaveCount(2);
  await expect(page.locator('#sources')).toContainText('scanpy');
  await expect(page.locator('#sources')).toContainText('anndata');
  await page.goto('./capabilities/resource~scanpy-library/');
  const relation = page.locator('#outputs .source-record');
  await expect(relation).toContainText('Relationship: uses');
  await expect(relation).toContainText('software relationship, not scientific validation');
  await expect(relation.getByRole('link', { name: 'github evidence', exact: false })).toHaveAttribute('href',
    'https://github.com/scverse/scanpy/blob/5f2accbe77cb0559401798c6d05f5a706779dc35/README.md');
  await relation.locator('a').first().click();
  await expect(page).toHaveURL(/capabilities\/resource~anndata-library\/$/);
  await expect(page.locator('#outputs .source-record')).toContainText('Incoming relationship: uses');
  expect(errors).toEqual([]);
});

test('real individual and multi-source organization routes retain source identities and correction intent', async ({ page }) => {
  await page.goto('./organizations/actor~github~95305807/');
  await expect(page.getByRole('heading', { name: 'scverse', exact: true })).toBeVisible();
  await expect(page.locator('#sources .source-record')).toHaveCount(3);
  for (const name of ['scverse/anndata', 'scverse/scanpy', 'scverse/mudata']) await expect(page.locator('#sources')).toContainText(name);
  await expect(page.locator('.glance')).toContainText('Community indexed');
  await expect(page.locator('#evidence')).toContainText('No maintainer acknowledgement or scientific validation');
  await page.goto('./researchers/actor~github~315810/');
  await expect(page.getByRole('heading', { name: 'mwaskom', exact: true })).toBeVisible();
  await expect(page.locator('#sources')).toContainText('seaborn');
  await page.getByRole('link', { name: 'Suggest a correction' }).click();
  await expect(page.getByLabel('Public GitHub repository or organization URL', { exact: false })).toHaveValue('https://github.com/mwaskom');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.locator('.draft')).toContainText('actor:github:315810');
});


test('MuData project and resource retain their own source, license and community scope', async ({ page }) => {
  await page.goto('./projects/project~mudata/');
  await expect(page.getByRole('heading', { name: 'MuData', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('main')).toContainText('multimodal annotated datasets');
  await page.goto('./capabilities/resource~mudata-library/');
  await expect(page.getByRole('heading', { name: 'MuData research software', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('#sources')).toContainText('scverse/mudata');
  await expect(page.locator('a[href="https://github.com/scverse/mudata"]').first()).toBeVisible();
  await expect(page.locator('main')).toContainText('BSD-3-Clause');
  await expect(page.locator('.glance')).toContainText('Community indexed');
});

test('robots and sitemap are official-origin artifacts and omit pagination', async ({ request }, testInfo) => {
  const robots = await request.get('./robots.txt');
  const sitemap = await request.get('./sitemap.xml');
  expect(robots.ok()).toBe(true);
  expect(sitemap.ok()).toBe(true);
  const robotsBody = await robots.text();
  const sitemapBody = await sitemap.text();
  expect(robotsBody).toContain('User-agent: *');
  expect(robotsBody).toContain('Allow: /');
  expect(sitemapBody).toContain('<urlset');
  expect(sitemapBody).not.toContain('/page/');
  expect(sitemapBody).not.toContain('?q=');
  const root = new URL(testInfo.project.use.baseURL!).pathname === '/';
  if (root) {
    expect(robotsBody).toContain('Sitemap: https://aipoch.network/sitemap.xml');
    expect(sitemapBody).toContain('https://aipoch.network/</loc>');
    expect(sitemapBody).toContain('https://aipoch.network/projects/');
  } else {
    expect(robotsBody).not.toContain('Sitemap:');
  }
});

test('raw HTML pagination paths expose later directory members', async ({ request, page }) => {
  const first = await request.get('./projects/');
  const second = await request.get('./projects/page/2/');
  const query = await request.get('./projects/?page=2');
  expect(first.ok()).toBe(true);
  expect(second.ok()).toBe(true);
  const firstHtml = await first.text();
  const secondHtml = await second.text();
  expect(await query.text()).toBe(firstHtml);
  expect(firstHtml).toContain('/projects/page/2/');
  expect(secondHtml).not.toBe(firstHtml);
  expect(firstHtml).toContain('AnnData');
  expect(secondHtml).not.toContain('>AnnData<');
  await page.goto('./projects/page/2/');
  await expect(page.getByRole('navigation', { name: 'Results pages' })).toContainText('Page 2 of');
  await page.goto('./projects/?page=2');
  await expect(page.getByRole('navigation', { name: 'Results pages' })).toContainText('Page 2 of');
});
