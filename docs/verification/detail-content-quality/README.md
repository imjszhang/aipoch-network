# Detail content candidate — 2026-09-22

Base: `ce328d104432917f58b0137054728f18390311e2`; branch: `codex/detail-content-quality`. This is prerelease evidence, not a production deployment or a search-growth result.

The batch covers AnnData, PsychoJS, anaStruct, xarray, spglib, Astropy, Biopython, Cantera, CLTK, DeepChem, AquaCrop and rpact: 12 existing projects and their 12 capabilities. Each project overview explains scope; its capability describes a concrete task, intended audience, inputs, outputs, two official starting links and documented conditions. Editorial interpretation is attributed separately from upstream facts. Existing license, runtime, classifications, relationships and stable identities remain intact.

[Content review](content-review.json) records retrieved primary sources, versions, supported fields, reviewer role and recheck triggers. Some rolling docs differ from the separately pinned implementation; no compatibility guarantee or upstream execution is implied. No upstream code, full README, image or tutorial was copied or executed. This is Codex editorial review, not independent scientific validation.

[Static checks](static-check.json) cover 483 assertions across the bounded registry diff and all 24 raw HTML pages: unaffected entities, identity fields, metadata, indexability, canonical paths and visible content. Three sample capabilities were also checked in desktop/mobile browsers with JavaScript disabled and enabled, including evidence expansion and overflow. Desktop/mobile screenshots were inspected locally; temporary screenshots and logs are excluded from Git.

Tests cover legacy records, refresh preservation, unsafe URLs, escaped markup, required provenance, blank/oversized input, ordered-step fingerprints and community attribution. Existing search tests now allow Xarray to match NumPy mentioned in its description; AnnData metadata and Biopython provenance expectations reflect the reviewed content. The new browser test respects the existing noindex policy of non-root deployment paths.

## Release handoff

Review the exact PR head and its hosted checks. After explicit release authorization, merge, run the trusted refresh, inspect the resulting immutable candidate, deploy through the existing Pages process and independently check all 24 URLs plus unchanged sentinels. Offline fixture snapshot `e1bcaf1ffaac24f2c77b2a35` is a test artifact, not the deployable production candidate.

Rollback: revert this bounded change on current main, then rebuild with current observations and withdrawal state. Do not deploy an old snapshot that might resurrect withdrawn entries. A content or evidence error, missing body, unexpected index policy or interaction regression triggers correction/rollback review. Record actual T0 before collecting T+7/T+28 observations; do not infer causality from the small reference group.

## Local verification results

Node 24.18.1, locked dependencies, fixed offline observation batch, 2026-09-22:

| Check | Result |
| --- | --- |
| TypeScript and diff whitespace | passed |
| Unit/contract/pipeline/consumer tests | 520 passed, 0 failed |
| Default root / subpath browser suites | 148 passed + 86 mode-specific skips each |
| Demo root / subpath browser suites | 172 passed + 62 mode-specific skips each |
| Real adapter root / subpath protocol suites | 57 passed + 1 existing skip each |
| All six static builds | passed |
| Bounded registry and 24-page static review | 483 checks passed |

Browser total: 754 passed, 0 failed; skipped cases are configuration-specific or an existing durable-profile skip, not successful checks. Protocol fixtures do not prove a real connected client or scientific execution. Initial failed expectations (old content/search assumptions; root-only robots expectation) were corrected and affected full suites rerun. Hosted checks are tracked against the exact PR head, separately from these local results.
