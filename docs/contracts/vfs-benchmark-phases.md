# VFS cache benchmark phase evidence

`tools/bench/vfs/cold-start-cache.js` retains its existing public options. The
internal child mode runs exactly one cold/warm/hot scenario and requires a marked,
owned root. It cannot reset/delete a supplied directory. Normal invocations create
one exclusive task root under the shared `.tmp/dev/benchmarks` owner, with a fresh
fixture for each cold repetition. Cleanup verifies original ownership/containment
and confirmed child settlement; failure retains primary/cleanup context and the
fixture path. Every child uses the existing subprocess owner, a 30-second deadline,
bounded output, no retries and asserted quiet diagnostics.

Cold materializes a fresh document set and persists its cache. Warm loads that
persisted cache in a new process, accesses documents and persists the same dirty
metadata obligations. Their totals include cache admission, document access and
flush. Hot primes verified in-process state outside measurement, then measures
that access without a persisted-cache lookup or flush. Warmup, source-plan work
and complete child wall time remain separate observations. Cold always primes its
fixture; warm/hot order alternates. Fresh processes do not imply cold OS caches.

The synthetic ASCII generator produces exactly the requested UTF-8 bytes per
document, uses the existing xxh64 owner and records actual backend, distinct content
count, total bytes and a SHA-256 of origin/content identities. Independent consumer
reads require exact bytes after timing. Document preparation is outside scenario
totals; it is reported separately. Containment admits at most 50,000 documents,
64 MiB per document and 128 MiB total, using the existing cache capacity coordinates.
These are workload bounds, not latency/memory acceptance thresholds.

Each sample counts created/regenerated documents, persisted/memory/independently
verified hits, document writes and content-verification bytes. Loaded rows/entries/
data bytes, cache bounds and actual flush counts come from the real cache owner.
Metadata/OS I/O bytes remain unmeasured. A claimed phase must match those facts;
missing/stale/rejected cache data is not warm success. Incorrect content rejects
the run. Incomplete phase coverage retains raw observations/reasons but receives
null qualified summary/rate fields, and the top-level state remains unqualified.

Increasing samples repeats fresh cold work instead of weighting a distribution
with hot reuse. No representative application gain, hardware qualification,
immutable URI lifetime or OS-cache control follows from this harness. Sustained
profiles, churn/cache-budget ladders and final-source Windows execution remain
separate qualification work. Cache root/content and live-bound repairs retain
their own contracts in `vfs-materialization-integrity.md` and
`vfs-cold-cache-bounds.md`.
