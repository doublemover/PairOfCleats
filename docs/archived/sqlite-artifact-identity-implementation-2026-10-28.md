# SQLite original artifact-stage identity — 2026-10-28

Source `417a4479dbd750b61d95e6de555ece174d004c56`, tree
`552bbaa3132e6a75d5ba24444cd62b42935055f0`, branch
`codex/pr557-audit-repairs-20261012`. Local, unpublished and functionally unqualified.

The artifact importer already has normalized chunk/file source staging tables.
Before retiring chunks_stage, it now compares destination ID/mode/UID/file/
byte-range/line-range/metadata with that original source projection. The native
join returns at most 17 rows and retains at most 16 bounded samples, explicitly
marking truncation. Duplicate/invalid IDs are rejected. It streams a domain- and
length-delimited SHA256 in source ID order, without a corpus Set, metadata JSON
copy or custom unordered hash. Actual post-import rows stream in the same owned
read transaction and compare that original witness, catching equal-count identity
changes and extra/missing rows before runner replacement.

The immutable in-process witness binds mode and the actual build owner's logical
output. Physical Windows fallback staging keeps that original publication target.
Copied/foreign witnesses and injected probe snapshots cannot grant qualification.
The cursor retains original next/return methods, pending step/return observations
and independent frozen cleanup causes. Existing disposal/metadata owners retain
their actual roles; no native-close replay or deletion authority is introduced.
Identity diagnostics survive the actual runner error projection.

Source review also corrected this wave's optional-stats regression in artifact/
bundle ANN reporting. Stats remain optional. Artifact import still validates the
source stage without retaining diagnostic stats. The ledger uses its shared
canonical version constant and rejects stale version-1 count evidence.

Thirty-one `storage/sqlite/build/row-identity/*` controls cover stage mismatch,
duplicate/invalid IDs, bounded samples, equal-count UID/file/range/ID/metadata
changes after stage retirement, extra/missing rows, target/mode/copy/probe refusal,
original cursor/cleanup failures and pending observations, logical fallback
binding, actual build positive/equal-count corruption preserving the old output,
and artifact/bundle builds without stats. A new stale-ledger control brings the
count/capability fixture to 33 cases. **All 32 added controls and affected
existing fixtures remain unexecuted.** No original assertion was removed.

Format/ESLint, nine JavaScript syntax checks, static inventory and whitespace
checks passed; shared-module analysis found zero cycles. No database operation,
functional fixture, child or publication gate ran. Dependencies remain unchanged.

Coverage is normalized artifact-stage chunk correspondence, not independent
parser/source truth or final-generation acceptance. The count result names that
limited coverage; unadopted routes remain unqualified. Expected file/hash inputs,
bundle/incremental correspondence, dense/ANN membership, post-compaction/final
publication checks, bounded replay/deltas and current-candidate qualification
remain. Hashing/native sort work also needs measured serial qualification.
#284/#1267/#1574 remain partial. Source counts remain **482 pending / 145 partial /
91 unresolved** across 718 live open issues.
