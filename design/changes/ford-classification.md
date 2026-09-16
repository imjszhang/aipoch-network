# Research discipline filters — F3 local addition

2026-09-17. Implements the user's approved OECD FORD classification within the existing v9-r2 directory sidebar/mobile filter dialog, rows, cards and details. The archived HTML/MD pair stays unchanged; designer sign-off and production publication are not implied.

- Add a compact “Research discipline” selector grouped by the six broad fields. Include all 42 leaves, parent aggregation, zero counts, explicit awaiting-classification and unrecorded states. Selecting a value adds/removes a wrapping removable chip; selection remains in the URL and survives reload.
- Add “Methods, tasks & topics” in three tag groups, independently of discipline. Add “Resource type” for capabilities. Existing “Research area” becomes “Legacy research area” and keeps the original values and exact matching.
- Counts are unique entries in the selected directory before other filters. Empty Clinical medicine is a visible zero, not a removed discipline. Clear scope conflicts when changing entry types interactively; hand-edited invalid URLs show repair feedback.
- Preserve the black/white/yellow hierarchy, compact native controls, mobile dialog and result layouts. Long labels wrap in chips/cards; selectors remain constrained to the sidebar. No new discipline landing pages or changes to Network positioning.
- Cards and rows prefer English standard discipline labels; legacy records explicitly say Legacy. Pending records say “Awaiting discipline classification”. Details expose separate discipline/tag evidence.

Local desktop/mobile behavior and screenshots are recorded in `docs/verification/ford-classification.md`. No remote client or live GitHub request is needed by the browser.
