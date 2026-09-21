import { test, expect, type Page } from '@playwright/test';

const search = (page: Page) => page.getByRole('searchbox', { name: 'Search directory', exact: true });
const searchArtifact = /\/internal\/ui\/v1\/[^/]+\/[^/]+\/search\.json$/;
async function navigateSection(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name, exact: true }).click();
}
async function rememberSelection(page: Page) {
  await page.addInitScript(({ demo }) => {
    localStorage.setItem(`aipoch-network.browser-library.v1.${demo ? 'demo' : 'public'}`, JSON.stringify({ version: 1, saved: [], recent: [], language: 'en', selection: { id: 'project:scipy', returnTo: '/projects/' } }));
  }, { demo: process.env.TEST_MODE === 'demo' });
}

for (const fullLoaded of [false, true]) test(`changing directory sections checks retirement before reusing ${fullLoaded ? 'full' : 'browse'} data`, async ({ page }) => {
  let retired = false, historyRequests = 0, documentRequests = 0;
  if (fullLoaded) await rememberSelection(page);
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++; });
  await page.route('**/catalog/v1/history.json', async route => {
    historyRequests++;
    const response = await route.fetch(), history = await response.json();
    if (retired) {
      history.snapshots.find((row: { snapshot_id: string }) => row.snapshot_id === history.current_snapshot_id).status = 'withdrawn';
      history.current_snapshot_id = 'new-release';
      history.snapshots.push({ snapshot_id: 'new-release', status: 'available', checked_at: history.checked_at });
    }
    await route.fulfill({ response, json: history });
  });
  await page.goto('./projects/');
  await expect(search(page)).toBeEnabled();
  await expect(page.locator('main[data-search-ready="true"]')).toBeVisible();
  if (fullLoaded) await expect(page.locator('#content')).toHaveAttribute('data-catalog-kind', 'full');
  const before = historyRequests;
  retired = true;
  await navigateSection(page, 'Capabilities');
  await expect(page.getByRole('heading', { name: 'Catalog controls unavailable', exact: true })).toBeVisible();
  await expect(search(page)).toBeDisabled();
  await expect(page.locator('.results-list > *').first()).toBeVisible();
  expect(historyRequests).toBeGreaterThan(before);
  expect(documentRequests).toBe(1);
  if (fullLoaded) {
    await page.getByRole('button', { name: /Open-Science — / }).click();
    await page.getByRole('button', { name: 'Read or copy reference', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'This page snapshot is no longer available' }).first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Complete research reference', exact: true })).toHaveCount(0);
  }
});

