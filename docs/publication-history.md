# Publication history and catalog dates

Publication history belongs to AIPOCH Network's release workflow. A successful source refresh creates a candidate; it does not prove that any catalog identity has appeared on the public site. The independent publication ledger binds minimal identity/fingerprint membership to the exact source commit, catalog snapshot, reviewed candidate artifact digest, reviewed published-file digest, deployment run and attempt, and successful deployment completion time.

The reviewed baseline is `registry/publication-ledger.json`. The next trusted refresh combines it with subsequent verified release receipts in `.cache/publication-ledger.json`. Generated site artifacts contain public date fields but never contain the mutable publication ledger or raw deployment metadata.

## Date decisions

- `first_published` is exact only when the reviewed history establishes the first public appearance of that stable identity. Incomplete historical coverage produces an `observed_bound` (“Listed by”) or an unknown date. A partial ledger also cannot prove the absence of a supposedly new identity in the missing past.
- `content_updated` from a published fingerprint is an `observed_bound`: it proves that the content was present by that deployment, not when an editor or upstream maintainer wrote it. Exact editorial times require separately reviewed evidence.
- A candidate whose material content differs from the last published fingerprint has an unknown current content date until it is published and a later refresh consumes the receipt. An unpublished edit followed by a revert does not advance the accepted date.
- A genuinely new identity receives its first-publication date in the next ordinary refresh after its release receipt exists. This deliberate one-refresh delay does not trigger an automatic second deployment or change the already reviewed site artifact.
- Actor and Organization projections of one GitHub identity share first-publication history. Renames and transfers preserve that identity's date. A reused name with a new identity does not inherit it.

Fingerprint version 1 includes meaningful titles, descriptions (including observed upstream fallbacks), classifications, usage, explicit source references and curated pins, collection membership, relationships, and semantic license information. It sorts unordered fields. It excludes metrics, observation/build/provenance timestamps, derived counts, and automatically moving default-branch revisions. A license document's location is retained while automatic GitHub revision components are normalized. The checked-in implementation and boundary tests define the exact whitelist. Changing that whitelist requires a new fingerprint version and a reviewed migration; do not reinterpret existing hashes silently.

## Release and refresh flow

1. The existing low-permission `verify` job checks the reviewed candidate bytes, source SHA, snapshot, source freshness, withdrawals and configured release mode. `publication-ledger.ts prepare` repeats the artifact binding and creates a minimal sidecar from that exact catalog and the reviewed registry checkout.
2. `verified-publication-index-RUN-ATTEMPT` retains the sidecar separately from the immutable Pages package. It contains IDs and fingerprints, not source descriptions or a full catalog.
3. The privileged `deploy` job still has no checkout, package installation, source build, or artifact-code execution. It publishes the same reviewed package.
4. After public smoke succeeds, the separate `record-publication` job reads this exact deployment attempt and sidecar. It has only `contents: read` and `actions: read`, no Pages write or push permission. It records the `deploy` job's completion time and uploads `catalog-publication-receipt-RUN-ATTEMPT`.
5. The next normal trusted refresh runs `scripts/restore-publications.ts`. It inventories every deployment attempt after the explicitly reviewed checkpoint, validates receipt identity and completion metadata, and writes the local combined ledger. The build consumes that file through `PUBLICATION_LEDGER`.

Receipt creation does not publish again. A job or artifact failure after successful deployment does not mean “never published”: restoration stops with a reconciliation requirement. A newer successful receipt cannot hide a missing intervening deployment.

## Bounds and checkpoint maintenance

Publication receipts and prepared indexes have a 90-day Actions retention period. The ledger has an 8,000,000-byte limit, at most 128 uncheckpointed receipts, and at most 50,000 identity/projection entries per index or checkpoint. Restoration reads complete bounded inventories: at most 1,000 workflow runs, 20 attempts per run, 100 jobs per attempt, and 1,000 artifacts. Truncated, changing, duplicate or oversized inventories fail before they can be treated as complete evidence.

Before these retention or count limits are reached, review the combined ledger and create a checkpoint. Compaction preserves first-publication and accepted content dates, one latest fingerprint per identity/projection, last membership state, last publication evidence, and any relisting time. It discards superseded per-release fingerprint lists. It does not write to GitHub or push changes automatically.

