import { test, expect } from '@playwright/test';

test('anonymous home is useful without GitHub API or a client', async ({ page }, testInfo) => {
  const unexpected: string[] = [], errors: string[] = [];
  page.on('request', request => { if (/api\.github\.com|open-science|localhost:.*client/i.test(request.url())) unexpected.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Science Open to All' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Featured projects' })).toBeVisible();
  await expect(page.locator('.project-row')).toHaveCount(3);
  await expect(page.locator('.hero-board')).toBeVisible();
  expect(await page.evaluate(width => document.documentElement.scrollWidth <= width, page.viewportSize()!.width)).toBe(true);
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
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
  await page.getByRole('radio', { name: 'Bioinformatics', exact: true }).check();
  await expect(page.locator('.results-list')).toContainText('Biopython');
  await expect(page.locator('.results-list')).not.toContainText('SciPy');
  await page.getByLabel('Sort results').selectOption('title');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Bioinformatics', exact: true })).toBeChecked();
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
  await page.getByLabel('Public GitHub repository or organization URL').fill('https://example.com/not-github');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.getByRole('alert')).toContainText('github.com');
  await page.getByLabel('Public GitHub repository or organization URL').fill('https://github.com/scipy/scipy');
  await page.getByLabel('Research context', { exact: false }).fill('Review numerical methods & research tools.');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.getByRole('button', { name: 'Continue', exact: false })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.locator('.draft')).toContainText('Review numerical methods & research tools.');
  const draft = await page.getByRole('link', { name: 'Open GitHub draft' }).getAttribute('href');
  expect(new URL(draft!).searchParams.get('body')).toContain('https://github.com/scipy/scipy');
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
  await expect(page.getByRole('status')).toContainText('Search is unavailable');
  await expect(page.locator('.results-list > *').first()).toBeVisible();
  await page.getByRole('button', { name: 'Retry search' }).click();
  await expect(page.getByRole('status')).toContainText('Search is unavailable');
});

test('corrections retain their target and edits invalidate prior content review', async ({ page }) => {
  await page.goto('./projects/project~scipy/');
  await page.getByRole('link', { name: 'Suggest a correction' }).click();
  await expect(page.getByLabel('Public GitHub repository or organization URL')).toHaveValue('https://github.com/scipy/scipy');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.locator('.draft')).toContainText('Catalog correction');
  await expect(page.locator('.draft')).toContainText('project:scipy');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByLabel('Research context', { exact: false }).fill('Updated context');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Continue', exact: false })).toBeDisabled();
});

test('long Unicode drafts use an explicit copy-and-paste path without losing content', async ({ page }) => {
  await page.goto('./submit/');
  const note = '科研资料与公开数据'.repeat(180);
  await page.getByLabel('Public GitHub repository or organization URL').fill('https://github.com/scipy/scipy');
  await page.getByLabel('Research context', { exact: false }).fill(note);
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.locator('.draft')).toContainText(note);
  await expect(page.getByText('This draft is too long for a GitHub link.', { exact: false })).toBeVisible();
  const href = await page.getByRole('link', { name: 'Open GitHub draft' }).getAttribute('href');
  expect(href!.length).toBeLessThan(7500);
  expect(new URL(href!).searchParams.has('body')).toBe(false);
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
  await expect(page.locator('#sources .source-record')).toHaveCount(2);
  await expect(page.locator('.glance')).toContainText('Community indexed');
  await expect(page.locator('#evidence')).toContainText('No maintainer acknowledgement or scientific validation');
  await page.goto('./researchers/actor~github~315810/');
  await expect(page.getByRole('heading', { name: 'mwaskom', exact: true })).toBeVisible();
  await expect(page.locator('#sources')).toContainText('seaborn');
  await page.getByRole('link', { name: 'Suggest a correction' }).click();
  await expect(page.getByLabel('Public GitHub repository or organization URL')).toHaveValue('https://github.com/mwaskom');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.locator('.draft')).toContainText('actor:github:315810');
});
