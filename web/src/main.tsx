import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App.js';
import type { SiteData } from './model.js';
import './styles.css';

declare global { interface Window { __AIPOCH__?: SiteData | null; __AIPOCH_BOOTSTRAP__?: { snapshot_id: string } } }
const root = document.getElementById('root')!;
const base = import.meta.env.BASE_URL;
const route = `/${location.pathname.slice(base.length).replace(/^\//, '')}`;
const MAX_CATALOG_BYTES = 32_000_000;
let active = false;
const noticeElement = document.createElement('div');
noticeElement.id = 'catalog-load-status';
root.before(noticeElement);
const notice = createRoot(noticeElement);
async function loadCatalog(): Promise<SiteData> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${base}internal/catalog.json`, { signal: controller.signal });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_CATALOG_BYTES || !response.body) throw new Error('Catalog unavailable');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_CATALOG_BYTES) { await reader.cancel(); throw new Error('Catalog too large'); }
      chunks.push(chunk.value);
    }
    const combined = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder().decode(combined)) as SiteData;
    if (!data || typeof data.snapshot_id !== 'string' || !data.catalog ||
      !['projects','resources','sources','actors','organizations','collections','claims','relations','tombstones'].every(key => Array.isArray(data.catalog[key as keyof SiteData['catalog']]))) throw new Error('Catalog invalid');
    if (window.__AIPOCH_BOOTSTRAP__ && data.snapshot_id !== window.__AIPOCH_BOOTSTRAP__.snapshot_id) throw new Error('Catalog snapshot changed');
    return data;
  } finally { clearTimeout(timer); }
}
async function start() {
  if (active) return;
  active = true;
  try {
  let data = window.__AIPOCH__;
  if (!data) {
    notice.render(<div className="wrap"><p className="notice" role="status">Loading catalog controls… The entries below remain readable.</p></div>);
    data = await loadCatalog();
    window.__AIPOCH__ = data;
  }
  const app = <App data={data} path={route} base={base} />;
  if (root.hasChildNodes()) hydrateRoot(root, app);
  else createRoot(root).render(app);
  notice.render(null);
  } catch {
    notice.render(<div className="wrap"><section className="notice" role="status"><h2>Catalog controls unavailable</h2><p>The shared catalog could not be loaded or did not match this page. The static entries below remain readable. Retry to enable search, filters, and submission controls.</p><button onClick={() => void start()}>Retry catalog</button></section></div>);
  } finally { active = false; }
}
void start();
