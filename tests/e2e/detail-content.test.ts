import { test, expect } from '@playwright/test';

for (const key of ['anndata-library', 'psychojs-tool', 'anastruct-tool']) {
  test(`reviewed usage remains readable before and after scripts: ${key}`, async ({ page, request, browser }) => {
    const route = `./capabilities/resource~${key}/`;
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('View usage information sources');
    expect(html).not.toContain('An intended audience has not been supplied');
    const robots = (process.env.TEST_BASE ?? '/') === '/' ? 'index, follow' : 'noindex, follow';
    expect(html).toContain(`<meta name="robots" content="${robots}"`);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)![1];
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: page.viewportSize()! });
    const plain = await context.newPage();
    await plain.goto(response.url());
    const before = await plain.locator('.info-grid').innerText();
    await expect(plain.locator('.info-grid ol li')).toHaveCount(2);
    await context.close();
    await page.goto(route);
    await expect(page.locator('.info-grid')).toHaveText(before, { useInnerText: true });
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', robots);
    await page.getByText('View usage information sources', { exact: true }).click();
    await expect(page.locator('details[open]')).toContainText('editor');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
