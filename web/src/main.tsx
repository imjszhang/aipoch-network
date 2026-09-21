import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App.js';
import type { SiteData } from './model.js';
import { legacyDirectoryRedirect } from './directory-url.js';
import { PAGE_SIZE } from './directory-routes.js';
import './styles.css';
import './pages/public-home.css';
import './pages/catalog-pages.css';
import './pages/directory.css';
import './pages/community.css';
import './workbench/styles.css';

declare global { interface Window { __AIPOCH__?: SiteData | null } }
const root = document.getElementById('root')!;
const base = import.meta.env.BASE_URL;
const route = `/${location.pathname.slice(base.length).replace(/^\//, '')}`;
const data = window.__AIPOCH__;
const maxPage = data?.directory_bootstrap ? Math.max(1, Math.ceil(data.directory_bootstrap.total / PAGE_SIZE)) : undefined;
// URL compatibility never waits for a catalog fetch. A new static document supplies
// the appropriate initial robots policy instead of rewriting an indexable page.
const redirect = legacyDirectoryRedirect(`${location.pathname}${location.search}${location.hash}`, base, maxPage);
if (redirect) location.replace(redirect);
else if (data) {
  // Render the same path as the static document first; navigation adopts query
  // parameters after hydration, so filtered deep links cannot replace SSR nodes.
  const app = <App data={data} path={route} base={base}/>;
  if (root.hasChildNodes()) hydrateRoot(root, app);
  else createRoot(root).render(app);
} else {
  const notice = document.createElement('p');
  notice.className = 'notice';
  notice.setAttribute('role', 'status');
  notice.textContent = 'Page controls are unavailable. The static entries and links remain readable. Refresh this page to try again.';
  root.before(notice);
}
