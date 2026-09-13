import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App.js';
import type { SiteData } from './model.js';
import './styles.css';
import './pages/public-home.css';
import './pages/catalog-pages.css';
import './pages/directory.css';
import './pages/community.css';
import './workbench/styles.css';
import { loadCatalog } from './catalog-loader.js';

declare global { interface Window { __AIPOCH__?: SiteData | null; __AIPOCH_BOOTSTRAP__?: { snapshot_id: string } } }
const root = document.getElementById('root')!;
const base = import.meta.env.BASE_URL;
const route = `/${location.pathname.slice(base.length).replace(/^\//, '')}`;
let active = false;
const noticeElement = document.createElement('div');
noticeElement.id = 'catalog-load-status';
root.before(noticeElement);
const notice = createRoot(noticeElement);
async function start() {
  if (active) return;
  active = true;
  try {
  let data = window.__AIPOCH__;
  if (!data) {
    notice.render(<div className="wrap"><p className="notice" role="status">Loading catalog controls… The entries below remain readable.</p></div>);
    data = await loadCatalog(base, window.__AIPOCH_BOOTSTRAP__?.snapshot_id);
    window.__AIPOCH__ = data;
  }
  const app = <App data={data} path={route} base={base} />;
  if (root.hasChildNodes()) hydrateRoot(root, app);
  else createRoot(root).render(app);
  notice.render(null);
  } catch {
    notice.render(<div className="wrap"><section className="notice" role="status"><h2>Catalog controls unavailable</h2><p>The shared catalog could not be loaded or did not match this page. The static entries below remain readable. Retry to enable controls, or refresh this page to load the current catalog snapshot.</p><button onClick={() => void start()}>Retry catalog</button> <button onClick={() => location.reload()}>Refresh page</button></section></div>);
  } finally { active = false; }
}
void start();
