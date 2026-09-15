import { test, expect, type Page } from '@playwright/test';
async function panel(page: Page) {
  const toggle=page.getByRole('button',{name:'Filters',exact:true});
  if (await toggle.isVisible()) { await toggle.click(); return page.getByRole('dialog',{name:'Refine results',exact:true}); }
  return page.getByRole('complementary',{name:'Directory filters',exact:true});
}
async function close(page: Page) { const dialog=page.getByRole('dialog',{name:'Refine results',exact:true}); if (await dialog.isVisible()) { await dialog.getByRole('button',{name:/^Show \d+ entries$/}).click(); await expect(page.locator('dialog.directory-filter-dialog')).toHaveCount(0); } }

test('shared incompatible criteria show a repair action without claiming an empty catalog', async ({page}) => {
  await page.goto('./explore/?min_stars=10&min_followers=20');
  await expect(page.getByRole('alert')).toContainText('Repository and account criteria cannot be combined');
  await expect(page.getByRole('heading',{name:'No matching entries',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Clear incompatible filters',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.results-list > *')).toHaveCount(8);
  await page.goto('./explore/?min_stars=1.5');
  await expect(page.getByRole('alert')).toContainText('whole number');
});

test('metric scopes, category changes and sort survive copied URLs with accessible feedback', async ({page}) => {
  await page.goto('./explore/');
  await expect(page.getByRole('searchbox',{name:'Search directory',exact:true})).toBeEnabled();
  let controls=await panel(page);
  await controls.getByText('GitHub metrics & activity',{exact:true}).click();
  await controls.getByLabel('Minimum GitHub stars',{exact:true}).fill('0');
  await close(page);
  await expect(page.locator('.directory-results .directory-scope')).toContainText('Repository criteria');
  await page.getByRole('combobox',{name:'Sort results'}).selectOption('stars');
  await page.reload();
  await expect(page.getByRole('combobox',{name:'Sort results'})).toHaveValue('stars');
  expect(new URL(page.url()).searchParams.get('min_stars')).toBe('0');
  await page.getByRole('button',{name:'Organizations',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'Filters that do not apply'})).toBeVisible();
  expect(new URL(page.url()).searchParams.has('min_stars')).toBe(false);
  expect(new URL(page.url()).searchParams.has('sort')).toBe(false);
  controls=await panel(page);
  if (!await controls.getByLabel('Minimum GitHub followers',{exact:true}).isVisible()) await controls.getByText('GitHub metrics & activity',{exact:true}).click();
  await controls.getByLabel('Minimum GitHub followers',{exact:true}).fill('0');
  await close(page);
  await expect(page.locator('.directory-results .directory-scope')).toContainText('Account criteria');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('date presets serialize inclusive UTC boundaries and reset together with numeric filters', async ({page}) => {
  await page.goto('./projects/');
  await expect(page.getByRole('searchbox',{name:'Search directory',exact:true})).toBeEnabled();
  let controls=await panel(page);
  await controls.getByText('Catalog dates',{exact:true}).click();
  await controls.getByLabel('Added to AIPOCH',{exact:true}).selectOption('7');
  await close(page);
  const params=new URL(page.url()).searchParams;
  expect(params.get('added_after')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(Date.parse(params.get('added_before')!)-Date.parse(params.get('added_after')!)).toBe(6*86_400_000);
  const link=page.url(); await page.reload(); await expect(page).toHaveURL(link);
  controls=await panel(page);
  if (!await controls.getByLabel('Added to AIPOCH',{exact:true}).isVisible()) await controls.getByText('Catalog dates',{exact:true}).click();
  await controls.getByLabel('Added to AIPOCH',{exact:true}).selectOption('unknown');
  expect(new URL(page.url()).searchParams.has('added_after')).toBe(false);
  await controls.getByRole('button',{name:'Reset filters',exact:true}).click();
  await close(page);
  await expect(page.locator('.results-list > *')).toHaveCount(8);
  expect(new URL(page.url()).searchParams.size).toBe(0);
});

test('cards and source details distinguish catalog dates, public counts and observed default branch', async ({page}) => {
  await page.goto('./projects/');
  await expect(page.locator('.results-list .catalog-date-facts').first()).toBeVisible();
  await expect(page.locator('.results-list .catalog-metric-facts').first()).toContainText('GitHub');
  await page.locator('.results-list .row-title a').first().click();
  await expect(page.locator('.glance')).toContainText('Catalog dates');
  await expect(page.locator('#sources')).toContainText('Last successful public check');
  await expect(page.locator('#sources')).toContainText('Latest default-branch commit');
  await expect(page.locator('#sources')).toContainText('Fixed commit');
  await expect(page.locator('#sources')).toContainText('separate from the fixed reference');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('mobile scope feedback and malformed-value repair remain inside the modal', async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('./explore/?min_stars=0');
  await expect(page.getByRole('searchbox',{name:'Search directory',exact:true})).toBeEnabled();
  const controls=await panel(page);
  await controls.getByText('GitHub metrics & activity',{exact:true}).click();
  await controls.getByLabel('Minimum GitHub followers',{exact:true}).fill('0');
  await expect(controls.getByRole('status').filter({hasText:'Filters that do not apply'})).toBeVisible();
  await controls.getByLabel('Minimum GitHub followers',{exact:true}).fill('1.5');
  await expect(controls.getByRole('alert')).toContainText('whole number');
  await controls.getByRole('button',{name:'Clear incompatible filters',exact:true}).click();
  await expect(controls.getByRole('alert')).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('min_followers')).toBe(false);
});
