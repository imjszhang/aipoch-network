import {test,expect,type Page} from '@playwright/test';
async function controls(page:Page){const toggle=page.getByRole('button',{name:'Filters',exact:true});if(await toggle.isVisible()){await toggle.click();return page.getByRole('dialog');}return page.locator('.desktop-filters');}
async function close(page:Page){const dialog=page.getByRole('dialog');if(await dialog.isVisible())await dialog.getByRole('button',{name:/^Show \d+ entries$/}).click();}
test('complete standard, an unpopulated field, multiple selections and shareable reload',async({page},testInfo)=>{
 await page.goto('capabilities/');const panel=await controls(page),field=panel.getByLabel('Research discipline',{exact:true});await expect(field).toBeEnabled();
 await expect(field.locator('optgroup')).toHaveCount(6);
 const emptyCode=await field.locator('option').evaluateAll(options=>options.map(option=>({value:(option as HTMLOptionElement).value,label:option.textContent??''})).find(option=>/^\d+\.\d+$/.test(option.value)&&/\(0\)$/.test(option.label))?.value);
 expect(emptyCode,'the live fixture has an unpopulated standard subfield').toBeTruthy();
 await field.selectOption(emptyCode!);await expect.poll(()=>new URL(page.url()).searchParams.get('field')).toBe(emptyCode);await close(page);await expect(page.getByText('No matching entries',{exact:false})).toBeVisible();
 await page.reload();expect(new URL(page.url()).searchParams.get('field')).toBe(emptyCode);const again=await controls(page);await again.getByLabel('Research discipline',{exact:true}).selectOption('1.1');await expect.poll(()=>new URL(page.url()).searchParams.get('field')?.split(',').sort()).toEqual(['1.1',emptyCode!].sort());await close(page);await expect(page.locator('.results-list')).toContainText('SciPy');
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

test('clinical tools are discoverable with pinned sources and honest usage conditions',async({page})=>{
 await page.goto('capabilities/?field=3.2');
 await expect(page.locator('.results-list')).toContainText('rpact R package');
 await expect(page.locator('.results-list')).toContainText('gtreg R package');
 await page.locator('.results-list').getByRole('link',{name:'gtreg R package',exact:true}).click();
 await expect(page.getByText(/README labels the package experimental/)).toBeVisible();
 await expect(page.getByRole('link',{name:'Documentation',exact:true})).toHaveAttribute('href',/5f63af412d18c3a94d553b281fffac9e025adb30/);
 await page.goto('capabilities/?field=3.2&q=rpact');await page.locator('.results-list').getByRole('link',{name:'rpact R package',exact:true}).click();
 await expect(page.getByText(/this pinned commit is not a stable release/)).toBeVisible();
});

test('civil tools are discoverable with fixed documentation and backend conditions',async({page})=>{
 await page.goto('capabilities/?field=2.1&resource_type=tool');
 for(const name of ['anaStruct tool','ONSAS tool','EE-UQ tool'])await expect(page.locator('.results-list')).toContainText(name);
 await page.locator('.results-list').getByRole('link',{name:'EE-UQ tool',exact:true}).click();
 await expect(page.getByText(/External analysis backends, ground-motion data/)).toBeVisible();
 await expect(page.getByRole('link',{name:'Documentation',exact:true})).toHaveAttribute('href',/67c7a9fabaf46d444d04d087635fd9ec058a8a00/);
});
