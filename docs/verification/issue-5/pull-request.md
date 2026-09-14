# Draft PR: Clarify local connection confirmation and explicit reference continuation

Issue #5 reports that a visitor can reach a connection code without knowing how to open its local confirmation page, and that successful pairing unexpectedly opens a previously selected reference. The connection panel now explains the code, shows the actual remaining time, and supplies a copyable request for Open-Science to open the matching confirmation page through its existing Connector tools. Recovery help remains available after failure or expiry.

Successful connection stays in the connection panel, or leaves it closed if the visitor dismissed it. The retained object has its own section and an explicit “Review reference for …” action. Starting a connection from manual review uses the same sequence. Reference approval, exact content matching, and sending remain separate actions. Deadline checks also reject responses arriving after the absolute cutoff when browser timers were delayed; focus is preserved when waiting controls disappear.

The local change supplements v9-r2 without editing its archived references. Design rationale, final copy, state mappings and visual evidence are linked below. No new Connector API, client dependency, credentials in the page, or public catalog contract change is introduced. Current main's MuData and Chinese guides are retained.

- [Design change](../../../design/changes/issue-5-connection-guidance.md)
- [Acceptance ledger and actual results](README.md)
- [Reproducible evidence](validation.json)

Validation: 295 offline tests and 334 browser checks across unavailable, Demo and real artifacts at root and Pages subpath passed. Visual checks cover 1440/1024/390/360 CSS px and actual browser 200% zoom; synthetic pairing data is used in all published screenshots. These checks do not establish real Connector usability.

All four live scenarios passed within the user's authorized scope. H01 passed by explicit user report after following the webpage instructions and personally approving. H02–H04 used authorized assistance through product UI and the user's own approval in the visible Codex in-app browser; they are not independent-user or native-Chrome usability evidence. H02 retained AnnData, stayed connected, and opened the same reference only after the named review action; sending remained disabled. H03–H04 observed a real expiry, explicit retry with a new code, and recovery through the page's help and a new Open-Science conversation without a temporary CLI workaround. The user confirmed personal approval, and the actual page remained Connected with AnnData retained and zero reference receipts. The brief interval between opening the confirmation page and approval was not directly captured; the acceptance ledger records the combined application report, user report and automated guard evidence.

The first local attempt was blocked by an unconfigured development origin; after explicit user authorization, supported Connector setup enabled that exact origin while retaining production access. This environmental correction is separate from the website implementation. Local implementation, acceptance and reviewable PR material are complete; each attempt and its evidence scope remain recorded.

This is local, reviewable PR material. It has not been submitted, merged, deployed, or represented as design-team signoff. Production publication and the live HTTPS check remain separate steps.
