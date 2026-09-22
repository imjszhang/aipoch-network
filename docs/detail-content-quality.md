# Reviewed detail content

This candidate improves 12 existing projects and their 12 capabilities. It adds no entities, changes no URLs or taxonomy, and preserves the open research network positioning. Selection and follow-up belong to Ops; public evidence belongs to each record and the [content review](verification/detail-content-quality/content-review.json).

## Field mapping and compatibility

Contract 1.3.0 adds optional Resource fields `audience: string[]` (1–20 entries) and `getting_started: {text, url}[]` (1–10 ordered steps). Nonblank plain text is limited to 2,000 characters; step URLs must be credential-free HTTPS. Both fields require provenance. Older v1 records without them remain valid and older consumers may ignore them. No status, authority or execution enums change.

| Content | Registry input | Public output / display |
| --- | --- | --- |
| Project role / capability task | existing description | entity description and existing generated search metadata |
| Suitability | resource audience | static/client Who it is for |
| Starting path | resource getting_started | ordered HTML links in How to use it |
| Inputs, outputs, conditions | existing fields | readable lists in existing detail layout |
| Documentation | existing documentation_url | official guide link |
| Field evidence | content_provenance | public provenance[field], description/usage disclosure |

Registry projects permit only description evidence overrides. Resources permit description, audience, getting_started, inputs, outputs, conditions and documentation_url. Each override requires an explicit value, reviewed editor/community evidence and a scope. License, runtime, classification, identities and claims cannot be overridden by this map. Community enhancement evidence is forced to community attribution.

Normalization retains explicit editorial values when upstream descriptions change. Browse projections omit usage detail to stay small; scoped entry payloads and public shards retain it. There is no second authoritative registry or SEO-specific store.

## Evidence, dates and rendering

Rolling documentation is labelled as such and does not prove compatibility with a separately pinned implementation. Audience and starting paths are editorial interpretation, not maintainer endorsements. Existing conditions remain, with English translations where needed and their original review dates. No complete upstream document, tutorial code, image or dataset is copied; no upstream software runs.

Content fingerprints include audience and ordered steps. Positions are incorporated so reordering steps changes content identity, while observation-time changes do not. Records without the new fields keep their original fingerprint shape. First-publication dates and license fields are unchanged.

ResourceGuide renders both initial HTML and client views, within the established detail design. Plain text is escaped and unsafe step links withheld. Empty or absent legacy fields remain explicitly unknown. Evidence can expand, but core guidance is visible without JavaScript. Related entities remain linked through existing source-backed relationships.

Established entity titles and URL identities remain unchanged, including pages with early impressions. Distinct project/capability descriptions feed the existing metadata path. This avoids title churn without adding new SEO-only fields or inventing formal research questions.

## Release boundary

This is an implementation candidate. Merge, trusted refresh, exact artifact review, deployment and live checks require separate evidence. Revert the bounded change on current main and rebuild from current source/suppression state if needed; do not resurrect withdrawn data from an old snapshot. Search observation starts at the actual release time.
