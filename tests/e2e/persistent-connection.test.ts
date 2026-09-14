import { createPublicKey, verify } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

test.skip(process.env.TEST_MODE !== 'real', 'Persistent authorization is isolated to the explicit real-adapter build.');
const header = (page: Page) => page.getByRole('button', { name: /^Open-Science — / });
const panel = (page: Page) => page.getByRole('dialog');
const idleTtlMs = 7_776_000_000;
interface PublicKey { kty: 'EC'; crv: 'P-256'; x: string; y: string }
interface Authorization { id: string; connectorId: string; origin: string; createdAt: number; lastUsedAt: number; expiresAt: number }
interface Grant { authorization: Authorization; publicKey: PublicKey; revoked: boolean; failure?: 'authorization_revoked' | 'authorization_expired' }
interface Pairing { pairingId: string; pollToken: string; verificationCode: string; expiresAt: number; publicKey?: PublicKey; origin: string; approved?: object }
interface Session { id: string; token: string; expiresAt: number; protocolVersion: '1.0'; authorizationId?: string; deleted: boolean }
interface Challenge { grantId: string; purpose: 'resume' | 'revoke'; challengeId: string; challenge: string; expiresAt: number; used: boolean }

/** Synthetic protocol host only. Browser WebCrypto and IndexedDB remain real and unmocked. */
function connector(options: { supportsRemember?: boolean; remember?: boolean } = {}) {
  const state = {
    connectorId: 'synthetic-persistent-connector', approved: false, ready: true, offline: false, supportsRemember: options.supportsRemember ?? true, remember: options.remember ?? true,
    pairings: [] as Pairing[], sessions: [] as Session[], grants: [] as Grant[], challenges: [] as Challenge[],
    proofRequests: [] as Array<{ purpose: string; verified: boolean; grantId: string }>, references: [] as unknown[], deleted: [] as string[],
    capabilityRequests: 0, holdNextResume: false, heldSession: null as Session | null, releaseResume: () => {},
    holdNextVerification: false, heldVerificationSession: null as Session | null, releaseVerification: () => {},
    tamperChallenge: undefined as ((fields: unknown[]) => void) | undefined,
  };
  const issueSession = (authorizationId?: string) => {
    const number = state.sessions.length + 1;
    const value: Session = { id: `synthetic-session-${number}`, token: `synthetic-session-token-${number}`, expiresAt: Date.now() + 1_800_000, protocolVersion: '1.0', ...(authorizationId ? { authorizationId } : {}), deleted: false };
    state.sessions.push(value); return value;
  };
  const outputSession = ({ deleted: _deleted, authorizationId: _authorization, ...value }: Session) => value;
  const handler = async (route: Route) => {
    if (state.offline) return route.abort('connectionrefused');
    const request = route.request(), path = new URL(request.url()).pathname;
    const origin = request.headers().origin ?? new URL(request.frame().url()).origin;
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Private-Network': 'true', 'Content-Type': 'application/json' };
    const respond = (body: unknown, status = 200) => route.fulfill({ status, headers, body: JSON.stringify(body) });
    const failure = (code: string, status: number) => respond({ error: { code } }, status);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path === '/v1/capabilities') {
      state.capabilityRequests++;
      return state.supportsRemember ? respond({ protocolVersion: '1.0', persistentAuthorization: { version: '1.0', algorithm: 'ECDSA-P256-SHA256', connectorId: state.connectorId, idleTtlMs, challengeTtlMs: 60_000 } }) : failure('not_found', 404);
    }
    if (path === '/v1/pairings') {
      expect(request.method()).toBe('POST');
      const body = request.postDataJSON() as { protocolVersion: string; attemptId: string; browserAuthorization?: { version: string; publicKey: PublicKey; browserName: string } };
      expect(body.protocolVersion).toBe('1.0');
      if (body.browserAuthorization) {
        expect(body.browserAuthorization.version).toBe('1.0');
        expect(Object.keys(body.browserAuthorization.publicKey).sort()).toEqual(['crv', 'kty', 'x', 'y']);
        expect(body.browserAuthorization.browserName.length).toBeGreaterThan(0);
      }
      const number = state.pairings.length + 1;
      const pairing: Pairing = { pairingId: `synthetic-pairing-${number}`, pollToken: `synthetic-poll-token-${number}`, verificationCode: `654 ${320 + number}`, expiresAt: Date.now() + 180_000, origin, ...(body.browserAuthorization ? { publicKey: body.browserAuthorization.publicKey } : {}) };
      state.pairings.push(pairing);
      return respond({ pairingId: pairing.pairingId, pollToken: pairing.pollToken, verificationCode: pairing.verificationCode, expiresAt: pairing.expiresAt });
    }
    if (path.startsWith('/v1/pairings/')) {
      const pairing = state.pairings.find(value => path.endsWith(`/${value.pairingId}`)); expect(pairing).toBeDefined();
      expect(request.headers().authorization).toBe(`Bearer ${pairing!.pollToken}`);
      if (!state.approved) return respond({ status: 'pending' });
      if (!pairing!.approved) {
        let authorization: Authorization | undefined;
        if (state.remember && pairing!.publicKey) {
          const now = Date.now(); authorization = { id: `synthetic-grant-${state.grants.length + 1}`, connectorId: state.connectorId, origin: pairing!.origin, createdAt: now, lastUsedAt: now, expiresAt: now + idleTtlMs };
          state.grants.push({ authorization, publicKey: pairing!.publicKey, revoked: false });
        }
        pairing!.approved = { status: 'approved', session: outputSession(issueSession(authorization?.id)), ...(authorization ? { authorization } : {}) };
      }
      return respond(pairing!.approved);
    }
    const match = path.match(/^\/v1\/authorizations\/([^/]+)\/(challenge|resume|revoke)$/);
    if (match) {
      const saved = state.grants.find(value => value.authorization.id === decodeURIComponent(match[1]!));
      if (!saved) return failure('authorization_unknown', 404);
      if (saved.revoked) return failure('authorization_revoked', 401);
      if (saved.failure) return failure(saved.failure, 401);
      const body = request.postDataJSON() as Record<string, unknown>;
      expect(request.method()).toBe('POST'); expect(body.version).toBe('1.0'); expect(body.connectorId).toBe(state.connectorId);
      if (match[2] === 'challenge') {
        expect(['resume', 'revoke']).toContain(body.purpose);
        const challengeId = `synthetic-challenge-${state.challenges.length + 1}`, expiresAt = Date.now() + 60_000;
        const fields: unknown[] = ['aipoch-browser-authorization', '1.0', state.connectorId, saved.authorization.origin, saved.authorization.id, body.purpose, challengeId, `synthetic-nonce-${state.challenges.length + 1}`, expiresAt];
        state.tamperChallenge?.(fields);
        const challenge = { grantId: saved.authorization.id, purpose: body.purpose as Challenge['purpose'], challengeId, expiresAt, challenge: JSON.stringify(fields), used: false };
        state.challenges.push(challenge);
        return respond({ challengeId, challenge: challenge.challenge, expiresAt });
      }
      const challenge = state.challenges.find(value => value.challengeId === body.challengeId); expect(challenge).toBeDefined(); expect(challenge!.used).toBe(false); expect(challenge!.purpose).toBe(match[2]);
      expect(challenge!.expiresAt).toBeGreaterThan(Date.now()); challenge!.used = true;
      const signature = Buffer.from(String(body.signature), 'base64url'); expect(signature.length).toBe(64);
      const verified = verify('sha256', Buffer.from(challenge!.challenge), { key: createPublicKey({ format: 'jwk', key: { ...saved.publicKey } }), dsaEncoding: 'ieee-p1363' }, signature);
      state.proofRequests.push({ purpose: match[2]!, verified, grantId: saved.authorization.id }); expect(verified).toBe(true);
      if (match[2] === 'revoke') { saved.revoked = true; return respond({ revoked: true }); }
      if (!state.ready) return failure('authorized_host_unavailable', 503);
      const now = Date.now(); saved.authorization = { ...saved.authorization, lastUsedAt: now, expiresAt: now + idleTtlMs };
      const session = issueSession(saved.authorization.id);
      if (state.holdNextResume) {
        state.holdNextResume = false; state.heldSession = session;
        await new Promise<void>(resolve => { state.releaseResume = resolve; });
        try { await respond({ session: outputSession(session), authorization: saved.authorization }); } catch (error) { if (!request.failure()) throw error; }
        return;
      }
      return respond({ session: outputSession(session), authorization: saved.authorization });
    }
    if (path === '/v1/session') {
      const token = request.headers().authorization?.replace(/^Bearer /, '');
      const session = state.sessions.find(value => value.token === token); expect(session).toBeDefined();
      if (request.method() === 'DELETE') { session!.deleted = true; state.deleted.push(session!.id); return route.fulfill({ status: 204, headers }); }
      if (session!.deleted) return failure('session_expired', 401);
      if (session!.authorizationId && state.grants.find(value => value.authorization.id === session!.authorizationId)?.revoked) return failure('authorization_revoked', 401);
      const result = { id: session!.id, expiresAt: session!.expiresAt, hostReady: state.ready, ...(session!.authorizationId ? { authorizationId: session!.authorizationId } : {}) };
      if (state.holdNextVerification) {
        state.holdNextVerification = false; state.heldVerificationSession = session!;
        await new Promise<void>(resolve => { state.releaseVerification = resolve; });
        try { await respond(result); } catch (error) { if (!request.failure()) throw error; }
        return;
      }
      return respond(result);
    }
    if (path === '/v1/references') { state.references.push(request.postDataJSON()); return failure('unexpected_reference', 400); }
    return failure('not_found', 404);
  };
  return { state, attach: (context: BrowserContext) => context.route('http://127.0.0.1:47821/**', handler) };
}

