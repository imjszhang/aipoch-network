import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

test.skip(process.env.TEST_MODE !== 'real', 'Only the explicit real-adapter artifact uses this protocol fixture.');
const header = (page: Page) => page.getByRole('button', { name: /^Open-Science — / });
const panel = (page: Page) => page.getByRole('dialog');

// HTTP protocol fixtures exercise the actual browser adapter. They are not a live Connector smoke test.
async function bridge(page: Page, options: { loseReferenceResponse?: boolean; missingReceipts?: number; holdReceipt?: boolean; receiptReadyAfterMs?: number } = {}) {
  let releaseReceipt!: () => void;
  const receiptGate = new Promise<void>(resolve => { releaseReceipt = resolve; });
  let missingReceipts = options.missingReceipts ?? 0;
  const state = {
    approved: false, ready: true, mismatch: false, references: [] as Array<Record<string, unknown>>, referencePostedAt: 0, deleted: false,
    receiptRequests: [] as string[], receiptResponses: [] as Array<{ status: number; body: Record<string, unknown> }>,
    expectCancelledReceipt: false, releaseReceipt,
  };
  const receiptFor = (reference: Record<string, unknown>) => ({
    protocolVersion: '1.0', requestId: reference.requestId, sessionId: reference.sessionId, objectId: reference.objectId,
    contentSha256: state.mismatch ? '0'.repeat(64) : (reference.review as { sha256: string }).sha256,
    outcome: 'received', receivedAt: Date.now(),
  });
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
      expect(request.method()).toBe('POST');
      if (!state.referencePostedAt) state.referencePostedAt = Date.now();
      const reference = request.postDataJSON() as Record<string, unknown>; state.references.push(reference);
      const review = reference.review as { content: string; sha256: string };
      expect(createHash('sha256').update(review.content, 'utf8').digest('hex')).toBe(review.sha256);
      if (options.loseReferenceResponse) return route.abort('connectionreset');
      body = receiptFor(reference);
    } else if (path.startsWith('/v1/receipts/')) {
      expect(request.method()).toBe('GET');
      expect(request.headers().authorization).toBe('Bearer fixture-session-token');
      const requestId = decodeURIComponent(path.slice('/v1/receipts/'.length));
      state.receiptRequests.push(requestId);
      const reference = state.references.find(value => value.requestId === requestId);
      expect(reference, 'Receipt queries must retain the original POST request ID').toBeDefined();
      if (missingReceipts > 0 || Date.now() - state.referencePostedAt < (options.receiptReadyAfterMs ?? 0)) {
        if (missingReceipts > 0) missingReceipts--;
        const missing = { error: { code: 'receipt_not_found', message: 'No durable receipt is available yet.' } };
        await route.fulfill({ status: 404, headers, body: JSON.stringify(missing) });
        state.receiptResponses.push({ status: 404, body: missing });
        return;
      }
      const receipt = receiptFor(reference!);
      if (options.holdReceipt) await receiptGate;
      try { await route.fulfill({ status: 200, headers, body: JSON.stringify(receipt) }); }
      catch (error) {
        // A stopped browser fetch can be gone before the held fixture response is released.
        if (!state.expectCancelledReceipt || !request.failure()) throw error;
      }
      state.receiptResponses.push({ status: 200, body: receipt });
      return;
    } else return route.fulfill({ status: 404, headers, body: '{}' });
    await route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  });
  return state;
}

