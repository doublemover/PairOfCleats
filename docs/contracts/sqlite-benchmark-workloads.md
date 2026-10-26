# SQLite benchmark workloads

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

The six CLI baseline/current/compare cases and real build/update fixture controls
are authored but unrun in the implementation-first wave. These small fixed-order,
single-trial smoke observations do not qualify sustained throughput or WAL gains.
Issue #1733 remains partial until the harness also offers independently scoped
changed/new/deleted/shrinking/growing/repeated work, observed threshold/batch
coverage and repeated alternating trials with separately identified lifecycle
timing and declared cache conditions. Representative execution remains deferred.