test('a search retry discovering retirement disables previously ready filters', async ({ page }) => {
  await page.route(searchArtifact, route => route.abort());
  await page.goto('./projects/');
  await expect(search(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible();
  await page.route('**/catalog/v1/history.json', async route => {
    const response = await route.fetch(), history = await response.json();
    history.snapshots.find((row: { snapshot_id: string }) => row.snapshot_id === history.current_snapshot_id).status = 'withdrawn';
    history.current_snapshot_id = 'new-release';
    history.snapshots.push({ snapshot_id: 'new-release', status: 'available', checked_at: history.checked_at });
    await route.fulfill({ response, json: history });
  });
  await page.unroute(searchArtifact);
  await page.getByRole('button', { name: 'Retry search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Catalog controls unavailable', exact: true })).toBeVisible();
  await expect(search(page)).toBeDisabled();
  await expect(page.locator('.results-list > *').first()).toBeVisible();
});

test('canonical, browse and query edits within a section share one availability check and keep focus', async ({ page }) => {
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/catalog/v1/history.json')) requests++; });
  await page.goto('./projects/');
  await expect(search(page)).toBeEnabled();
  await expect(page.locator('main[data-search-ready="true"]')).toBeVisible();
  const before = requests;
  await search(page).fill('SciPy');
  await expect(page).toHaveURL(/\/browse\/projects\/\?q=SciPy$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true, includeHidden: true }).getByRole('link', { name: 'Projects', exact: true, includeHidden: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.results-list .row-title a')).toHaveText(['SciPy']);
  await expect(search(page)).toBeFocused();
  await search(page).fill('NumPy');
  await expect(page.locator('.results-list .row-title a')).toHaveText(['NumPy']);
  await search(page).fill('');
  await expect(page).toHaveURL(/\/projects\/$/);
  await expect(search(page)).toBeFocused();
  expect(requests).toBe(before);
});

test('background full-catalog loading preserves an in-progress submission and its review step', async ({ page }) => {
  await rememberSelection(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/internal/catalog.json', async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  await page.goto('./submit/');
  await page.getByLabel('Public GitHub repository or organization URL', { exact: true }).fill('https://github.com/scipy/scipy');
  await page.getByLabel('Research context', { exact: false }).fill('Preserve this draft while the catalog finishes loading.');
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.getByRole('heading', { name: /Step 2 of 3/ })).toBeVisible();
  const consent = page.getByRole('checkbox');
  await consent.check();
  release();
  await expect(page.locator('#content')).toHaveAttribute('data-catalog-kind', 'full');
  await expect(page.getByRole('heading', { name: /Step 2 of 3/ })).toBeVisible();
  await expect(consent).toBeChecked();
  await expect(page.getByLabel('Exact public draft for review')).toContainText('Preserve this draft while the catalog finishes loading.');
});

test('a correction target remains pending through a slow or failed full load and is checked after retry', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/internal/catalog.json', async route => { await gate; await route.fulfill({ status: 503, body: 'temporarily unavailable' }); });
  await page.goto('./submit/?intent=correction&entry=project%3Ascipy');
  const source = page.getByLabel('Public GitHub repository or organization URL', { exact: false });
  const waiting = page.getByRole('status').filter({ hasText: 'The complete catalog is needed to check this correction target' });
  await expect(waiting).toBeVisible();
  await expect(source).toBeDisabled();
  await expect(page.getByText('This catalog entry is unavailable.', { exact: false })).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: 'Retry catalog', exact: true })).toBeVisible();
  await expect(waiting).toBeVisible();
  await expect(page.getByText('This catalog entry is unavailable.', { exact: false })).toHaveCount(0);
  await page.unroute('**/internal/catalog.json');
  await page.getByRole('button', { name: 'Retry catalog', exact: true }).click();
  await expect(source).toBeEnabled();
  await expect(source).toHaveValue('https://github.com/scipy/scipy');
  await expect(waiting).toHaveCount(0);
});

test('isolated Review keeps its manual scenario when research is chosen before full data arrives', async ({ page }) => {
  test.skip(process.env.TEST_MODE !== 'demo', 'The isolated Review belongs to the explicit Demo artifact.');
  let release!: () => void, documentRequests = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++; });
  await page.route('**/internal/catalog.json', async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  await page.goto('./review/');
  const requested = page.waitForRequest('**/internal/catalog.json');
  await page.getByRole('button', { name: 'Enter isolated Review', exact: true }).click();
  await requested;
  const controls = page.getByRole('complementary', { name: 'Isolated demo Review controls', exact: true });
  await controls.locator('summary').click();
  await controls.getByRole('combobox', { name: /^Reference response/ }).selectOption('manual');
  await page.getByRole('link', { name: 'Choose research to review', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading catalog data to keep your current workbench session' })).toBeVisible();
  await expect(page).toHaveURL(/\/review\/$/);
  release();
  await expect(page).toHaveURL(/\/explore\/$/);
  await expect(search(page)).toBeEnabled();
  await expect(controls.getByRole('combobox', { name: /^Reference response/ })).toHaveValue('manual');
  expect(documentRequests).toBe(1);
});

test('an ordinary connected session survives immediate navigation while full data is pending', async ({ page }) => {
  test.skip(process.env.TEST_MODE !== 'demo', 'This case uses the ordinary Demo connection, outside isolated Review.');
  let release!: () => void, documentRequests = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++; });
  await page.route('**/internal/catalog.json', async route => { const response = await route.fetch(); await gate; await route.fulfill({ response }); });
  await page.goto('./join/');
  const requested = page.waitForRequest('**/internal/catalog.json');
  const header = page.getByRole('button', { name: /^Open-Science — / });
  await header.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
  await expect(header).toHaveAccessibleName(/Open-Science — Connected · Demo/);
  await requested;
  await page.getByRole('dialog').getByRole('link', { name: 'Your research home', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Loading catalog data to keep your current workbench session' })).toBeVisible();
  await expect(page).toHaveURL(/\/join\/$/);
  release();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(header).toHaveAccessibleName(/Open-Science — Connected · Demo/);
  await expect(page.getByRole('complementary', { name: 'Isolated demo Review controls', exact: true })).toHaveCount(0);
  expect(documentRequests).toBe(1);
});
