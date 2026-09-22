import React from 'react';
import type { Resource } from '../../spec/types.js';
import { isSafeHttpsUrl, resourceTypeLabel } from '../../spec/identity.js';
import { displayDate } from './model.js';

function Items({ values, fallback }: { values?: string[]; fallback: string }) {
  return values?.length ? <ul>{values.map((value, i) => <li key={i}>{value}</li>)}</ul> : <p>{fallback}</p>;
}

/** The same component renders initial HTML and the client detail view. */
export function ResourceGuide({ resource }: { resource: Resource }) {
  const evidenceFields = ['audience', 'getting_started', 'inputs', 'outputs', 'conditions', 'documentation_url'] as const;
  return <>
    <div className="info-grid">
      <div><h3>Who it is for</h3><Items values={resource.audience} fallback="An intended audience has not been supplied. Check the original documentation for suitability and prerequisites."/></div>
      <div><h3>How to use it</h3>
        {resource.getting_started?.length ? <ol>{resource.getting_started.map((step, i) => <li key={i}>{isSafeHttpsUrl(step.url) ? <a href={step.url}>{step.text}</a> : step.text}</li>)}</ol> : <p>Follow upstream guidance and source conditions.</p>}
        <p>AIPOCH has not verified execution.</p>
        {resource.documentation_url && <a href={resource.documentation_url}>Read usage documentation</a>}
      </div>
      <div><h3>Inputs</h3><Items values={resource.inputs} fallback="Not described in the catalog."/></div>
      <div><h3>Outputs</h3><Items values={resource.outputs} fallback="Not described in the catalog."/></div>
      <div><h3>Resource type</h3><p>{resourceTypeLabel(resource.resource_type)}</p></div>
      <div><h3>Execution guidance</h3><p>{resource.runtime.status === 'not_described' ? 'Follow the upstream documentation. Execution has not been verified by AIPOCH.' : resource.runtime.status.replaceAll('_', ' ')}</p>{resource.runtime.documentation_url && <a href={resource.runtime.documentation_url}>Read execution guidance</a>}</div>
      <div><h3>Access conditions</h3><Items values={resource.conditions} fallback="Check the original documentation and license for applicable conditions."/>{resource.download_url && <a href={resource.download_url}>Upstream download</a>}</div>
    </div>
    {evidenceFields.some(field => resource.provenance[field]?.length) && <details className="provenance"><summary>View usage information sources</summary>
      {evidenceFields.filter(field => resource.provenance[field]?.length).map(field => <div key={field}><h4>{({ audience: 'Who it is for', getting_started: 'How to use it', inputs: 'Inputs', outputs: 'Outputs', conditions: 'Access conditions', documentation_url: 'Documentation' })[field]}</h4>{resource.provenance[field].map((item, i) => <p key={i}><a href={item.url}>{item.role} · {displayDate(item.observed_at)}</a>{item.scope && <span> — {item.scope}</span>}</p>)}</div>)}
    </details>}
  </>;
}
