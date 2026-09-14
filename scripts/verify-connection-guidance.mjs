// Isolated visual checks. All connection responses and codes below are synthetic.
// Run after starting real static preview at ISSUE5_URL (default http://127.0.0.1:4186).
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve('docs/verification/issue-5');
const output = resolve(root, 'screenshots');
await mkdir(output, { recursive: true });
const url = process.env.ISSUE5_URL ?? 'http://127.0.0.1:4186';
const sourceHashes = {};
for (const path of ['web/src/workbench/index.tsx', 'web/src/workbench/engine.ts', 'web/src/workbench/styles.css', 'scripts/verify-connection-guidance.mjs', 'design/references/aipoch-network-concept-v9-r2.html']) sourceHashes[path] = createHash('sha256').update(await readFile(path)).digest('hex');
const report = { kind: 'synthetic protocol visual checks; not human or live Connector acceptance', recordedAt: new Date().toISOString(), buildUrl: url, buildInfo: await (await fetch(`${url}/build-info.json`)).json(), sourceHashes, browser: '', results: [] };
const scratch = await mkdtemp(resolve(tmpdir(), 'aipoch-issue5-visual-'));
try {
  const extension = resolve(scratch, 'extension');
  await mkdir(extension);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Isolated verification zoom', version: '1.0', permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
  await writeFile(resolve(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
  for (const [name, width, zoom] of [['desktop', 1440, 1], ['tablet', 1024, 1], ['mobile', 390, 1], ['narrow', 360, 1], ['zoom200', 1440, 2]]) {
    const context = await chromium.launchPersistentContext(resolve(scratch, name), { channel: 'chromium', headless: true, viewport: zoom === 1 ? { width, height: 1000 } : null, hasTouch: width <= 390, reducedMotion: 'reduce', args: [`--window-size=${width},1087`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    try {
      report.browser = context.browser().version();
      const page = await context.newPage();
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(url);
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const actualZoom = await worker.evaluate(async ({ url, zoom }) => { const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(url)); await chrome.tabs.setZoom(tab.id, zoom); return chrome.tabs.getZoom(tab.id); }, { url, zoom });
      expect(actualZoom).toBe(zoom);
      let approved = false; let pairTtl = 180000;
      const expiresAt = Date.now() + 1800000;
      let references = 0;
      await page.route('http://127.0.0.1:47821/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/v1/references') references++;
        const body = path === '/v1/pairings' ? { pairingId: 'visual-fixture', pollToken: 'synthetic-poll', verificationCode: '123 456', expiresAt: Date.now() + pairTtl } : path === '/v1/pairings/visual-fixture' ? approved ? { status: 'approved', session: { id: 'visual-session', token: 'synthetic-session', expiresAt, protocolVersion: '1.0' } } : { status: 'pending' } : { id: 'visual-session', expiresAt, hostReady: true };
        await route.fulfill({ json: body });
      });
      const dialog = page.getByRole('dialog');
      const snapshot = async state => {
        await expect(dialog).toBeVisible();
        await dialog.evaluate(element => { element.scrollTop = 0; });
        const metrics = await page.evaluate(() => ({ innerWidth, innerHeight, outerWidth, dpr: devicePixelRatio, scrollWidth: document.documentElement.scrollWidth, dialogWidth: document.querySelector('[role=dialog]').clientWidth, dialogScrollWidth: document.querySelector('[role=dialog]').scrollWidth }));
        expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
        expect(metrics.dialogScrollWidth).toBeLessThanOrEqual(metrics.dialogWidth + 1);
        const client = await context.newCDPSession(page);
        const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(resolve(output, `${name}-${state}.png`), Buffer.from(data, 'base64'));
        await client.detach();
        report.results.push({ name, state, zoom: actualZoom, ...metrics });
      };
      await page.getByRole('button', { name: /^Open-Science — / }).click();
      await snapshot('disconnected');
      await page.keyboard.press('Escape');
      await page.goto(`${url}/capabilities/resource~anndata-library/`);
      await page.getByRole('button', { name: 'Connect to use: AnnData research software', exact: true }).click();
      await snapshot('selected');
      const connect = dialog.getByRole('button', { name: 'Connect Open-Science', exact: true });
      if (width <= 390) await connect.tap(); else await connect.click();
      await expect(dialog.getByRole('timer')).toBeVisible();
      await snapshot('waiting');
      await dialog.getByText('Can’t find the confirmation page?', { exact: true }).click();
      await snapshot('help');
      // Focus traversal covers collapsed/expanded summary and scrolls lower actions into reach.
      for (let index = 0; index < 18; index++) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true); }
      await dialog.getByRole('button', { name: 'Cancel connection', exact: true }).focus();
      const client = await context.newCDPSession(page);
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(resolve(output, `${name}-waiting-actions.png`), Buffer.from(data, 'base64'));
      await client.detach();
      approved = true;
      await expect(page.getByRole('button', { name: 'Open-Science — Connected', exact: true })).toBeVisible();
      await expect(dialog).toHaveAccessibleName('Open-Science');
      await snapshot('connected');
      await dialog.getByRole('button', { name: 'Review reference for AnnData research software', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Send reference', exact: true })).toBeDisabled();
      await snapshot('review');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: /^Open-Science — / }).click();
      await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
      approved = false; pairTtl = 1500;
      await dialog.getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Open-Science — Not confirmed', exact: true })).toBeVisible();
      await snapshot('expired');
      expect(references).toBe(0);
      expect(errors).toEqual([]);
      const referenceUrl = process.env.ISSUE5_REFERENCE_URL ?? 'http://127.0.0.1:4220/aipoch-network-concept-v9-r2.html';
      const reference = await context.newPage();
      await reference.goto(referenceUrl);
      await worker.evaluate(async ({ referenceUrl, zoom }) => { const tab = (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(referenceUrl)); await chrome.tabs.setZoom(tab.id, zoom); }, { referenceUrl, zoom });
      await reference.getByRole('button', { name: /Open-Science.*Not connected/ }).click();
      await expect(reference.getByRole('button', { name: 'Connect Open-Science', exact: true })).toBeVisible();
      const referenceShot = async state => {
        await reference.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const cdp = await context.newCDPSession(reference);
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(resolve(output, `${name}-reference-${state}.png`), Buffer.from(data, 'base64'));
        await cdp.detach();
      };
      await referenceShot('disconnected');
      await reference.getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
      await expect(reference.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
        await referenceShot('connected');
    } finally { await context.close(); }
  }
  await writeFile(resolve(root, 'visual-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ screenshots: report.results.length + 15, states: report.results.length, allPassed: true }));
} finally { await rm(scratch, { recursive: true, force: true }); }
