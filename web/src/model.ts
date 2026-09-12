import { emptyCatalog, type CatalogData, type CatalogEntity, type Project, type Resource, type SourceRepository, type Organization, type Collection, type Actor, type Tombstone } from '../../spec/types.js';
export interface SiteData { snapshot_id: string; generated_at: string; catalog: CatalogData; totals?: Record<keyof CatalogData, number> }
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
export function tombstoneRouteFor(record: Tombstone): string {
  const section = { source: 'sources', project: 'projects', resource: 'capabilities', actor: 'organizations', collection: 'collections' }[record.id.split(':')[0]];
  return `/${section ?? 'entries'}/${record.id.replaceAll(':', '~')}/`;
}
export function tombstoneRoutesFor(record: Tombstone): string[] {
  return record.id.startsWith('actor:') ? [tombstoneRouteFor(record), `/researchers/${record.id.replaceAll(':', '~')}/`] : [tombstoneRouteFor(record)];
}
/** Detail HTML carries its display subgraph, never a duplicate of the complete directory. */
export function pageDataForRoute(data: SiteData, path: string): SiteData {
  if (['/explore/','/projects/','/capabilities/','/organizations/','/researchers/','/collections/','/sources/','/submit/'].includes(path)) return data;
  const all = allEntries(data.catalog);
  const focus = all.find(entry => routeFor(entry) === path);
  const selected = new Set<string>();
  if (path === '/') { data.catalog.projects.slice(0,3).forEach(row => selected.add(row.id)); data.catalog.resources.slice(0,3).forEach(row => selected.add(row.id)); }
  if (focus) {
    selected.add(focus.id);
    if (focus.kind === 'project' || focus.kind === 'organization') focus.resource_ids.forEach(id => selected.add(id));
    if (focus.kind === 'resource') focus.project_ids.forEach(id => selected.add(id));
    if (focus.kind === 'collection') focus.item_ids.forEach(id => selected.add(id));
    if (focus.kind === 'organization') data.catalog.projects.filter(row => row.source_refs.some(ref => focus.source_ids.includes(ref.source_id))).forEach(row => selected.add(row.id));
  }
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
  catalog.organizations = data.catalog.organizations.filter(row => selected.has(row.id));
  catalog.collections = data.catalog.collections.filter(row => selected.has(row.id));
  catalog.claims = data.catalog.claims.filter(row => selected.has(row.subject_id));
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
  return { ...data, catalog, totals };
}
export function displayDate(value: string): string { return new Date(value).toISOString().slice(0, 10); }
export function provenanceLabel(entry: CatalogEntity, field = 'description'): string {
  const roles = [...new Set(entry.provenance[field]?.map(item => item.role) ?? [])];
  return roles.includes('github') ? 'From the source repository' : roles.includes('maintainer') ? 'Maintainer statement' : roles.includes('editor') ? 'Catalog editorial description' : 'Description not supplied';
}
