import { emptyCatalog, type CatalogData, type CatalogEntity, type Project, type Resource, type SourceRepository, type Organization, type Collection, type Actor, type Tombstone } from '../../spec/types.js';
export interface SiteData { snapshot_id: string; generated_at: string; catalog: CatalogData; totals?: Record<keyof CatalogData, number>; related_totals?: Record<string, number>; researcher_total?: number; membership_counts?: Record<string, { projects: number; resources: number }> }
export type Entry = SourceRepository | Project | Resource | Organization | Collection | Actor;
export function routeFor(entry: Entry): string {
  const section = { source_repository: 'sources', project: 'projects', resource: 'capabilities', organization: 'organizations', collection: 'collections', actor: 'researchers' }[entry.kind];
  return `/${section}/${entry.id.replaceAll(':', '~')}/`;
}
export function sourceFor(entry: Entry, catalog: CatalogData): SourceRepository | undefined {
  if (entry.kind === 'source_repository') return entry;
  if (entry.kind === 'project' || entry.kind === 'resource') return catalog.sources.find(source => source.id === entry.source_refs[0]?.source_id);
  if (entry.kind === 'organization') return catalog.sources.find(source => entry.source_ids.includes(source.id));
  return undefined;
}
export function allEntries(catalog: CatalogData): Entry[] { return [...catalog.projects, ...catalog.resources, ...catalog.organizations, ...catalog.collections, ...catalog.sources, ...catalog.actors.filter(actor => actor.account_type === 'user')]; }
export const RELATED_PREVIEW_LIMIT = 20;
export const SHARED_CATALOG_ROUTES = ['/explore/','/projects/','/capabilities/','/organizations/','/researchers/','/collections/','/sources/','/submit/','/join/','/me/','/review/','/contribute/','/community/'];
export function isSharedCatalogRoute(path: string): boolean {
  const raw = path.split('?')[0] ?? '/';
  const pathname = raw.endsWith('/') || raw === '/' ? raw : `${raw}/`;
  if (SHARED_CATALOG_ROUTES.includes(pathname)) return true;
  const paged = pathname.match(/^\/(?:explore|projects|capabilities|organizations|researchers|collections|sources)\/page\/([1-9]\d{0,6})\/$/);
  return Boolean(paged && Number(paged[1]) > 1);
}
/** The same membership rule drives a detail preview and its View all directory filter. */
export function relatedEntriesFor(entry: Organization | Collection, catalog: CatalogData): Entry[] {
  if (entry.kind === 'collection') {
    const entries = new Map(allEntries(catalog).map(row => [row.id, row]));
    return entry.item_ids.map(id => entries.get(id)).filter((row): row is Entry => Boolean(row));
  }
  const sources = new Set(entry.source_ids), resources = new Set(entry.resource_ids);
  return [...catalog.projects.filter(row => row.source_refs.some(ref => sources.has(ref.source_id))), ...catalog.resources.filter(row => resources.has(row.id))];
}
export function tombstoneRouteFor(record: Tombstone): string {
  const section = { source: 'sources', project: 'projects', resource: 'capabilities', actor: 'organizations', collection: 'collections' }[record.id.split(':')[0]];
  return `/${section ?? 'entries'}/${record.id.replaceAll(':', '~')}/`;
}
export function tombstoneRoutesFor(record: Tombstone): string[] {
  return record.id.startsWith('actor:') ? [tombstoneRouteFor(record), `/researchers/${record.id.replaceAll(':', '~')}/`] : [tombstoneRouteFor(record)];
}
/** Detail HTML carries its display subgraph, never a duplicate of the complete directory. */
export function pageDataForRoute(data: SiteData, path: string): SiteData {
  if (isSharedCatalogRoute(path)) return data;
  const all = allEntries(data.catalog);
  const focus = all.find(entry => routeFor(entry) === path);
  const selected = new Set<string>();
  let preview: Entry[] | undefined;
  const relatedTotals: Record<string, number> = {};
  const membershipCounts: Record<string, {projects: number; resources: number}> = {};
  if (focus?.kind === 'actor' || focus?.kind === 'organization') {
    const actorId = focus.kind === 'actor' ? focus.id : focus.actor_id;
    const sourceIds = new Set(data.catalog.sources.filter(source => source.owner_id === actorId).map(source => source.id));
    membershipCounts[focus.id] = { projects: new Set(data.catalog.projects.filter(row => row.source_refs.some(ref => sourceIds.has(ref.source_id))).map(row => row.id)).size, resources: new Set(data.catalog.resources.filter(row => row.source_refs.some(ref => sourceIds.has(ref.source_id))).map(row => row.id)).size };
  }
  if (path === '/') {
    data.catalog.projects.slice(0,3).forEach(row => selected.add(row.id));
    data.catalog.resources.slice(0,4).forEach(row => selected.add(row.id));
    data.catalog.organizations.slice(0,3).forEach(row => selected.add(row.id));
  }
  if (focus) {
    selected.add(focus.id);
    if (focus.kind === 'project') focus.resource_ids.forEach(id => selected.add(id));
    if (focus.kind === 'resource') focus.project_ids.forEach(id => selected.add(id));
    if (focus.kind === 'organization' || focus.kind === 'collection') {
      const related = relatedEntriesFor(focus, data.catalog);
      relatedTotals[focus.id] = related.length;
      preview = related.slice(0, RELATED_PREVIEW_LIMIT);
      preview.forEach(row => selected.add(row.id));
    }
  }
  const relations = focus ? data.catalog.relations.filter(row => row.from_id === focus.id || row.to_id === focus.id) : path === '/' ? data.catalog.relations.slice(0,2) : [];
  for (const relation of relations) { selected.add(relation.from_id); selected.add(relation.to_id); }
  const catalog = emptyCatalog();
  const sourceIds = new Set<string>();
  for (const entry of all.filter(row => selected.has(row.id))) {
    if ('source_refs' in entry) entry.source_refs.forEach(ref => sourceIds.add(ref.source_id));
    if (entry.kind === 'source_repository') sourceIds.add(entry.id);
    if (entry.kind === 'organization') entry.source_ids.forEach(id => sourceIds.add(id));
    if (entry.kind === 'actor') data.catalog.sources.filter(row => row.owner_id === entry.id).forEach(row => sourceIds.add(row.id));
  }
  catalog.sources = data.catalog.sources.filter(row => sourceIds.has(row.id));
  const ownerIds = new Set(catalog.sources.map(row => row.owner_id));
  catalog.actors = data.catalog.actors.filter(row => ownerIds.has(row.id) || selected.has(row.id));
  catalog.projects = data.catalog.projects.filter(row => selected.has(row.id));
  catalog.resources = data.catalog.resources.filter(row => selected.has(row.id));
  catalog.organizations = data.catalog.organizations.filter(row => selected.has(row.id)).map(row => row.id === focus?.id && preview ? { ...row, resource_ids: preview.filter(item => item.kind === 'resource').map(item => item.id) } : row);
  catalog.collections = data.catalog.collections.filter(row => selected.has(row.id)).map(row => row.id === focus?.id && preview ? { ...row, item_ids: preview.map(item => item.id) } : row);
  catalog.claims = data.catalog.claims.filter(row => selected.has(row.subject_id));
  catalog.relations = relations;
  catalog.tombstones = data.catalog.tombstones.filter(row => tombstoneRoutesFor(row).includes(path));
  // Keep names/routes needed to resolve a public replacement, without retaining withdrawn records.
  for (const tombstone of catalog.tombstones) if (tombstone.replacement_id) {
    const replacement = all.find(row => row.id === tombstone.replacement_id);
    if (replacement) for (const key of ['projects','resources','sources','organizations','collections','actors'] as const) {
      const rows = data.catalog[key] as Entry[];
      if (rows.some(row => row.id === replacement.id)) (catalog[key] as Entry[]).push(replacement);
    }
  }
  const totals = Object.fromEntries(Object.entries(data.catalog).map(([key,rows]) => [key,rows.length])) as Record<keyof CatalogData,number>;
  return { ...data, catalog, totals, membership_counts: membershipCounts, researcher_total: data.catalog.actors.filter(row => row.account_type === 'user').length, ...(preview ? { related_totals: relatedTotals } : {}) };
}
export function displayDate(value: string): string { return new Date(value).toISOString().slice(0, 10); }
export function provenanceLabel(entry: CatalogEntity, field = 'description'): string {
  const roles = [...new Set(entry.provenance[field]?.map(item => item.role) ?? [])];
  return roles.includes('github') ? 'From the source repository' : roles.includes('maintainer') ? 'Maintainer statement' : roles.includes('editor') ? 'Catalog editorial description' : roles.includes('community') ? 'Community-supplied description' : 'Description not supplied';
}
