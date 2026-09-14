import { test, expect, type Page } from '@playwright/test';

// Exercise only public UI and browser capabilities. No application state or engine is injected.
const demo = process.env.TEST_MODE === 'demo';
const libraryKey = `aipoch-network.browser-library.v1.${demo ? 'demo' : 'public'}`;
const header = (page: Page) => page.getByRole('button', { name: /^Open-Science — / });
const panel = (page: Page) => page.getByRole('dialog');
const reviewPanel = (page: Page) => page.getByRole('dialog', { name: 'Review research reference', exact: true });
const consent = (page: Page) => reviewPanel(page).getByRole('checkbox', { name: /^I reviewed this exact object/ });
const sendButton = (page: Page) => reviewPanel(page).getByRole('button', { name: /^Send reference/ });
const controls = (page: Page) => page.getByRole('complementary', { name: 'Isolated demo Review controls' });

async function closePanel(page: Page) {
  await panel(page).getByRole('button', { name: 'Close Open-Science panel', exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
}
async function connectOpenPanel(page: Page) {
  await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
  await expect(header(page)).toHaveAccessibleName(/Open-Science — Connected · Demo/);
  await expect(panel(page)).toHaveAccessibleName('Open-Science');
  await expect(reviewPanel(page)).toHaveCount(0);
}
async function reviewSelectedReference(page: Page, title = 'SciPy') {
  await panel(page).getByRole('button', { name: `Review reference for ${title}`, exact: true }).click();
  await expect(reviewPanel(page)).toBeVisible();
}
async function connectFromHeader(page: Page) {
  await header(page).click();
  await connectOpenPanel(page);
}
async function researchHome(page: Page) {
  await header(page).click();
  await panel(page).getByRole('link', { name: 'Your research home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
}
async function setSearch(page: Page, query: string) {
  await page.getByRole('searchbox', { name: 'Search directory', exact: true }).fill(query);
  await expect(page.getByRole('searchbox', { name: 'Search directory', exact: true })).toHaveValue(query);
}
async function expandControls(page: Page) {
  const details = controls(page).locator('details').first();
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  await expect(controls(page).getByRole('combobox', { name: /^Connection response/ })).toBeVisible();
}
async function enterReview(page: Page, receipt: 'automatic' | 'manual' | 'silent' | 'failure' | 'continue' = 'manual') {
  await page.goto('./review/');
  await page.getByRole('button', { name: 'Enter isolated Review', exact: true }).click();
  await expandControls(page);
  await controls(page).getByRole('combobox', { name: /^Reference response/ }).selectOption(receipt);
}
async function reviewProjectFromExplore(page: Page, title = 'SciPy') {
  await page.getByRole('link', { name: 'Choose research to review', exact: true }).click();
  await setSearch(page, title);
  await page.getByRole('button', { name: `Connect to open: ${title}`, exact: true }).click();
  await connectOpenPanel(page);
  await reviewSelectedReference(page, title);
}
async function reviewManualText(page: Page) {
  const review = reviewPanel(page);
  await review.locator('summary', { hasText: 'Complete manual reference' }).click();
  return JSON.parse(await review.getByRole('textbox', { name: 'Complete research reference', exact: true }).inputValue());
}
async function viewReceipts(page: Page) {
  await researchHome(page);
  await page.getByRole('navigation', { name: 'Research activity', exact: true }).getByRole('link', { name: 'Reference receipts', exact: true }).click();
  await expect(page).toHaveURL(/personal=feed&activity=receipts$/);
}
async function expectNoPersonalActions(page: Page) {
  await expect(page.getByRole('button', { name: /^(?:Save |Unsave |Clear this browser|Remove saved record)/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Your research views', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^(?:Saved|Recently viewed)$/ })).toHaveCount(0);
}

test('V01: unconnected discovery has one workbench entry, actual counts and no personal operations', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await request.get('./internal/catalog.json');
  expect(response.ok()).toBe(true);
  const { catalog } = await response.json();
  await page.goto('./');
  await expect(header(page)).toHaveCount(1);
  await expect(header(page)).toHaveAccessibleName(/Open-Science — Not connected/);
  await expect(page.getByRole('heading', { name: 'Science Open to All', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Join with Open-Science', exact: true })).toBeVisible();
  await expectNoPersonalActions(page);
  const expected = [
    ['Projects', catalog.projects.length], ['Capabilities', catalog.resources.length],
    ['Organizations', catalog.organizations.length],
    ['Researchers', catalog.actors.filter((row: { account_type: string }) => row.account_type === 'user').length],
    ['Collections', catalog.collections.length],
  ] as const;
  const grid = page.locator('.ph-browse-links');
  await expect(grid.getByRole('link')).toHaveCount(5);
  for (const [name, count] of expected) {
    const item = grid.getByRole('link', { name: new RegExp(name) });
    await expect(item).toBeVisible();
    await expect(item.locator('b')).toHaveText(count.toLocaleString('en-US'));
  }
  await header(page).click();
  await expect(panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true })).toBeVisible();
  await expect(panel(page).getByRole('link', { name: 'Get Open-Science', exact: true })).toHaveAttribute('href', 'https://aipoch.com/open-science');
  await expect(panel(page).getByRole('tab')).toHaveCount(0);
  await expect(panel(page).getByRole('link', { name: /Saved|Recently viewed|Reference receipts/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Open-Science', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open Open-Science', exact: true })).toHaveCount(0);
  await closePanel(page);
  expect(errors).toEqual([]);
});

test('V01/V15: unconnected object controls preserve URL and support keyboard dismissal with focus return', async ({ page }) => {
  await page.goto('./projects/project~scipy/?from=shared');
  await expectNoPersonalActions(page);
  const trigger = page.getByRole('button', { name: 'Connect to open: SciPy', exact: true });
  const before = page.url();
  await trigger.click();
  await expect(panel(page)).toContainText('SciPy');
  await expect(page).toHaveURL(before);
  await page.keyboard.press('Tab');
  const focusInside = () => panel(page).evaluate(element => element.contains(document.activeElement));
  expect(await focusInside()).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await focusInside()).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(before);
  await page.goto('./me/');
  await expect(page.getByRole('heading', { name: 'Connect to return to saved research', exact: true })).toBeVisible();
  await expectNoPersonalActions(page);
});

test.describe('default production adapter', () => {
  test.skip(demo, 'Production cannot be evaluated against the isolated Demo artifact.');

  test('V02/V18: URL flags cannot enable Demo or claim a connection; browsing stays available', async ({ page, baseURL }) => {
    const externalRequests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== new URL(baseURL!).origin) externalRequests.push(request.url());
    });
    await page.goto('./?demo=true&connected=true&scenario=connected');
    await header(page).click();
    await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName('Open-Science — Not confirmed');
    await expect(panel(page)).toContainText('This website cannot confirm an Open-Science connection yet.');
    await expect(panel(page)).toContainText('This does not tell us whether Open-Science is installed.');
    await expect(panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Continue browsing', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Science Open to All', exact: true })).toBeVisible();
    await expectNoPersonalActions(page);
    await page.goto('./review/?demo=true&scenario=connected');
    await expect(page.getByText('This production website cannot enable simulated connection through a URL.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter isolated Review', exact: true })).toHaveCount(0);
    await expect(controls(page)).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  });

  test('V04/V18: unavailable connection preserves the exact capability reference and manual-copy fallback', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
    });
    await page.goto('./capabilities/resource~scipy-tutorial/');
    await page.getByRole('button', { name: 'Connect to use: SciPy tutorial at a reviewed revision', exact: true }).click();
    await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName('Open-Science — Not confirmed');
    await panel(page).getByRole('button', { name: 'Read or copy reference', exact: true }).click();
    const reference = await reviewManualText(page);
    expect(reference.object).toMatchObject({ id: 'resource:scipy-tutorial', kind: 'resource', title: 'SciPy tutorial at a reviewed revision' });
    expect(reference.action).toBe('Use');
    expect(reference.sources).toEqual(expect.arrayContaining([expect.objectContaining({ commit: '0b94e98b820b255de843dba3c411fc4dd2604206', path: 'doc/source/tutorial/index.rst' })]));
    await expect(reviewPanel(page)).toContainText('All source references');
    await expect(reviewPanel(page)).toContainText('0b94e98b820b255de843dba3c411fc4dd2604206');
    await expect(sendButton(page)).toHaveCount(0);
    await expect(consent(page)).toHaveCount(0);
    await reviewPanel(page).getByRole('button', { name: 'Copy complete reference', exact: true }).click();
    await expect(reviewPanel(page)).toContainText('Copy was unavailable. Select and copy the complete reference below.');
    const preserved = JSON.parse(await reviewPanel(page).getByRole('textbox', { name: 'Complete research reference', exact: true }).inputValue());
    expect(preserved).toEqual(reference);
    await expect(reviewPanel(page).getByRole('heading', { name: /^Reference received/ })).toHaveCount(0);
  });
});