async function connect(page: Page, state: ReturnType<typeof connector>['state']) {
  if (!await panel(page).count()) await header(page).click();
  await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
  await expect.poll(() => state.pairings.length).toBeGreaterThan(0);
  state.approved = true;
  await expect(header(page)).toHaveAccessibleName('Open-Science — Connected');
}
async function disconnect(page: Page) {
  if (!await panel(page).count()) await header(page).click();
  await panel(page).getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(header(page)).toHaveAccessibleName('Open-Science — Connection paused');
}
async function inspectKey(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('aipoch-network-browser-identity-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const value = await new Promise<any>((resolve, reject) => { const request = db.transaction('identity').objectStore('identity').get('current'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      if (!value?.privateKey) return { hasKey: false };
      let privateExportRejected = false; try { await crypto.subtle.exportKey('jwk', value.privateKey); } catch { privateExportRejected = true; }
      return { hasKey: true, credentialId: value.credentialId, publicKey: value.publicKeyJwk, extractable: value.privateKey.extractable, type: value.privateKey.type, algorithm: value.privateKey.algorithm, usages: value.privateKey.usages, paused: value.paused, privateExportRejected, grant: value.grant };
    } finally { db.close(); }
  });
}

/** Opt-in screenshots use the same synthetic host and actual candidate; no real browser profile or service is touched. */
async function visual(page: Page, state: string) {
  const output = process.env.PERSISTENT_VISUAL_DIR;
  if (!output) return;
  const original = page.viewportSize()!;
  const mobile = original.width < 600;
  if (mobile) await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const name = `${mobile ? 'narrow-360' : 'desktop-1440'}-${state}`;
  await mkdir(output, { recursive: true });
  await panel(page).evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' });
  const geometry = await panel(page).evaluate(element => {
    const box = element.getBoundingClientRect();
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth, panel: { left: box.left, top: box.top, width: box.width, height: box.height, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth } };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.panel.scrollWidth).toBeLessThanOrEqual(geometry.panel.clientWidth + 1);
  const controls = panel(page).getByRole('button').or(panel(page).getByRole('link'));
  const reachability: Array<{ name: string; reachable: boolean }> = [];
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    await control.scrollIntoViewIfNeeded();
    await control.click({ trial: true });
    const reachable = await control.evaluate(element => {
      // Wrapped inline links have multiple visible boxes; their union's center can be blank space.
      return Array.from(element.getClientRects()).some(box => {
        const x = box.left + box.width / 2, y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && !!hit && (hit === element || element.contains(hit));
      });
    });
    const label = await control.getAttribute('aria-label') ?? await control.innerText();
    reachability.push({ name: label, reachable }); expect(reachable, `${name}: ${label} must remain reachable after scrolling`).toBe(true);
  }
  await page.screenshot({ path: join(output, `${name}-actions.png`), animations: 'disabled' });
  await writeFile(join(output, `${name}.json`), JSON.stringify({ state, fixture: 'synthetic only', browser: 'Chromium', url: page.url(), label: await header(page).getAttribute('aria-label'), ...geometry, reachability }, null, 2));
  await page.setViewportSize(original);
}

