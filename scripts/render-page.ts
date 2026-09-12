import React from 'react';
import { renderToString } from 'react-dom/server';
import { App } from '../web/src/App.js';
import { allEntries, pageDataForRoute, routeFor, SHARED_CATALOG_ROUTES, type SiteData } from '../web/src/model.js';

const escapeMetadata = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Render the route's display subgraph without interpreting source text as replacement syntax or markup. */
export function renderPage(template: string, data: SiteData, path: string, base: string): string {
  const entry = allEntries(data.catalog).find(entry => routeFor(entry) === path);
  const title = entry ? `${entry.title} | AIPOCH Network` : path === '/' ? 'Science Open to All | AIPOCH Network' : `${path.split('/')[1].replace(/^./, first => first.toUpperCase())} | AIPOCH Network`;
  const pageData = pageDataForRoute(data, path);
  const markup = renderToString(React.createElement(App, { data: pageData, path, base }));
  const serialize = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  // Directory HTML stays readable before JavaScript. One shared catalog is loaded before hydration.
  const script = SHARED_CATALOG_ROUTES.includes(path)
    ? `<script>window.__AIPOCH__=null;window.__AIPOCH_BOOTSTRAP__=${serialize({ snapshot_id: data.snapshot_id })}</script>`
    : `<script>window.__AIPOCH__=${serialize(pageData)}</script>`;
  // Callback replacements preserve literal $&, $', and $` in upstream content.
  const html = template.replace('<!--app-html-->', () => markup).replace('<!--app-data-->', () => script)
    .replace(/<title>.*?<\/title>/, () => `<title>${escapeMetadata(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, () => `<meta name="description" content="${escapeMetadata(entry?.description ?? 'Discover research projects and reusable capabilities, connected to their original GitHub sources.')}" />`);
  if (!html.includes('window.__AIPOCH__') || !html.includes('Skip to content')) throw new Error('Prerender template placeholders missing');
  return html;
}
