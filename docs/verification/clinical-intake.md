# Clinical research intake — September 17, 2026

This change adds two publicly observed sources, two projects and two tool resources: `rpact`, `rpact-tool`, `gtreg`, and `gtreg-tool`. All existing IDs and observations remain intact. It does not add claims, organization endorsements, patient datasets, or verified execution results.

## Reviewed scope

- [rpact README](https://github.com/rpact-com/rpact/blob/7f2dc890b86bff774c8abc0a311c77002f9e1a96/README.md) and [DESCRIPTION](https://github.com/rpact-com/rpact/blob/7f2dc890b86bff774c8abc0a311c77002f9e1a96/DESCRIPTION): R software for confirmatory trial planning, simulation and analysis. Proposed disciplines 3.2 Clinical medicine and 1.1 Mathematics are supported by the clinical trial and statistical-method purposes. The pinned DESCRIPTION is development version 4.5.0.9317 and declares LGPL-3. GitHub API license metadata remains unknown; no observed source field is overwritten with the editorial declaration.
- [gtreg README](https://github.com/shannonpileggi/gtreg/blob/5f63af412d18c3a94d553b281fffac9e025adb30/README.md), [DESCRIPTION](https://github.com/shannonpileggi/gtreg/blob/5f63af412d18c3a94d553b281fffac9e025adb30/DESCRIPTION) and [LICENSE](https://github.com/shannonpileggi/gtreg/blob/5f63af412d18c3a94d553b281fffac9e025adb30/LICENSE.md): clinical/adverse-event reporting supports 3.2 Clinical medicine. DESCRIPTION declares GPL (>= 3); the experimental lifecycle label is retained. No regulatory approval is inferred from the stated reporting purpose.

Project summaries are editorial descriptions with source attribution. Tool resources pin the reviewed implementation commits; conditions preserve the license declarations and version/lifecycle limits. Installation instructions are maintainer-described, not independently executed. No upstream package, code, weights, or patient records were executed or downloaded.

## Input handoff and verification

The existing trusted Network collector observed only the two added repositories and owner accounts. Its whitelist projection was appended to the offline fixture; all previous 21 source and 19 account observations remain byte-equivalent as JSON values. The complete proposed registry and merged batch passed validation. Trusted main must refresh all sources again before release; this fixture is not publication evidence.

Local type checks, 461 offline tests and the 126-page fixed-input build passed. Eight desktop/mobile classification browser checks passed, including the two new resources, pinned documentation links and explicit usage conditions. Empty-field behavior continues to be tested using Civil engineering. Full hosted checks, merge and production publication are separate steps recorded by the PR and release workflows.
