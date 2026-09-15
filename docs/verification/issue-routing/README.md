# Issue routing implementation and verification

2026-09-15. Original baseline: c6f94edf166f1e3cf89839ae2c4ccf8578007355.

## Implemented behavior

Eight forms and 19 managed labels separate catalog requests from product bugs, features, and questions. URL-only blank issues and existing template filenames remain supported. Contribute has two entry groups. Submission and correction drafts use distinct titles, labels, and bodies; valid catalog objects without source links support corrections, while unknown targets show an explicit error.

Three-step review, renewed confirmation after edits, complete copying for long drafts, and copy-failure feedback remain intact. No automatic submission, approval, claim, or comment is introduced.

[PR #9](https://github.com/imjszhang/aipoch-network/pull/9) merged as c046cbfb2336e38fa8f181da40e5922225108246. Labels were applied and read back with no remaining differences. Historical issues #5 and #7 received product:bug and product:enhancement respectively; both remained closed without catalog outcomes. The authenticated GitHub chooser displayed all eight forms and the blank issue entry. The source form showed its required URL field and default catalog:submission/stage:triage labels; no issue was submitted.

## Original validation evidence

[Structured results](validation.json) records Node 24.18.1, type checking, 390 passing tests, and a static build. Targeted site/community/issue-routing browser checks passed 38 tests at each of the root and subpath configurations with no failures or flaky tests. Coverage includes desktop/mobile, keyboard confirmation, focus visibility, oversized Unicode drafts, and copy failure. Tests intercept external navigation and create no real issues.

The local v9-r2 reference was visually compared. Screenshots in this directory were refreshed from the English subpath candidate. They show desktop and mobile contribution/correction states, not production deployment evidence.

## English follow-up

The user requested English for the entire issue-routing update. Forms, title prefixes, managed label descriptions, contribution guidance, and this policy and implementation documentation now use English. Template filenames and label identifiers remain stable. Unicode test inputs intentionally exercise international user content; they are not interface copy.

Default-branch forms and repository labels take effect independently of website deployment. Production website publication is a separate step. Full submission acceptance using an ordinary external account remains deferred.

English follow-up validation passed: 390 unit tests, type checking, static builds, and 38 browser tests each at root and /aipoch-network/. The 19 English label descriptions were applied; readback showed no differences. See [English validation](english-validation.json).
