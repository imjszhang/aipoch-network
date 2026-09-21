import { disciplineLabels } from '../../../spec/classification.js';
import React, { useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, BookOpen, Boxes, Building2, Compass, FlaskConical, GitBranch, Search, Video } from 'lucide-react';
import type { Organization, Project, Resource } from '../../../spec/types.js';
import { allEntries, displayDate, routeFor, sourceFor, type SiteData } from '../model.js';
import { Link, useNavigation } from '../navigation.js';
import { EntryActions } from '../workbench/index.js';

function SectionHeading({ eyebrow, title, to, action }: { eyebrow: string; title: string; to: string; action: string }) {
  return <div className="ph-section-heading">
    <div><p className="ph-eyebrow">{eyebrow}</p><h2>{title}</h2></div>
    <Link to={to} className="ph-link">{action}<ArrowRight size={16} aria-hidden="true" /></Link>
  </div>;
}

function ProjectRow({ entry, data }: { entry: Project; data: SiteData }) {
  const source = sourceFor(entry, data.catalog);
  return <article className="ph-project-row">
    <span className="ph-icon ph-project-icon"><BookOpen size={19} aria-hidden="true" /></span>
    <div className="ph-row-body">
      <h3><Link to={routeFor(entry)}>{entry.title}</Link></h3>
      <p>{entry.description || 'Explore the source documentation for this research project and its methods.'}</p>
      <div className="ph-row-facts">
        <span><b>Research discipline</b> {disciplineLabels(entry).join(' · ') || 'Not classified'}</span>
        <span><b>Reusable outputs</b> {entry.resource_ids.length}</span>
      </div>
      <div className="ph-row-meta">
        <span className="ph-domain">{disciplineLabels(entry)[0] || 'Open research'}</span>
        {source && <Link to={routeFor(source)}>{source.title}</Link>}
        <span>Updated {displayDate(entry.updated_at)}</span>
      </div>
    </div>
    <div className="ph-row-actions"><EntryActions entry={entry} compact /></div>
  </article>;
}

function CapabilityCard({ entry }: { entry: Resource }) {
  const license = entry.license.status === 'identified' ? entry.license.spdx_id || entry.license.name || 'License identified'
    : entry.license.status === 'conflicting' ? 'License conflicting' : 'License unknown';
  return <article className="ph-card">
    <div className="ph-card-top"><span className="ph-icon ph-icon-yellow"><Boxes size={19} aria-hidden="true" /></span><span className="ph-badge">{license}</span></div>
    <p className="ph-eyebrow">{entry.resource_type}</p>
    <h3><Link to={routeFor(entry)}>{entry.title}</Link></h3>
    <p className="ph-card-description">{entry.description || 'Explore the original source and its connected research.'}</p>
    <div className="ph-card-bottom"><span>{disciplineLabels(entry)[0] || 'Open research'}</span><EntryActions entry={entry} compact /></div>
  </article>;
}

function OrganizationCard({ entry }: { entry: Organization }) {
  const participation = { community_indexed: 'Community indexed', maintainer_acknowledged: 'Maintainer acknowledged', actively_curated: 'Actively curated' }[entry.participation];
  return <article className="ph-card">
    <div className="ph-card-top"><span className="ph-icon"><Building2 size={20} aria-hidden="true" /></span><span className="ph-badge">{participation}</span></div>
    <p className="ph-eyebrow">Organization</p>
    <h3><Link to={routeFor(entry)}>{entry.title}</Link></h3>
    <p className="ph-card-description">{entry.description || 'Selected public research from this GitHub organization.'}</p>
    <div className="ph-card-bottom"><span>{entry.source_ids.length} selected source{entry.source_ids.length === 1 ? '' : 's'}</span><Link to={routeFor(entry)} className="ph-card-arrow" aria-label={`View ${entry.title}`}><ArrowUpRight size={19} aria-hidden="true" /></Link></div>
  </article>;
}

