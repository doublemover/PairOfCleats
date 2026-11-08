# SQLite bounded native row correspondence — 2026-10-28

Source `1173c6ec774d9b6df11cb078851724ca34a28a6f`, tree
`9e90901a3ba1dab7c4a00e7247a503ac77515e19`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

Equal counts alone allowed dense rows to name another chunk/mode and ANN rows
to name other dense IDs. The post-import owner now checks those native relations
inside the same original read transaction as counts and artifact identity. It
also checks missing chunk-to-file bindings and exact native file chunk counts.
Empty manifest entries with zero rows remain valid. ANN row IDs follow the actual
shared toSqliteRowId owner, which preserves doc_id rather than adding one.
Disabled ANN remains unadmitted; a ready/present representation checks membership
in both directions. Query/extension failures propagate rather than qualifying
empty evidence.

Every relation retains at most 16 bounded witness rows, collecting a seventeenth
only to mark truncation. File samples cap path text at 512 characters. Native
indexed joins/aggregation replace an additional JavaScript corpus Set. Injected
snapshot lookalikes cannot claim native correspondence. The count fixture still
requires three scalar count queries on one handle/transaction; its counter now
distinguishes those scalar statements from relation aggregation.

Sixteen `storage/sqlite/build/row-correspondence/*` controls cover empty/complete
positives, legitimate empty file entries, equal-count wrong dense IDs/modes,
missing files, wrong/null file counts, wrong/missing/extra ANN IDs, disabled empty
ANN, bounded mismatch evidence, exact required-query failure, transaction refusal
and forged snapshots. They use tiny actual SQLite tables, with a regular-table
ANN control; this does **not** qualify sqlite-vec. **All sixteen controls and
affected existing fixtures are unexecuted.** Prior assertions remain.

Format/ESLint, five JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles. No native operation,
functional fixture, child or publication gate ran. Dependencies are unchanged.

This is native relation consistency plus the separately recorded artifact-stage
chunk witness. Complete source file/hash inventories, original bundle/incremental
identity, vector-value/validity correspondence, post-compaction/final publication,
generation-qualified replay and full current-candidate acceptance remain. Native
join/hash/sort resource/latency qualification remains deferred and serial.
#284/#1267/#1574 remain partial; counts stay **482 pending / 145 partial / 91
unresolved** across 718 live open issues.