async function sendScipyReference(page: Page) {
  await page.goto('./projects/project~scipy/');
  await page.getByRole('button', { name: 'Connect to open: SciPy', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
  await expect(panel(page)).toHaveAccessibleName('Review research reference');
  await panel(page).getByRole('checkbox', { name: /^I reviewed this exact object/ }).check();
  await panel(page).getByRole('button', { name: 'Send reference', exact: true }).click();
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

test('a lost POST response recovers its exact receipt after an initial 404 without resending', async ({ page }) => {
  const state = await bridge(page, { loseReferenceResponse: true, missingReceipts: 1, holdReceipt: true }); state.approved = true;
  try {
    await sendScipyReference(page);
    await expect.poll(() => state.receiptRequests.length).toBe(2);
    await expect(panel(page).getByRole('button', { name: 'Waiting for matching receipt…', exact: true })).toBeDisabled();
    await expect(panel(page).getByRole('button', { name: 'Stop waiting', exact: true })).toBeVisible();
    await expect(panel(page).getByRole('heading', { name: 'Reference received', exact: true })).toHaveCount(0);
    expect(state.references).toHaveLength(1);
    const original = state.references[0]!;
    expect(state.receiptRequests).toEqual([original.requestId, original.requestId]);
    expect(state.receiptResponses.map(response => response.status)).toEqual([404]);

    state.releaseReceipt();
    await expect(panel(page).getByRole('heading', { name: 'Reference received', exact: true })).toBeVisible();
    await expect.poll(() => state.receiptResponses.length).toBe(2);
    expect(state.receiptResponses[1]).toMatchObject({ status: 200, body: {
      requestId: original.requestId, sessionId: original.sessionId, objectId: original.objectId,
      contentSha256: createHash('sha256').update((original.review as { content: string }).content, 'utf8').digest('hex'),
      outcome: 'received',
    } });
    expect(state.references).toHaveLength(1);
    await expect(panel(page).getByRole('button', { name: 'Stop waiting', exact: true })).toHaveCount(0);
  } finally { state.releaseReceipt(); }
});

test('Stop waiting rejects a late recovered receipt and does not resend the reference', async ({ page }) => {
  const state = await bridge(page, { loseReferenceResponse: true, holdReceipt: true }); state.approved = true;
  try {
    await sendScipyReference(page);
    await expect.poll(() => state.receiptRequests.length).toBe(1);
    await expect(panel(page).getByRole('button', { name: 'Waiting for matching receipt…', exact: true })).toBeDisabled();
    expect(state.references).toHaveLength(1);
    const original = state.references[0]!;
    expect(state.receiptRequests).toEqual([original.requestId]);
    expect(state.receiptResponses).toHaveLength(0);

    state.expectCancelledReceipt = true;
    const cancelledFetch = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname === `/v1/receipts/${encodeURIComponent(String(original.requestId))}`);
    await panel(page).getByRole('button', { name: 'Stop waiting', exact: true }).click();
    await expect(panel(page)).toContainText('This does not withdraw a reference the workbench may already have received.');
    expect((await cancelledFetch).failure()?.errorText).toMatch(/abort|cancel/i);
    state.releaseReceipt();
    await expect.poll(() => state.receiptResponses.length).toBe(1);
    expect(state.receiptResponses[0]).toMatchObject({ status: 200, body: {
      requestId: original.requestId, sessionId: original.sessionId, objectId: original.objectId,
      contentSha256: (original.review as { sha256: string }).sha256, outcome: 'received',
    } });
    await expect(panel(page).getByRole('button', { name: 'Review for a new request', exact: true })).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Send reference', exact: true })).toBeDisabled();
    await expect(panel(page).getByRole('checkbox', { name: /^I reviewed this exact object/ })).not.toBeChecked();
    await expect(panel(page).getByRole('heading', { name: 'Reference received', exact: true })).toHaveCount(0);
    expect(state.references).toHaveLength(1);
    expect(state.receiptRequests).toEqual([original.requestId]);
  } finally { state.releaseReceipt(); }
});

test('real receipt recovery continues beyond the former 15-second engine deadline', async ({ page }) => {
  test.setTimeout(40000);
  const state = await bridge(page, { loseReferenceResponse: true, receiptReadyAfterMs: 16000 }); state.approved = true;
  await sendScipyReference(page);
  await expect.poll(() => state.receiptResponses[0]?.status).toBe(404);
  await expect(panel(page).getByRole('button', { name: 'Waiting for matching receipt…', exact: true })).toBeDisabled();
  expect(state.references).toHaveLength(1);
  const original = state.references[0]!;

  // Each GET returns immediately; only the durable receipt remains unavailable for 16 real seconds.
  await expect(panel(page).getByRole('heading', { name: 'Reference received', exact: true })).toBeVisible({ timeout: 25000 });
  expect(Date.now() - state.referencePostedAt).toBeGreaterThanOrEqual(15000);
  const response = state.receiptResponses.at(-1)!;
  expect(response).toMatchObject({ status: 200, body: {
    requestId: original.requestId, sessionId: original.sessionId, objectId: original.objectId,
    contentSha256: createHash('sha256').update((original.review as { content: string }).content, 'utf8').digest('hex'),
    outcome: 'received',
  } });
  expect(Number(response.body.receivedAt) - state.referencePostedAt).toBeGreaterThanOrEqual(16000);
  expect(state.receiptResponses.slice(0, -1).every(value => value.status === 404)).toBe(true);
  expect(state.receiptRequests.length).toBeGreaterThan(1);
  expect(state.receiptRequests.every(requestId => requestId === original.requestId)).toBe(true);
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
