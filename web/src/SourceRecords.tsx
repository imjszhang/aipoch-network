import React from 'react';
import { ArrowUpRight, ExternalLink, GitBranch } from 'lucide-react';
import type { SourceRef, SourceRepository } from '../../spec/types.js';
import { MetricFact, useObservationTime } from './catalog-observations.js';
import { observationStatus, sourceCommit } from './discovery.js';
import { displayDate } from './model.js';

export function SourceRecords({ refs, sources }: { refs: SourceRef[]; sources: SourceRepository[] }) {
  const referenceTime = useObservationTime();
  return <>{refs.map((ref, index) => {
    const source = sources.find(row => row.id === ref.source_id);
    if (!source) return <p key={`${ref.source_id}-${index}`}>Source reference unavailable: {ref.source_id}</p>;
    const activity = source.source_activity?.default_branch_head;
    const committedAt = sourceCommit(source, referenceTime);
    const revision = ref.commit ?? ref.ref;
    const location = revision ? `${source.canonical_url}/tree/${encodeURIComponent(revision)}${ref.path ? `/${ref.path.split('/').map(encodeURIComponent).join('/')}` : ''}` : undefined;
    return <div className="source-record" key={`${ref.source_id}-${ref.role}-${ref.path ?? ''}-${index}`}>
      <a href={source.canonical_url}><GitBranch size={18}/>{source.title}<ExternalLink size={15}/></a>
      <dl>
        <dt>Reference role</dt><dd>{ref.role}</dd>
        <dt>Last successful public check</dt><dd>{source.observation?.last_success_at ?? source.observed_at}</dd><dt>Latest public check attempt</dt><dd>{source.observation?.last_attempt_at ?? 'unknown'} · {source.observation?.result.replaceAll('_', ' ') ?? source.availability.replaceAll('_', ' ')}</dd><dt>GitHub metrics</dt><dd><MetricFact metric={source.github_metrics?.stars} label="Stars" compact={false}/><br/><MetricFact metric={source.github_metrics?.forks} label="Forks" compact={false}/></dd><dt>Latest default-branch commit</dt><dd>{committedAt ? <time dateTime={committedAt}>{committedAt}</time> : `Unknown${activity?.date_status === 'future' || activity?.date_status === 'invalid' ? ' (source date could not be verified)' : ''}`}{activity && <><br/><a href={`${source.canonical_url}/commit/${activity.sha}`}><code>{activity.sha}</code></a><br/>Observed {activity.observed_at}</>}</dd>
        <dt>Source activity check</dt><dd>{observationStatus(source.source_activity?.observation, referenceTime)} · last successful check {source.source_activity?.observation?.last_success_at ?? 'unknown'} · latest attempt {source.source_activity?.observation?.last_attempt_at ?? 'unknown'} ({source.source_activity?.observation?.result.replaceAll('_', ' ') ?? 'not checked'})</dd>
        <dt>Source status</dt><dd>{source.archived ? 'Archived' : 'Active at last observation'}</dd>
        <dt>License</dt><dd>{source.license.status === 'identified' ? <a href={source.license.url}>{source.license.spdx_id ?? source.license.name}</a> : 'Unknown — check the source terms'}</dd>
        <dt>Fixed commit</dt><dd>{ref.commit ? <a href={`${source.canonical_url}/tree/${ref.commit}`}><code>{ref.commit}</code> <ArrowUpRight size={13}/></a> : 'Not available'}</dd>
        {ref.ref && <><dt>Named reference</dt><dd>{ref.ref}{!ref.commit && ' · mutable'}</dd></>}
        {ref.path && <><dt>Source path</dt><dd>{location ? <a href={location}><code>{ref.path}</code> <ArrowUpRight size={13}/></a> : <code>{ref.path}</code>}</dd></>}
        {ref.resolved_at && <><dt>Reference checked</dt><dd>{displayDate(ref.resolved_at)}</dd></>}
        {ref.sha256 && <><dt>Content SHA-256</dt><dd><code>{ref.sha256}</code></dd></>}
      </dl>
      {ref.commit && source.license.status === 'identified' && <a className="text-button" href={`${source.canonical_url}/archive/${ref.commit}.zip`}>Download source at this commit <ArrowUpRight size={15}/></a>}
      <p className="muted">Default-branch activity is separate from the fixed reference above. Source terms apply. A fixed commit identifies content; it does not establish scientific validity.</p>
    </div>;
  })}</>;
}
