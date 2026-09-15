# Catalog dates and public GitHub metrics

This additive v1.1 contract keeps Projects, Capabilities, Organizations, Researchers and Collections. Source repositories remain provenance records. Stars and followers describe publicly reported GitHub activity; they do not establish endorsement, ownership, research quality or admission eligibility.

## Field dictionary

| Field | Meaning |
| --- | --- |
| `catalog_dates.first_published` | First successful public deployment containing this stable identity. |
| `catalog_dates.content_updated` | Evidence for the current material catalog content revision. |
| `source_activity.default_branch_head` | Observed default-branch HEAD SHA, its Git committer date when valid, observation time and date status. |
| `observation` | Latest completed check attempt, last successful check and independent result. |
| Source `github_metrics.stars`, `forks` | GitHub `stargazers_count` and `forks_count`. |
| Actor `github_metrics.followers`, `following`, `public_repositories` | GitHub's public profile counts. Organizations resolve the shared Actor; they do not store another copy. |

Dates contain `basis: exact | observed_bound | unknown`, an optional UTC `value`, and an evidence URL. Known dates require evidence. Unknown dates have no value. `Listed by` and `Change observed by` are upper bounds, not invented exact dates. Complete deployment coverage can prove first publication; publication membership alone only bounds a content change. New or changed content without accepted publication evidence stays unknown until reconciliation; no build clock is substituted. A publication receipt arrives after the immutable package is deployed, so a newly published entry's first date appears in the next normal refresh. There is no automatic second deployment.

`updated_at` retains its v1.0 behavior for compatibility: repository metadata time for Sources, observation time for Actors, and build time for generated catalog entities. It is not the new content date. `sort=updated` retains that legacy ordering. Optional legacy Source `stars` is projected from the same metric observation. Consumers can ignore the new optional fields and still resolve exact resource references.

Metrics contain optional safe nonnegative integer `value` and `observed_at`, required `last_attempt_at`, `result: ok | unavailable | unsupported | invalid_response`, and `visibility: public_api`. A real zero is different from an absent value. Failed checks retain previously observed values for at most seven days in public output. Values up to 48 hours old are fresh; older values are stale, and those older than seven days are unavailable. These are catalog operating thresholds. Individual fields and auxiliary requests have independent timestamps; repository success does not refresh account or commit evidence. Conditional responses refresh only retained fields covered by that endpoint.

GitHub can mask private-profile follower/following counts to zero. The UI therefore says **publicly reported**, without promising a complete total; detected restrictions remain unavailable. We do not collect follower identities, emails, private counters or raw profiles. Organization Following is unsupported in our projection. A source becoming private does not erase a separately reviewed public researcher profile; an explicit actor withdrawal does. GitHub public repository counts are distinct from AIPOCH project and capability counts.

## Collection and activity

Bulk refresh requests one repository response and one small commit-list response per source, plus one public profile per unique account, including effective reviewed researcher profiles that do not own a catalog source. `GET /repos/{owner}/{repo}/commits?sha={default_branch}&per_page=1` avoids downloading large patch bodies while observing the branch head. It records the committer date, not `pushed_at`, repository `updated_at`, the author date or a maximum over all branches. A force push can move it backwards. Future/malformed dates retain an explicit status without a comparable date. An unavailable HEAD check cannot reject URL-only intake.

For the current inventory this is 21 repository reads, 21 public HEAD reads and 19 public profile reads. Trusted refresh uses its existing token only for repository metadata; public HEAD/profile requests remain anonymous. Bulk refresh skips optional README and release enrichment to prioritize this bounded request budget; standalone intake retains its existing behavior. Retries are bounded and can add requests. There are no browser GitHub API calls. Counts on the live site reflect its deployed artifact, not the schedule or an unpublished candidate.

Fixed resource references retain their own SHA and path. “Latest source commit” does not imply that a pinned resource has changed.

## Explore rules

Filters combine with AND. Repository criteria apply to Projects, Capabilities and Sources; follower criteria apply to Researchers and Organizations. All view visibly narrows to the applicable kinds. Interactive scope changes clear conflicting controls and announce the change. Incompatible shared URLs show an error and repair controls. Collections have catalog dates and member counts, without inherited popularity totals.

Only `primary` and `implementation` SourceRefs lend repository metrics. Sources are deduplicated by stable ID. At least one **same source** must satisfy every repository threshold, activity range and observation criterion. A high-star repository and a different recently changed repository cannot jointly qualify a project. Cards name the source that witnesses the match. Repository sorting uses the best matching eligible source and never sums unrelated counts.

| URL parameters | Accepted values |
| --- | --- |
| `added_after`, `added_before`, `updated_after`, `updated_before`, `source_after`, `source_before` | Inclusive `YYYY-MM-DD` UTC dates. |
| `added_date`, `updated_date`, `source_date` | `unknown`; catalog date mode includes bounds and unknown dates. |
| `min_stars`, `min_forks`, `min_followers` | Optional nonnegative safe integers; zero requires a known count. |
| `observation` | `fresh`, `stale`, `missing`. Applies to repository/account observations. |
| `include_stale_metrics` | `1` explicitly admits retained values within seven days; default off. |
| `sort` | `relevance`, `title`, `added`, `catalog_updated`, `source_activity`, `stars`, `followers`, legacy `updated`. |

Existing query/type/domain/organization/collection/page parameters remain. Duplicate parameters, invalid numbers, invalid enums, impossible dates and inverted ranges are not coerced. Changes reset pagination. Date presets serialize absolute UTC dates for repeatable shared links; day ranges use half-open UTC intervals internally. Exact date thresholds exclude historical bounds and explain the missing/bounded option. Sorting keeps unknown entries last, bounded dates after exact dates, and uses stable identity to break ties. Stale metrics remain unranked unless explicitly admitted. The browser captures one reference time after hydration, so results do not drift while navigating pages; loading a new catalog can change results.

## Content history and release evidence

Versioned fingerprints include substantive descriptions, classifications, usage, explicit source references/pins, relationships, selected membership and meaningful license information. Unordered sets are canonicalized. Counts, timestamps, automatic moving HEAD SHAs and derived totals are excluded. Repeated builds, metrics-only updates and reverted unpublished edits do not advance content dates. History records only stable IDs, object kinds, hashes, dates and release evidence—not a second registry.

The reviewed baseline is `registry/publication-ledger.json`. A trusted refresh restores subsequent successful release receipts to `.cache/publication-ledger.json`; the trusted build selects that state through `PUBLICATION_LEDGER`. Offline builds default to the reviewed baseline; an explicitly missing ledger fails with a history-gap error. A missing historical state does not reset all entries to today. The build report binds the ledger digest.

Deployment verification prepares an independent minimal publication index from the exact verified candidate and matching source checkout. A separate read-only job, after deployment and smoke, records the completion time and identity as a receipt artifact. The privileged Pages job neither checks out source nor rebuilds the package. Artifact retention is finite: checkpoint reviewed minimum evidence before expiry. Missing/expired receipts and a successful deployment with failed smoke require reconciliation; they never mean “unpublished.” See [publication maintenance](publication-history.md).

## Primary API references

- [Repository fields](https://docs.github.com/en/rest/repos/repos#get-a-repository)
- [Branch commit listing](https://docs.github.com/en/rest/commits/commits#list-commits)
- [Public user profiles and privacy behavior](https://docs.github.com/en/rest/users/users#get-a-user)
- [Public organization profiles](https://docs.github.com/en/rest/orgs/orgs#get-an-organization)

Checked on 2026-09-15. Actual backfill coverage, public probes and validation results are recorded in [implementation evidence](verification/explore-dates-metrics/README.md).
