import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueDraft, issueRoutes, issueTemplateUrl } from '../src/issue-routing.js';
import { readFileSync, readdirSync } from 'node:fs';
// @ts-expect-error The dependency-free maintenance CLI is plain ESM.
import { validateConfig, labelChanges, synchronizeLabels } from '../../scripts/issue-labels.mjs';
const root = new URL('../../', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const labels = read('.github/issue-labels.json');
const forms = Object.fromEntries(readdirSync(new URL('.github/ISSUE_TEMPLATE/', root)).filter(file => file.endsWith('.yml')).map(file => [file, read(`.github/ISSUE_TEMPLATE/${file}`)]));
test('request links use existing forms and isolated unique type labels', () => {
  validateConfig(labels, forms);
  for (const [type, route] of Object.entries(issueRoutes)) {
    const url = new URL(issueTemplateUrl(type as keyof typeof issueRoutes));
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.searchParams.get('template'), route.template);
    assert.equal(forms[route.template].labels[0], route.label);
    assert.equal(forms[route.template].title.trim(), route.prefix);
  }
});
test('URL-only draft normalizes the source, preserves text and prelabels the blank issue', () => {
  const draft = buildIssueDraft({ type: 'submission', source: 'https://github.com/scipy/scipy/', note: '科研 & # detail?\nnext' });
  const url = new URL(draft.href);
  assert.equal(url.searchParams.get('body'), draft.body);
  assert.equal(url.searchParams.get('labels'), 'catalog:submission,stage:triage');
  assert.equal(url.searchParams.has('template'), false);
  assert.equal(draft.source, 'https://github.com/scipy/scipy');
  assert.ok(draft.title.startsWith('[收录]'));
  assert.throws(() => buildIssueDraft({ type: 'submission', source: '', note: '' }));
  assert.throws(() => buildIssueDraft({ type: 'submission', source: 'https://example.com/x', note: '' }));
});
test('corrections allow known source-less objects but cannot silently become submissions', () => {
  const draft = buildIssueDraft({ type: 'correction', target: 'collection:research-foundations', knownIds: ['collection:research-foundations'], source: '', note: 'Correct the selection' });
  assert.equal(new URL(draft.href).searchParams.get('labels'), 'catalog:correction,stage:triage');
  assert.match(draft.body, /collection:research-foundations/);
  assert.doesNotMatch(draft.body, /candidate for community indexing/);
  for (const target of ['', 'project:missing']) assert.throws(() => buildIssueDraft({ type: 'correction', target, knownIds: [], source: 'https://github.com/scipy/scipy', note: '' }));
});
test('oversized drafts retain title, routing and full copyable content', () => {
  for (const type of ['submission','correction'] as const) {
    const note = '科研资料'.repeat(500);
    const draft = buildIssueDraft({ type, source: 'https://github.com/scipy/scipy', target: 'project:scipy', knownIds: ['project:scipy'], note });
    assert.equal(draft.oversized, true);
    const url = new URL(draft.href);
    assert.equal(url.searchParams.has('body'), false);
    assert.equal(url.searchParams.get('title'), draft.title);
    assert.equal(url.searchParams.get('labels'), `${issueRoutes[type].label},stage:triage`);
    assert.ok(draft.body.includes(note));
    assert.ok(draft.href.length < 7500);
  }
});
test('form validation rejects conflicting types, missing labels and extra required intake fields', () => {
  const mutate = (fn: (copy: typeof forms) => void) => { const copy = structuredClone(forms); fn(copy); assert.throws(() => validateConfig(labels, copy)); };
  mutate(copy => copy['source-proposal.yml'].labels.push('catalog:claim'));
  mutate(copy => copy['source-proposal.yml'].labels.push('missing'));
  mutate(copy => copy['bug.yml'].labels.push('stage:triage'));
  mutate(copy => copy['source-proposal.yml'].body[2].validations.required = true);
  mutate(copy => copy['config.yml'].blank_issues_enabled = false);
});
test('label preview never writes; apply preserves unrelated labels and is idempotent', () => {
  let existing = [{ name: 'bug', color: '000000', description: 'Legacy' }, { ...labels[0], description: 'Old' }];
  const writes: string[] = [];
  const api = (method: string, endpoint: string, payload: { name: string; color: string; description: string }) => {
    assert.ok(endpoint.startsWith('repos/imjszhang/aipoch-network/labels'));
    if (method === 'GET') return structuredClone(existing);
    writes.push(method);
    existing = existing.filter(row => row.name !== payload.name).concat(payload);
    return payload;
  };
  assert.equal(synchronizeLabels(labels, api).length, 19);
  assert.equal(writes.length, 0);
  synchronizeLabels(labels, api, true);
  assert.equal(writes.length, 19);
  assert.ok(existing.some(row => row.name === 'bug'));
  assert.deepEqual(labelChanges(labels, existing), []);
  synchronizeLabels(labels, api, true);
  assert.equal(writes.length, 19);
  assert.throws(() => synchronizeLabels(labels, () => [], true), /readback/);
  assert.throws(() => synchronizeLabels(labels, () => { throw new Error('API failed'); }, true), /API failed/);
});
