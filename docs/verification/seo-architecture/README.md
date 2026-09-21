# SEO and loading architecture verification

Implementation began on 2026-09-21 from `3e5ecea40a8af2c31ea09c90763877790bddf03e`. Runtime implementation is committed at `412465ecc26db03c4910fe0804d93d7611570afa`. This document is an execution record, not proof of deployment.

## Scope

Preserve content, identity, classification, catalog/v1 and Connector semantics. Split static discovery from noindex browse operations; hydrate the exact page independently of global data; use an immutable, snapshot-bound lightweight browser projection.

## Fixed baseline

- Last successful Pages deployment checked on 2026-09-21: [35441399275](https://github.com/imjszhang/aipoch-network/actions/runs/35441399275), source `3e5ecea40a8af2c31ea09c90763877790bddf03e`.
- Public manifest: snapshot `ed9456e59610b3cefd59c7bd`, generated `2026-09-19T11:44:27.932Z`, contract `1.2.0`.
- 226 projects and 227 resources. The public catalog and search gzip transfers previously measured 250,722 and 64,816 bytes; those are HTTP samples, not field performance.
- The old catalog request had a 15-second total deadline; a historical request aborted at approximately 15,001 ms. The underlying slow network segment remains unknown.
- Static Pages cannot return a different initial HTML document for each query string. Legacy query URLs remain migration exceptions; their early client redirect is not an HTTP redirect.

## Measurement protocol

Before/after source revisions, snapshot, browser version, build mode, device and CPU/network profile must accompany each measurement. Normal profile: 1.6 Mbps / 150 ms RTT / 4x CPU; slow profile: 400 Kbps / 400 ms / 4x CPU. Five cold and five warm runs per profile; report median and maximum, not public p95. Timing starts at navigation start.

Targets: menu/filter/search 3/5/6 seconds normal and 6/12/15 seconds slow; discovery projection <=100 KiB local gzip at the production-size baseline; no unreviewed >10% script gzip growth; ready-state filter response <=200 ms. Actual field INP and Google indexing effects remain separate and may be unavailable. Failed targets require a recorded diagnosis and correction, not a moved timing origin.

## Implemented boundaries

Seven initial-noindex browse routes coexist with indexable static directories/details and crawlable pagination. Legacy queries adapt before any catalog request; README and existing UI filter links use the new routes. No titles, positioning, registry entries or public contract fields were changed.

SSR embeds the exact page subgraph, totals and a pinned UI-manifest reference. The page can hydrate independently; browse/search load in parallel with digest/schema/snapshot validation. Source/account lookups and sort keys are cached. The full catalog is reserved for complete references and workbench operations. Normal navigation uses existing HTML. A live workbench context alone may wait for its shared full-data preparation to preserve pairing, selection and isolated Review state.

Snapshots gate UI/asset history, retained notices and browser reuse. A detected retirement disables filters and new reference review/sending, cancels local pending work and retains the selected ID and readable page. It does not claim to recall data already sent. An old trusted projection may have a different valid byte encoding/hash; a new candidate must still exactly reproduce the current writer's bytes.

The initially suggested separate changes are one integrated implementation commit: routing, embedded manifests, loaders and candidate inventories need to agree before any deployment. No intermediate incompatible combination was published.

## Release and recovery

This is an offline implementation/verification handoff. No merge, trusted refresh, Pages deployment or production interaction verification has occurred for this change. The fixture artifact is not a fresh publishable candidate. After review, use the existing current-main refresh and exact-artifact approval workflow; preserve its source-age, retirement, complete-inventory and mode checks.

Publish README route changes together with the website migration. The first migration cannot guarantee that pre-existing cached HTML can fetch old JS/CSS bundles which lack a verified asset inventory. Later retained bundles have explicit snapshot associations. Public history remains capped at 64 MiB, UI history at 32 MiB (8 MiB/file), JS/CSS at 16 MiB, and merged notices at 1 MB. Fixed artwork bytes are unchanged in this implementation.

Recovery keeps the new retention/inventory compatibility layer, reverts the faulty module on current main, then produces and reviews a fresh candidate. Reverting all changes to an unaware older builder would discard retained UI/assets and is not a validated recovery. Retired data is never restored for continuity.

After an authorized release, independently verify live status/headers, representative browser journeys and the full bounded link/SEO scan; then record actual day-1, day-7 and day-28 observations. No scheduler, future observation, field Core Web Vitals result, ranking change or scientific execution is claimed by these local checks.

## Functional acceptance

Node 24.18.1; `typecheck` and all 516 unit/contract/pipeline tests passed. The independent output scan validated 1,125 HTML pages, 896 sitemap URLs and real anchor paths to all 886 catalog details. A 1,000-project synthetic graph exercises projection equivalence and sort/source boundaries. Timers, transient failures, bytes/digests, malformed schemas, cancellation, retention, withdrawal, same-snapshot alternate projection encoding, and complete references have dedicated boundary tests.

| Local build and browser suite | Passed | Skipped | Failed / flaky |
| --- | ---: | ---: | ---: |
| Public `/` | 142 | 86 | 0 / 0 |
| Public `/aipoch-network/` | 142 | 86 | 0 / 0 |
| Demo `/` | 166 | 62 | 0 / 0 |
| Demo `/aipoch-network/` | 166 | 62 | 0 / 0 |
| Real `/` | 57 | 1 | 0 / 0 |
| Real `/aipoch-network/` | 57 | 1 | 0 / 0 |

Public/Demo runs use the complete suite; tests for other adapter modes intentionally skip. Real runs use protocol fixtures and persistence tests, with one mobile skip for a duplicate browser-process-restart scenario. These 730 passes are executions across six configurations, not 730 unique scenarios or proof of a live Connector session. Slow full-data navigation preserves both isolated Review and connected sessions; background loads preserve submission drafts, consent and correction state.

The local offline candidate's exact tree digest, snapshot and compact test timestamps are in [verification.json](verification.json). No test failure was waived: the discovered Review navigation regression and historical projection restoration defect were fixed; the synthetic fixture and mobile hidden-navigation assertions were corrected before final acceptance.

## Measured performance

Measured on 2026-09-21 from 06:09:03 to 06:13:00 UTC after other builds/browser suites had stopped. Both sites used the same frozen production snapshot above, public/unavailable mode and root base. Chromium 153.0.8010.12 ran on Darwin 25.6.0 / Apple M5 Max, with the profiles specified above. [performance.json](performance.json) contains all 40 directory samples, resource timing, 40 separate homepage samples and exact revision/environment metadata. This local gzip server does not reproduce production CDN caching or physical mobile hardware.

The following are navigation-start medians in seconds; each cell has five observations. Search readiness requires the actual result to render.

| Profile/cache | Menu before → after | Filter before → after | Search before → after |
| --- | ---: | ---: | ---: |
| Normal/cold | 2.507 → 1.145 | 2.507 → 2.307 | 2.996 → 2.307 |
| Slow/cold | 8.953 → 3.817 | 8.953 → 7.944 | 10.663 → 7.944 |
| Normal/warm | 0.285 → 0.274 | 0.285 → 0.441 | 0.320 → 0.441 |
| Slow/warm | 0.676 → 0.791 | 0.676 → 1.221 | 0.712 → 1.221 |

Every after sample passed the fixed readiness budgets. Maximum after cold times were 1.147/2.318/2.318 seconds normal and 3.828/8.008/8.008 slow. Already-loaded sorting of all 226 projects stayed below 34 ms across after samples, versus the 200 ms budget; this event/React/two-frame measurement is not field INP. No ordinary browse run requested the full catalog. Warm filter/search readiness increased because every page entry checks the uncached retirement ledger before reusing data. That bounded cost is retained to prevent withdrawn snapshots being reused; it stays below every agreed readiness budget.

The browser projection uses 978,968 decoded / 98,581 local-gzip bytes (96.27 KiB), versus 2,784,673 / 240,328 for the old full catalog: a 59.0% reduction in this data request. Search adds 63,693 local-gzip bytes separately. Entry JavaScript grew from 124,146 to 129,555 local-gzip bytes (+4.36%), within the 10% review threshold. These same-encoder sizes differ from the earlier production HTTP samples.

Homepage text and the sampled 1,082 × 17,574 mobile full-page PNG were identical, including every pixel (SHA-256 `b793d6c4c6ec5da758b459af0204740ee05fbac6a09a22dff48faab8694388a6`). Homepage CLS was zero in all samples. Homepage LCP medians were normal cold 1,828 → 1,860 ms, slow cold 6,820 → 6,940 ms, normal warm 200 → 200 ms, and slow warm 516 → 524 ms. The approximately 1.8% cold increase is a recorded tradeoff, consistent with the additional 5.3 KiB of entry code sharing the throttled connection; it is not described as a homepage speed gain. No image, content or layout changed. The directory's measured cold CLS improved from 0.290 to 0.078, while warm CLS remained zero.

Reproduce with the committed `scripts/verification-site.ts` helper to build both frozen-catalog sites, then run `node --import tsx scripts/seo-architecture-benchmark.ts --before <baseline-site> --after <candidate-site> --output <report.json> --repetitions 5`. Keep the catalog and full screenshots in ignored local evidence; the checked-in record contains their fixed identity and minimal comparison facts.
