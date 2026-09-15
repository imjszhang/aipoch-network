import React from 'react';
import { renderToString } from 'react-dom/server';
import { App } from '../web/src/App.js';
import { isSharedCatalogRoute, pageDataForRoute, type SiteData } from '../web/src/model.js';
import { seoForPath, seoHeadMarkup, HOME_DESCRIPTION, HOME_TITLE } from '../web/src/seo.js';
import { siteConfigFromEnv, type SiteConfig } from '../web/src/site-url.js';

const escapeMetadata = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Render the route's display subgraph without interpreting source text as replacement syntax or markup. */
export function renderPage(template: string, data: SiteData, path: string, base: string, config: SiteConfig = siteConfigFromEnv({ ...process.env, SITE_BASE: base })): string {
  const pageData = pageDataForRoute(data, path);
  const seo = seoForPath(path, data, { ...config, base });
  const markup = renderToString(React.createElement(App, { data: pageData, path, base }));
  const serialize = (value: unknown) => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  // Directory HTML stays readable before JavaScript. One shared catalog is loaded before hydration.
  const script = isSharedCatalogRoute(path)
    ? `<script>window.__AIPOCH__=null;window.__AIPOCH_BOOTSTRAP__=${serialize({ snapshot_id: data.snapshot_id })}</script>`
    : `<script>window.__AIPOCH__=${serialize(pageData)}</script>`;
  const title = path === '/' || path.split('?')[0] === '/' ? HOME_TITLE : seo.title;
  const description = path === '/' || path.split('?')[0] === '/' ? HOME_DESCRIPTION : seo.description;
  // Callback replacements preserve literal $&, $', and $` in upstream content.
  let html = template.replace('<!--app-html-->', () => markup).replace('<!--app-data-->', () => script)
    .replace(/<title>.*?<\/title>/, () => `<title>${escapeMetadata(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, () => `<meta name="description" content="${escapeMetadata(description)}" />`);
  if (!html.includes('rel="canonical"')) html = html.replace('</head>', `${seoHeadMarkup(seo)}</head>`);
  if (!html.includes('window.__AIPOCH__') || !html.includes('Skip to content')) throw new Error('Prerender template placeholders missing');
  return html;
}
