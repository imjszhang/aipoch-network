import { normalizeGitHubUrl } from '../../spec/identity.js';
export const ISSUE_REPO = 'https://github.com/imjszhang/aipoch-network';
export const issueRoutes = {
  submission: { prefix: '[Submission]', label: 'catalog:submission', template: 'source-proposal.yml', name: 'Recommend a source' },
  claim: { prefix: '[Claim]', label: 'catalog:claim', template: 'claim-or-curation.yml', name: 'Claim maintenance or organization curation' },
  correction: { prefix: '[Correction]', label: 'catalog:correction', template: 'correction-or-withdrawal.yml', name: 'Correct catalog content' },
  withdrawal: { prefix: '[Withdrawal]', label: 'catalog:withdrawal', template: 'withdrawal.yml', name: 'Request content withdrawal' },
  appeal: { prefix: '[Appeal]', label: 'catalog:appeal', template: 'appeal.yml', name: 'Appeal a catalog decision' },
  bug: { prefix: '[Bug]', label: 'product:bug', template: 'bug.yml', name: 'Report a website bug' },
  enhancement: { prefix: '[Feature]', label: 'product:enhancement', template: 'feature.yml', name: 'Suggest a product improvement' },
  question: { prefix: '[Question]', label: 'support:question', template: 'question.yml', name: 'Ask a usage question' },
} as const;
export type IssueType = keyof typeof issueRoutes;
export function issueTemplateUrl(type: IssueType): string {
  const url = new URL(`${ISSUE_REPO}/issues/new`);
  url.searchParams.set('template', issueRoutes[type].template);
  return url.href;
}
export function buildIssueDraft(input: { type: 'submission' | 'correction'; source: string; note: string; target?: string; knownIds?: readonly string[] }) {
  const { type, note } = input;
  const target = input.target ?? '';
  if (type === 'correction' && (!target || !input.knownIds?.includes(target))) throw new Error('This catalog entry is unavailable. Return to the directory or use the correction form on GitHub.');
  const source = input.source.trim() ? normalizeGitHubUrl(input.source.trim()).canonical_url : '';
  if (type === 'submission' && !source) throw new Error('Enter a public github.com repository or organization URL.');
  const route = issueRoutes[type];
  const title = `${route.prefix} ${type === 'correction' ? target : 'Research source proposal'}`;
  const body = type === 'correction'
    ? `## Catalog correction\n${target}\n\n## Source URL\n${source || 'Not supplied; the catalog ID identifies the target.'}\n\n## Requested correction\n${note || 'Not supplied.'}\n\nThis requests a catalog correction, not a new submission or authority claim.`
    : `## Source URL\n${source}\n\n## Optional context\n${note || 'Not supplied.'}\n\nThis is a candidate for community indexing, not a maintainer or organization claim.`;
  const url = new URL(`${ISSUE_REPO}/issues/new`);
  // A complete reviewed Markdown body belongs to a blank issue, not form field prefill.
  url.searchParams.set('title', title);
  url.searchParams.set('labels', `${route.label},stage:triage`);
  url.searchParams.set('body', body);
  const oversized = url.href.length > 7500;
  if (oversized) url.searchParams.delete('body');
  return { title, body, source, href: url.href, oversized };
}
