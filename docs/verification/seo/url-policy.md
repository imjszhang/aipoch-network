# Existing-site SEO URL policy

This is the engineering record for SEO-02. Status lives in the Ops ledger, not here. Official origin is `https://aipoch.network`. Canonical URLs use that origin plus `SITE_BASE`. Request `Host` is never read.

## Pagination

GitHub Pages and `scripts/prerender.ts` emit one HTML file per path. Query strings do not change the file. Default unfiltered listings therefore prerender `/projects/page/2/` (and the same pattern for other directories). Page 1 stays `/projects/`.

`?page=2` share links still work after JavaScript. A default listing that only carries `page` is replaced to the path form. Invalid or out-of-range **query** pages still clamp. Unbuilt **path** pages, including `/page/1/`, are real 404s.

Filtered, sorted (except equivalent `title`/`relevance`), and search pagination stay on query strings, are `noindex`, and are not prerendered.

## Indexing

Index and sitemap: home, first directory pages, listed detail pages, `/community/`, `/contribute/`.

Index, not sitemap: default listing page 2+ path URLs.

`noindex`: submit, join, me, review, free-text search, facet filters, non-equivalent sorts, tombstones, HTML 404. Preview/subpath builds (`SITE_BASE` other than `/`) are `noindex` and do not advertise a sitemap.

Capabilities are not marked `SoftwareApplication`. Project and capability pages that share a short description keep separate canonicals.
