import { test, expect, type Page } from '@playwright/test';

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search directory', exact: true });
const results = (page: Page) => page.locator('.results-list > *');
const searchParams = (page: Page) => new URL(page.url()).searchParams;
const searchArtifact = /\/internal\/(?:ui\/v1\/[^/]+\/[^/]+\/)?search\.json$/;

async function filterPanel(page: Page) {
  const toggle = page.getByRole('button', { name: 'Filters', exact: true });
  if (await toggle.isVisible()) {
    await toggle.click();
    return page.getByRole('dialog', { name: 'Refine results', exact: true });
  }
  return page.getByRole('complementary', { name: 'Directory filters', exact: true });
}
async function applyFilters(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Refine results', exact: true });
  if (await dialog.isVisible()) await dialog.getByRole('button', { name: /^Show \d+ entries$/ }).click();
}

test('every directory has a searchable first page, truthful counts and responsive refinement', async ({ page, request }) => {
  const response = await request.get('./internal/catalog.json');
  expect(response.ok()).toBe(true);
  const { catalog } = await response.json();
  const directories: [string, string, number][] = [
    ['projects', 'Research projects', catalog.projects.length],
    ['capabilities', 'Reusable capabilities', catalog.resources.length],
    ['organizations', 'Organizations', catalog.organizations.length],
    ['researchers', 'Researchers & maintainers', catalog.actors.filter((row: { account_type: string }) => row.account_type === 'user').length],
    ['collections', 'Research collections', catalog.collections.length],
    ['sources', 'Source repositories', catalog.sources.length],
  ];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const [route, title, count] of directories) {
    await page.goto(`./${route}/`);
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(search(page)).toBeEnabled();
    await expect(results(page)).toHaveCount(Math.min(count, 8));
    await expect(page.locator('.results-heading h2 b')).toHaveText(String(count));
    await expect(page.getByRole('navigation', { name: 'Directory types' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'All of the network', exact: false })).toBeVisible();
    if (page.viewportSize()!.width <= 960) await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
    else await expect(page.getByRole('complementary', { name: 'Directory filters' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('pagination preserves sort and restores the same records after detail, back, forward and refresh', async ({ page, request }) => {
  const { catalog } = await (await request.get('./internal/catalog.json')).json();
  const total = catalog.projects.length;
  expect(total).toBeGreaterThan(16);
  await page.goto('./projects/?sort=added');
  await expect(search(page)).toBeEnabled();
  const firstPage = await page.locator('.results-list .row-title a').allTextContents();
  await page.getByRole('navigation', { name: 'Results pages' }).getByRole('link', { name: 'Next', exact: true }).click();
  await expect.poll(() => searchParams(page).get('page')).toBe('2');
  await expect(results(page)).toHaveCount(8);
  const secondPage = await page.locator('.results-list .row-title a').allTextContents();
  expect(secondPage).not.toEqual(firstPage);
  await page.locator('.results-list .row-title a').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(secondPage[0]);
  await page.goBack();
  await expect.poll(() => searchParams(page).get('page')).toBe('2');
  await expect(page.locator('.results-list .row-title a')).toHaveText(secondPage);
  await expect(page.getByRole('combobox', { name: 'Sort results' })).toHaveValue('added');
  await page.goBack();
  await expect.poll(() => searchParams(page).get('page')).toBe(null);
  await expect(page.locator('.results-list .row-title a')).toHaveText(firstPage);
  await page.goForward();
  await expect(page.locator('.results-list .row-title a')).toHaveText(secondPage);
  await page.reload();
  await expect(page.locator('.results-list .row-title a')).toHaveText(secondPage);
  const pages = Math.ceil(total / 8);
  for (let current = 3; current <= pages; current++) {
    await page.getByRole('navigation', { name: 'Results pages' }).getByRole('link', { name: 'Next', exact: true }).click();
    await expect.poll(() => searchParams(page).get('page')).toBe(String(current));
    await expect(results(page)).toHaveCount(Math.min(8, total - (current - 1) * 8));
    await expect(page.locator('.pagination')).toContainText(`Page ${current} of ${pages}`);
  }
  await expect(page.getByRole('navigation', { name: 'Results pages' }).getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
});

test('invalid and out-of-range shared pages clamp to real results and canonical URLs', async ({ page, request }) => {
  const { catalog } = await (await request.get('./internal/catalog.json')).json();
  const total = catalog.projects.length;
  for (const [query, canonical, count] of [['999', String(Math.ceil(total / 8)), total % 8 || 8], ['0', null, 8], ['-2', null, 8], ['NaN', null, 8], ['2.7', '2', 8]] as const) {
    await page.goto(`./projects/?sort=title&page=${query}`);
    await expect(search(page)).toBeEnabled();
    await expect.poll(() => new URL(page.url()).pathname.match(/\/page\/(\d+)\/$/)?.[1] ?? null).toBe(canonical);
    await expect(results(page)).toHaveCount(count);
    expect(searchParams(page).size).toBe(0);
    await expect(page.getByRole('combobox', { name: 'Sort results' })).toHaveValue('relevance');
    await expect(page.getByRole('heading', { name: 'No matching entries', exact: true })).toHaveCount(0);
  }
});

test('late search results clamp the shared page without stealing search focus', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(searchArtifact, async route => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.goto('./projects/?q=scipy&page=999');
  await expect(search(page)).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: 'Loading search index' })).toBeVisible();
  await search(page).focus();
  release();
  await expect.poll(() => searchParams(page).get('page')).toBe(null);
  await expect(results(page)).toHaveCount(1);
  await expect(page.locator('.results-list .row-title a')).toHaveText(['SciPy']);
  await expect(search(page)).toBeFocused();
  await search(page).pressSequentially(' xyz');
  await expect(search(page)).toHaveValue('scipy xyz');
  await expect(page.getByRole('heading', { name: 'No matching entries', exact: true })).toBeVisible();
  await expect(search(page)).toBeFocused();
});

test('version and area refinements survive reload and clear unknown shared scopes', async ({ page, request }) => {
  const { catalog } = await (await request.get('./internal/catalog.json')).json();
  const pinnedCount = [...catalog.projects, ...catalog.resources].filter((row: { source_refs: { commit?: string }[] }) => row.source_refs.some(ref => ref.commit)).length;
  await page.goto('./explore/');
  await expect(search(page)).toBeEnabled();
  let panel = await filterPanel(page);
  await panel.getByRole('combobox', { name: 'Version & conditions', exact: true }).selectOption('pinned');
  await applyFilters(page);
  await expect(page.locator('.results-heading h2 b')).toHaveText(String(pinnedCount));
  await expect(page.locator('.results-list .simple-card, .results-list .organization-card')).toHaveCount(0);
  await search(page).fill('scipy');
  await expect(page.locator('.results-list')).toContainText('SciPy tutorial at a reviewed revision');
  await expect(page.locator('.results-list')).not.toContainText('Biopython');
  expect(searchParams(page).get('access')).toBe('pinned');
  await page.reload();
  panel = await filterPanel(page);
  await expect(panel.getByRole('combobox', { name: 'Version & conditions', exact: true })).toHaveValue('pinned');
  await panel.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Legacy research area', exact: true }).selectOption('Bioinformatics');
  await applyFilters(page);
  await expect(page.locator('.results-list')).toContainText('Biopython');
  await expect(page.locator('.results-list')).not.toContainText('SciPy');
  await page.getByRole('combobox', { name: 'Sort results', exact: true }).selectOption('title');
  await page.reload();
  expect(searchParams(page).get('domain')).toBe('Bioinformatics');
  await expect(page.getByRole('combobox', { name: 'Sort results', exact: true })).toHaveValue('title');
  await page.goto('./explore/?organization=unknown-org&collection=unknown-collection&access=unknown-status&page=999');
  await expect(page.getByRole('alert')).toContainText('Unknown source condition');
  await expect(page.getByRole('heading', { name: 'No matching entries', exact: true })).toHaveCount(0);
  await expect(page.locator('.directory-active-filters')).toContainText('Unknown status');
  await page.getByRole('button', { name: 'Clear incompatible filters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No matching entries', exact: true })).toBeVisible();
  await expect(page.locator('.directory-active-filters')).toContainText('Unknown organization');
  await expect(page.locator('.directory-active-filters')).toContainText('Unknown collection');
  await expect.poll(() => searchParams(page).get('page')).toBe(null);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(results(page)).toHaveCount(8);
  expect(searchParams(page).size).toBe(0);
});

test('organization and collection selectors intersect real memberships and preserve shared links', async ({ page }) => {
  await page.goto('./explore/');
  await expect(search(page)).toBeEnabled();
  let panel = await filterPanel(page);
  await panel.getByRole('combobox', { name: 'Organization', exact: true }).selectOption({ label: 'scipy' });
  await applyFilters(page);
  await expect(results(page)).toHaveCount(3);
  await expect(page.locator('.results-list')).toContainText('SciPy tutorial at a reviewed revision');
  await expect(page.locator('.results-list')).not.toContainText('Biopython');
  panel = await filterPanel(page);
  await panel.getByRole('combobox', { name: 'Collection', exact: true }).selectOption({ label: 'Foundations for open research' });
  await applyFilters(page);
  await expect(results(page)).toHaveCount(1);
  await expect(page.locator('.results-list .row-title a')).toHaveText(['SciPy']);
  const shared = page.url();
  await page.reload();
  await expect(page).toHaveURL(shared);
  await expect(results(page)).toHaveCount(1);
  panel = await filterPanel(page);
  await expect(panel.getByRole('combobox', { name: 'Organization', exact: true }).locator('option:checked')).toHaveText('scipy');
  await expect(panel.getByRole('combobox', { name: 'Collection', exact: true }).locator('option:checked')).toHaveText('Foundations for open research');
  await panel.getByRole('combobox', { name: 'Organization', exact: true }).selectOption('');
  await applyFilters(page);
  await expect(results(page)).toHaveCount(5);
  await expect(page.locator('.results-list')).toContainText('Snakemake');
  await expect(page.locator('.results-list')).toContainText('Biopython');
});

test('search failure keeps browsable pages and retry applies the actual query', async ({ page, request }) => {
  const { catalog } = await (await request.get('./internal/catalog.json')).json();
  const total = catalog.projects.length;
  await page.route(searchArtifact, route => route.abort());
  await page.goto('./projects/?q=scipy&page=999');
  await expect(page.getByRole('status').filter({ hasText: 'Search is unavailable' })).toBeVisible();
  await expect(results(page)).toHaveCount(total % 8 || 8);
  await expect.poll(() => searchParams(page).get('page')).toBe(String(Math.ceil(total / 8)));
  await expect(page.locator('.results-heading h2')).toContainText(`${total} entries`);
  await page.unroute(searchArtifact);
  await page.getByRole('button', { name: 'Retry search', exact: true }).click();
  await expect(results(page)).toHaveCount(1);
  await expect(page.locator('.results-list .row-title a')).toHaveText(['SciPy']);
  await expect.poll(() => searchParams(page).get('page')).toBe(null);
  await expect(search(page)).toHaveValue('scipy');
  await expect(page.getByRole('status').filter({ hasText: 'Search is unavailable' })).toHaveCount(0);
});

test('mobile refinement traps keyboard focus, keeps query and returns focus on dismissal', async ({ page, request }) => {
  const { catalog } = await (await request.get('./internal/catalog.json')).json();
  const total = catalog.projects.length;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./projects/?q=scipy&sort=title');
  await expect(page.locator('.results-list .row-title a')).toHaveText(['SciPy']);
  const toggle = page.getByRole('button', { name: 'Filters', exact: true });
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: 'Refine results', exact: true });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await dialog.getByRole('combobox', { name: 'Legacy research area', exact: true }).selectOption('Bioinformatics');
  await expect(dialog.getByRole('button', { name: 'Show 0 entries', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(search(page)).toHaveValue('scipy');
  await expect(page.getByRole('heading', { name: 'No matching entries', exact: true })).toBeVisible();
  expect(searchParams(page).get('domain')).toBe('Bioinformatics');
  expect(searchParams(page).get('sort')).toBe('title');
  await toggle.click();
  await dialog.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await dialog.getByRole('button', { name: `Show ${total} entries`, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await expect(results(page)).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('changing sort from a static second page starts at the first result page', async ({ page }) => {
  await page.goto('./projects/page/2/');
  await expect(page.locator('.pagination')).toContainText('Page 2 of');
  await page.getByRole('combobox', { name: 'Sort results' }).selectOption('title');
  await expect(page.locator('.pagination')).toContainText('Page 1 of');
  expect(new URL(page.url()).pathname).not.toContain('/page/2/');
});

test('returning home restores its original description', async ({ page }) => {
  await page.goto('./projects/project~anndata/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Annotated data.');
  await page.getByRole('link', { name: 'AIPOCH Network home', exact: true }).click();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Discover research projects and reusable capabilities, connected to their original GitHub sources.');
});

test('hydration preserves the build indexing policy', async ({ page, request }) => {
  const html = await (await request.get('./projects/')).text();
  const robots = html.match(/<meta name="robots" content="([^"]+)"/)?.[1];
  expect(robots).toBeTruthy();
  await page.goto('./projects/');
  await expect(search(page)).toBeEnabled();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', robots!);
});
