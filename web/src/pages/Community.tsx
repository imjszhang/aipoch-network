import React, { useEffect, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, GitBranch, Info } from 'lucide-react';
import { allEntries, displayDate, routeFor, type SiteData } from '../model.js';
import { Link, useNavigation } from '../navigation.js';

const REPO = 'https://github.com/imjszhang/aipoch-network';
const filters = [['all', 'All activity'], ['curation', 'Curation'], ['reuse', 'Reuse'], ['validation', 'Validation'], ['collaboration', 'Collaboration']] as const;
type ActivityFilter = typeof filters[number][0];
type RecordedActivity = { id: string; type: 'reuse' | 'curation' | 'connection'; title: string; description: string; date: string; to: string; evidence?: string };

function Heading({ eyebrow, title, description, action, to }: { eyebrow: string; title: string; description: string; action: string; to: string }) {
  return <section className="cp-heading"><div className="cp-wrap"><div><p className="cp-eyebrow"><span className="cp-dot" aria-hidden="true"/>{eyebrow}</p><h1>{title}</h1><p className="cp-page-copy">{description}</p></div><Link className="cp-button cp-dark" to={to}>{action}<ArrowRight size={17} aria-hidden="true"/></Link></div></section>;
}

function recordedActivity(data: SiteData): RecordedActivity[] {
  const entries = new Map(allEntries(data.catalog).map(entry => [entry.id, entry]));
  const reuseTypes = new Set(['uses', 'produces', 'fork_of', 'derived_from']);
  const relations = data.catalog.relations.flatMap((relation): RecordedActivity[] => {
    const from = entries.get(relation.from_id), to = entries.get(relation.to_id), evidence = relation.evidence[0];
    if (!from || !to || !evidence) return [];
    return [{ id: relation.id, type: reuseTypes.has(relation.type) ? 'reuse' : 'connection', title: `${from.title} connects to ${to.title}`, description: evidence.scope || 'A relationship recorded with source evidence. This is not a scientific validation.', date: relation.recorded_at, to: routeFor(from), evidence: evidence.url }];
  });
  return [...relations, ...data.catalog.collections.map((collection): RecordedActivity => ({ id: collection.id, type: 'curation', title: collection.title, description: collection.description || collection.selection_basis, date: collection.updated_at, to: routeFor(collection) }))];
}

export function Community({ data }: { data: SiteData }) {
  const { path, href, navigate } = useNavigation();
  const requested = new URLSearchParams(path.split('?')[1] ?? '').get('activity');
  const active: ActivityFilter = filters.find(([value]) => value === requested)?.[0] ?? 'all';
  const [interactive, setInteractive] = useState(false);
  useEffect(() => setInteractive(true), []);
  const events = recordedActivity(data).filter(event => active === 'all' || event.type === active);
  const selectFilter = (filter: ActivityFilter) => {
    const to = filter === 'all' ? '/community/' : `/community/?activity=${filter}`;
    void navigate(to, { preserveScroll: true }).catch(() => { location.assign(href(to)); });
  };
  return <main className="cp-page">
    <Heading eyebrow="Community" title="Research moves through people." description="Follow the connections, shared resources and carefully documented contributions behind the network." action="Contribute" to="/contribute/"/>
    <div className="cp-wrap cp-section cp-community-layout">
      <section aria-label="Recorded research activity">
        <div className="cp-tabs" role="group" aria-label="Activity type">{filters.map(([value, label]) => <button type="button" key={value} className={active === value ? 'active' : ''} aria-pressed={active === value} disabled={!interactive} onClick={() => selectFilter(value)}>{label}</button>)}</div>
        <p className="cp-sr-only" role="status">{events.length} recorded {events.length === 1 ? 'activity' : 'activities'} shown.</p>
        {events.length ? <div className="cp-activity-list">{events.map(event => <article key={event.id}>
          <span className="cp-activity-symbol" aria-hidden="true"><Activity size={18}/></span>
          <div className="cp-activity-body"><p className="cp-eyebrow">{event.type} · Recorded <time dateTime={event.date}>{displayDate(event.date)}</time></p><h2><Link to={event.to}>{event.title}</Link></h2><p>{event.description}</p>{event.evidence ? <a className="cp-link" href={event.evidence} target="_blank" rel="noreferrer">Read the evidence<ArrowUpRight size={15} aria-hidden="true"/></a> : <Link className="cp-link" to={event.to}>Read the selection basis<ArrowRight size={15} aria-hidden="true"/></Link>}</div>
        </article>)}</div> : <div className="cp-empty"><span className="cp-empty-symbol" aria-hidden="true"><Activity size={22}/></span><h2>No documented activity yet</h2><p>{active === 'validation' || active === 'collaboration' ? 'No activity is recorded in this category. Scientific validation and collaboration are not inferred from directory inclusion, software connections or GitHub activity.' : 'No matching relationships or curated collections are recorded in this snapshot.'}</p><Link className="cp-button" to="/contribute/">Learn how to contribute<ArrowRight size={16} aria-hidden="true"/></Link></div>}
      </section>
      <aside className="cp-sidebar"><section className="cp-panel cp-yellow-panel"><h2>Small contributions connect research.</h2><p>Share a useful source. Improve a description. Bring an independent review with its evidence.</p><Link className="cp-link" to="/submit/">Share a public link<ArrowRight size={16} aria-hidden="true"/></Link></section><section className="cp-panel"><h2>Recorded, not live</h2><p>This view uses the catalog observed on <time dateTime={data.generated_at}>{displayDate(data.generated_at)}</time>. The time a connection was recorded may differ from when the research happened.</p></section></aside>
    </div>
  </main>;
}

export function Contribute() {
  return <main className="cp-page">
    <Heading eyebrow="Contribute" title="Your research already has a home." description="Connect it to a wider network. Start with the GitHub projects and organizations you already use." action="Share a public link" to="/submit/"/>
    <div className="cp-wrap cp-section">
      <div className="cp-contribute-steps">{[
        ['01', 'Start with a link', 'A public repository or organization URL is enough to propose a source. No special file, AIPOCH account or client is required.'],
        ['02', 'Review what you share', 'Check the source and the exact description. Keep private research data and credentials in your own environment.'],
        ['03', 'Continue on GitHub', 'Submit the prepared issue on GitHub. The directory review happens there, with a traceable discussion.'],
      ].map(([number, title, description]) => <article className="cp-panel" key={number}><span className="cp-step-number">{number}</span><h2>{title}</h2><p>{description}</p></article>)}</div>
      <div className="cp-contribute-body"><section><p className="cp-eyebrow">A place for existing organizations</p><h2>Choose what represents your work.</h2><p>An organization link starts a candidate review. Select the repositories you want considered; the whole organization is not enrolled automatically.</p><p>Directory inclusion, a maintainer acknowledgement, and authority to curate an organization each have their own scope and evidence.</p><Link className="cp-link" to="/submit/?kind=organization">Propose an organization<ArrowRight size={16} aria-hidden="true"/></Link></section><aside className="cp-panel"><GitBranch size={25} aria-hidden="true"/><h3>Keep collaboration at the source.</h3><p>Discuss methods and code with the original project. Bring directory corrections, source suggestions and evidence records to AIPOCH.</p><a className="cp-link" href={`${REPO}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">Read the contribution guide<ArrowUpRight size={15} aria-hidden="true"/></a></aside></div>
      <div className="cp-notice"><Info size={18} aria-hidden="true"/><p>Open-Science is an optional way to continue research locally. You can browse and contribute public GitHub sources without installing it.</p></div>
    </div>
  </main>;
}
