# Phrase row assembly and adaptive spill

The default hashed phrase producer and the legacy string-map producer feed the
same row collector, sorter, run merger and output fold. Hash buckets resolve one
token-ID sequence at a time, using the existing token-map lookup and string-ID
fallback. Every collision entry counts as a phrase row. No full phrase-string
array or replacement map is created before admission to the collector.

With a build directory, either inclusive configured threshold enables spill
collection: `phraseSpillMaxUnique` counts phrase rows and `phraseSpillMaxBytes`
counts serialized JSONL bytes, including the newline and stable row ordinal.
Both representations now use that exact byte count; the legacy route previously
used a heuristic JSON size estimate. Normalized configuration values, defaults,
zero-disabled thresholds and the existing 5,000-row / 4 MiB collector limits are
retained. Without a build directory, the existing in-memory assembly remains.
Enabling collection does not promise a disk run for a small input: the existing
collector may return its sorted buffer until a collector limit is reached.

The existing hashed output behavior remains: document IDs are normalized,
sorted and deduplicated; equal resolved phrase strings from distinct ID
sequences remain separate rows in original stable order, and empty normalized
hashed postings remain present. A temporary row ordinal preserves tie ordering
through planner regrouping. Legacy equal-key folding and empty-row filtering
are unchanged. Empty or absent hash input retains the legacy-map fallback.
Disabled phrase indexing never traverses either phrase source.

Source entries remain owned until their row is accepted into the adaptive
buffer or collector. Iteration then releases consumed string entries or complete
hash buckets. A collision bucket remains available until all its entries are
accepted. Failures preserve the current/unaccepted source entry; prior accepted
entries may already have been consumed, so a failed destructive build does not
promise replay from the same partially consumed maps.

`buildPostings().phraseStats` reports source/container counts, accepted input
rows and serialized bytes, adaptive-buffer and collector high-water rows/bytes,
collector caps, thresholds, actual spill runs/rows/bytes and final output rows.
`postingsMergeStats.phrase` separately reports actual merged rows and runs.
The source expands at most one pending phrase row outside those buffers. A
serialized row is temporary scratch; the collector can exceed its byte trigger
by one row, whose maximum serialized size is reported. The adaptive buffer
similarly includes the threshold-crossing row. No bound on an individual input
posting list or phrase string is introduced.

These are serialized working-set counters, not measured V8 object sizes. Input
bucket maps already materialize and final vocabulary/posting arrays still
materialize; `inputBucketBytes` and `finalArrayBytes` are explicitly unknown.
The result is a bounded assembly policy when spill thresholds apply, without an
end-to-end memory, throughput or speedup claim.

The existing spill collector exposes `cleanup()` independently of `finalize()`.
Append, serialization, cooperative-yield and cancellation failures release the
original run directory without retrying a buffered write. Merge-reader cleanup
and input-run cleanup are both attempted, with original failure identity kept
when cleanup succeeds and composed with cleanup failures when necessary.
The planner separately owns its private output directory, including partial
outputs created before its cleanup function can be returned; it never removes
borrowed input runs or shared planner hints. Cancellation checks surround row
collection and folding; an in-progress shared planner merge is awaited before
its output ownership is retired.

Output meaning is preserved, so no semantic analysis producer-version bump is
requested. The temporary spill row format and additive diagnostics are internal
execution changes. Cross-route parity, threshold boundaries, original cleanup,
default state production and actual spill/merge consumer regressions are authored
in `tests/indexing/postings/phrase-hash-{adaptive-spill,source-contract,spill-failure-ownership}.test.js`.
Execution is deferred until the shared wave is frozen. Native/bootstrap checks
and controlled wall-time/RSS/heap/event-loop/disk performance acceptance remain
separate work; no benchmark measurement is implied by these source changes.
