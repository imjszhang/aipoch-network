# FORD classification — F3 local verification

Recorded 2026-09-17 (Asia/Shanghai), branch `codex/ford-classification-foundation`, base `d6312165c7ab078aa81fcba8291a8103af25602d`. These are local uncommitted changes; no push, PR, merge, production refresh or deployment occurred in F3. Sync and review against current main before F4 release.

The reviewed registry now carries 21 projects and 22 resources with separate classification/tag evidence. Thirty-three entries have supported FORD leaf codes; ten explicitly await discipline classification. Legacy domains and resource types are unchanged. Clinical medicine is present in the complete 6/42 vocabulary and has zero assigned entries in this batch. This does not narrow the open research network's scope.

## Verification

- Pinned Node 24.18.1; `npm run check`: typecheck, all 461 offline tests and the static build pass. New checks cover malformed/unknown assignments, separate evidence, old records, snapshot-bound dictionaries, missing/corrupt dictionaries, retained revisions, recovery, material date fingerprints, first publication, bilingual search and filter semantics.
- Root and `/aipoch-network/` builds: 117 pages each. Local snapshot `a18ffd7bfd640d37e8192b96`, contract 1.2.0, two exact dictionary artifacts. The offline pilot source observation time remains historical; this is not a fresh production candidate.
- Playwright `classification`, `directory-navigation`, `explore-dates-metrics` and `site`: 66 checks at root and 66 at the subpath, each covering desktop and mobile. The final shared multi-resource-type control adjustment received a root rerun and a 6-check subpath classification rerun. Results include empty clinical medicine, multi-selection, legacy links, reload, repair, noindex, evidence and layout bounds.
- The unchanged pre-F3 independent reader from the base commit reads the 1.2.0 output; its reconstructed collections equal the new reader's collections. Its SHA-256 is `33cda5736a5bf9434e935d8cb59efd61045429c705d97b220b051749fc354b00`.
- Read-only production check at `2026-09-16T16:33:21.470Z`: the new reader consumes production 1.1.0, snapshot `a41e47fdfc2e4f71a9a98139`, with the same 21 project/22 resource IDs as F2. Production still lacks the F3 rollout.
- Desktop and mobile screenshots were inspected locally. Generated builds, browser traces/reports and screenshots remain ignored artifacts. Ops stores source/log/artifact hashes and a minimal result, not a second registry.

Commands: `npm run check`; `npx playwright test classification.test.ts directory-navigation.test.ts explore-dates-metrics.test.ts site.test.ts --workers=4`; subpath build with `SITE_BASE=/aipoch-network/`, and the same suite with matching `TEST_BASE`, `TEST_OUTPUT` and isolated port. Subsequent focused rerun: `classification.test.ts`.

## Remaining

F4: reconcile current main, review the release diff, commit/merge via the normal process, produce a fresh trusted candidate and separately publish/verify it. F5: observe the published taxonomy coverage, select research batches and run the long-term curation pipeline. Do not use this local projection as a live coverage baseline or as evidence of clinical resource inclusion. The ten unresolved classification records and F2 review questions remain open.
