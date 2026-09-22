import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResourceGuide } from '../src/ResourceGuide.js';
import { createFixtureCatalog } from '../../spec/fixtures/catalog.js';

test('usage renders in static HTML, escapes text and withholds unsafe step links', () => {
  const resource = createFixtureCatalog().resources[0];
  resource.audience = ['Researchers <script>alert(1)</script>'];
  resource.inputs = [];
  resource.getting_started = [{ text: 'Read <guide>', url: 'https://example.org/guide' }, { text: 'Unsafe link', url: 'javascript:alert(1)' }];
  resource.provenance.audience = [{role:'editor',url:'https://example.org/guide',observed_at:'2026-09-22T00:00:00Z',review:'reviewed',scope:'Audience inferred from tutorial'}];
  const html = renderToStaticMarkup(React.createElement(ResourceGuide, { resource }));
  assert.match(html, /Researchers &lt;script&gt;/);
  assert.match(html, /href="https:\/\/example.org\/guide"/);
  assert.doesNotMatch(html, /javascript:|<script>/);
  assert.match(html, /Not described in the catalog/);
  assert.match(html, /View usage information sources/);
  assert.match(html, /AIPOCH has not verified execution/);
});

test('legacy resources retain explicit unknown audience and execution state', () => {
  const resource = createFixtureCatalog().resources[0];
  delete resource.audience; delete resource.getting_started;
  const html = renderToStaticMarkup(React.createElement(ResourceGuide, { resource }));
  assert.match(html, /An intended audience has not been supplied/);
  assert.match(html, /Follow upstream guidance and source conditions/);
});
