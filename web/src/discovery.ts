import type { Actor, CatalogData, CatalogDate, MetricObservation, Observation, SourceRepository } from '../../spec/types.js';
import type { Entry } from './model.js';

export const DAY = 86_400_000;
export const FRESH_WINDOW = 2 * DAY;
export const DISPLAY_WINDOW = 7 * DAY;
export const discoveryKeys = ['added_after','added_before','added_date','updated_after','updated_before','updated_date','source_after','source_before','source_date','min_stars','min_forks','min_followers','observation','include_stale_metrics','sort'] as const;
const repositoryKeys = ['source_after','source_before','source_date','min_stars','min_forks'];
export const sorts = { relevance: 'Most relevant', title: 'Name A–Z', added: 'Recently added', catalog_updated: 'Recently updated', source_activity: 'Latest source activity', stars: 'Most starred', followers: 'Most followed', updated: 'Legacy updated order' } as const;
export type DiscoverySort = keyof typeof sorts;
export type Freshness = 'fresh' | 'stale' | 'missing';
export type Scope = 'repository' | 'account' | 'all';
export interface DiscoveryFilters {
  params: URLSearchParams;
  sort: DiscoverySort;
  scope: Scope;
  includeStale: boolean;
  errors: string[];
  invalidKeys: string[];
  referenceTime: number;
}
export function isRepositoryKind(kind: string) { return ['project','resource','source_repository'].includes(kind); }
export function isAccountKind(kind: string) { return ['actor','organization'].includes(kind); }
export function validDay(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value; }
export function parseDiscovery(params: URLSearchParams, kind: string, referenceTime: string): DiscoveryFilters {
  const errors: string[] = [], invalidKeys = new Set<string>();
  const invalid = (keys: string[], message: string) => { errors.push(message); keys.forEach(key => invalidKeys.add(key)); };
  for (const key of new Set(params.keys())) if (params.getAll(key).length > 1) invalid([key], `The ${key.replaceAll('_',' ')} filter is repeated. Choose one value.`);
  for (const key of ['min_stars','min_forks','min_followers']) if (params.has(key) && (!/^\d+$/.test(params.get(key)!) || !Number.isSafeInteger(Number(params.get(key))))) invalid([key], `${key.replace('min_', 'Minimum ')} must be a nonnegative whole number within the supported range.`);
  for (const prefix of ['added','updated','source']) {
    const after = params.get(`${prefix}_after`), before = params.get(`${prefix}_before`), mode = params.get(`${prefix}_date`);
    for (const [key,value] of [[`${prefix}_after`,after],[`${prefix}_before`,before]]) if (value !== null && !validDay(value!)) invalid([key!], `Choose a valid UTC calendar date for ${key!.replaceAll('_',' ')}.`);
    if (after && before && validDay(after) && validDay(before) && after > before) invalid([`${prefix}_after`,`${prefix}_before`], `The ${prefix} start date must be on or before its end date.`);
    if (mode !== null && mode !== 'unknown') invalid([`${prefix}_date`], `Unknown ${prefix} date option.`);
    if (mode && (after || before)) invalid([`${prefix}_date`,`${prefix}_after`,`${prefix}_before`], `Choose either an exact ${prefix} date range or unknown dates.`);
  }
  if (params.has('sort') && !Object.hasOwn(sorts, params.get('sort')!)) invalid(['sort'], 'Unknown sort order. Choose a supported sort.');
  if (params.has('access') && !['pinned','unpinned','unknown','stale'].includes(params.get('access')!)) invalid(['access'], 'Unknown source condition. Choose a supported version or condition.');
  if (params.has('type') && !['all','project','resource','organization','actor','collection','source_repository'].includes(params.get('type')!)) invalid(['type'], 'Unknown entry type. Choose a supported category.');
  if (params.has('observation') && !['fresh','stale','missing'].includes(params.get('observation')!)) invalid(['observation'], 'Unknown observation status.');
  if (params.has('include_stale_metrics') && params.get('include_stale_metrics') !== '1') invalid(['include_stale_metrics'], 'Allow stale metrics must be explicitly set to 1.');
  const sort = (Object.hasOwn(sorts, params.get('sort')!) ? params.get('sort') : 'relevance') as DiscoverySort;
  const legacyRepositoryKeys = ['domain','access','organization'];
  const repo = repositoryKeys.some(key => params.has(key)) || sort === 'stars' || sort === 'source_activity';
  const account = params.has('min_followers') || sort === 'followers';
  if (account && legacyRepositoryKeys.some(key => params.has(key))) invalid([...legacyRepositoryKeys,'min_followers','sort'], 'Research area, organization membership and source conditions apply to project or source records, not account metrics.');
  if (repo && account) invalid([...repositoryKeys,'min_followers','sort'], 'Repository and account criteria cannot be combined. Choose one scope to repair this link.');
  const selectedKind = kind === 'all' ? params.get('type') || 'all' : kind;
  if (selectedKind !== 'all' && !['project','resource'].includes(selectedKind)) {
    for (const key of ['domain','organization']) if (params.has(key)) invalid([key], `${key === 'domain' ? 'Research area' : 'Organization membership'} applies to Projects and Capabilities.`);
  }
  if (params.has('access') && selectedKind !== 'all' && (!isRepositoryKind(selectedKind) || selectedKind === 'source_repository' && ['pinned','unpinned'].includes(params.get('access')!))) invalid(['access'], 'These source conditions do not apply to the selected category.');
  if (repo && selectedKind !== 'all' && !isRepositoryKind(selectedKind)) invalid([...repositoryKeys,'sort'], 'Repository criteria apply to Projects, Capabilities and Sources.');
  if (account && selectedKind !== 'all' && !isAccountKind(selectedKind)) invalid(['min_followers','sort'], 'Follower criteria apply to Researchers and Organizations.');
  if (params.has('observation') && selectedKind === 'collection') invalid(['observation'], 'Collections have no source or account observation.');
  return { params, sort, scope: repo ? 'repository' : account ? 'account' : 'all', includeStale: params.get('include_stale_metrics') === '1', errors, invalidKeys: [...invalidKeys], referenceTime: Date.parse(referenceTime) };
}
/** Interactive changes repair scope; hand-written incompatible links remain visibly invalid. */
export function changeDiscovery(params: URLSearchParams, changes: Record<string,string>, kind: string): { params: URLSearchParams; notice: string } {
  const next = new URLSearchParams(params), removed = new Set<string>();
  const clear = (keys: string[]) => keys.forEach(key => { if (next.has(key)) { next.delete(key); removed.add(key); } });
  next.delete('page');
  for (const [key,value] of Object.entries(changes)) { if (value && !(key === 'type' && value === 'all') && !(key === 'sort' && value === 'relevance') && !(key === 'page' && value === '1')) next.set(key,value); else next.delete(key); }
  const selectedKind = kind === 'all' ? next.get('type') || 'all' : kind;
  const toRepo = [...repositoryKeys,'domain','access','organization'].some(key => Boolean(changes[key])) || ['stars','source_activity'].includes(changes.sort);
  const toAccount = Boolean(changes.min_followers) || changes.sort === 'followers';
  if (toRepo) { clear(['min_followers']); if (next.get('sort') === 'followers') clear(['sort']); }
  if (toAccount) { clear([...repositoryKeys,'domain','access','organization']); if (['stars','source_activity'].includes(next.get('sort')!)) clear(['sort']); }
  if (changes.type !== undefined) {
    if (selectedKind !== 'all' && !isRepositoryKind(selectedKind)) { clear([...repositoryKeys,'access','domain']); if (['stars','source_activity'].includes(next.get('sort')!)) clear(['sort']); }
    if (selectedKind !== 'all' && !isAccountKind(selectedKind)) { clear(['min_followers']); if (next.get('sort') === 'followers') clear(['sort']); }
    if (selectedKind !== 'all' && !['project','resource'].includes(selectedKind)) clear(['domain','organization']);
    if (selectedKind === 'source_repository' && ['pinned','unpinned'].includes(next.get('access')!)) clear(['access']);
    if (selectedKind === 'collection') clear(['observation','include_stale_metrics']);
  }
  return { params: next, notice: removed.size ? 'Filters that do not apply to the selected scope were cleared.' : '' };
}
export function presetDates(prefix: string, days: number, referenceTime: number): Record<string,string> {
  const end = new Date(referenceTime).toISOString().slice(0,10), start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0,10);
  return { [`${prefix}_after`]: start, [`${prefix}_before`]: end, [`${prefix}_date`]: '' };
}
export function freshness(observedAt: string | undefined, referenceTime: number): Freshness {
  const time = observedAt ? Date.parse(observedAt) : NaN, age = referenceTime - time;
  return !Number.isFinite(age) || age < 0 || age > DISPLAY_WINDOW ? 'missing' : age <= FRESH_WINDOW ? 'fresh' : 'stale';
}
export function observationStatus(observation: Observation | undefined, referenceTime: number): Freshness { return freshness(observation?.last_success_at, referenceTime); }
export function metricValue(metric: MetricObservation | undefined, referenceTime: number, includeStale = false): number | undefined {
  const status = freshness(metric?.observed_at, referenceTime);
  return metric?.value !== undefined && Number.isSafeInteger(metric.value) && metric.value >= 0 && (status === 'fresh' || includeStale && status === 'stale') ? metric.value : undefined;
}
export function actorFor(entry: Entry, catalog: CatalogData): Actor | undefined { return entry.kind === 'actor' ? entry : entry.kind === 'organization' ? catalog.actors.find(row => row.id === entry.actor_id) : undefined; }
export function eligibleSources(entry: Entry, catalog: CatalogData, includeAllReferences = false): SourceRepository[] {
  if (entry.kind === 'source_repository') return [entry];
  if (entry.kind !== 'project' && entry.kind !== 'resource') return [];
  const ids = new Set(entry.source_refs.filter(ref => includeAllReferences || ref.role === 'primary' || ref.role === 'implementation').map(ref => ref.source_id));
  return catalog.sources.filter(source => ids.has(source.id)).sort((a,b) => a.id.localeCompare(b.id));
}
function dayRange(value: string | undefined, params: URLSearchParams, prefix: string): boolean {
  if (!params.has(`${prefix}_after`) && !params.has(`${prefix}_before`)) return true;
  if (!value) return false;
  const time = Date.parse(value), after = params.get(`${prefix}_after`), before = params.get(`${prefix}_before`);
  return Number.isFinite(time) && (!after || time >= Date.parse(`${after}T00:00:00Z`)) && (!before || time < Date.parse(`${before}T00:00:00Z`) + DAY);
}
function catalogDateMatches(date: CatalogDate | undefined, params: URLSearchParams, prefix: string): boolean {
  if (params.get(`${prefix}_date`) === 'unknown') return !date?.value || date.basis !== 'exact';
  if (params.has(`${prefix}_after`) || params.has(`${prefix}_before`)) return date?.basis === 'exact' && dayRange(date.value,params,prefix);
  return true;
}
export function sourceCommit(source: SourceRepository, referenceTime: number): string | undefined {
  const head = source.source_activity?.default_branch_head, date = head?.committed_at;
  return head?.date_status === 'valid' && date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= referenceTime && freshness(source.source_activity?.observation?.last_success_at ?? head.observed_at, referenceTime) !== 'missing' ? date : undefined;
}
export function matchingSources(entry: Entry, catalog: CatalogData, filters: DiscoveryFilters, includeAllReferences = false): SourceRepository[] {
  const { params, referenceTime, includeStale } = filters;
  return eligibleSources(entry,catalog,includeAllReferences).filter(source => {
    const organization = params.get('organization');
    if (organization && !catalog.organizations.find(row => row.id === organization)?.source_ids.includes(source.id)) return false;
    const access = params.get('access');
    if (access === 'pinned' || access === 'unpinned') {
      if (entry.kind !== 'project' && entry.kind !== 'resource') return false;
      const refs = entry.source_refs.filter(ref => ref.source_id === source.id && (includeAllReferences || ref.role === 'primary' || ref.role === 'implementation'));
      if (!refs.some(ref => access === 'pinned' ? Boolean(ref.commit) : !ref.commit)) return false;
    } else if (access === 'unknown') {
      if (entry.kind === 'resource' ? entry.license.status !== 'unknown' : source.license.status !== 'unknown') return false;
    } else if (access === 'stale') {
      if (!source.stale && freshness(source.observation?.last_success_at ?? source.observed_at,referenceTime) === 'fresh') return false;
    } else if (access) return false;
    for (const [key,metric] of [['min_stars',source.github_metrics?.stars],['min_forks',source.github_metrics?.forks]] as const) if (params.has(key)) { const value = metricValue(metric,referenceTime,includeStale); if (value === undefined || value < Number(params.get(key))) return false; }
    const commit = sourceCommit(source,referenceTime);
    if (params.get('source_date') === 'unknown' ? commit !== undefined : !dayRange(commit,params,'source')) return false;
    return !params.has('observation') || observationStatus(source.observation,referenceTime) === params.get('observation');
  });
}
export function matchesDiscovery(entry: Entry, catalog: CatalogData, filters: DiscoveryFilters): boolean {
  if (filters.errors.length) return false;
  const { params, referenceTime, includeStale, scope } = filters;
  if (!catalogDateMatches(entry.catalog_dates?.first_published,params,'added') || !catalogDateMatches(entry.catalog_dates?.content_updated,params,'updated')) return false;
  if (scope === 'repository' && !isRepositoryKind(entry.kind) || scope === 'account' && !isAccountKind(entry.kind)) return false;
  const repoCriteria = repositoryKeys.some(key => params.has(key));
  const legacyCriteria = ['access','organization'].some(key => params.has(key));
  // Legacy version/membership filters cover explicit reference roles; these roles never lend GitHub popularity.
  if ((repoCriteria || legacyCriteria) && !matchingSources(entry,catalog,filters,!repoCriteria && !params.has('observation')).length) return false;
  const actor = actorFor(entry,catalog);
  if (params.has('min_followers')) { const value = metricValue(actor?.github_metrics?.followers,referenceTime,includeStale); if (value === undefined || value < Number(params.get('min_followers'))) return false; }
  if (params.has('observation')) return actor ? observationStatus(actor.observation,referenceTime) === params.get('observation') : matchingSources(entry,catalog,filters).length > 0;
  return true;
}
export function representativeSource(entry: Entry, catalog: CatalogData, filters: DiscoveryFilters): SourceRepository | undefined {
  const sources = matchingSources(entry,catalog,filters), value = (source: SourceRepository) => filters.sort === 'source_activity' ? sourceCommit(source,filters.referenceTime) ? Date.parse(sourceCommit(source,filters.referenceTime)!) : undefined : metricValue(source.github_metrics?.stars,filters.referenceTime,filters.includeStale);
  return sources.sort((a,b) => compareOptional(value(a),value(b)) || a.id.localeCompare(b.id))[0];
}
function compareOptional(a: number | undefined, b: number | undefined) { return a === undefined ? b === undefined ? 0 : 1 : b === undefined ? -1 : b - a; }
export function compareDiscovery(a: Entry, b: Entry, catalog: CatalogData, filters: DiscoveryFilters, matches?: Map<string,number>): number {
  const { sort, referenceTime, includeStale } = filters;
  let rank = 0;
  if (sort === 'added' || sort === 'catalog_updated') {
    const field = sort === 'added' ? 'first_published' : 'content_updated', left = a.catalog_dates?.[field], right = b.catalog_dates?.[field];
    const tier = (date?: CatalogDate) => date?.value && date.basis === 'exact' ? 0 : date?.value && date.basis === 'observed_bound' ? 1 : 2;
    rank = tier(left) - tier(right) || compareOptional(left?.value ? Date.parse(left.value) : undefined,right?.value ? Date.parse(right.value) : undefined);
  } else if (sort === 'stars' || sort === 'source_activity') {
    const value = (entry: Entry) => { const source = representativeSource(entry,catalog,filters); return source ? sort === 'stars' ? metricValue(source.github_metrics?.stars,referenceTime,includeStale) : sourceCommit(source,referenceTime) ? Date.parse(sourceCommit(source,referenceTime)!) : undefined : undefined; };
    rank = compareOptional(value(a),value(b));
  } else if (sort === 'followers') rank = compareOptional(metricValue(actorFor(a,catalog)?.github_metrics?.followers,referenceTime,includeStale),metricValue(actorFor(b,catalog)?.github_metrics?.followers,referenceTime,includeStale));
  else if (sort === 'updated') rank = b.updated_at.localeCompare(a.updated_at);
  else if (sort === 'title') rank = a.title.localeCompare(b.title);
  else if (matches) rank = (matches.get(a.id) ?? Infinity) - (matches.get(b.id) ?? Infinity);
  else rank = a.title.localeCompare(b.title);
  return rank || a.id.localeCompare(b.id);
}
