# Saved runtime query qualification

Runtime query v2 identity binds the pinned request and its source/family
qualification semantics. Request and artifact formats remain unchanged. Earlier
query cursors cannot be reused under the new identity.

Each returned observation is one projection occurrence. Its stable `evidenceId`
continues to identify the logical observation; it does not identify one immutable
family's source attribution. `reference.family` indexes the page's complete
`pinnedFamilies` table in requested order. Combining that table entry's generation,
manifest hash and capture ID with the observation's evidence ID and
`reference.rowHash` identifies its exact retained projection. Explanations carry
matching `evidenceRefs`; omissions retain the same family/hash reference beside
their logical ID. An omission's row hash is the expected hash from the verified
query index; omitted bytes have not thereby been read or verified.

Multiple families may intentionally project the same saved capture differently.
The query returns each occurrence, without blind logical-ID deduplication or
last-write-wins attribution. Family order changes only page handles/order, not
the resolved immutable owner. The family table and reference semantics remain
stable across cursor pages. Consumers counting logical observations must count
logical IDs separately from projection occurrences. Each selected retained row
still undergoes its own existing hash/key verification, even if an intact sibling
has the same logical ID. Validators reject dangling family handles, mismatched
capture/omission owners, duplicate family occurrences and incorrect explanation
references.

Source selectors retain OR semantics for row retrieval. `coverage.requestedSources`
qualifies each requested source/hash pair in each pinned family. It records
snapshot presence, retained exact-source observation count, selected/excluded
state and an explicit reason for absence or no retained exact observations.
Counts use the existing source-key index, without hydrating evidence rows.
`cost.sourcePredicates` counts those actual pair predicates. Counts are scoped to
the family's retained exact-source evidence, independently of later row-kind or
record filters. Family-wide join totals remain separately labeled
`sourceJoinCountsScope: family`; they cannot qualify a different requested pair.

Adding a successful source alternative cannot erase another pair's absence or
missing exact retained evidence. Snapshot-present/no-exact-observation is distinct
from absent-from-snapshot, unavailable mapping and incomplete capture/import.
`executionCoverage: unknown` explicitly preserves the fact that a complete scan
of retained observations cannot prove all source executions were captured.
Excluded captures have `not-selected` source receipts and no local predicate
counts; their incomplete capture/import state cannot invalidate another selected
capture's result. Receipts describe the pinned request on every page, including
pages without matching rows. Final byte/time/record limits still apply.

Authored controls use actual imports, immutable row-byte/hash oracles, source-pair
indexed-predicate instrumentation, family-order and cursor-boundary checks,
selected/excluded incomplete captures, tamper negatives and the real published
semantic witness's verified/ambiguous/unverified attribution variants. They are
unrun; current Windows qualification and API/MCP/CLI execution remain deferred.
