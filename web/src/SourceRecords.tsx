import React from 'react';
import { ArrowUpRight, ExternalLink, GitBranch } from 'lucide-react';
import type { SourceRef, SourceRepository } from '../../spec/types.js';
import { displayDate } from './model.js';

export function SourceRecords({ refs, sources }: { refs: SourceRef[]; sources: SourceRepository[] }) {
  return <>{refs.map((ref, index) => {
    const source = sources.find(row => row.id === ref.source_id);
    if (!source) return <p key={`${ref.source_id}-${index}`}>Source reference unavailable: {ref.source_id}</p>;
    const revision = ref.commit ?? ref.ref;
    const location = revision ? `${source.canonical_url}/tree/${encodeURIComponent(revision)}${ref.path ? `/${ref.path.split('/').map(encodeURIComponent).join('/')}` : ''}` : undefined;
    return <div className="source-record" key={`${ref.source_id}-${ref.role}-${ref.path ?? ''}-${index}`}>
      <a href={source.canonical_url}><GitBranch size={18}/>{source.title}<ExternalLink size={15}/></a>
      <dl>
        <dt>Reference role</dt><dd>{ref.role}</dd>
        <dt>Public check</dt><dd>{displayDate(source.observed_at)} · {source.stale ? 'Overdue' : source.availability.replaceAll('_', ' ')}</dd>
        <dt>Source status</dt><dd>{source.archived ? 'Archived' : 'Active at last observation'}</dd>
        <dt>License</dt><dd>{source.license.status === 'identified' ? <a href={source.license.url}>{source.license.spdx_id ?? source.license.name}</a> : 'Unknown — check the source terms'}</dd>
        <dt>Fixed commit</dt><dd>{ref.commit ? <a href={`${source.canonical_url}/tree/${ref.commit}`}><code>{ref.commit}</code> <ArrowUpRight size={13}/></a> : 'Not available'}</dd>
        {ref.ref && <><dt>Named reference</dt><dd>{ref.ref}{!ref.commit && ' · mutable'}</dd></>}
        {ref.path && <><dt>Source path</dt><dd>{location ? <a href={location}><code>{ref.path}</code> <ArrowUpRight size={13}/></a> : <code>{ref.path}</code>}</dd></>}
        {ref.resolved_at && <><dt>Reference checked</dt><dd>{displayDate(ref.resolved_at)}</dd></>}
        {ref.sha256 && <><dt>Content SHA-256</dt><dd><code>{ref.sha256}</code></dd></>}
      </dl>
      {ref.commit && source.license.status === 'identified' && <a className="text-button" href={`${source.canonical_url}/archive/${ref.commit}.zip`}>Download source at this commit <ArrowUpRight size={15}/></a>}
      <p className="muted">Source terms apply. A fixed commit identifies content; it does not establish scientific validity.</p>
    </div>;
  })}</>;
}