test('refresh, a new tab, and closing/reopening tabs resume the same nonextractable identity without pairing', async ({ page, context, baseURL }) => {
  const host = connector(); await host.attach(context); await page.goto('./'); await connect(page, host.state);
  await expect(panel(page).getByRole('region', { name: 'Browser authorization' })).toContainText('This browser is remembered');
  await visual(page, 'remembered');
  const original = await inspectKey(page); expect(original).toMatchObject({ hasKey: true, extractable: false, type: 'private', privateExportRejected: true, usages: ['sign'], algorithm: { name: 'ECDSA', namedCurve: 'P-256' } });
  await page.reload(); await expect(header(page)).toHaveAccessibleName('Open-Science — Connected');
  expect(await inspectKey(page)).toEqual(original);
  const second = await context.newPage(); await second.goto(baseURL!); await expect(header(second)).toHaveAccessibleName('Open-Science — Connected');
  expect((await inspectKey(second)).credentialId).toBe(original.credentialId);
  await page.close(); await second.close();
  const reopened = await context.newPage(); await reopened.goto(baseURL!); await expect(header(reopened)).toHaveAccessibleName('Open-Science — Connected');
  expect((await inspectKey(reopened)).credentialId).toBe(original.credentialId);
  expect(host.state.pairings).toHaveLength(1); expect(host.state.proofRequests.filter(value => value.purpose === 'resume')).toHaveLength(3); expect(host.state.references).toHaveLength(0);
  const storage = await reopened.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  expect(storage).not.toMatch(/synthetic-(?:session-token|poll-token)|privateKey/);
});

