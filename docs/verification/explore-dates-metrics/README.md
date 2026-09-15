# Explore dates and GitHub metrics — implementation evidence

Status: implementation and local verification complete on `codex/explore-dates-metrics`; PR and hosted checks are recorded separately. No merge or production deployment in this task. Baseline source: `96e26e549e6d5da91e3ac8d353927e88785ca191`. Baseline production snapshot: `5ee1901237e9fef920db1657`, deployment `34944652152`.

## Reviewed data

- [Deployment inventory](deployment-audit.json): all eight successful production releases, complete bounded Actions/platform inventories, exact source/artifact/snapshot bindings and independently validated candidate archive/shard digests. First public release is supported by the historical [public release record](../../deployment/public-pages.md).
- [Per-record historical backfill](backfill.md): 103 projections /85 stable identities; Actor/Organization identities deduplicated. All 85 first-publication dates are exact; all current content-change dates are observed bounds. No build timestamps were promoted. Reapplying identical evidence produces no differences.
- [Public API probes](public-probe.json): 21 source Star/Fork counts, 21 valid default-branch HEAD committer dates, 19 distinct profile follower counts. API version 2022-11-28 remained supported in these observations. Source and per-field timestamps are retained; unsupported organization Following is not fabricated.
- `registry/catalog.json` classifications, IDs and explicit source references are unchanged. The fixed offline fixture now contains the reviewed public observations. Production counters remain from the previously deployed artifact until a new release is authorized.

## Validation

[Validation results](validation.json): 435 unit/contract tests passed with the static build. Browser tests passed 554 checks with 0 failures and 0 flaky tests: standard root/subpath 96 each, Demo root/subpath 116 each, and real protocol/discovery root/subpath 65 each. Mode-specific skips are recorded explicitly. Real tests use independent protocol fixtures, not a live client pairing. Tests cover keyboard/mobile dialogs, narrow screens and 200% text sizing; native browser chrome zoom and screen-reader speech were not assessed.

A build restored all 14 historical snapshots from the reviewed current production package; all 140 manifested snapshot files remained byte-identical. The new read-only publication restoration command was also exercised against current GitHub metadata and correctly found 0 new receipts after the reviewed checkpoint. These checks do not deploy anything.

Resolved regressions included hidden legacy filters after category changes, split-source matches between legacy and numeric criteria, documentation-reference membership in standalone legacy filters, invalid enum URLs, and native-dialog test synchronization. Final runs above passed after fixes. [Screenshots](screenshots.json) were captured on the same catalog snapshot and visually reviewed:

- [Desktop Explore](desktop-explore.png): Project, Capability and Organization cards.
- [Researcher details](desktop-researcher.png): publicly reported counts and separate catalog membership.
- [Collections](desktop-collections.png): dates/member counts without inherited popularity.
- [Mobile filters](mobile-filters.png): repository metrics, source activity and freshness controls.

This implementation does not add a backend, browser GitHub API calls, new categories, login, upstream execution or scientific/organization endorsement. The new first-publication receipt is consumed by the next normal refresh after deployment; there is no second automatic release. Publication history gaps stop restoration for explicit reconciliation.
