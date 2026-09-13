import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

test.skip(process.env.TEST_MODE !== 'real', 'Only the explicit real-adapter artifact uses this protocol fixture.');
const header = (page: Page) => page.getByRole('button', { name: /^Open-Science — / });
const panel = (page: Page) => page.getByRole('dialog');

// HTTP protocol fixtures exercise the actual browser adapter. They are not a live Connector smoke test.
async function bridge(page: Page) {
  const state = { approved: false, ready: true, mismatch: false, references: [] as Array<Record<string, unknown>>, deleted: false };
  const expiresAt = Date.now() + 1800000;
  await page.route('http://127.0.0.1:47821/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { 'Access-Control-Allow-Origin': request.headers().origin ?? '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Private-Network': 'true', 'Content-Type': 'application/json' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let body: unknown;
    if (path === '/v1/pairings') body = { pairingId: 'fixture-pairing', pollToken: 'fixture-poll-token', verificationCode: '456 123', expiresAt: Date.now() + 180000 };
    else if (path === '/v1/pairings/fixture-pairing') body = state.approved ? { status: 'approved', session: { id: 'fixture-session', token: 'fixture-session-token', expiresAt, protocolVersion: '1.0' } } : { status: 'pending' };
    else if (path === '/v1/session') { if (request.method() === 'DELETE') state.deleted = true; body = { id: 'fixture-session', expiresAt, hostReady: state.ready && !state.deleted }; }
    else if (path === '/v1/references') {
      const reference = request.postDataJSON() as Record<string, unknown>; state.references.push(reference);
      const review = reference.review as { content: string; sha256: string };
      expect(createHash('sha256').update(review.content, 'utf8').digest('hex')).toBe(review.sha256);
      body = { protocolVersion: '1.0', requestId: reference.requestId, sessionId: reference.sessionId, objectId: reference.objectId, contentSha256: state.mismatch ? '0'.repeat(64) : review.sha256, outcome: 'received', receivedAt: Date.now() };
    } else return route.fulfill({ status: 404, headers, body: '{}' });
    await route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
  return state;
}

test('pairing approval preserves the original object and exact review; disconnect keeps browser data', async ({ page, request }) => {
  expect(await (await request.get('./build-info.json')).json()).toMatchObject({ workbench_mode: 'real', real_connector: true, connector_protocol: '1.0' });
  const state = await bridge(page);
  await page.goto('./projects/project~scipy/');
  await expect(page.getByRole('button', { name: /^Save / })).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect to open: SciPy', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
  await expect(panel(page)).toContainText('456 123');
  await expect(header(page)).toHaveAccessibleName('Open-Science — Connecting');
  expect(state.references).toHaveLength(0);
  state.approved = true;
  await expect(header(page)).toHaveAccessibleName('Open-Science — Connected');
  await expect(panel(page)).toHaveAccessibleName('Review research reference');
  await expect(panel(page)).toContainText('SciPy');
  await expect(page).toHaveURL(/projects\/project~scipy\/$/);
  await expect(panel(page).getByRole('button', { name: 'Send reference', exact: true })).toBeDisabled();
  await panel(page).getByRole('checkbox', { name: /^I reviewed this exact object/ }).check();
  await panel(page).getByRole('button', { name: 'Send reference', exact: true }).click();
  await expect(panel(page).getByRole('heading', { name: 'Reference received', exact: true })).toBeVisible();
  expect(state.references).toHaveLength(1);
  await panel(page).getByRole('button', { name: 'Return to research', exact: true }).click();
  await page.getByRole('button', { name: 'Save SciPy', exact: true }).click();
  await header(page).click(); await panel(page).getByRole('link', { name: 'Your research home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await header(page).click(); await panel(page).getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(header(page)).toHaveAccessibleName('Open-Science — Not connected');
  await panel(page).getByRole('button', { name: 'Close Open-Science panel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Science Open to All', exact: true })).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(storage).toContain('project:scipy'); expect(storage).not.toContain('fixture-session-token'); expect(storage).not.toContain('fixture-poll-token');
});

test('a mismatched receipt stays unconfirmed and never resends automatically', async ({ page }) => {
  const state = await bridge(page); state.approved = true; state.mismatch = true;
  await page.goto('./projects/project~scipy/');
  await page.getByRole('button', { name: 'Connect to open: SciPy', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
  await expect(panel(page)).toHaveAccessibleName('Review research reference');
  await panel(page).getByRole('checkbox', { name: /^I reviewed this exact object/ }).check();
  await panel(page).getByRole('button', { name: 'Send reference', exact: true }).click();
  await expect(panel(page)).toContainText('Delivery is unconfirmed.');
  await expect(panel(page).getByRole('heading', { name: 'Reference received', exact: true })).toHaveCount(0);
  expect(state.references).toHaveLength(1);
});

test('refresh does not restore connection and a cancelled pairing cannot connect later', async ({ page }) => {
  const state = await bridge(page);
  await page.goto('./'); await header(page).click();
  await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
  await expect(panel(page)).toContainText('456 123');
  await panel(page).getByRole('button', { name: 'Cancel connection', exact: true }).click();
  state.approved = true;
  await expect(header(page)).toHaveAccessibleName('Open-Science — Not confirmed');
  await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
  await expect(header(page)).toHaveAccessibleName('Open-Science — Connected');
  await page.reload(); await expect(header(page)).toHaveAccessibleName('Open-Science — Not connected');
  expect(state.references).toHaveLength(0);
});
