# Research classification vocabularies

F1 foundation, recorded September 17, 2026 (Asia/Shanghai). These versioned files belong to Network; Ops references them rather than maintaining a second dictionary. F3 applies reviewed assignments and distributes exact bytes through snapshot-bound public manifest descriptors. Production publication remains separate.

- `oecd-ford-2015.json`: six broad fields and 42 second-level fields from OECD Frascati Manual 2015, Table 2.2, printed page 59. Preserve codes as strings, including `2.1`, `2.10` and `2.11`. English names retain the reference terminology; Chinese names are local editorial translations. Source attribution and rights notice are inside the file.
- `research-tags-v1.json`: an initial AIPOCH vocabulary for the 15 legacy labels, with independent `method`, `task` and `topic` categories. These are not FORD disciplines or automatic assignments. The list can grow through reviewed, versioned changes; an empty alias list makes no synonym claim.

## Maintenance

Do not remove a discipline because it currently has no catalog entries. Check code uniqueness, completeness, parentage and original English names against the cited standard. A changed code set requires a new standard version; translation/source-metadata corrections increment dictionary revision without reassigning codes. Published bytes must be immutable and pinned by digest.

Tag IDs must remain stable. Use explicit reviewed aliases for equivalent names, not automatic assignment rules. Never reuse a retired ID with a different meaning; vocabulary revisions require a new tag version and migration guidance. Tags do not mirror unreviewed GitHub Topics. A topic tag may coexist with a discipline code, but it must never override it.

`spec/taxonomy.ts` validates these local dictionaries and optional editorial assignment drafts. The regular `npm test` glob includes its boundary tests. The registry validator enforces the editorial assignments and evidence; public 1.2.0 fields remain optional for legacy compatibility. See [classification contract design](../../docs/research-classification.md) for staged integration and compatibility.
