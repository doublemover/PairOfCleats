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
