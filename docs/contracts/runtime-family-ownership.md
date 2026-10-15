# Saved runtime family ownership and references

Imports and derived-claim publication share an exclusive writer lease for the
canonical destination. Admission inventories retained raw CAS, immutable
generations, claims, pending files and pointer/control metadata, counting hardlinks
once. A fresh process starts from this physical inventory. Same-process supplied
accounts reconcile their destination charges; instrumentation wrappers preserve
the underlying inventory identity with `wrapRuntimeDiskAccount`.

The destination stores a bounded internal receipt of the working-set allowance
explicitly admitted by import. Claims read that receipt under the same writer
lease and obey that total cap. Lowering a requested cap below retained storage
refuses new work without deleting pinned families. Promotion relinquishes exclusive
ownership of an immutable family. Cancellation or pointer failure cleans only
owned staging and keeps promoted bytes charged and available to pinned readers.

An import can receive `semanticContext: { repoRoot, store, manifest }` for an exact
published source generation. Record targets require partition membership, record
existence, source ownership/hash and supported source coordinates. Direct UTF-16
ranges and Inspector zero-based source positions can qualify targets. Unknown
source maps, embedded mappings, inlining and unavailable coordinates retain file
evidence without authoritative operation targets. Supplied references without a
pinned context remain non-authoritative. File-level `exact-source` and the
separate `targetQuality` field describe different precision contracts.

CPU coordinates qualify function scopes or function AST statement/expression
records only; module/block parents and arbitrary value/name records do not grant
function attribution. Direct UTF-16 ranges support expression/statement records
and function scopes. Exact duplicate references collapse to one target. Multiple
distinct supported records containing the same coordinate are ambiguous and
produce no targets; the importer does not guess the innermost record.

Observation warnings preserve capture warnings before adapter warnings, with
deduplication and an internal 64-item/8-KiB projection allowance. A truncation
marker reports excess warning metadata. Saved synthetic fixture labels therefore
remain present when observations are hydrated/exported independently of capture
metadata; their numeric values do not establish live performance measurements.
Derived claims use the same bounded merge for warnings from their supporting
observations, preserving those labels in standalone persisted claim exports.

The runtime parser is version 3, observation projection is version 2, and lookup
index format is version 2. Incompatible saved families reject explicitly and must
be reimported from retained raw inputs; there is no compatibility migration.

Metadata and offset buffers are bounded and hashed from the exact opened bytes
consumed. SQLite opens a verified serialized image rather than reopening a
pathname after verification. That image has a private 64 MiB reader allowance;
larger-family support and interactive cost need separate qualification. Returned
evidence rows still verify their pinned row hashes. Paged lookup receipts expose
`cost.familyOpens` and `cost.verificationBytes`; these measure work and do not
claim immutable-handle reuse or large-family performance.

Streaming verification rechecks the shared opened-descriptor containment guard
before committing its result. Native database and file resource cleanup attempts
every close even if another fails. An open/query error remains the primary cause
when cleanup also fails, and failed closes remain explicit errors.