for (const broadcastChannel of [true, false]) test(`disconnect persists in all tabs and explicit Connect resumes peers${broadcastChannel ? '' : ' using storage events alone'}`, async ({ page, context, baseURL }) => {
  if (!broadcastChannel) await context.addInitScript(() => { Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined }); });
  const host = connector(); await host.attach(context); await page.goto('./'); await connect(page, host.state);
  const peer = await context.newPage(); await peer.goto(baseURL!); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connected');
  await disconnect(page); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connection paused');
  if (broadcastChannel) await visual(page, 'paused');
  const proofCount = host.state.proofRequests.length;
  await Promise.all([page.reload(), peer.reload()]);
  await expect(header(page)).toHaveAccessibleName('Open-Science — Connection paused'); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connection paused');
  expect(host.state.proofRequests).toHaveLength(proofCount);
  await header(page).click(); await panel(page).getByRole('button', { name: 'Connect Open-Science', exact: true }).click();
  await expect(header(page)).toHaveAccessibleName('Open-Science — Connected'); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connected');
  expect(host.state.pairings).toHaveLength(1); expect(host.state.references).toHaveLength(0);
});

test('forget deletes the browser key, revokes with a verified proof, and invalidates both tabs', async ({ page, context, baseURL }) => {
  const host = connector(); await host.attach(context); await page.goto('./'); await connect(page, host.state);
  const original = await inspectKey(page);
  const peer = await context.newPage(); await peer.goto(baseURL!); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connected');
  await panel(page).getByRole('button', { name: 'Forget this browser', exact: true }).click();
  await expect(panel(page)).toContainText('authorization was revoked');
  await visual(page, 'forgotten');
  await expect(header(page)).toHaveAccessibleName('Open-Science — Not connected'); await expect(header(peer)).toHaveAccessibleName('Open-Science — Not connected');
  expect(await inspectKey(page)).toEqual({ hasKey: false }); expect(host.state.grants[0]?.revoked).toBe(true);
  expect(host.state.proofRequests.filter(value => value.purpose === 'revoke')).toEqual([{ purpose: 'revoke', verified: true, grantId: 'synthetic-grant-1' }]);
  const proofCount = host.state.proofRequests.length; await peer.reload(); await expect(header(peer)).toHaveAccessibleName('Open-Science — Not connected'); expect(host.state.proofRequests).toHaveLength(proofCount);
  await connect(peer, host.state); expect(host.state.pairings).toHaveLength(2); expect((await inspectKey(peer)).credentialId).not.toBe(original.credentialId); expect(host.state.references).toHaveLength(0);
});

test('remembered authorization survives a stopped host and automatically verifies when it becomes ready', async ({ page, context }) => {
  const host = connector(); await host.attach(context); await page.goto('./'); await connect(page, host.state); host.state.ready = false;
  await page.reload(); await expect(header(page)).toHaveAccessibleName('Open-Science — Waiting for connection'); await header(page).click();
  await expect(panel(page)).toContainText('Authorization is remembered. Waiting for Open-Science to be ready.');
  await visual(page, 'host-unavailable');
  if (process.env.PERSISTENT_VISUAL_DIR) {
    host.state.offline = true; await page.reload(); await expect(header(page)).toHaveAccessibleName('Open-Science — Waiting for connection'); await header(page).click();
    await expect(panel(page)).toContainText('Check AIPOCH Connector; your authorization has not been forgotten.');
    await visual(page, 'connector-unreachable'); host.state.offline = false;
  }
  expect(host.state.pairings).toHaveLength(1);
  host.state.ready = true; await expect(header(page)).toHaveAccessibleName('Open-Science — Connected', { timeout: 15_000 });
  expect(host.state.pairings).toHaveLength(1); expect(host.state.references).toHaveLength(0);
});

