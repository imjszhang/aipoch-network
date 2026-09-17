# Contributing to AIPOCH Network

AIPOCH Network indexes existing GitHub research projects, resources, and organizations. Content and collaboration stay upstream wherever possible. A public GitHub URL is enough to recommend a source: no upstream changes, special manifest, Topics, installed app, or AIPOCH account are required.

## Choose a request type

Use the [issue chooser](https://github.com/imjszhang/aipoch-network/issues/new/choose). Catalog requests use **[Submission]**, **[Claim]**, **[Correction]**, **[Withdrawal]**, or **[Appeal]**. Website bugs, product suggestions, and usage questions use **[Bug]**, **[Feature]**, or **[Question]**. Maintainers correct misclassified requests. Blank issues containing only a public URL remain welcome. See the [routing policy](docs/issue-routing.md) for stages and closure criteria.

The repository is public. A GitHub account is required to submit an issue or pull request. A website-generated draft becomes an issue only after you confirm it on GitHub.

## Recommend a repository or organization

Choose **Catalog: Recommend a source** and provide a public GitHub repository or organization URL. A blank issue containing only the URL also works. Everything else is optional:

```text
https://github.com/example/research-project
```

This is a format example, not a real recommendation. Research purpose, suggested categories, and organization repository scope may be left blank. Missing licenses, structured metadata, or runtime configuration do not prevent candidate review; unknown facts remain unknown.

An organization URL creates an organization candidate. Maintainers may identify public repositories for selection, but do not automatically include all current or future repositories. Each repository or resource in scope is reviewed separately. Community indexing does not imply the organization's participation or endorsement.

Review checks source identity, duplicates, research relevance, descriptions, and the proposed catalog change. Input validation is not an inclusion decision. The original issue records catalog IDs, related PRs, or reasons for declining. Account names, Stars, PR merges, and passing checks do not establish scientific validity.

## Correct, withdraw, or appeal

Choose the corresponding catalog form and identify the catalog ID or public source URL, requested scope, and supporting evidence. Anyone may report verifiable incorrect links, descriptions, duplicates, stale versions, inaccessible sources, invalid claims, or scope disputes.

Approved withdrawals remove content from the agreed detail pages, search, static data, and accessible historical artifacts, with suppression against automatic reintroduction. Rollbacks must not restore withdrawn content. A source becoming public again does not cancel a valid withdrawal; relisting requires review of the original reasons and scope. See [governance](docs/governance.md).

Do not include tokens, private membership lists, personal contact details, or identity documents in issues, PRs, or attachments. Arrange restricted verification through an existing agreed channel when needed. If none exists, describe only the need for restricted verification and leave the claim pending. The project does not presume a private intake service is available.

## Claim maintenance or organization curation

Choose **Catalog: Claim maintenance or organization curation** and provide your GitHub identity, the objects and scope, and publicly verifiable evidence. Claims are not required for source recommendations.

Repository maintenance confirmation covers only verified maintenance scope. Organization curation requires explicit owner authority or verified owner delegation to a specific person for a specific scope. Organization membership, merged PRs, access to one repository, or self-description alone are insufficient.

Curation applies to an explicit repository/resource list. Additional or future entries require review. Transfers, identity changes, expiry, revocation, or disputed evidence trigger rechecking. Claim status, community indexing, organization curation, and scientific validation remain separate.

## Submit catalog improvements directly

Contributors may propose PRs to human-maintained `registry/` records, preserving stable IDs, evidence, scope, and responsibility for descriptions. First-time recommendations can use a URL-only issue without learning the file format. See the [catalog contract](docs/catalog-contract.md) and repository schemas.

Maintainers prepare verified observations for new sources; recommenders do not need to write fixtures. Offline CI uses `fixtures/pilot/snapshots.json` and rejects new registry sources without matching reviewed observations. Maintainers use trusted reviewed code to verify public sources, select allowed fields, and hand off catalog changes together with matching offline inputs. See the [maintainer guide](docs/maintainer-guide.md). Submitted snapshots and authority statements remain unverified data until reviewed.

Do not manually edit derived outputs, copy complete upstream repositories, or execute source text as collection instructions. Projects, source repositories, and resources are distinct entities with many-to-many relationships. Do not invent authorship, executability, or licensing conclusions.

PR descriptions should explain the change, evidence, claim or withdrawal impact, and applicable checks. Preserve attribution and applicable licenses for third-party content. Indexing does not change an upstream license; contribution templates do not create additional authorization.

## Suggest an entry for the README

The README is a curated entry point, not a copy of the entire catalog. A catalog candidate can be proposed with only a public URL; selection for the README additionally requires a clear research use, documentation, source and license review, and a concise explanation of the resource's role. See the [selection criteria](README.md#selection-criteria).

For list changes, propose a short factual description and a display section in the README. Research disciplines use OECD FORD 2015; projects and resources may have multiple evidence-backed subfield codes. Method/task tags and resource types are separate. A README display section does not replace the catalog classification; general tools can remain pending when evidence is insufficient. Recommendations from all six broad fields are welcome, including fields currently without entries. Link the project name directly to its upstream repository or official documentation. Include an AIPOCH detail link only for an existing, verified catalog page. Avoid duplicate entries, promotional claims, and using star counts as a quality threshold. Maintainers recheck affected entries when catalog identities, licenses, maintenance status, or withdrawal decisions change.

## Where to discuss

| Topic | Destination |
| --- | --- |
| Catalog descriptions, categories, relationships, or links | AIPOCH catalog correction issue or PR |
| Research methods, upstream code, releases, or contributions | The original project's issues, discussions, or contribution guide |
| Organization authority or maintenance scope | AIPOCH claim review; agreed restricted channels for sensitive evidence |
| AIPOCH website or contract behavior | AIPOCH product issue with page/version and reproduction details |

Respect original authors and differing research views. Discuss verifiable facts. Maintainers explain declined requests and possible remedies for out-of-scope, duplicate, unverifiable, or unsuitable disclosures.

Operational procedures are in the [maintainer guide](docs/maintainer-guide.md); full governance rules are in [governance](docs/governance.md).
