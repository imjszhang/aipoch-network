import {test,expect,type Page} from '@playwright/test';
async function controls(page:Page){const toggle=page.getByRole('button',{name:'Filters',exact:true});if(await toggle.isVisible()){await toggle.click();return page.getByRole('dialog');}return page.locator('.desktop-filters');}
async function close(page:Page){const dialog=page.getByRole('dialog');if(await dialog.isVisible())await dialog.getByRole('button',{name:/^Show \d+ entries$/}).click();}
test('complete standard, empty clinical field, multiple selections and shareable reload',async({page},testInfo)=>{
 await page.goto('capabilities/');const panel=await controls(page),field=panel.getByLabel('Research discipline',{exact:true});await expect(field).toBeEnabled();
 await expect(field.locator('optgroup')).toHaveCount(6);await expect(field.locator('option[value="3.2"]')).toHaveText('3.2 Clinical medicine (0)');
 await field.selectOption('3.2');await expect(page).toHaveURL(/field=3.2/);await close(page);await expect(page.getByText('No matching entries',{exact:false})).toBeVisible();
 await page.reload();await expect(page).toHaveURL(/field=3.2/);const again=await controls(page);await again.getByLabel('Research discipline',{exact:true}).selectOption('1.1');await expect(page).toHaveURL(/field=1.1%2C3.2/);await close(page);await expect(page.locator('.results-list')).toContainText('SciPy');
 await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content',/noindex/);
 await page.screenshot({path:testInfo.outputPath('classification.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('legacy URL, research tags and independent resource type remain functional',async({page})=>{
 await page.goto('capabilities/?domain=Single-cell%20analysis');await expect(page.locator('.results-list')).toContainText('AnnData');const panel=await controls(page);await expect(panel.getByLabel('Legacy research area',{exact:true})).toHaveValue('Single-cell analysis');await close(page);
 await page.goto('capabilities/?field=1.2&tag=single-cell-analysis&resource_type=tool');await expect(page.locator('.results-list')).toContainText('AnnData');await page.reload();await expect(page.locator('.results-list')).toContainText('AnnData');
 await page.goto('capabilities/?field=9');await expect(page.locator('.directory-filter-errors')).toBeVisible();
});
test('detail exposes separate discipline and tag evidence, pending classification is explicit',async({page})=>{
 await page.goto('projects/?q=Jupyter');await expect(page.locator('.results-list')).toContainText('Awaiting discipline classification');
 await page.goto('projects/?q=AnnData');await page.locator('.results-list').getByRole('link',{name:'AnnData',exact:true}).click();await expect(page.getByText('Research classification',{exact:true})).toBeVisible();
 await page.getByText('View discipline evidence',{exact:true}).click();await expect(page.locator('details[open] a').first()).toHaveAttribute('href',/\/blob\/[a-f0-9]{40}\//);
});