```sh
# Print the canonical digest of the exact combined ledger to review.
npx --no-install tsx -e 'import {readPublicationLedger} from "./pipeline/catalog-dates.ts"; import {sha256,stableJson} from "./pipeline/json.ts"; readPublicationLedger(".cache/publication-ledger.json").then(value => { if (!value) throw new Error("Missing ledger"); console.log(sha256(stableJson(value))); });'

# Replace REVIEWED_DIGEST with the reviewed 64-character digest.
npx --no-install tsx scripts/publication-ledger.ts checkpoint .cache/publication-ledger.json .cache/publication-checkpoint.json REVIEWED_DIGEST
```

Review the resulting minimal checkpoint, then update `registry/publication-ledger.json` in a normal reviewed change before the required Actions evidence expires. A checkpoint's `through` closes the reviewed earlier history; the timestamp of an individual receipt does not. A missing or expired required receipt blocks automatic restoration until it is recovered or explicitly included in a reviewed checkpoint.

Withdrawal and suppression rules still govern the normalized catalog and every retained downloadable snapshot. Applying publication dates never creates records or recovers withdrawn titles, URLs, descriptions or metrics. The ledger retains only minimal stable IDs, fingerprints, dates and release evidence so that relisting the same identity can preserve its established date. The public catalog omits withdrawn records. Any separate policy requiring erasure of a minimal history identity must be handled in the reviewed checkpoint; it must not silently reintroduce public content.

## Read-only reconciliation

Use the **original successful deployment attempt**. A recorder-only “rerun failed jobs” starts a new attempt without recreating the earlier verifier sidecar or deployment. The recorder deliberately rejects borrowing another attempt's evidence. Do not redeploy just to repair a receipt.

Read the original `verified-publication-index-RUN-ATTEMPT` artifact, attempt metadata, and complete jobs response from GitHub. Keep raw metadata local under `.cache/`; do not commit it. The following command only produces a local review report:

```sh
npx --no-install tsx scripts/publication-ledger.ts reconcile .cache/prepared-publication.json .cache/publication-run.json .cache/publication-jobs.json .cache/publication-reconciliation.json
```

The result is `not_published` when the deployment did not succeed, `verified_publication` when deployment and smoke succeeded, or `pending_reconciliation` when deployment succeeded but smoke did not confirm the public page. The latter includes a proposed receipt and an explanation. Verify the exact public snapshot and applicable release evidence before accepting it. An absent receipt upload after successful smoke can be repaired from the original immutable attempt evidence through the same command.

After reviewing the report and public evidence, save only its proposed `receipt` as a separate local JSON file. Review its canonical `receipt_sha256` from the report. Application requires that exact digest and a pre-existing reviewed baseline:

```sh
npx --no-install tsx scripts/publication-ledger.ts apply .cache/reviewed-publication-receipt.json .cache/publication-ledger.json REVIEWED_RECEIPT_DIGEST
```

This validates the schema, repository, exact deployment identity, UTC times, fingerprints, digest bindings and byte limits. It modifies only the specified local ledger. Reapplying the identical receipt is a no-op; conflicting receipts for one attempt fail. An older receipt overlapping an existing checkpoint requires reviewing and rebuilding that checkpoint, not replaying it automatically. To make the recovery available to future trusted refreshes, review and commit the minimal updated checkpoint through a normal PR.

## Backfill and offline review

Historical membership must come from independently verified **published** artifacts. A retained candidate or snapshot alone is insufficient. When building a historical index, use that deployment's own exact registry source revision; a current registry can misclassify an old automatic reference as a curated pin. Inventory missing deployments, artifacts and source revisions explicitly. Use complete coverage only when the historical evidence supports that claim.

```sh
npx --no-install tsx scripts/publication-ledger.ts backfill .cache/reviewed-site/internal/catalog.json registry/catalog.json registry/publication-ledger.json .cache/catalog-dates-backfill.json
```

The report lists every current public identity/projection, proposed dates, basis, evidence, changed status and missing-history reason. Build-time application only decorates the already validated normalized catalog; it does not edit the registry, reclassify entries or promote submissions. Repeating a dry run over the already decorated catalog and identical ledger produces no changed rows. Live GitHub metric collection is separate from historical publication backfill, and old counts are never relabelled with a new observation time.

Relevant offline tests are `pipeline/tests/catalog-dates.test.ts` and `pipeline/tests/publication-evidence.test.ts`. They cover material change detection, unordered inputs, moving revisions, unpublished reversions, exact/bounded/unknown dates, identity changes, relisting, no-op application, strict schema and byte limits, failed deployment/smoke, original-attempt recovery, incomplete inventories and intervening missing receipts.
