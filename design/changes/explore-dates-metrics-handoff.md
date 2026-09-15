# Explore dates and GitHub metrics — design synchronization handoff

Updated: 2026-09-15. Scope: the implemented `explore-dates-metrics-v1` addition to v9-r2. Implementation reference: `ec9215709662381478b6bad98990afada63a1e75`, [PR #11](https://github.com/imjszhang/aipoch-network/pull/11). This document prepares synchronization of the design draft; a revised HTML/MD pair and designer sign-off have not yet been recorded. Implementation, design synchronization and production publication are separate states.

Use this handoff with the [design change](explore-dates-metrics.md), [field and filtering contract](../../docs/catalog-dates-metrics.md), and [implementation screenshots](../../docs/verification/explore-dates-metrics/screenshots.json). Preserve the archived v9-r2 originals and their manifests. Deliver any revised design as a new matched HTML/MD pair with its own version and checksums.

## Frames and component changes

| Frame/component | Required design update |
| --- | --- |
| Explore desktop | Keep the existing search, category tabs, sidebar and results hierarchy. Add collapsed `Catalog dates` and applicable `GitHub metrics & activity` groups below existing filters. Include active-filter chips, scope feedback and sorting. |
| Explore mobile | Put the same controls in the existing `Refine results` dialog. Show expanded sections, scrollable content, close/reset controls and keyboard focus behavior. |
| Project rows and Capability cards | Add secondary date rows and an attributed `GitHub · owner/repository` row with Stars and Forks. Preserve source links and existing actions. |
| Source repository cards/details | Show repository observations for that source. Source details distinguish catalog dates, metric checks and default-branch commit evidence. |
| Organization and Researcher cards | Add dates and `GitHub · @login`, `Public followers`, and the available `Checked` date. |
| Organization and Researcher details | Add `GitHub public profile`: public followers, public repositories, and public following for personal accounts only. Keep AIPOCH project/capability counts separate. |
| Collections | Add dates and distinct catalog-entry counts. Do not add summed stars or followers. |

The five primary categories remain Projects, Capabilities, Organizations, Researchers and Collections. Source repositories remain a secondary provenance view. Preserve the black/white/yellow palette, typography, spacing hierarchy and existing connection flows. New facts use secondary text rather than competing with titles or primary actions.

## Display variants and exact copy

| Fact/state | Display rule |
| --- | --- |
| Exact first publication | `Added` + date |
| Bounded first publication | `Listed by` + date |
| Exact material content change | `Catalog updated` + date |
| Bounded material content change | `Change observed by` + date |
| Missing date | `Added unknown` or `Catalog updated unknown`; never substitute the build date |
| Known numeric zero | Show `0`; zero is eligible for a minimum-zero filter |
| Large count | Compact on cards, such as `5.3K`; retain the exact count in accessible text and the tooltip; details use the full number |
| Retained stale value | Show the count with `· stale`; do not imply that a failed latest attempt refreshed it |
| Missing/expired metric | Show `unknown`; unsupported fields use `unsupported` when rendered |
| Profile counts | Use `Public followers`, `Public following`, `Public repositories on GitHub`; explain that profile privacy can limit reported values |
| Repository activity | `Latest source commit`; the card adds this date when sorting by source activity |

Dates render as calendar dates, with evidence in date tooltips. Metric tooltips include the exact publicly reported value and observation time. Detailed metrics also expose check and latest-attempt information. Do not use a single ambiguous “Updated” label for catalog revision, source commit and observation time. Source activity is the observed default-branch HEAD committer date; it does not change a pinned resource version.

## Filter and sorting specifications

| Group | Controls and variants |
| --- | --- |
| Catalog dates | `Added to AIPOCH`, `Catalog updated`: Any date, Last 7/30/90 days, Custom UTC dates, Unknown or bounded date |
| Repository metrics/activity | `Minimum GitHub stars`, `Minimum GitHub forks`; `Latest source commit`: Any date, Last 30/90/365 days, Custom UTC dates, Unknown date |
| Account metrics | `Minimum GitHub followers` |
| Observation status | Any observation; Fresh (within 48 hours); Stale (48 hours to 7 days); Missing or older than 7 days |
| Stale opt-in | `Allow stale metric values`, unchecked by default |
| Sorting | Most relevant, Name A–Z, Recently added, Recently updated, Latest source activity, Most starred, Most followed; only applicable choices appear |

Exact date ranges exclude bounded/unknown dates. Presets resolve to inclusive UTC calendar dates in the URL. Repository controls apply to Projects, Capabilities and Sources; followers apply to Organizations and Researchers. Collections have date controls only. All view narrows to eligible kinds when metric criteria apply. Category changes clear incompatible controls and announce the change; incompatible shared URLs show repair feedback rather than silent coercion. Changes reset pagination.

Every repository criterion must match one primary or implementation source. A project cannot combine one repository’s stars with another repository’s activity to qualify. Display the matching source; do not sum repository popularity. Unknown values sort last; bounded dates follow exact dates. Stale values are excluded from numeric thresholds and ranking unless explicitly allowed, and cannot remain usable beyond seven days. Legacy `sort=updated` links display `Legacy updated order`; this is distinct from the new content-date ordering.

## Design state coverage

Prepare desktop and mobile frames for default collapsed groups, expanded date controls, repository filters, account filters, Collections, active filters, empty results, invalid shared-link repair, and incompatible category changes. Include component variants for exact/bounded/unknown dates, known zero, large counts, stale values, missing values and unavailable checks with retained evidence. Exercise keyboard focus, dialog dismissal, long source names and wrapped metadata without horizontal overflow. These are design synchronization acceptance items, not a claim that every variant has a dedicated screenshot.

## Visual evidence and synchronization status

| Evidence | Viewport / state |
| --- | --- |
| [Desktop Explore](../../docs/verification/explore-dates-metrics/desktop-explore.png) | 1440 × 1000; scrolled to Project, Capability and Organization facts |
| [Researcher detail](../../docs/verification/explore-dates-metrics/desktop-researcher.png) | 1440 × 1000; public profile and catalog membership |
| [Collections](../../docs/verification/explore-dates-metrics/desktop-collections.png) | 1440 × 1000; dates and member counts |
| [Mobile filters](../../docs/verification/explore-dates-metrics/mobile-filters.png) | 390 × 844; expanded repository controls, dialog scrolled |

These implementation captures use catalog snapshot `4e6acaa6cb7d1cf6a8d62f86` and the unavailable adapter mode. Counts are dated observations, not permanent design copy. Verification scope and limitations remain in the [evidence record](../../docs/verification/explore-dates-metrics/README.md).

- Documentation and implementation mapping: synchronized by this handoff.
- Revised design HTML/MD pair: pending delivery; archived originals remain unchanged.
- Designer visual/interaction sign-off: not recorded.
- Merge and production publication: consult the PR and release evidence; local preview is not production evidence.

When the revised pair arrives, record its filenames, version, date, checksums and replaced scope in the design index. Compare it with the implemented states above and record any remaining differences before marking design synchronization complete.