/** Public content is rendered from the current catalog, including its static first-page subset. */
export function PublicHome({ data }: { data: SiteData }) {
  const [query, setQuery] = useState('');
  const { navigate, href } = useNavigation();
  const { catalog, totals } = data;
  const counts = [
    { label: 'Projects', count: totals?.projects ?? catalog.projects.length, route: '/projects/' },
    { label: 'Capabilities', count: totals?.resources ?? catalog.resources.length, route: '/capabilities/' },
    { label: 'Organizations', count: totals?.organizations ?? catalog.organizations.length, route: '/organizations/' },
    { label: 'Researchers', count: data.researcher_total ?? catalog.actors.filter(actor => actor.account_type === 'user').length, route: '/researchers/' },
    { label: 'Collections', count: totals?.collections ?? catalog.collections.length, route: '/collections/' },
  ];
  const entries = new Map(allEntries(catalog).map(entry => [entry.id, entry]));
  const relation = catalog.relations.find(row => row.evidence.length && entries.has(row.from_id) && entries.has(row.to_id));
  const relatedFrom = relation ? entries.get(relation.from_id) : undefined;
  const relatedTo = relation ? entries.get(relation.to_id) : undefined;
  const relationLabel = relation?.type.replaceAll('_', ' ');

  return <main className="ph-home">
    <section className="ph-hero">
      <div className="ph-wrap ph-hero-inner">
        <div>
          <p className="ph-eyebrow"><i aria-hidden="true" />A network for open research</p>
          <h1 className="ph-display">Science<br /><em>Open to All</em></h1>
          <p className="ph-hero-copy">Explore AIPOCH Network.<br />Research locally with Open-Science.</p>
          <div className="ph-hero-actions">
            <Link className="ph-button ph-dark" to="/join/">Join with Open-Science<ArrowRight size={17} aria-hidden="true" /></Link>
            <Link className="ph-button" to="/explore/">Explore AIPOCH Network<Compass size={17} aria-hidden="true" /></Link>
          </div>
          <p className="ph-hero-footnote">Projects, capabilities, and people. Connected through open research.</p>
        </div>
        <aside className="ph-workbench-card" aria-label="About the Open-Science workbench">
          <div className="ph-workbench-heading">
            <div><h2>Open-Science</h2><p>Open source research workbench</p></div>
            <span className="ph-icon ph-icon-yellow"><FlaskConical size={21} aria-hidden="true" /></span>
          </div>
          <img src={href('/assets/open-science-product-v9-r2.jpg')} width="1024" height="768" alt="Open-Science product screenshot showing research files and generated scientific artifacts" />
          <div className="ph-workbench-body">
            <p>Create, run, and review research on your computer.</p>
            <div className="ph-walkthrough-note"><span className="ph-video-icon"><Video size={16} aria-hidden="true" /></span><span>Walkthrough · coming later<small>中文 / English</small></span></div>
          </div>
        </aside>
      </div>
    </section>

    <section className="ph-wrap ph-browse" aria-label="Browse the network">
      <form className="ph-search" role="search" action={href('/browse/explore/')} method="get" onSubmit={event => { event.preventDefault(); void navigate(`/browse/explore/?q=${encodeURIComponent(query.trim())}`).catch(() => { location.assign(href(`/browse/explore/?q=${encodeURIComponent(query.trim())}`)); }); }}>
        <Search size={23} aria-hidden="true" />
        <input type="search" name="q" aria-label="Search AIPOCH Network" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search projects, capabilities, organizations…" />
        <button type="submit" className="ph-button ph-dark" aria-label="Explore search results"><span>Explore results</span><ArrowRight size={17} aria-hidden="true" /></button>
      </form>
      <div className="ph-browse-links">{counts.map(({ label, count, route }) => <Link to={route} key={label}><span>{label}</span><b>{count.toLocaleString('en-US')}</b><ArrowUpRight size={15} aria-hidden="true" /></Link>)}</div>
    </section>

    <section className="ph-wrap ph-section ph-research">
      <div>
        <SectionHeading eyebrow="Explore research" title="A question. A project. A next step." to="/projects/" action="All projects" />
        <div className="ph-projects">{catalog.projects.slice(0, 3).map(entry => <ProjectRow entry={entry} data={data} key={entry.id} />)}{!catalog.projects.length && <p className="ph-empty">No projects in this directory snapshot yet.</p>}</div>
      </div>
      <aside className="ph-network-note">
        <p className="ph-eyebrow">The network, in view</p>
        <h2>Find your next connection.</h2>
        <p>Public projects and capabilities, brought together with their sources.</p>
        <div className="ph-network-counts">{counts.slice(0, 3).map(row => <div key={row.label}><b>{row.count.toLocaleString('en-US')}</b><span>{row.label}</span></div>)}</div>
        <p className="ph-snapshot-label">Directory snapshot · {displayDate(data.generated_at)}<br />Inclusion does not imply endorsement.</p>
        <Link to="/collections/" className="ph-link">Explore curated collections<ArrowRight size={16} aria-hidden="true" /></Link>
      </aside>
    </section>

    <section className="ph-capabilities-band">
      <div className="ph-wrap ph-section">
        <SectionHeading eyebrow="Reusable capabilities" title="Build on what others have made." to="/capabilities/" action="All capabilities" />
        <div className="ph-capabilities">{catalog.resources.slice(0, 4).map(entry => <CapabilityCard entry={entry} key={entry.id} />)}{!catalog.resources.length && <p className="ph-empty">No capabilities in this directory snapshot yet.</p>}</div>
      </div>
    </section>

    <section className="ph-wrap ph-section">
      <SectionHeading eyebrow="People & organizations" title="Research is a collective effort." to="/organizations/" action="All organizations" />
      <div className="ph-organizations">{catalog.organizations.slice(0, 3).map(entry => <OrganizationCard entry={entry} key={entry.id} />)}{!catalog.organizations.length && <p className="ph-empty">No organizations in this directory snapshot yet.</p>}</div>
    </section>

    <section className="ph-wrap ph-section ph-community">
      <div><p className="ph-eyebrow">Connected research</p><h2>Useful work travels further.</h2><p>Follow documented connections and curated research. Bring questions and contributions back to the people behind the work.</p><Link className="ph-link" to="/community/">Explore the community<ArrowRight size={17} aria-hidden="true" /></Link></div>
      <div className="ph-activity"><Activity size={23} aria-hidden="true" /><p className="ph-eyebrow">{relation ? 'A source-backed connection' : 'Research, with its sources'}</p>
        {relation && relatedFrom && relatedTo ? <><h3>{relatedFrom.title} &amp; {relatedTo.title}</h3><p>A documented relationship: {relatedFrom.title} {relationLabel} {relatedTo.title}. Explore the recorded evidence at the source.</p><Link className="ph-link" to={routeFor(relatedFrom)}>See connected research<ArrowUpRight size={16} aria-hidden="true" /></Link></> : <><h3>Follow the documented connections.</h3><p>Each directory entry keeps its original sources in view. Explore the research and the people behind it.</p><Link className="ph-link" to="/sources/">Explore research sources<ArrowUpRight size={16} aria-hidden="true" /></Link></>}
      </div>
    </section>

    <section className="ph-github-invitation">
      <div className="ph-wrap"><GitBranch size={34} aria-hidden="true" /><div><p className="ph-eyebrow">Already on GitHub?</p><h2>Your project can be part of the network.</h2><p>Start with a public link. Keep your repository, documentation and collaboration.</p></div><Link to="/contribute/" className="ph-button ph-dark">Connect an existing project<ArrowRight size={17} aria-hidden="true" /></Link></div>
    </section>
  </main>;
}
