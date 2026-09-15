# Issue routing policy

Policy version: 2026-09-15 (English).

This policy separates catalog requests from product issues. Verify activation separately for default-branch forms, repository labels, and website publication. See the [implementation record](verification/issue-routing/README.md).

## 1. Request types

GitHub Issues hosts both catalog requests and product support. Give them distinct names, queues, and metrics. Users select a form; maintainers complete or correct classification.

| Request | Title prefix | Single type label | Purpose |
| --- | --- | --- | --- |
| Source submission | [Submission] | catalog:submission | Recommend a public GitHub repository or organization; only its URL is required |
| Maintenance claim or organization curation | [Claim] | catalog:claim | Verify identity, authority, scope, or changes to existing authorization |
| Catalog correction | [Correction] | catalog:correction | Correct descriptions, classification, versions, links, duplicates, or source accessibility |
| Content withdrawal | [Withdrawal] | catalog:withdrawal | Remove catalog content within an explicit scope |
| Appeal | [Appeal] | catalog:appeal | Review a decision using new evidence, including relisting and authorization disputes |
| Product bug | [Bug] | product:bug | Report failures in the website, search, connection interaction, or public contract |
| Product improvement | [Feature] | product:enhancement | Suggest features, interactions, or behavior changes |
| Usage question | [Question] | support:question | Ask about usage or process before a defect is established |

Each issue has exactly one type label from this table. Prefixes help readers; labels determine queues. Existing bug, enhancement, documentation, or accessibility labels may supplement, but never replace, the type label. Do not use a generic question label to represent submissions or claims.

Examples: an incorrect Scanpy category is a correction; a list that fails to update after selecting a category is a bug; a new task filter is a feature; claiming to maintain Scanpy is a claim. Scientific software algorithm or runtime issues belong upstream unless Network itself is responsible.

## 2. Minimal and mixed requests

- Keep blank issues available for recommendations containing only a public URL. Unlabelled issues await triage and must not be ignored or rejected for lacking labels.
- Intake does not require a claim, author participation, an AIPOCH account, a client, or a special manifest.
- Handle one source or explicit decision scope per request. Organizations may provide a bounded repository list; do not include all repositories automatically.
- Track submission and authority claims separately. Completed indexing does not establish authority. Classify the original issue first; create linked requests only for independent decisions, without asking users to repeat information.
- Correct the classification when someone selects the wrong form. Preserve the discussion. Link duplicate requests to the original issue and close as duplicate, without counting them as successful submissions.
- The website creates a reviewed draft and opens GitHub with [Submission] and catalog:submission by default. Only the user's confirmation on GitHub creates an issue. Corrections use [Correction] and catalog:correction.

## 3. Catalog stages

Each classified catalog request has exactly one stage label. These labels describe the GitHub queue; authoritative catalog, claim, and publication states remain in their existing records and schemas.

| Label | Meaning | Required action or evidence |
| --- | --- | --- |
| stage:triage | Awaiting initial triage | Identify the object, check duplicates, and assign responsibility |
| stage:review | Under review | Verify public sources, descriptions, authority, or scope |
| stage:needs-info | Awaiting information | Specify missing facts, how to provide them, and next steps without requesting sensitive uploads |
| stage:accepted | Approved; awaiting implementation | Record reviewer, time, scope, reasons, and linked PR; this does not mean published |
| stage:verification | Implemented; awaiting verification | Check the production catalog or authorization state; a merged PR alone is insufficient |
| stage:closed | Closed | Add exactly one outcome label and a closure record |

When reopening, remove stage:closed and the previous outcome, then restore the actual stage. Preserve prior decisions in the history. Product bugs, features, and questions do not use catalog stages: accepting a feature plan does not mean catalog inclusion.

## 4. Closure criteria

A closed catalog request has exactly one outcome: outcome:completed, outcome:duplicate, outcome:declined, outcome:cancelled, or outcome:incomplete. GitHub Open/Closed indicates whether work continues, not its outcome.

| Request | Requirements for outcome:completed |
| --- | --- |
| Submission | Verify the review decision, merged commit, actual publication, and live stable catalog ID |
| Claim or organization curation | An independent reviewer verifies identity and scope; verify authoritative records and public presentation. Insufficient evidence remains needs-info; no self-approval |
| Correction | Verify affected fields or entries after actual publication |
| Withdrawal | Verify specified entries, search, public data, and agreed historical artifacts; record limits such as uncontrolled external caches |
| Appeal | Give an explicit review decision addressing prior findings and new evidence. Verify publication for catalog changes; explain any decision to uphold the original outcome |

Cancelling one's own pending request is cancelled. Removing indexed content is withdrawal. Closure after prolonged missing information is incomplete, not completed or declined; new information may reopen the request. Explain declined or duplicate outcomes and how to resubmit or appeal.

The closure record includes object and scope, decision, reviewer and time, evidence, related PRs/commits, applicable publication and live verification, and remaining limits. A green label is not proof of maintainer acknowledgement, organization endorsement, or scientific validation.

## 5. Responsibility and queues

The current catalog review owner is jszhang. Their own claims require another authorized reviewer; without one, the claim remains unverified.

Review unclassified requests, withdrawals and authorization disputes, pending publication verification, other catalog requests, then product issues. Actual bug severity may take priority over routine catalog work.

Initial triage within two business days is an internal target, not a public SLA. Requests waiting over seven days enter the weekly report; do not automatically reject or delete them. Agents still need specific authorization to send replies or create linked issues.

Suggested saved queues:

- Submissions: `is:issue is:open label:catalog:submission`
- Claims: `is:issue is:open label:catalog:claim`
- Corrections: `is:issue is:open label:catalog:correction`
- Withdrawals: `is:issue is:open label:catalog:withdrawal`
- Appeals: `is:issue is:open label:catalog:appeal`
- Bugs: `is:issue is:open label:product:bug`
- Features: `is:issue is:open label:product:enhancement`
- Questions: `is:issue is:open label:support:question`

Count actual classification, closure, and publication results only. Templates and simulated data are not operational metrics.

## 6. Configuration and migration

Create managed labels and merge all eight forms. Catalog forms start at stage:triage; product and support forms have no catalog stage. Keep contribution and governance guidance consistent with the public repository and prohibit private authority evidence in issues.

Preserve existing template filenames and deep links. The legacy correction-or-withdrawal.yml now handles corrections and links to the separate withdrawal form. Maintain the reviewed website draft, explicit user confirmation, and complete-copy fallback for oversized URLs.

Review historical issue content before adding type labels. Old titles or closure alone do not prove acceptance. Previously closed product issues receive only their type label, without catalog outcomes. Existing Chinese prefixes remain historical text; labels continue to determine routing, and no bulk title rewrite is required.

Verify the chooser, default labels, URL-only fallback, and queues. Full intake acceptance using an ordinary external account remains deferred at the user's direction. Automation must not approve claims, inclusion, or closure based on the submitter, body, or a PR merge. No automatic replies or approvals are introduced.

The managed label configuration is `.github/issue-labels.json`. From a reviewed checkout:

```sh
node scripts/issue-labels.mjs check
node scripts/issue-labels.mjs plan
node scripts/issue-labels.mjs apply
```

`check` validates labels and forms offline. `plan` reads differences through authenticated gh. `apply` explicitly synchronizes managed labels and verifies the result; it preserves unrelated labels, does not classify issues, and sends no comments. The target is fixed to imjszhang/aipoch-network. Ordinary CI uses offline checks only.

Website publication follows its separate release process. Roll back entry-point changes or their commit if necessary, without deleting discussions, bulk-removing used labels, or reversing valid withdrawal or authority decisions.
