import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const repo = 'repos/imjszhang/aipoch-network';
const types = ['catalog:submission','catalog:claim','catalog:correction','catalog:withdrawal','catalog:appeal','product:bug','product:enhancement','support:question'];
export function validateConfig(labels, forms) {
  if (!Array.isArray(labels) || labels.length !== 19) throw new Error('Expected 19 managed labels.');
  const names = new Set();
  for (const row of labels) {
    if (!row || typeof row.name !== 'string' || !/^(catalog|product|support|stage|outcome):[a-z-]+$/.test(row.name) || names.has(row.name) || !/^[0-9a-f]{6}$/i.test(row.color) || typeof row.description !== 'string' || !row.description || row.description.length > 100) throw new Error('Invalid or duplicate managed label.');
    names.add(row.name);
  }
  if (!forms || forms['config.yml']?.blank_issues_enabled !== true) throw new Error('URL-only blank issues must remain enabled.');
  const used = new Set();
  for (const [file, form] of Object.entries(forms)) {
    if (file === 'config.yml') continue;
    const selected = form.labels?.filter(label => types.includes(label)) ?? [];
    if (selected.length !== 1 || used.has(selected[0]) || form.labels.some(label => !names.has(label))) throw new Error('Each form needs a unique known request type.');
    used.add(selected[0]);
    const expected = selected[0].startsWith('catalog:') ? [selected[0], 'stage:triage'] : selected;
    if (JSON.stringify(form.labels) !== JSON.stringify(expected)) throw new Error('Invalid initial stage.');
    if (!form.name || !form.description || !/^\[[^\]]+\] /.test(form.title) || !Array.isArray(form.body)) throw new Error('Invalid Issue Form metadata.');
    const ids = new Set();
    for (const field of form.body) {
      if (field.type === 'markdown') { if (!field.attributes?.value) throw new Error('Missing form notice.'); continue; }
      if (!['input','textarea','dropdown','checkboxes'].includes(field.type) || !field.id || ids.has(field.id) || !field.attributes?.label || typeof field.validations?.required !== 'boolean') throw new Error('Invalid form field.');
      ids.add(field.id);
    }
    if (selected[0] === 'catalog:submission' && form.body.filter(field => field.validations?.required).length !== 1) throw new Error('Basic submission requires only a URL.');
  }
  if (used.size !== types.length || types.some(name => !names.has(name))) throw new Error('Missing request type.');
}
export function labelChanges(desired, existing) {
  return desired.flatMap(row => {
    const current = existing.find(item => item.name === row.name);
    if (!current) return [{ action: 'create', ...row }];
    if (current.color.toLowerCase() !== row.color.toLowerCase() || (current.description ?? '') !== row.description) return [{ action: 'update', ...row }];
    return [];
  });
}
export function synchronizeLabels(desired, api, apply = false) {
  const existing = api('GET', `${repo}/labels?per_page=100`, null, true);
  if (!Array.isArray(existing)) throw new Error('Invalid label response.');
  const changes = labelChanges(desired, existing);
  if (apply) {
    for (const { action, name, color, description } of changes) {
      api(action === 'create' ? 'POST' : 'PATCH', action === 'create' ? `${repo}/labels` : `${repo}/labels/${encodeURIComponent(name)}`, { name, color, description });
    }
    const after = api('GET', `${repo}/labels?per_page=100`, null, true);
    if (!Array.isArray(after) || labelChanges(desired, after).length) throw new Error('Label readback differs from the configuration.');
  }
  return changes;
}
function ghApi(method, endpoint, payload, paginate = false) {
  const args = ['api', '--method', method, endpoint];
  if (paginate) args.push('--paginate', '--slurp');
  if (payload) args.push('--input', '-');
  let value;
  try {
    value = JSON.parse(execFileSync('gh', args, { input: payload ? JSON.stringify(payload) : undefined, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }));
  } catch { throw new Error('GitHub request failed. Check gh access, then rerun plan; no automatic retry was made.'); }
  return paginate ? value.flat() : value;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const mode = process.argv[2] ?? 'check';
    if (!['check','plan','apply'].includes(mode) || process.argv.length > 3) throw new Error('Usage: node scripts/issue-labels.mjs check|plan|apply');
    const labels = JSON.parse(readFileSync(resolve(root, '.github/issue-labels.json'), 'utf8'));
    const directory = resolve(root, '.github/ISSUE_TEMPLATE');
    const forms = Object.fromEntries(readdirSync(directory).filter(file => file.endsWith('.yml')).map(file => [file, JSON.parse(readFileSync(resolve(directory, file), 'utf8'))]));
    validateConfig(labels, forms);
    console.log(JSON.stringify(mode === 'check' ? { valid: true, labels: labels.length, forms: Object.keys(forms).length - 1 } : { applied: mode === 'apply', changes: synchronizeLabels(labels, ghApi, mode === 'apply') }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
