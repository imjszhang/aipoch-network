# Research classification: FORD and catalog 1.2

Recorded 2026-09-17 (Asia/Shanghai). User decision: use OECD FORD as the primary discipline framework, independent of methods/tasks and resource types. F1 dictionaries, F2 per-entry review and F3 local integration are implemented. Production publication (F4) and new Ops coverage (F5) remain separate; a local build is not a production release.

## Three dimensions

The complete discipline dictionary is [OECD FORD 2015](../registry/taxonomies/oecd-ford-2015.json), attributed to [Frascati Manual Table 2.2](https://www.oecd.org/content/dam/oecd/en/publications/reports/2015/10/frascati-manual-2015_g1g57dcb/9789264239012-en.pdf), printed page 59. It contains 6 broad and 42 second-level fields. Clinical medicine is `3.2`, under `3` Medical and health sciences. This statistical classification is being used for discovery; catalog inclusion does not assert that every software project qualifies as R&D.

[Research tags](../registry/taxonomies/research-tags-v1.json) describe methods, tasks and finer topics. Resource types continue to describe what an output is (tool, workflow, dataset, model, documentation, etc.). Topic tags preserve useful detail such as astronomy or neuroscience where a two-level discipline alone would be too broad. Chinese labels are local translations, not an official OECD translation.

## Optional public fields

Catalog 1.2.0 adds these optional fields to Project and Resource. Legacy v1 inputs remain valid:

```json
{
  "classification": {
    "scheme": "oecd-ford",
    "version": "2015",
    "codes": ["3.2"]
  },
  "research_tags": {
    "scheme": "aipoch-research-tags",
    "version": "1",
    "ids": ["image-analysis", "machine-learning"]
  }
}
```

This is a synthetic format example, not the classification of an existing catalog entry. The tag object includes its vocabulary version (refining the early Ops array sketch) so future readers do not interpret IDs against an arbitrary current vocabulary.

- Codes are distinct second-level strings; parent membership is derived. A multi-disciplinary entity can use multiple codes only with evidence. Do not store both `3` and `3.2` or duplicate codes.
- Omitted classification means that no new classification record is present. Explicitly unclassified uses an empty `codes` array with a non-empty `unclassified_reason`. A non-empty array must not carry that reason. Do not silently map an unknown or method-only legacy label to a FORD field.
- Tags can exist while a discipline is still unclassified. An absent tag object means not recorded; an explicit empty `ids` array means an empty reviewed selection only when supporting review evidence exists. Shape validation does not prove a review happened.
- Projects and resources are classified separately; neither inherits all codes from the other by default. Reusable numerical software is not assigned every possible application discipline. Clinical classification requires applicable evidence, not a keyword match.
- Record evidence in `provenance.classification` and `provenance.research_tags`, following existing editor/maintainer distinctions. Registry input uses separate `classification_provenance` and `research_tags_provenance` arrays. The current editorial writer requires reviewed editor/community evidence, an entry source, an immutable commit, file path and decision scope. Normalization preserves these arrays as the respective public provenance fields. The F1 draft validator does not enforce entity provenance because it only checks the classification fragment.
- Keep `resource_type` unchanged and extensible. Its future/unknown values remain generically displayable. FORD fields are not resource types.

## Snapshot dictionary publication

Keep the authoritative JSON in `registry/taxonomies/`. The generator copies the reviewed dictionary bytes into immutable content-addressed paths under `/catalog/v1/taxonomies/<sha256>.json`. It adds an optional manifest `taxonomies` array with `scheme`, `version`, `revision` (where present), relative `href`, `sha256` and `bytes`. Each pair of scheme/version occurs at most once in a manifest. Revision changes update the digest/reference, never rewrite a previously published dictionary URL. Bind every emitted assignment to a dictionary present in its manifest. No new mandatory collection is added.

New consumers resolve relative paths with the existing safe URL policy, verify digest/bytes, and apply bounded reads (initially 1 MiB per dictionary, at most 16 dictionaries). Retain referenced dictionaries with retained snapshots, subject to existing public-content governance. Clients do not fetch the latest vocabulary implicitly or depend on an external runtime taxonomy service.

Local producer validation rejects unknown codes/versions to prevent publishing invented assignments. Reader handling differs: unknown future optional schemes/versions are preserved or ignored and displayed generically; they are not mapped to a known version. A failed dictionary fetch remains unavailable, not an empty discipline list.

## Compatibility and migration

The local writer emits contract 1.2.0; production release remains F4. Keep `domains` required with original values through the transition; document them as legacy labels and do not repurpose their meaning. Deletion or making the new fields mandatory for old inputs requires a major-version decision.

Old readers must still read the next snapshot using `domains`; new readers must support old snapshots without inventing classification. New views prefer standard fields and can show legacy labels as such when awaiting review. Keep old `?domain=` exact-match behavior; introduce separate field/tag/resource-type filters. Do not redirect an ambiguous old label to a guessed discipline.

All categories remain navigable even at zero occupancy; count unique entities within a parent even when several child codes match. Unknown/unreviewed classification is separate from confirmed zero coverage. Search uses reviewed labels, aliases and tags; empty categories do not automatically generate indexable SEO pages. Filtered URLs are noindex and do not create new static discipline landing pages.

The F2 review was applied to 21 projects and 22 resources, preserving stable IDs, legacy labels and resource types. Of these, 33 receive supported codes and 10 explicitly remain unclassified with reasons. There are no reviewed clinical medicine assignments in this batch. URL-only submission remains available; optional context can suggest disciplines, tags and resource types.

The UI supports comma-separated `field` and `tag` values: OR within a dimension, AND between dimensions. `field=3` includes all reviewed descendants of Medical and health sciences; `field=3.2` is Clinical medicine. Codes remain strings. `field=unclassified` selects explicit pending records; `field=unrecorded` selects legacy records without the field. `resource_type` is an independent resource filter, including future type strings; it also accepts comma-separated values in shared URLs. Invalid discipline/tag links show a repair action rather than an empty coverage claim. `domain` remains the exact legacy filter. Parent counts use unique entity IDs in the selected directory, before other filters; they are not summed child totals.

Each pinned snapshot has its own `taxonomies/<sha256>.json` files so all relative references remain inside that snapshot directory. Retention also preserves each retained dictionary at the root `/catalog/v1/taxonomies/` address for cached root manifests. The release verifier checks both copies and rejects unmanifested files. A dictionary digest contributes to snapshot identity. Browser search/presentation uses the same reviewed dictionaries bundled at build time; independent clients interpret only verified manifest-bound dictionaries.

## Validation coverage and remaining work

F1 tests cover dictionary completeness, code identity (`2.1` versus `2.10`), parentage, malformed dictionaries, tag alias collisions, unknown versions, duplicates and explicit unclassified drafts. Tests cannot prove fidelity of all translated labels, entry-specific evidence or publication.

F3 integration checks cover cross-version catalog reads, manifest/dictionary binding and digest failures, provenance, reconstruction/recovery, material-date updates without first-publication changes, multi-field aggregation, old URL compatibility and desktop/mobile/root/subpath browsing. See the local [verification record](verification/ford-classification.md). Production classification coverage remains unverified until F4 publication and F5 observation.