test.describe('isolated Demo adapter', () => {
  test.skip(!demo, 'Requires the separately built Demo artifact; never enable it with page state.');

  test('V01/V02: normal connection replaces the full homepage and exposes honest personal views', async ({ page }) => {
    await page.goto('./');
    await connectFromHeader(page);
    await panel(page).getByRole('link', { name: 'Your research home', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Science Open to All', exact: true })).toHaveCount(0);
    await expect(page.locator('.ph-browse-links')).toHaveCount(0);
    const views = page.getByRole('navigation', { name: 'Your research views', exact: true });
    await expect(views.getByRole('link')).toHaveText(['Your feed', 'Your projects', 'Saved', 'Following', 'Contributions']);
    await expect(page.locator('.wb-connection-inline').first()).toContainText('Open-Science connected');
    await expect(page.locator('.wb-connection-inline').first()).toContainText('Demo');
    for (const [tab, query, empty] of [
      ['Your projects', 'projects', 'No workbench project list available'],
      ['Following', 'following', 'No following data available'],
      ['Contributions', 'contributions', 'No confirmed contributions available'],
      ['Saved', 'saved', 'Keep useful research close.'],
    ]) {
      await views.getByRole('link', { name: tab, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`personal=${query}$`));
      await expect(page.getByRole('heading', { name: empty, exact: true })).toBeVisible();
      await expect(page.locator('.wb-library-list article')).toHaveCount(0);
    }
    await views.getByRole('link', { name: 'Your feed', exact: true }).click();
    await page.getByRole('navigation', { name: 'Research activity', exact: true }).getByRole('link', { name: 'Reference receipts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No reference receipts yet', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Share your research', exact: true })).toHaveAttribute('href', /\/submit\/$/);
  });

  test('V03/V05/V07: filtered project selection continues the same object and requires exact review before a receipt', async ({ page }) => {
    await page.goto('./explore/?q=scipy');
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByLabel('Sort results').selectOption('title');
    const before = page.url();
    const trigger = page.getByRole('button', { name: 'Connect to open: SciPy', exact: true });
    await trigger.click();
    await connectOpenPanel(page);
    await reviewSelectedReference(page);
    await expect(page).toHaveURL(before);
    await expect(reviewPanel(page)).toContainText('SciPy');
    await expect(sendButton(page)).toBeDisabled();
    await expect(reviewPanel(page).getByRole('heading', { name: /^Reference received/ })).toHaveCount(0);
    const reference = await reviewManualText(page);
    expect(reference.object.id).toBe('project:scipy');
    expect(reference.action).toBe('Open');
    expect(reference.target).toBe('Open-Science');
    expect(reference.sources.length).toBeGreaterThan(0);
    expect(reference.snapshot.id).toBeTruthy();
    await consent(page).check();
    await expect(sendButton(page)).toBeEnabled();
    await consent(page).uncheck();
    await expect(sendButton(page)).toBeDisabled();
    await consent(page).check();
    await sendButton(page).click();
    await expect(reviewPanel(page).getByRole('heading', { name: 'Reference received · Demo', exact: true })).toBeVisible();
    await expect(reviewPanel(page)).toContainText('Receiving a reference does not mean cloning, importing, installing, executing, or validating research.');
    await reviewPanel(page).getByRole('button', { name: 'Return to research', exact: true }).click();
    await expect(page).toHaveURL(before);
    await expect(page.getByRole('searchbox', { name: 'Search directory', exact: true })).toHaveValue('scipy');
    await expect(page.getByLabel('Sort results')).toHaveValue('title');
    await expect(page.getByRole('button', { name: 'Open in Open-Science: SciPy', exact: true })).toBeFocused();
    await viewReceipts(page);
    await expect(page.locator('.wb-receipt')).toHaveCount(1);
    await expect(page.locator('.wb-receipt')).toContainText('SciPy');
    await expect(page.locator('.wb-receipt')).toContainText('Receipt confirmed only; no import, installation or execution is claimed.');
  });

  test('V04/V14: Use review keeps full fixed revision, path, source conditions and multi-source project evidence', async ({ page }) => {
    await page.goto('./capabilities/resource~scipy-tutorial/');
    await page.getByRole('button', { name: 'Connect to use: SciPy tutorial at a reviewed revision', exact: true }).click();
    await connectOpenPanel(page);
    await reviewSelectedReference(page, 'SciPy tutorial at a reviewed revision');
    const reference = await reviewManualText(page);
    expect(reference.action).toBe('Use');
    expect(reference.object.kind).toBe('resource');
    expect(reference.sources).toEqual(expect.arrayContaining([expect.objectContaining({ commit: '0b94e98b820b255de843dba3c411fc4dd2604206', path: 'doc/source/tutorial/index.rst', version_status: 'fixed', path_status: 'provided' })]));
    await expect(reviewPanel(page)).toContainText('doc/source/tutorial/index.rst');
    await expect(reviewPanel(page)).toContainText('License conditions');
    await expect(sendButton(page)).toBeDisabled();
    await closePanel(page);
    await page.getByRole('link', { name: 'AIPOCH Network home', exact: true }).click();
    await page.locator('.wb-home-hero').getByRole('link', { name: 'Explore', exact: true }).click();
    await setSearch(page, 'scanpy');
    await page.getByRole('button', { name: 'Open in Open-Science: Scanpy', exact: true }).click();
    const multi = await reviewManualText(page);
    expect(multi.object.id).toBe('project:scanpy');
    expect(multi.sources).toHaveLength(2);
    expect(new Set(multi.sources.map((source: { id: string }) => source.id)).size).toBe(2);
    await expect(reviewPanel(page).locator('.wb-reference-source')).toHaveCount(2);
    expect(multi.license.status).toBe('per_source');
    await expect(consent(page)).not.toBeChecked();
    await expect(sendButton(page)).toBeDisabled();
  });

  test('V09/V10/V11: saved items survive disconnection and refresh without restoring connection authority', async ({ page, context }) => {
    await page.goto('./projects/project~scipy/');
    await expectNoPersonalActions(page);
    await connectFromHeader(page);
    await closePanel(page);
    await page.getByRole('button', { name: 'Save SciPy', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unsave SciPy', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await researchHome(page);
    await page.getByRole('navigation', { name: 'Your research views', exact: true }).getByRole('link', { name: 'Saved', exact: true }).click();
    await expect(page.locator('.wb-library-list').getByRole('link', { name: 'SciPy', exact: true })).toBeVisible();
    await header(page).click();
    await panel(page).getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Not connected · Demo/);
    await closePanel(page);
    await expect(page.getByRole('heading', { name: 'Science Open to All', exact: true })).toBeVisible();
    await expectNoPersonalActions(page);
    await connectFromHeader(page);
    await closePanel(page);
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
    await expect(page.locator('.wb-library-list').getByRole('link', { name: 'SciPy', exact: true })).toBeVisible();
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), libraryKey);
    expect(stored.saved).toContain('project:scipy');
    expect(stored).not.toHaveProperty('session');
    expect(stored).not.toHaveProperty('connected');
    await page.reload();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Not connected · Demo/);
    await expectNoPersonalActions(page);
    await connectFromHeader(page);
    await closePanel(page);
    await expect(page.locator('.wb-library-list').getByRole('link', { name: 'SciPy', exact: true })).toBeVisible();
    const another = await context.newPage();
    await another.goto(page.url());
    await expect(header(another)).toHaveAccessibleName(/Open-Science — Not connected · Demo/);
    await expectNoPersonalActions(another);
    await connectFromHeader(another);
    await closePanel(another);
    await expect(another.locator('.wb-library-list').getByRole('link', { name: 'SciPy', exact: true })).toBeVisible();
    await another.close();
  });

  test('V11: denied browser storage uses memory and preserves the personal flow within the visit', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
    });
    await page.goto('./projects/project~scipy/');
    await expect(page.locator('.wb-storage-warning')).toContainText('Changes stay in memory for this visit');
    await connectFromHeader(page);
    await closePanel(page);
    await page.getByRole('button', { name: 'Save SciPy', exact: true }).click();
    await researchHome(page);
    await page.getByRole('navigation', { name: 'Your research views', exact: true }).getByRole('link', { name: 'Saved', exact: true }).click();
    await expect(page.locator('.wb-library-list').getByRole('link', { name: 'SciPy', exact: true })).toBeVisible();
    await page.reload();
    await expect(header(page)).toHaveAccessibleName(/Not connected/);
    await connectFromHeader(page);
    await closePanel(page);
    await expect(page.getByRole('heading', { name: 'Keep useful research close.', exact: true })).toBeVisible();
  });

  test('V11: damaged preferences are preserved while new saved state stays in memory', async ({ page }) => {
    await page.addInitScript(key => localStorage.setItem(key, '{not-json-preserve-me'), libraryKey);
    await page.goto('./projects/project~scipy/');
    await expect(page.locator('.wb-storage-warning')).toContainText('existing stored data is preserved');
    await connectFromHeader(page);
    await closePanel(page);
    await page.getByRole('button', { name: 'Save SciPy', exact: true }).click();
    expect(await page.evaluate(key => localStorage.getItem(key), libraryKey)).toBe('{not-json-preserve-me');
    await researchHome(page);
    await page.getByRole('navigation', { name: 'Your research views', exact: true }).getByRole('link', { name: 'Saved', exact: true }).click();
    await expect(page.locator('.wb-library-list').getByRole('link', { name: 'SciPy', exact: true })).toBeVisible();
  });

  test('V06/V07: manual receipts reject every mismatched identity, preserve in-flight work and deduplicate success', async ({ page }) => {
    await enterReview(page, 'manual');
    await reviewProjectFromExplore(page);
    await consent(page).check();
    await sendButton(page).click();
    await expect(reviewPanel(page).getByRole('button', { name: 'Waiting for matching receipt…', exact: true })).toBeDisabled();
    await reviewPanel(page).getByRole('button', { name: 'Close review', exact: true }).click();
    // Reopening the same object is a view operation, not cancellation or a fresh request.
    await page.getByRole('button', { name: 'Open in Open-Science: SciPy', exact: true }).click();
    await expect(reviewPanel(page).getByRole('button', { name: 'Stop waiting', exact: true })).toBeVisible();
    await expect(consent(page)).toHaveCount(0);
    await closePanel(page);
    await viewReceipts(page);
    await expect(page.getByRole('heading', { name: 'No reference receipts yet', exact: true })).toBeVisible();
    await expandControls(page);
    for (const label of ['Wrong session receipt', 'Wrong request receipt', 'Wrong object receipt', 'Wrong content receipt']) {
      await controls(page).getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('heading', { name: 'No reference receipts yet', exact: true })).toBeVisible();
      await expect(page.locator('.wb-receipt')).toHaveCount(0);
    }
    await controls(page).getByRole('button', { name: 'Deliver matching receipt', exact: true }).click();
    await expect(page.locator('.wb-receipt')).toHaveCount(1);
    await expect(page.locator('.wb-receipt')).toContainText('SciPy');
    await controls(page).getByRole('button', { name: 'Deliver matching receipt', exact: true }).click();
    await expect(page.locator('.wb-receipt')).toHaveCount(1);
    await page.locator('.wb-receipt summary').click();
    await expect(page.locator('.wb-receipt')).toContainText('Request');
    await expect(page.locator('.wb-receipt')).toContainText('Session at receipt');
    await expect(page.locator('.wb-receipt')).toContainText('"id": "project:scipy"');
  });

  test('V06/V09: replacing an in-flight object needs a choice and old delivery cannot approve the replacement', async ({ page }) => {
    await enterReview(page, 'manual');
    await reviewProjectFromExplore(page);
    await consent(page).check();
    await sendButton(page).click();
    await closePanel(page);
    await setSearch(page, 'pandas');
    await page.getByRole('button', { name: 'Open in Open-Science: pandas', exact: true }).click();
    const replacing = page.getByRole('dialog', { name: 'Another reference is waiting', exact: true });
    await expect(replacing).toContainText('SciPy');
    await expect(replacing).toContainText('pandas');
    await replacing.getByRole('button', { name: 'Keep waiting for current reference', exact: true }).click();
    await expect(reviewPanel(page)).toContainText('SciPy');
    await expect(reviewPanel(page).getByRole('button', { name: 'Stop waiting', exact: true })).toBeVisible();
    await closePanel(page);
    await page.getByRole('button', { name: 'Open in Open-Science: pandas', exact: true }).click();
    await replacing.getByRole('button', { name: 'Replace and review new reference', exact: true }).click();
    const reference = await reviewManualText(page);
    expect(reference.object.id).toBe('project:pandas');
    await expect(consent(page)).not.toBeChecked();
    await expect(sendButton(page)).toBeDisabled();
    await expect(reviewPanel(page)).toContainText('Its delivery remains unconfirmed.');
    await closePanel(page);
    await viewReceipts(page);
    await expandControls(page);
    await controls(page).getByRole('button', { name: 'Deliver matching receipt', exact: true }).click();
    await expect(page.locator('.wb-receipt')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue with this project', exact: true }).click();
    await expect(consent(page)).not.toBeChecked();
    await expect(sendButton(page)).toBeDisabled();
    await consent(page).check();
    await sendButton(page).click();
    await closePanel(page);
    await controls(page).getByRole('button', { name: 'Deliver matching receipt', exact: true }).click();
    await expect(page.locator('.wb-receipt')).toHaveCount(1);
    await expect(page.locator('.wb-receipt')).toContainText('pandas');
    await expect(page.locator('.wb-receipt')).not.toContainText('SciPy');
  });

  test('V08: cancelled and timed-out connections ignore late confirmation and permit an explicit retry', async ({ page }) => {
    await page.clock.install();
    await enterReview(page);
    await controls(page).getByRole('combobox', { name: /^Connection response/ }).selectOption('manual');
    await header(page).click();
    await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Connecting/);
    await panel(page).getByRole('button', { name: 'Cancel connection', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Not confirmed/);
    await closePanel(page);
    await controls(page).getByRole('button', { name: 'Deliver connection response', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Not confirmed/);
    await controls(page).getByRole('combobox', { name: /^Connection response/ }).selectOption('silent');
    await header(page).click();
    await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Connecting/);
    await page.clock.fastForward(8100);
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Not confirmed/);
    await expect(panel(page)).toContainText('No response was confirmed.');
    await expect(panel(page)).toContainText('this does not mean Open-Science is not installed');
    await panel(page).getByRole('button', { name: 'Continue browsing', exact: true }).click();
    await controls(page).getByRole('button', { name: 'Deliver connection response', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Not confirmed/);
    await controls(page).getByRole('combobox', { name: /^Connection response/ }).selectOption('automatic');
    await connectFromHeader(page);
    await expect(panel(page).getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  });

  test('V09/V10: timeout and interruption invalidate send consent without falsely withdrawing remote work', async ({ page }) => {
    await page.clock.install();
    await enterReview(page, 'silent');
    await reviewProjectFromExplore(page);
    await consent(page).check();
    await sendButton(page).click();
    await expect(reviewPanel(page).getByRole('button', { name: 'Stop waiting', exact: true })).toBeVisible();
    await page.clock.fastForward(15100);
    await expect(reviewPanel(page)).toContainText('Delivery is unconfirmed; the workbench may already have received the reference.');
    await expect(reviewPanel(page)).toContainText('No automatic retry will occur.');
    await expect(sendButton(page)).toBeDisabled();
    await expect(consent(page)).not.toBeChecked();
    await closePanel(page);
    await expandControls(page);
    await controls(page).getByRole('button', { name: 'Deliver matching receipt', exact: true }).click();
    await viewReceipts(page);
    await expect(page.locator('.wb-receipt')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue with this project', exact: true }).click();
    await consent(page).check();
    await sendButton(page).click();
    await reviewPanel(page).getByRole('button', { name: 'Stop waiting', exact: true }).click();
    await expect(reviewPanel(page)).toContainText('This does not withdraw a reference the workbench may already have received.');
    await expect(sendButton(page)).toBeDisabled();
    await closePanel(page);
    await controls(page).getByRole('button', { name: 'Deliver matching receipt', exact: true }).click();
    await expect(page.locator('.wb-receipt')).toHaveCount(0);
    await controls(page).getByRole('button', { name: 'Interrupt connection', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Interrupted/);
    await expectNoPersonalActions(page);
    await connectFromHeader(page);
    await reviewSelectedReference(page);
    await expect(reviewPanel(page)).toContainText('SciPy');
    await expect(consent(page)).not.toBeChecked();
    await expect(sendButton(page)).toBeDisabled();
  });

  test('V08/V09/V18: explicit failures permit review and a workbench follow-up never becomes GitHub authorization or execution', async ({ page }) => {
    await enterReview(page, 'failure');
    await controls(page).getByRole('combobox', { name: /^Connection response/ }).selectOption('failure');
    await page.getByRole('link', { name: 'Choose research to review', exact: true }).click();
    await setSearch(page, 'scipy');
    await page.getByRole('button', { name: 'Connect to open: SciPy', exact: true }).click();
    await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Not confirmed/);
    await expect(panel(page)).toContainText('Demo connection failed. No connection was confirmed.');
    await expectNoPersonalActions(page);
    await closePanel(page);
    await controls(page).getByRole('combobox', { name: /^Connection response/ }).selectOption('automatic');
    await connectFromHeader(page);
    await reviewSelectedReference(page);
    await expect(reviewPanel(page)).toContainText('SciPy');
    await consent(page).check();
    await sendButton(page).click();
    await expect(reviewPanel(page)).toContainText('Demo transport failed. Delivery is not confirmed; the workbench may already have received the reference.');
    await expect(sendButton(page)).toBeDisabled();
    await expect(reviewPanel(page).getByRole('heading', { name: /^Reference received/ })).toHaveCount(0);
    await closePanel(page);
    await controls(page).getByRole('combobox', { name: /^Reference response/ }).selectOption('continue');
    await page.getByRole('button', { name: 'Open in Open-Science: SciPy', exact: true }).click();
    await expect(consent(page)).not.toBeChecked();
    await expect(sendButton(page)).toBeDisabled();
    await consent(page).check();
    await sendButton(page).click();
    await expect(reviewPanel(page).getByRole('heading', { name: 'Reference received · Demo', exact: true })).toBeVisible();
    await expect(reviewPanel(page)).toContainText('Continue in Open-Science with SciPy.');
    await expect(reviewPanel(page)).toContainText('The next step belongs in your running workbench.');
    await expect(reviewPanel(page).getByRole('button', { name: /GitHub|Authorize|Grant permission|Open Open-Science/i })).toHaveCount(0);
    await expect(reviewPanel(page).getByRole('textbox', { name: /token|scope|password/i })).toHaveCount(0);
    await reviewPanel(page).getByRole('button', { name: 'Return to research', exact: true }).click();
    await viewReceipts(page);
    await expect(page.locator('.wb-receipt')).toHaveCount(1);
    await expect(page.locator('.wb-receipt')).toContainText('Continue with this object in Open-Science for the next step.');
  });

  test('V12: Review uses a temporary library and returns to the ordinary valid session without pollution', async ({ page }) => {
    await page.goto('./join/');
    await connectFromHeader(page);
    await closePanel(page);
    await page.getByRole('link', { name: 'Keep exploring', exact: true }).click();
    await setSearch(page, 'scipy');
    await page.getByRole('button', { name: 'Save SciPy', exact: true }).click();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Connected', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Review connection scenarios', exact: true }).click();
    await page.getByRole('button', { name: 'Enter isolated Review', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Not connected/);
    await connectFromHeader(page);
    await closePanel(page);
    await researchHome(page);
    await page.getByRole('navigation', { name: 'Your research views', exact: true }).getByRole('link', { name: 'Saved', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Keep useful research close.', exact: true })).toBeVisible();
    await page.locator('.wb-home-hero').getByRole('link', { name: 'Explore', exact: true }).click();
    await setSearch(page, 'pandas');
    await page.getByRole('button', { name: 'Save pandas', exact: true }).click();
    await expandControls(page);
    await controls(page).getByRole('button', { name: 'Reset Review', exact: true }).click();
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Not connected/);
    await expectNoPersonalActions(page);
    await connectFromHeader(page);
    await closePanel(page);
    await researchHome(page);
    await page.getByRole('navigation', { name: 'Your research views', exact: true }).getByRole('link', { name: 'Saved', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Keep useful research close.', exact: true })).toBeVisible();
    await expandControls(page);
    await controls(page).getByRole('button', { name: 'Exit Review', exact: true }).click();
    await expect(controls(page)).toHaveCount(0);
    await expect(header(page)).toHaveAccessibleName(/Open-Science — Connected · Demo/);
    await page.getByRole('navigation', { name: 'Your research views', exact: true }).getByRole('link', { name: 'Saved', exact: true }).click();
    await expect(page.locator('.wb-library-list').getByRole('link', { name: 'SciPy', exact: true })).toBeVisible();
    await expect(page.locator('.wb-library-list').getByRole('link', { name: 'pandas', exact: true })).toHaveCount(0);
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), libraryKey);
    expect(stored.saved).toContain('project:scipy');
    expect(stored.saved).not.toContain('project:pandas');
  });
});
