# SQLite benchmark workloads

The bounded wide-artifact controls retain six paired trials as two two-trial
capsules and two one-trial capsules. Each pair still uses 32768 retained-wide
rows, the unchanged 128 MiB decision, fresh databases, full content validation
and owned cleanup. The final pair of capsules invokes the same artifact
benchmark function with a private trial offset, preserving its original
baseline/current then current/baseline order and trial identifiers. The CLI has
no new option. This changes a process boundary, not measured work inside an arm;
it does not establish sustained or end-to-end improvement. The original
30.66-second aggregate failure remains historical evidence. Representative
bundle-build and add/delete/shrink/grow/repeated-update qualification remains a
separate requirement.

`tools/bench/sqlite/build-from-bundles.js` and `incremental-update.js` use the
canonical artifact surface version and immutable bundle snapshot writer. Source
hash/size bind deterministic synthetic lexical bytes. Every selected manifest
entry retains its complete content-addressed shard inventory. Deriving an update
preserves top-level identities and publishes a new complete snapshot, while the
original selected snapshot remains readable. Production format, path, source,
dependency, checksum and change-ratio admission remain enabled.

Each invocation creates its own directory under the existing `.tmp/` development
artifact owner. Launching another benchmark no longer deletes a shared workspace.
An incremental smoke needs at least three files so its one changed file remains
inside the production change-ratio allowance. File/chunk inputs must be positive
safe integers; absent inputs retain the existing 20×6 build and 12×6 update sizes.

The default experiment is explicitly smoke. Setup builds and correctness
validation are outside update timing; correctness validation follows build
timing. Both paths validate nonzero expected work and stable resulting chunks,
resolved token postings, document lengths, file manifests, FTS retrieval and
applicable sealed filter facts. Missing filter seals retain their production
fallback/unavailable state; the benchmark does not rebuild them outside timing
and claim an acceleration result. Dense/phrase/chargram work is explicitly absent
and checked as zero. Baseline/current output parity is required before printing a
smoke delta. The observed-work record reports actual source/bundle bytes,
files/chunks/postings, lane scope and stable content digest.

The CLI baseline/current/compare cases and real build/update fixture controls
retain their small correctness scope. The lexical/wide campaign profiles offer
changed/new/deleted/shrinking/growing and repeated work, observed threshold/batch
coverage and alternating trials with separately identified lifecycle timing and
declared cache conditions. Smoke observations do not qualify sustained throughput
or WAL gains; representative execution retains its separate acceptance.

The artifact entrypoint also registers its generated chunks/postings and genuinely
disabled semantic family through canonical production manifest/family writers.
Both arms admit the same input and use a fresh database per arm/trial. Every
sample validates chunks, retained metadata, postings and document lengths outside
timing. `--trials` alternates arm order and preserves raw checkpoints/final JSON.
`--profile wide` retains roughly 4.6 KiB of document metadata per row; with
`--chunks 32768` the actual serialized input crosses the unchanged 128 MiB default
optimization threshold. `--profile lexical` retains the existing default shape
and 100,000-row default. Reported threshold eligibility derives from actual file
bytes. Fresh databases do not imply cold filesystem caches. Small CLI controls
and separately bounded representative capsules retain their distinct scopes;
authoring them does not itself qualify sustained performance.

Artifact runs create one private `work/` directory under their unique invocation
root. After every database and validation owner closes, successful runs preserve
the compact checkpoint/final receipts, counts, content hashes and raw timings,
then reclaim only that generated input/database directory. Canonical parent/run/
work paths, original directory identities and a private run UUID/marker hash must
still agree. A caller's `--index-dir` never receives this deletion authority.
Failed operations or unconfirmed cleanup retain their evidence and remain failed.

The campaign report is version 2. Canonically admitted bundle bytes and row counts
feed the existing native optimization and batch owners. An opaque validation
admission captures the original immutable source facts once; it cannot be forged,
transferred to a different manifest, or presented as a later filesystem read.
The validator uses the original native close owner and preserves query and close
failures together. Each arm publishes its compact raw receipt before reclaiming
its independently owned generated database; failed or pending work is retained.

The explicit `tests/perf/qualification/sqlite-row-shapes.js` helper authors the
small-low, large-low and large-high source-bundle matrix, six paired trials and
three successive updates per arm. Changed/new/deleted and shrinking/growing work
is conserved independently. The high-change shape remains below the production
35% guard; no threshold override is supplied. Each actual native arm is bounded
to 30 seconds including validation and cleanup. Its multi-capsule campaign is
not a single 30-second aggregate or a sustained throughput result. Authored
helpers and unexecuted plans do not qualify representative performance.

The private row-shape worker emits at most 256 synchronous structured phase
records on stderr, reserving the last record for an explicit truncation marker.
Coarse progress is limited to 24 records across the entire child, with separately
reported coalesced counts, so three update rounds cannot crowd out close/end
records. The parent accepts only the exact bounded JSON-line protocol and
reconciles its counters and phase pairs with the child's report. Unknown text,
warnings, malformed/truncated records, failed phases and unfinished phases
reject a claimed success. Raw stderr and diagnostic admission failures remain
in the capsule evidence; stderr is never silently discarded.
The original native methods still perform every operation. Records distinguish
source admission, bundle build/insertion, chunk indexes, filter reconstruction
and sealing, commit, optimization, WAL checkpoints, native close and independent
validation. A start without an end identifies unfinished work; neither a phase
record nor forced process termination proves graceful resource settlement.
The original row shapes, 30-second bounds and transaction policy are unchanged.

Bundle validation checks native postings in one correspondence stream rather
than repeating a mode-wide join for every file. Each admitted document retains
a compact source-token bitset: unknown/duplicate/extra/missing postings and exact
term-frequency mismatches reject. The original canonical digest transcript is
preserved, and no result escapes before all native rows match the independently
admitted source. Native iterator and database close failures retain their
original owners and independent operational evidence. No index is added to the
measured database, and validation remains outside operation timing.