for (const failure of ['authorization_revoked', 'authorization_expired'] as const) test(`${failure} requires explicit new approval instead of automatically pairing`, async ({ page, context }) => {
  const host = connector(); await host.attach(context); await page.goto('./'); await connect(page, host.state);
  host.state.grants[0]!.failure = failure;
  await page.reload(); await expect(header(page)).toHaveAccessibleName('Open-Science — Not confirmed'); await header(page).click();
  await expect(panel(page)).toContainText('Choose Connect to approve again.'); expect(host.state.pairings).toHaveLength(1); expect(host.state.proofRequests).toHaveLength(0);
  if (failure === 'authorization_revoked') await visual(page, 'reauthorize');
  await connect(page, host.state); expect(host.state.pairings).toHaveLength(2); expect(host.state.grants).toHaveLength(2); expect(host.state.references).toHaveLength(0);
});

for (const fallback of ['old-connector', 'storage-denied', 'remember-unchecked'] as const) test(`${fallback} remains an explicit session-only connection and requires pairing on a new visit`, async ({ page, context }) => {
  if (fallback === 'storage-denied') await context.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('Storage denied', 'SecurityError'); } }); });
  const host = connector({ supportsRemember: fallback !== 'old-connector', remember: fallback !== 'remember-unchecked' }); await host.attach(context);
  await page.goto('./'); await connect(page, host.state);
  await expect(panel(page)).toContainText('Only this visit is connected. A new visit will need approval again.');
  expect(host.state.grants).toHaveLength(0);
  if (fallback !== 'remember-unchecked') expect(host.state.pairings[0]?.publicKey).toBeUndefined();
  await page.reload(); await expect(header(page)).toHaveAccessibleName('Open-Science — Not connected');
  expect(host.state.proofRequests).toHaveLength(0); await connect(page, host.state); expect(host.state.pairings).toHaveLength(2); expect(host.state.references).toHaveLength(0);
});

test('refresh preserves the selected research but clears review approval and never sends a reference', async ({ page, context }) => {
  const host = connector(); await host.attach(context); await page.goto('./projects/project~scipy/');
  await page.getByRole('button', { name: 'Connect to open: SciPy', exact: true }).click(); await connect(page, host.state);
  await panel(page).getByRole('button', { name: 'Review reference for SciPy', exact: true }).click();
  await panel(page).getByRole('checkbox', { name: /^I reviewed this exact object/ }).check(); await expect(panel(page).getByRole('button', { name: 'Send reference', exact: true })).toBeEnabled();
  await page.reload(); await expect(header(page)).toHaveAccessibleName('Open-Science — Connected'); await expect(panel(page)).toHaveCount(0);
  await header(page).click(); await panel(page).getByRole('button', { name: 'Review reference for SciPy', exact: true }).click();
  await expect(panel(page)).toHaveAccessibleName('Review research reference'); await expect(panel(page)).toContainText('project:scipy');
  await expect(panel(page).getByRole('checkbox', { name: /^I reviewed this exact object/ })).not.toBeChecked(); await expect(panel(page).getByRole('button', { name: 'Send reference', exact: true })).toBeDisabled();
  expect(host.state.pairings).toHaveLength(1); expect(host.state.references).toHaveLength(0);
});

test('a challenge bound to another origin is never signed or exchanged for a session', async ({ page, context }) => {
  await context.addInitScript(() => {
    const original = crypto.subtle.sign.bind(crypto.subtle);
    (window as unknown as { proofSignatures: number }).proofSignatures = 0;
    crypto.subtle.sign = (async (...args: Parameters<SubtleCrypto['sign']>) => {
      if (new TextDecoder().decode(args[2] as ArrayBuffer).startsWith('["aipoch-browser-authorization"')) (window as unknown as { proofSignatures: number }).proofSignatures++;
      return original(...args);
    }) as SubtleCrypto['sign'];
  });
  const host = connector(); await host.attach(context); await page.goto('./'); await connect(page, host.state);
  host.state.tamperChallenge = fields => { fields[3] = 'https://different.example'; };
  await page.reload(); await expect(header(page)).toHaveAccessibleName('Open-Science — Waiting for connection');
  expect(host.state.challenges.length).toBeGreaterThan(0); expect(host.state.proofRequests).toHaveLength(0);
  expect(await page.evaluate(() => (window as unknown as { proofSignatures: number }).proofSignatures)).toBe(0);
  expect(host.state.pairings).toHaveLength(1); expect(host.state.references).toHaveLength(0);
});

