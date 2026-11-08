# Artifact row admission

JSON array and JSON-columnar payload admission is shared by materialized and
streaming readers. Containment, encoded byte limits, backup selection, checksums
and family row validation remain separate owners. Rejecting malformed input does
not change valid stored row meaning or require a semantic producer version bump.

## JSON arrays

An array representation must decode to an array, including in permissive mode.
Objects, null and scalar values fail with `ERR_ARTIFACT_INVALID`, retaining the
artifact and selected source path. Valid `[]` means zero rows. The shape guard
returns the existing decoded array; it does not copy or validate every row again.
Optional cold chunk metadata follows the same rule. A recorded required-cold
representation still rejects a hot row without its required cold counterpart.

## JSON columnar

Both inflation and iteration admit the complete column envelope before allocating
row output or exposing the first row. An explicit length must be a nonnegative
safe integer. Declared column names must be unique strings, each naming an own
array with exactly that extent. Positive length requires at least one column.
Explicit null cells remain valid; a missing or short column is not null padding.
Dictionary/table decoding retains its existing value semantics and row order.

For supported legacy envelopes, omitted columns infer own array keys and omitted
length infers the first admitted column's length (zero for no columns). A present
invalid field never requests inference. This is O(columns) envelope/extent work;
family validators still own cell semantics. Encoded byte limits remain distinct
from decoded row cardinality. Manifest row counts, when declared for that exact
payload, must agree with the envelope length.

## Canonical counts and recovery

Source resolution binds each selected canonical manifest piece to its physical
read target and optional row count. Recovery may select a `.bak` file without
changing that count authority. It never strips arbitrary suffixes to infer a
manifest identity. A declared source that fails exact canonical mapping is an
error; a legitimate legacy piece with no count retains absent-count semantics.

Generic and file-metadata JSONL streams pass these already-admitted counts to the
existing bounded offsets validator. The validator still owns its paired-empty,
64-KiB window, newline, monotonicity, cancellation and descriptor-close contracts.
Count binding adds no new full-payload pass or process-global validation cache.

## Cleanup observation and publication

Artifact cleanup treats only `ENOENT` as known absence. An access or I/O failure
is recorded under the target's observation phase and propagated before removal
can be admitted. Immediate and staged cleanup retain original failures, pending
resource observations and exact counters. A healthy sibling cannot erase a
previous failed observation from the receipt. Committed immutable exclusions and
the original actual-removal failure owner remain binding.

Manifest checksums use settled concurrency with collected, sorted results.
Cancellation stops new admission and remains observable in occurrence order;
every started original checksum operation settles before publication returns.
Later failed closes remain independent failure observations. The existing file
and publication lock sessions retain unresolved resources for explicit recovery.
Generic prompt-cancellation queues keep their separate contract.

## Logical statistics

The stats owner counts disjoint logical payload shards under the exact family
name. Symbol, occurrence, edge, call-site, graph and file/chunk payload writers
register shard-local counts. Auxiliary offsets/metadata and differently named
compatibility encodings contribute physical bytes, never another copy of rows.
Compression variants of one payload reconcile the same count. Whole-family
alternative representations must agree, rather than being summed or maximized.

Phrase/chargram payload counts describe their vocabularies. The primary
`dense_vectors` payload owns its row total; binary metadata repeats it and
doc/code channels retain independent absence/cardinality. Missing, null, negative,
fractional, unsafe and overflowing counts remain unknown. Physical bytes and
logical rows are reported separately.

The current fixtures are authored implementation coverage; execution and source
qualification are recorded separately in the active roadmap and durable receipts.
