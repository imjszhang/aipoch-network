import { actorId, entityId, normalizeGitHubUrl, sourceId } from '../spec/identity.js';
import { emptyCatalog, type CatalogData, type Claim, type SourceRef, type Provenance, type SourceRepository } from '../spec/types.js';
import type { SourceSnapshot } from './github.js';
import { type Registry, type RegistryAttribution, type RegistrySourceRef, parseOrganizationCurationScope, validateRegistry } from './registry.js';

export interface SnapshotBatch { as_of: string; sources: SourceSnapshot[] }
export interface NormalizedCatalog { catalog: CatalogData; diagnostics: { id: string; message: string }[]; generated_at: string }
export function normalize(registry: Registry, batch: SnapshotBatch): NormalizedCatalog {
  const errors = validateRegistry(registry);
  if (errors.length) throw new Error(errors.join('\n'));
  if (!Number.isFinite(Date.parse(batch.as_of))) throw new Error('Invalid snapshot batch time');
  const catalog = emptyCatalog();
  const diagnostics: NormalizedCatalog['diagnostics'] = [];
  const sourceByUrl = new Map<string, SourceRepository>();
  const blocked = new Set(registry.withdrawals.map(item => item.id));
  // A suppression applies to identity, including every old URL alias in this batch.
  const registeredUrls = new Set(registry.sources.map(entry => normalizeGitHubUrl(entry.url).canonical_url));
  for (const observation of batch.sources) {
    if (registeredUrls.has(normalizeGitHubUrl(observation.requested_url).canonical_url) && observation.repository
      && (blocked.has(actorId(observation.repository.owner.id)) || observation.suppressed || observation.availability === 'private' || observation.availability === 'deleted')) blocked.add(sourceId(observation.repository.id));
  }
  const at = batch.as_of;
  const tombstone = (id: string, reason: 'withdrawn' | 'unavailable' = 'unavailable') => {
    if (!catalog.tombstones.some(row => row.id === id)) catalog.tombstones.push({ kind: 'tombstone', id, status: 'withdrawn', withdrawn_at: at, reason });
  };
  for (const withdrawal of registry.withdrawals) catalog.tombstones.push({ kind: 'tombstone', ...withdrawal, status: withdrawal.replacement_id ? 'superseded' : 'withdrawn' });
  for (const entry of registry.sources) {
    const url = normalizeGitHubUrl(entry.url).canonical_url;
    const snapshot = batch.sources.find(row => normalizeGitHubUrl(row.requested_url).canonical_url === url);
    if (!snapshot?.repository || !snapshot.observed_at) { diagnostics.push({ id: url, message: 'No verified public observation; remains a candidate.' }); continue; }
    const repo = snapshot.repository;
    const id = sourceId(repo.id);
    const owner_id = actorId(repo.owner.id);
    // Actor withdrawal removes owned source content before any title, URL, provenance,
    // license or organization projection can reintroduce the withdrawn identity.
    if (blocked.has(id) || blocked.has(owner_id) || snapshot.suppressed || snapshot.availability === 'private' || snapshot.availability === 'deleted') { tombstone(id); blocked.add(id); continue; }
    const age = Date.parse(at) - Date.parse(snapshot.observed_at);
    const expired = age > 7 * 24 * 60 * 60 * 1000;
    const evidence: Provenance = { role: 'github', url: repo.html_url, source_id: id, observed_at: snapshot.observed_at, review: 'reviewed', ...(repo.commit ? { commit: repo.commit } : {}) };
    const collaboration = !expired && (repo.has_issues === true || repo.has_discussions === true) ? {
      ...(repo.has_issues === true ? { issues_url: `${repo.html_url}/issues` } : {}),
      ...(repo.has_discussions === true ? { discussions_url: `${repo.html_url}/discussions` } : {}),
    } : undefined;
    const source: SourceRepository = {
      kind: 'source_repository', id, title: expired ? 'Source awaiting public check' : repo.full_name,
      ...(repo.description && !expired ? { description: repo.description } : {}), status: 'listed', updated_at: repo.updated_at,
      provider: 'github', provider_id: repo.id, canonical_url: repo.html_url, owner_id,
      ...(!expired ? { default_branch: repo.default_branch } : {}), availability: snapshot.availability,
      archived: repo.archived, observed_at: snapshot.observed_at, stale: age > 48 * 60 * 60 * 1000 || snapshot.availability !== 'accessible',
      license: repo.license && !expired ? { status: 'identified', ...repo.license } : { status: 'unknown' },
      aliases: url.toLowerCase() !== repo.html_url.toLowerCase() ? [{ url, verified_at: snapshot.observed_at, provider_id: repo.id }] : [],
      provenance: { title: [evidence], canonical_url: [evidence], ...(repo.description && !expired ? { description: [evidence] } : {}), license: [evidence], ...(collaboration ? { collaboration: [evidence] } : {}) },
      ...(collaboration ? { collaboration } : {}),
      ...(!expired ? { topics: repo.topics, language: repo.language, homepage: repo.homepage, readme: repo.readme, latest_commit: repo.commit } : {}),
    };
    const existing = catalog.sources.find(row => row.id === id);
    if (!existing) catalog.sources.push(source);
    else { existing.aliases = [...new Map([...existing.aliases, ...source.aliases].map(alias => [alias.url, alias])).values()]; }
    sourceByUrl.set(url, existing ?? source);
    if (!catalog.actors.some(row => row.id === owner_id)) catalog.actors.push({ kind: 'actor', id: owner_id, title: repo.owner.login, status: 'listed', updated_at: snapshot.observed_at,
      provider: 'github', provider_id: repo.owner.id, account_type: repo.owner.type === 'Organization' ? 'organization' : 'user', login: repo.owner.login,
      canonical_url: repo.owner.html_url, aliases: [], provenance: { title: [{ ...evidence, url: repo.owner.html_url }] } });
    if (expired) { blocked.add(id); diagnostics.push({ id, message: 'Public observation is over 7 days old; harvested content withheld.' }); }
    if (snapshot.error) diagnostics.push({ id, message: `Refresh state: ${snapshot.error}` });
  }
  for (const actor of registry.actors ?? []) {
    if (blocked.has(actor.id)) continue;
    // An actual source observation owns current identity metadata. A supplemental
    // record provides independent contributors, never overwrites a newer owner.
    if (catalog.actors.some(row => row.id === actor.id)) continue;
    if (Object.values(actor.provenance).flat().some(item => Date.parse(item.observed_at) > Date.parse(at))) {
      diagnostics.push({ id: actor.id, message: 'Supplemental public identity observation is not effective at this snapshot time.' });
      continue;
    }
    catalog.actors.push(structuredClone(actor));
  }
  function refs(urls: string[], declared?: RegistrySourceRef[], recordId?: string): SourceRef[] | undefined {
    const sources = urls.map(url => sourceByUrl.get(normalizeGitHubUrl(url).canonical_url));
    if (sources.some(source => !source || blocked.has(source.id))) return undefined;
    if (declared) {
      const references: SourceRef[] = [];
      for (const locator of declared) {
        const source = sourceByUrl.get(normalizeGitHubUrl(locator.source_url).canonical_url)!;
        if (locator.source_id && locator.source_id !== source.id) {
          diagnostics.push({ id: recordId ?? source.id, message: 'Declared source identity no longer matches the observed repository; fixed reference withheld for review.' });
          return undefined;
        }
        const { source_url: _sourceUrl, source_id: _expectedSourceId, ...location } = locator;
        const version = locator.commit ?? locator.ref;
        const href = version ? `${source.canonical_url}/${locator.path ? 'blob' : 'tree'}/${encodeURIComponent(version)}${locator.path ? `/${locator.path.split('/').map(encodeURIComponent).join('/')}` : ''}` : source.canonical_url;
        references.push({ ...structuredClone(location), source_id: source.id, url: href });
      }
      return [...new Map(references.map(ref => [JSON.stringify([ref.source_id, ref.role, ref.path, ref.commit, ref.ref, ref.sha256, ref.resolved_at]), ref])).values()];
    }
    return [...new Map(sources.map(source => [source!.id, source!])).values()].map((source) => ({ source_id: source.id, role: 'primary' as const, url: source.canonical_url,
      ...(source!.latest_commit ? { commit: source!.latest_commit, resolved_at: source!.observed_at } : {}) }));
  }
  const editor = (source_refs: SourceRef[], attribution?: RegistryAttribution): Provenance[] => source_refs.map(ref => ({ role: attribution?.role ?? 'editor', url: attribution?.url ?? ref.url!, source_id: ref.source_id, observed_at: attribution?.observed_at ?? at, review: 'reviewed', scope: 'Catalog classification and summary; not maintainer acknowledgement.' }));
  const referenceProvenance = (source_refs: SourceRef[], declared?: RegistrySourceRef[], attribution?: RegistryAttribution): Provenance[] => declared
    ? editor(source_refs, attribution).map((evidence, index) => ({ ...evidence, ...(source_refs[index].commit ? { commit: source_refs[index].commit } : {}), ...(source_refs[index].path ? { path: source_refs[index].path } : {}), scope: 'Catalog-declared content location; the declaration is reviewed, but file availability, checksum and execution are not verified by this pipeline.' }))
    : source_refs.flatMap(ref => catalog.sources.find(source => source.id === ref.source_id)?.provenance.canonical_url ?? []);
  for (const entry of registry.resources) {
    const id = entityId('resource', entry.key);
    const source_refs = refs(entry.sources, entry.source_refs, id);
    if (blocked.has(id) || !source_refs) { tombstone(id); continue; }
    const first = catalog.sources.find(source => source.id === source_refs[0].source_id)!;
    const fixed = Boolean(entry.source_refs?.some(ref => ref.commit));
    const description = entry.description ?? (!fixed ? first.description : undefined);
    const licenses = source_refs.map(ref => catalog.sources.find(source => source.id === ref.source_id)!.license);
    const license = fixed ? { status: 'unknown' as const } : licenses.every(row => row.status === 'identified' && row.spdx_id === licenses[0].spdx_id) ? licenses[0] : { status: licenses.every(row => row.status === 'unknown') ? 'unknown' as const : 'conflicting' as const };
    const documentation_url = entry.documentation_url ?? (!fixed ? first.homepage : undefined);
    catalog.resources.push({ kind: 'resource', id, title: entry.title, ...(description ? { description } : {}), status: 'listed', updated_at: at,
      resource_type: entry.type, domains: entry.domains, source_refs, project_ids: [], license,
      ...(documentation_url ? { documentation_url } : {}), ...(entry.download_url ? { download_url: entry.download_url } : {}),
      ...(entry.inputs ? { inputs: entry.inputs } : {}), ...(entry.outputs ? { outputs: entry.outputs } : {}),
      ...(entry.conditions ? { conditions: entry.conditions } : {}), runtime: entry.runtime ? structuredClone(entry.runtime) : { status: 'not_described' },
      provenance: { title: editor(source_refs, entry.attribution), ...(description ? { description: entry.description ? editor(source_refs, entry.attribution) : first.provenance.description ?? editor(source_refs, entry.attribution) } : {}), resource_type: editor(source_refs, entry.attribution), domains: editor(source_refs, entry.attribution), source_refs: referenceProvenance(source_refs, entry.source_refs, entry.attribution),
        ...(entry.inputs ? { inputs: editor(source_refs, entry.attribution) } : {}), ...(entry.outputs ? { outputs: editor(source_refs, entry.attribution) } : {}), ...(entry.conditions ? { conditions: editor(source_refs, entry.attribution) } : {}), ...(entry.runtime ? { runtime: editor(source_refs, entry.attribution) } : {}),
        ...(entry.download_url ? { download_url: editor(source_refs, entry.attribution) } : {}), ...(entry.documentation_url ? { documentation_url: editor(source_refs, entry.attribution) } : {}), ...(!fixed ? { license: first.provenance.license } : {}) } });
  }
  for (const entry of registry.projects) {
    const id = entityId('project', entry.key);
    const source_refs = refs(entry.sources, entry.source_refs, id);
    if (blocked.has(id) || !source_refs) { tombstone(id); continue; }
    const resource_ids = entry.resources.map(key => entityId('resource', key)).filter(id => catalog.resources.some(row => row.id === id));
    const first = catalog.sources.find(source => source.id === source_refs[0].source_id)!;
    const description = entry.description ?? (!entry.source_refs?.some(ref => ref.commit) ? first.description : undefined);
    catalog.projects.push({ kind: 'project', id, title: entry.title, ...(description ? { description } : {}), status: 'listed', updated_at: at,
      domains: entry.domains, source_refs, resource_ids, provenance: { title: editor(source_refs, entry.attribution), ...(description ? { description: entry.description ? editor(source_refs, entry.attribution) : first.provenance.description ?? editor(source_refs, entry.attribution) } : {}), domains: editor(source_refs, entry.attribution), source_refs: referenceProvenance(source_refs, entry.source_refs, entry.attribution) } });
    for (const resource of catalog.resources) if (resource_ids.includes(resource.id)) resource.project_ids.push(id);
  }
  for (const actor of catalog.actors.filter(actor => actor.account_type === 'organization')) {
    const source_ids = catalog.sources.filter(source => source.owner_id === actor.id).map(source => source.id);
    catalog.organizations.push({ kind: 'organization', id: actor.id, actor_id: actor.id, title: actor.title, status: 'listed', updated_at: at,
      source_ids, resource_ids: catalog.resources.filter(resource => resource.source_refs.some(ref => source_ids.includes(ref.source_id))).map(resource => resource.id),
      participation: 'community_indexed', provenance: actor.provenance });
  }
  const available = new Set([...catalog.sources, ...catalog.actors, ...catalog.projects, ...catalog.resources].map(row => row.id));
  const collectionById = new Map(registry.collections.map(entry => [entityId('collection', entry.key), entry]));
  const unresolved = new Map<string, number>();
  const parents = new Map<string, string[]>();
  for (const [id, entry] of collectionById) {
    const childIds = entry.item_ids.filter(itemId => collectionById.has(itemId));
    unresolved.set(id, childIds.length);
    for (const childId of childIds) parents.set(childId, [...(parents.get(childId) ?? []), id]);
  }
  // Registry validation has rejected cycles. Resolve child collections first so a
  // parent never loses a valid child merely because of registry array ordering.
  const ready = [...unresolved.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const id = ready[cursor];
    const entry = collectionById.get(id)!;
    const item_ids = entry.item_ids.filter(id => available.has(id));
    if (blocked.has(id) || !item_ids.length) tombstone(id);
    else {
      catalog.collections.push({ kind: 'collection', id, title: entry.title, ...(entry.description ? { description: entry.description } : {}), status: 'listed', updated_at: at,
        actor_ids: [], item_ids, selection_basis: entry.selection_basis, provenance: { title: [{ role: 'editor', url: 'https://github.com/imjszhang/aipoch-network', observed_at: at, review: 'reviewed' }],
          description: [{ role: 'editor', url: 'https://github.com/imjszhang/aipoch-network', observed_at: at, review: 'reviewed' }] } });
      available.add(id);
    }
    for (const parentId of parents.get(id) ?? []) {
      const remaining = unresolved.get(parentId)! - 1;
      unresolved.set(parentId, remaining);
      if (remaining === 0) ready.push(parentId);
    }
  }
  const publicRecords = new Set([...catalog.sources, ...catalog.actors, ...catalog.projects, ...catalog.resources, ...catalog.collections].map(row => row.id));
  const sourceRecords = new Map(catalog.sources.map(source => [source.id, source]));
  const actorRecords = new Map(catalog.actors.map(actor => [actor.id, actor]));
  const resourceRecords = new Map(catalog.resources.map(resource => [resource.id, resource]));
  for (const relation of registry.relations ?? []) {
    const references = [relation.from_id, relation.to_id, ...relation.evidence.flatMap(item => [item.source_id, item.actor_id].filter((id): id is string => Boolean(id)))];
    if (blocked.has(relation.id) || references.some(id => blocked.has(id) || !publicRecords.has(id))) {
      tombstone(relation.id);
      diagnostics.push({ id: relation.id, message: 'Relation withheld because an endpoint or public evidence is unavailable.' });
      continue;
    }
    if ([relation.recorded_at, ...relation.evidence.map(item => item.observed_at)].some(value => Date.parse(value) > Date.parse(at))) {
      diagnostics.push({ id: relation.id, message: 'Relation evidence is not effective at this snapshot time.' });
      continue;
    }
    catalog.relations.push(structuredClone(relation));
  }
  function evidenceRepositoryUrl(value: string): string | undefined {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'github.com' && parts.length >= 2 && parts[0] !== 'orgs') return `https://github.com/${parts[0]}/${parts[1]}`.toLowerCase();
    if (url.hostname === 'api.github.com' && parts[0] === 'repos' && parts.length >= 3) return `https://github.com/${parts[1]}/${parts[2]}`.toLowerCase();
    return undefined;
  }
  function evidenceActorUrl(value: string): string | undefined {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'github.com' && parts.length === 1) return `https://github.com/${parts[0]}`.toLowerCase();
    if (['github.com', 'api.github.com'].includes(url.hostname) && ['orgs', 'users'].includes(parts[0]) && parts[1]) return `https://github.com/${parts[1]}`.toLowerCase();
    return undefined;
  }
  function scopeSources(claim: Claim): string[] {
    const ids = new Set<string>();
    if (claim.subject_id.startsWith('source:github:')) ids.add(claim.subject_id);
    if (claim.type === 'organization_curation') {
      for (const id of parseOrganizationCurationScope(claim.scope) ?? []) {
        if (id.startsWith('source:github:')) ids.add(id);
        else for (const ref of resourceRecords.get(id)?.source_refs ?? []) ids.add(ref.source_id);
      }
    }
    for (const evidence of claim.evidence) if (evidence.source_id) ids.add(evidence.source_id);
    return [...ids];
  }
  function identityChanged(claim: Claim): boolean {
    if (claim.recheck_on.includes('rename')) {
      for (const id of new Set([claim.actor_id, claim.subject_id, ...claim.evidence.flatMap(item => item.actor_id ? [item.actor_id] : [])])) {
        const actor = actorRecords.get(id);
        if (!actor) continue;
        const previous = (registry.actors ?? []).find(item => item.id === id);
        if (previous && previous.canonical_url.toLowerCase() !== actor.canonical_url.toLowerCase()) return true;
        if (actor.aliases.some(alias => Date.parse(alias.verified_at) > Date.parse(claim.verified_at ?? claim.recorded_at))) return true;
        if (claim.evidence.some(item => item.actor_id === id && evidenceActorUrl(item.url) && evidenceActorUrl(item.url) !== actor.canonical_url.toLowerCase())) return true;
      }
    }
    for (const id of scopeSources(claim)) {
      const source = sourceRecords.get(id);
      if (!source) continue;
      const current = source.canonical_url.toLowerCase();
      const former = [
        ...source.aliases.filter(alias => Date.parse(alias.verified_at) > Date.parse(claim.verified_at ?? claim.recorded_at)).map(alias => alias.url),
        ...claim.evidence.filter(item => item.source_id === id).map(item => evidenceRepositoryUrl(item.url)).filter((value): value is string => Boolean(value)),
      ];
      for (const url of former) {
        if (url.toLowerCase() === current) continue;
        const moved = new URL(url).pathname.split('/')[1]?.toLowerCase() !== new URL(current).pathname.split('/')[1]?.toLowerCase();
        if (claim.recheck_on.includes(moved ? 'transfer' : 'rename')) return true;
      }
    }
    return false;
  }
  for (const record of registry.claims ?? []) {
    const references = [record.subject_id, record.actor_id, ...(record.verified_by ? [record.verified_by] : []), ...record.evidence.flatMap(item => [item.source_id, item.actor_id].filter((id): id is string => Boolean(id)))];
    const scope = record.type === 'organization_curation' ? parseOrganizationCurationScope(record.scope)! : [];
    if (blocked.has(record.id) || [...references, ...scope].some(id => blocked.has(id) || !publicRecords.has(id))) {
      tombstone(record.id);
      diagnostics.push({ id: record.id, message: 'Claim withheld because a required public identity, scope or evidence is unavailable.' });
      continue;
    }
    if (record.type === 'organization_curation' && actorRecords.get(record.subject_id)?.account_type !== 'organization') {
      diagnostics.push({ id: record.id, message: 'Organization curation claim requires a public organization account.' });
      tombstone(record.id);
      continue;
    }
    if ([record.recorded_at, record.verified_at, ...record.evidence.map(item => item.observed_at)].some(value => value && Date.parse(value) > Date.parse(at))) {
      diagnostics.push({ id: record.id, message: 'Claim or evidence is not effective at this snapshot time.' });
      continue;
    }
    const claim = structuredClone(record);
    if (claim.status === 'verified') {
      if (claim.expires_at && Date.parse(claim.expires_at) <= Date.parse(at)) claim.status = 'expired';
      else if (claim.evidence.some(item => item.review === 'disputed')) claim.status = 'disputed';
      else if (claim.evidence.some(item => item.review === 'stale') || identityChanged(claim)) claim.status = 'unverified';
      if (claim.status !== 'verified') diagnostics.push({ id: claim.id, message: `Claim now ${claim.status}; renewed review is required before it can confer catalog authority.` });
    }
    if (claim.type === 'organization_curation' && claim.status === 'verified') {
      const sources = scopeSources(claim);
      if (!sources.length || sources.some(id => sourceRecords.get(id)?.owner_id !== claim.subject_id)) {
        claim.status = 'unverified';
        diagnostics.push({ id: claim.id, message: 'Organization curation scope no longer matches the current repository ownership.' });
      }
    }
    catalog.claims.push(claim);
  }
  for (const organization of catalog.organizations) {
    const claims = catalog.claims.filter(claim => claim.subject_id === organization.id && claim.type === 'organization_curation' && claim.status === 'verified');
    if (!claims.length) continue;
    const scope = new Set(claims.flatMap(claim => parseOrganizationCurationScope(claim.scope) ?? []));
    // The badge and object references cover exactly the reviewed selection; other
    // repositories belonging to this owner do not inherit active participation.
    organization.participation = 'actively_curated';
    organization.source_ids = [...scope].filter(id => id.startsWith('source:github:')).sort();
    organization.resource_ids = [...scope].filter(id => id.startsWith('resource:')).sort();
    organization.provenance = { ...organization.provenance, participation: claims.flatMap(claim => structuredClone(claim.evidence)) };
  }
  for (const rows of Object.values(catalog) as { id: string }[][]) rows.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return { catalog, diagnostics, generated_at: at };
}
