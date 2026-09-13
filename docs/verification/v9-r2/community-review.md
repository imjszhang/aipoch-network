# Community and Contribute review

Captured 2026-09-13T09:46:05.390Z against http://127.0.0.1:4290/. Reference: the archived v9-r2 HTML served at http://127.0.0.1:53139/. Both pages were inspected as screenshots at 1440 and 390 px, alongside their reference screenshots.

## Result

Community now follows the reference activity-page layout, with five activity filters and a separate Contribute destination. Contribute follows the three-step public link submission flow, organization scope explanation, upstream collaboration card and optional Open-Science note. The production route has one main landmark and one h1.

The current snapshot displays one evidenced Scanpy–AnnData software relationship and two curated collections. Reuse shows one record; Curation shows two; Validation and Collaboration show an honest empty state. Dates and descriptions come from the current catalog. Filters remain in the URL and survive Back and reload. Read the evidence points to the recorded source; collection links open their actual selection basis.

## Checks

- TypeScript check passed.
- Targeted Community browser suite: 8/8 passed (desktop and mobile). It covers evidence and counts, filter history/reload, empty scientific categories, distinct contribution links, and navigation without JavaScript.
- Both pages have no document overflow at 1440, 1024, 390 or 360 px, and no browser page errors were observed. The narrow activity filter row scrolls internally.
- Without JavaScript, real activity and ordinary navigation remain available; interactive filter buttons are disabled.

## Accepted differences from the prototype

- Production omits the prototype simulation banner and review-only footer text. Header/footer use the shared implementation.
- Current catalog timestamps use ISO dates. The software relationship displays its exact evidence scope rather than the prototype's generic explanation.
- Collections link to their own selection basis instead of a generic repository link. Unsupported validation/collaboration categories explain that such claims are not inferred.
- The first contribution step says “AIPOCH account” instead of “new account,” preserving the lack of an AIPOCH account requirement without implying anything about the external GitHub issue flow.
- Mobile panels stay within the viewport; the reference Community screenshot has a 409 px document at a 390 px viewport. Button/link touch targets and clear heading weights are retained.

## Artifacts

- Browser measurements: [community-browser-results.json](community-browser-results.json).
- Screenshots: [Community desktop](screenshots/community-1440.png), [Community mobile](screenshots/community-390.png), [Contribute desktop](screenshots/contribute-1440.png), [Contribute mobile](screenshots/contribute-390.png).
- Reference screenshots use the same filenames prefixed with reference-.
- Captured stylesheet: http://127.0.0.1:4290/assets/index-D0mbGhXU.css
- Captured script: http://127.0.0.1:4290/assets/index-oN_nSBOB.js

This review does not claim a native screen-reader pass.