test('a delayed restore cannot reconnect a tab after another tab pauses the browser', async ({ page, context, baseURL }) => {
  const host = connector(); await host.attach(context); await page.goto('./'); await connect(page, host.state);
  const peer = await context.newPage(); await peer.goto(baseURL!); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connected');
  host.state.holdNextResume = true; await peer.reload(); await expect.poll(() => host.state.heldSession !== null).toBe(true);
  await disconnect(page); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connection paused');
  host.state.releaseResume(); await peer.reload(); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connection paused');
  expect(host.state.pairings).toHaveLength(1); expect(host.state.references).toHaveLength(0);
});

test('a known restored session is revoked when another tab pauses during its host verification', async ({ page, context, baseURL }) => {
  const host = connector(); await host.attach(context); await page.goto('./'); await connect(page, host.state);
  const peer = await context.newPage(); await peer.goto(baseURL!); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connected');
  host.state.holdNextVerification = true; await peer.reload(); await expect.poll(() => host.state.heldVerificationSession !== null).toBe(true);
  await disconnect(page); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connection paused');
  host.state.releaseVerification();
  await expect.poll(() => host.state.deleted.includes(host.state.heldVerificationSession!.id)).toBe(true);
  await peer.reload(); await expect(header(peer)).toHaveAccessibleName('Open-Science — Connection paused');
  expect(host.state.pairings).toHaveLength(1); expect(host.state.references).toHaveLength(0);
});

test('closing the Chromium process and reopening its profile restores the same durable key', async ({ baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One process-restart proof is sufficient; layout tests run in both projects.');
  test.setTimeout(60_000);
  const profile = await mkdtemp(join(tmpdir(), 'aipoch-persistent-profile-'));
  const host = connector(); let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, channel: process.env.PW_CHANNEL });
    await host.attach(context); const page = context.pages()[0] ?? await context.newPage(); await page.goto(baseURL!); await connect(page, host.state);
    const original = await inspectKey(page); await page.goto('about:blank'); await context.close(); context = undefined;
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, channel: process.env.PW_CHANNEL });
    await host.attach(context); const reopened = context.pages()[0] ?? await context.newPage(); await reopened.goto(baseURL!); await expect(header(reopened)).toHaveAccessibleName('Open-Science — Connected');
    expect(await inspectKey(reopened)).toEqual(original); expect(host.state.pairings).toHaveLength(1);
    expect(host.state.proofRequests).toEqual([{ purpose: 'resume', verified: true, grantId: 'synthetic-grant-1' }]); expect(host.state.references).toHaveLength(0);
    await disconnect(reopened); await reopened.goto('about:blank'); await context.close(); context = undefined;
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, channel: process.env.PW_CHANNEL });
    await host.attach(context); const paused = context.pages()[0] ?? await context.newPage(); await paused.goto(baseURL!);
    await expect(header(paused)).toHaveAccessibleName('Open-Science — Connection paused');
    expect((await inspectKey(paused)).credentialId).toBe(original.credentialId); expect(host.state.proofRequests).toHaveLength(1);
    await header(paused).click(); await panel(paused).getByRole('button', { name: 'Connect Open-Science', exact: true }).click(); await expect(header(paused)).toHaveAccessibleName('Open-Science — Connected');
    expect(host.state.pairings).toHaveLength(1); expect(host.state.proofRequests).toHaveLength(2); expect(host.state.references).toHaveLength(0);
    await testInfo.attach('process-restart-proof.json', { contentType: 'application/json', body: JSON.stringify({ browser: 'Chromium', browserVersion: context.browser()?.version(), keyReloadedAfterBrowserProcessRestart: true, pausePersistedAfterBrowserProcessRestart: true, explicitConnectResumedSameGrant: true, privateKeyExtractable: original.extractable, privateExportRejected: original.privateExportRejected, newPairings: host.state.pairings.length, verifiedResumeProofs: host.state.proofRequests.length }, null, 2) });
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
