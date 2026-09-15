# Explore catalog dates and GitHub metrics

This change implements the approved `explore-dates-metrics-v1` plan against the v9-r2 design. The paired v9-r2 Markdown and the directory/card/detail states in the archived HTML were inspected; the original references are unchanged.

The five primary categories, black/white/yellow palette, project rows, capability cards, sidebar, mobile filter dialog, source links and existing connection/reference controls remain. New information sits in compact secondary rows beneath catalog descriptions. The universal date group and the applicable GitHub group use expandable sections in the existing sidebar and mobile dialog, keeping normal browsing compact. Source repositories remain a provenance category.

## Interaction and meaning

- Added refers to evidenced publication; Catalog updated refers to material catalog content. `Listed by` and `Change observed by` retain historical uncertainty. Unknown dates remain visible and have a dedicated filter.
- Stars/forks identify one primary or implementation source. Every repository criterion must match that same source. Documentation, data and evidence references do not lend popularity. Collections have membership counts and dates, without aggregate popularity.
- Follower counts come from the canonical GitHub Actor shared by an Organization. Counts are labelled publicly reported. Details distinguish GitHub public repositories from distinct AIPOCH projects/capabilities.
- Date presets become inclusive UTC calendar boundaries in the URL. Filtering/sorting resets pagination. Invalid shared combinations show a repair action; interactive category/scope changes clear incompatible controls with an accessible status message.
- Repository and account sorting make the eligible kinds explicit. Unknown values sort last. Historical bounds follow exact dates. Stale values remain labelled and are excluded from numeric thresholds/ranking unless the user opts in, with a seven-day limit.
- The initial static view uses the artifact reference time. Hydration captures the browser time once for the page session; rerenders, filtering and pagination do not advance it. The snapshot date remains separate. No browser request to GitHub is added.
- The legacy `sort=updated` URL retains its original ordering by `updated_at` and displays “Legacy updated order”. New `sort=catalog_updated` uses evidenced content dates. Unknown access/type/sort/observation values and duplicate parameters are validated explicitly. Existing version and organization-membership filters still cover explicit documentation references; those references never lend popularity or source-activity values. Sorting retains such entries in its unranked tail unless an active GitHub criterion requires a primary/implementation witness.

## Implementation mapping

| Surface | Implementation |
| --- | --- |
| Pure URL, scope, same-source matching and sorting | `web/src/discovery.ts` |
| Session reference time and reusable factual presentation | `web/src/catalog-observations.tsx` |
| Desktop/mobile directory controls and repair feedback | `web/src/pages/Directory.tsx`, `web/src/pages/directory.css` |
| Compact cards, source and account details | `web/src/catalog-components.tsx`, `web/src/SourceRecords.tsx`, `web/src/pages/Detail.tsx` |
| Complete account membership counts in detail subgraphs | `web/src/model.ts` |

Meaningful selector and rendering boundaries are covered in `web/tests/discovery.test.ts`; browser scenarios are in `tests/e2e/explore-dates-metrics.test.ts`. Actual verification results and screenshots belong to `docs/verification/explore-dates-metrics/`; this design mapping does not imply a deployment or replace the recorded v9-r2 regression evidence.
