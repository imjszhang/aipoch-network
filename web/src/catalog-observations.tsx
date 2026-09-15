import React, { createContext, useContext, useEffect, useState } from 'react';
import type { CatalogData, CatalogDate, MetricObservation, SourceRepository } from '../../spec/types.js';
import { actorFor, freshness, metricValue, parseDiscovery, representativeSource, sourceCommit, type DiscoveryFilters } from './discovery.js';
import { displayDate, type Entry } from './model.js';

const ReferenceTime = createContext(0);
/** Hydrates from the artifact, then captures one browser time for this page session. */
export function ObservationClock({ generatedAt, children }: { generatedAt: string; children: React.ReactNode }) {
  const [time, setTime] = useState(Date.parse(generatedAt));
  useEffect(() => { setTime(Date.now()); }, []);
  return <ReferenceTime.Provider value={time}>{children}</ReferenceTime.Provider>;
}
export const useObservationTime = () => useContext(ReferenceTime);
export function DateFact({ date, updated = false }: { date?: CatalogDate; updated?: boolean }) {
  const label = date?.basis === 'observed_bound' ? updated ? 'Change observed by' : 'Listed by' : updated ? 'Catalog updated' : 'Added';
  return <span className="catalog-date" title={date?.evidence ? `Evidence: ${date.evidence}` : 'A verified publication or content date is not available.'}>{label} {date?.value && date.basis !== 'unknown' ? <time dateTime={date.value}>{displayDate(date.value)}</time> : 'unknown'}</span>;
}
export function CatalogDateFacts({ entry }: { entry: Entry }) { return <div className="catalog-date-facts"><DateFact date={entry.catalog_dates?.first_published}/><DateFact date={entry.catalog_dates?.content_updated} updated/></div>; }
export function MetricFact({ metric, label, compact = true }: { metric?: MetricObservation; label: string; compact?: boolean }) {
  const now = useObservationTime(), value = metricValue(metric,now,true), status = freshness(metric?.observed_at,now);
  const exact = value === undefined ? undefined : new Intl.NumberFormat('en-US').format(value);
  return <span className="metric-fact" title={value === undefined ? metric?.result === 'unsupported' ? 'Not supported by the public source' : 'No usable public observation' : `${exact} ${label.toLowerCase()}, publicly reported by GitHub; observed ${metric!.observed_at}${status === 'stale' ? '; stale' : ''}${metric?.result !== 'ok' ? `; latest attempt ${metric?.result.replaceAll('_',' ')}` : ''}`}>
    {label} <b aria-label={exact}>{value === undefined ? metric?.result === 'unsupported' ? 'unsupported' : 'unknown' : compact ? new Intl.NumberFormat('en-US',{ notation:'compact',maximumFractionDigits:1 }).format(value) : exact}</b>{status === 'stale' && value !== undefined && <span> · stale</span>}{metric?.observed_at && value !== undefined && !compact && <span> · checked <time dateTime={metric.observed_at}>{displayDate(metric.observed_at)}</time></span>}{metric && !compact && <span> · latest attempt {metric.last_attempt_at} ({metric.result.replaceAll('_',' ')})</span>}
  </span>;
}
export function RepositoryFacts({ source, activity = false }: { source?: SourceRepository; activity?: boolean }) {
  const now = useObservationTime(), committedAt = source && sourceCommit(source,now);
  return <div className="catalog-metric-facts">{source ? <><span className="metric-attribution">GitHub · {source.title}</span><MetricFact metric={source.github_metrics?.stars} label="Stars"/><MetricFact metric={source.github_metrics?.forks} label="Forks"/>{activity && <span>Latest source commit {committedAt ? <time dateTime={committedAt}>{displayDate(committedAt)}</time> : 'unknown'}</span>}</> : <span>GitHub source metrics unknown</span>}</div>;
}
export function EntryFacts({ entry, catalog, filters }: { entry: Entry; catalog: CatalogData; filters?: DiscoveryFilters }) {
  const now = useObservationTime(), actor = actorFor(entry,catalog);
  const source = representativeSource(entry,catalog,filters ?? parseDiscovery(new URLSearchParams(),'all',new Date(now).toISOString()));
  return <><CatalogDateFacts entry={entry}/>{actor ? <div className="catalog-metric-facts"><span>GitHub · @{actor.login}</span><MetricFact metric={actor.github_metrics?.followers} label="Public followers"/>{actor.github_metrics?.followers?.observed_at && metricValue(actor.github_metrics.followers,now,true) !== undefined && <span>Checked {displayDate(actor.github_metrics.followers.observed_at)}</span>}</div> : entry.kind === 'collection' ? <p className="catalog-member-count">{new Set(entry.item_ids).size} catalog entries</p> : <RepositoryFacts source={source} activity={filters?.sort === 'source_activity'}/>}</>;
}
export function AccountDetails({ entry, catalog, counts }: { entry: Entry; catalog: CatalogData; counts?: {projects:number;resources:number} }) {
  const actor = actorFor(entry,catalog);
  if (!actor) return null;
  const sourceIds = new Set(catalog.sources.filter(source => source.owner_id === actor.id).map(source => source.id));
  const projects = catalog.projects.filter(project => project.source_refs.some(ref => sourceIds.has(ref.source_id)));
  const resources = catalog.resources.filter(resource => resource.source_refs.some(ref => sourceIds.has(ref.source_id)));
  return <section className="panel article-section catalog-account-details"><h2>GitHub public profile</h2><p>These are GitHub’s publicly reported counts. Profile privacy can limit the reported values.</p><div className="catalog-metric-details"><MetricFact metric={actor.github_metrics?.followers} label="Public followers" compact={false}/>{actor.account_type === 'user' && <MetricFact metric={actor.github_metrics?.following} label="Public following" compact={false}/>}<MetricFact metric={actor.github_metrics?.public_repositories} label="Public repositories on GitHub" compact={false}/></div><p>AIPOCH catalog: {counts?.projects ?? new Set(projects.map(row => row.id)).size} projects · {counts?.resources ?? new Set(resources.map(row => row.id)).size} capabilities.</p><p className="source-note">Last successful profile check: {actor.observation?.last_success_at ?? 'unknown'} · Latest attempt: {actor.observation?.last_attempt_at ?? 'unknown'} · {actor.observation?.result.replaceAll('_',' ') ?? 'not checked'}</p></section>;
}
