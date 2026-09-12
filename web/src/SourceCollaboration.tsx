import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { SourceRepository } from '../../spec/types.js';

export function SourceCollaboration({ sources }: { sources: SourceRepository[] }) {
  return <div className="upstream-collaboration">{[...new Map(sources.map(source => [source.id, source])).values()].map(source =>
    <div key={source.id}>
      {sources.length > 1 && <h3>{source.title}</h3>}
      <div className="actions">
        <a href={source.canonical_url} className="button">Contribute on GitHub <ArrowUpRight size={15}/></a>
        {source.collaboration?.issues_url && <a href={source.collaboration.issues_url} className="button">Upstream issues <ArrowUpRight size={15}/></a>}
        {source.collaboration?.discussions_url && <a href={source.collaboration.discussions_url} className="button">Upstream discussions <ArrowUpRight size={15}/></a>}
      </div>
    </div>)}</div>;
}
