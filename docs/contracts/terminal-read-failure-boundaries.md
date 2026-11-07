# Terminal read and cancellation boundaries

An already-aborted `raceAbort` wait retains a rejection observer on work supplied
to it. It returns the same typed, correctly caused cancellation promptly without
waiting for or cancelling that independent work. The live-signal result/error and
listener contracts remain unchanged. TypeScript protocol consumption fences
admission before accepting the next record, after assembler/log callbacks, and
immediately before a deferred record callback. It captures the selected callback
once with its original receiver. Cancellation preserves the original reason.

Synchronous zstd native decoding retains its existing bounded output headroom.
Post-decode byte and heap admission occurs outside codec-error translation;
capacity refusals keep `ERR_JSON_TOO_LARGE` through JSON, JSONL and compressed
sibling fallback. Corrupt frames still report codec failure. Optional fallback
and validation's allow-oversize behavior depend on that exact distinction.

Incremental manifest loading reads directly, removing a redundant existence
check that could hide operational failure. Only actual ENOENT is an ordinary
missing snapshot. Observation, cancellation, format and capacity failures
propagate without quarantining or replacing valid reuse state. Known JSON syntax
failure after a contained read and explicit compact-content validation failures
have private owner classifications. An arbitrary exception class or copied error
code cannot authorize quarantine. Corruption paths requalify the observed hash
before rename and retain distinct UUID receipts. Healthy paths retain their
single contained read and compact dependency identities. Failed quarantine keeps
the original content error and secondary failure; diagnostic failure after rename
retains the published path and original pending resource ownership.

JSONL materialization owns one terminal admission state and cooperative signal
for its concurrent shard readers. The first failure closes admission before a
worker can claim another source. Active source/decoder cleanup is joined before
outward rejection, with original and independent failures retained together.
Partial arrays are released on failure. Successful bounded concurrency retains
input order; single-source and empty inputs preserve their existing behavior.
This adds no CLI/configuration option, retry or serialized success workaround.

Authored controls use isolated rejection observation, the real TypeScript
protocol/compiler phase, finite zstd size/heap boundaries, actual manifest
stat/open/read/fstat/quarantine failures, and held real JSONL source closes through
direct and canonical artifact loaders. Existing capacity, format-cutover, abort
provenance and decoded-stream controls remain. Functional execution is deferred;
source/static receipts are recorded in the implementation archive.
