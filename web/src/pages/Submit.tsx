import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, GitBranch, X } from 'lucide-react';
import { PageHeader } from '../catalog-components.js';
import { allEntries, sourceFor, type SiteData } from '../model.js';
import { Link, useNavigation } from '../navigation.js';
import { buildIssueDraft, ISSUE_REPO, issueTemplateUrl } from '../issue-routing.js';

export function Submit({ data }: { data: SiteData }) {
  const { path } = useNavigation();
  const params = new URLSearchParams(path.split('?')[1] ?? '');
  const correction = params.get('intent') === 'correction';
  const target = params.get('entry') ?? '';
  const entries = allEntries(data.catalog);
  const entry = correction ? entries.find(row => row.id === target) : undefined;
  const initialSource = entry && sourceFor(entry, data.catalog);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [step, setStep] = useState(1);
  const [url, setUrl] = useState(initialSource?.canonical_url ?? (entry?.kind === 'actor' ? entry.canonical_url : ''));
  const [note, setNote] = useState(''), [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false), [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (step > 1) heading.current?.focus(); }, [step]);
  let draft: ReturnType<typeof buildIssueDraft> | undefined;
  try { draft = buildIssueDraft({ type: correction ? 'correction' : 'submission', source: url, note, target, knownIds: entries.map(row => row.id) }); } catch { /* Validation is shown when the user continues. */ }
  function next(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || step >= 3 || (step === 2 && !reviewed)) return;
    try {
      const checked = buildIssueDraft({ type: correction ? 'correction' : 'submission', source: url, note, target, knownIds: entries.map(row => row.id) });
      setUrl(checked.source); setError(''); setStep(step + 1);
    } catch (e) { setError((e as Error).message); }
  }
  const unknownTarget = correction && !entry;
  return <><PageHeaderContent correction={correction}/><main className="wrap submit-layout"><form className="submission panel" onSubmit={next}>
    <div className="card-top"><span className="square-icon yellow"><GitBranch/></span><Link to="/explore/" aria-label="Close submission"><X size={20}/></Link></div>
    <h2 ref={heading} tabIndex={-1}>{correction ? 'Correct catalog content' : 'Propose a research source'} · Step {step} of 3</h2>
    <div className="steps">{['Select','Review sharing','Confirm'].map((label,i) => <span key={label} className={step >= i + 1 ? 'active' : ''}>{label}</span>)}</div>
    {step === 1 ? <div className="form-fields">
      {correction && <p><b>Catalog target:</b> <code>{target || 'Not specified'}</code></p>}
      {unknownTarget && <p className="form-error" role="alert">This catalog entry is unavailable. <Link to="/explore/">Return to the directory</Link> or <a href={issueTemplateUrl('correction')}>use the correction form on GitHub</a>.</p>}
      <label htmlFor="source-url">Public GitHub repository or organization URL{correction && <span className="muted"> (optional)</span>}</label>
      <input disabled={!ready || unknownTarget} id="source-url" type="url" required={!correction} placeholder="https://github.com/organization/project" value={url} onChange={event => { setUrl(event.target.value); setReviewed(false); setCopied(false); }}/>
      <p>{correction ? 'The catalog ID identifies the entry. A source URL is optional.' : 'AIPOCH does not require a special manifest or changes to the original repository.'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <label htmlFor="source-note">{correction ? 'Requested correction' : 'Research context'} <span className="muted">(optional)</span></label>
      <textarea disabled={!ready || unknownTarget} id="source-note" rows={4} maxLength={2000} value={note} onChange={event => { setNote(event.target.value); setReviewed(false); setCopied(false); }} placeholder={correction ? 'What should change, and what supports the correction?' : 'What does this project help researchers do?'}/>
    </div> : step === 2 ? <div className="form-fields">
      <h3>What will be shared</h3><p>Public destination: <a href={ISSUE_REPO}>imjszhang/aipoch-network</a></p>
      <p><b>Issue title:</b> {draft?.title}</p><pre className="draft" aria-label="Exact public draft for review">{draft?.body}</pre>
      <p><Check size={17}/> {correction ? 'The catalog target and optional source URL' : 'The public source URL'}</p><p><Check size={17}/> {correction ? 'Your requested correction' : 'Your optional research context'}</p>
      <p>GitHub will attach your GitHub identity when you submit. No local files, private project data, or credentials are collected by this page.</p>
      <div className="notice">{correction ? 'This requests a catalog correction. Review and publication are separate steps; it does not claim maintenance authority.' : 'An organization URL starts a candidate review. Individual repositories are selected before inclusion; the whole organization is not enrolled automatically.'}</div>
      <label className="checkbox-label"><input disabled={!ready} type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} required/>I have reviewed this content and intend to share it with the repository's readers.</label>
    </div> : <div>
      <h3>{correction ? 'Your catalog correction draft' : 'Your submission draft'}</h3><p><b>Issue title:</b> {draft?.title}</p><pre className="draft">{draft?.body}</pre>
      {draft?.oversized && <p className="notice">This draft is too long for a GitHub link. Copy the complete draft, then paste it into the issue opened below.</p>}
      <div className="notice"><b>Review and submit on GitHub</b><p>Opening GitHub prepares a draft; nothing has been submitted yet. Review the draft and submit the issue there when you are ready.</p></div>
    </div>}
    <div className="form-footer">{step > 1 ? <button type="button" onClick={() => { setStep(step - 1); setCopied(false); setError(''); }}>Back</button> : <Link to="/explore/">Cancel</Link>}
      {step < 3 ? <button className="primary" type="submit" disabled={!ready || unknownTarget || (step === 2 && !reviewed)}>Continue <ArrowRight size={16}/></button> : draft && <div className="actions">
        <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(draft.body); setCopied(true); setError(''); } catch { setError('Copy is unavailable. Select the draft text to copy it.'); } }}>{copied ? 'Copied' : 'Copy draft'}</button>
        <a href={draft.href} target="_blank" rel="noopener noreferrer" className="button primary">Open GitHub draft <ArrowUpRight size={16}/></a>
      </div>}
    </div>{step === 3 && error && <p role="status">{error}</p>}
  </form></main></>;
}
function PageHeaderContent({ correction }: { correction: boolean }) {
  return <PageHeader title={correction ? 'Correct catalog content' : 'Share research'} description={correction ? 'Identify the catalog entry and review the correction you want to propose.' : 'A public GitHub link is enough to begin. Review exactly what you want to share.'}/>;
}
