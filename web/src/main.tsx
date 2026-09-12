import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App.js';
import type { SiteData } from './model.js';
import './styles.css';

declare global { interface Window { __AIPOCH__?: SiteData } }
const root = document.getElementById('root')!;
const base = import.meta.env.BASE_URL;
const route = `/${location.pathname.slice(base.length).replace(/^\//, '')}`;
async function start() {
  let data = window.__AIPOCH__;
  if (!data) {
    const response = await fetch(`${base}internal/catalog.json`);
    if (!response.ok) throw new Error('Catalog unavailable');
    data = await response.json() as SiteData;
  }
  const app = <App data={data} path={route} base={base} />;
  if (root.hasChildNodes() && window.__AIPOCH__) hydrateRoot(root, app);
  else createRoot(root).render(app);
}
start().catch(() => {
  createRoot(root).render(<main className="wrap error-page"><p className="eyebrow">AIPOCH Network</p><h1>Catalog unavailable</h1><p>The directory could not be loaded. Please try again.</p><button onClick={() => location.reload()}>Retry</button><a href="https://github.com/imjszhang/aipoch-network">Repository</a></main>);
});
