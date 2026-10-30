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

## Deterministic text profiles

The cold-start CLI accepts `--content ascii|utf8` (default `ascii`). Both profiles
materialize exactly `docBytes` UTF-8 bytes per document; Unicode units are never
split. UTF-8 workload identity names generator version 3 while the existing ASCII
generator remains version 2. The owned fixture marker binds the selected profile
across actual child scenarios. Budget/churn controls preserve content parity but
cannot label partial persisted-hit coverage a fully warm phase.

The bounded large-workload controls retain three repetitions of 256 documents
of 8191 UTF-8 bytes in separate persisted-pair and hot-access capsules. A persisted
pair uses fresh cold and warm child processes sharing the same exclusive root,
with equal flush obligations and independent content verification. A hot capsule
uses the original sample owner in a fresh child and materializes its exclusive
root during warmup, outside hot timing. This preparation differs from the full
benchmark's already-materialized hot input. The controls retain raw phase/work
receipts but do not qualify the full alternating three-mode schedule, sustained
end-to-end latency or an application gain. The original full UTF-8 aggregate's
30-second failures remain historical evidence. The smaller ASCII control retains
the unchanged complete three-repetition orchestration; production default and
full-benchmark execution remain unchanged.

`createVfsColdStartSeries` is the same private-root lifecycle consumed by the
ordinary benchmark. It admits one actual child at a time, retaining the original
nine-step sequence cold/warm/hot, cold/hot/warm, cold/warm/hot across three roots.
The explicit `tests/perf/qualification/vfs-series.js` helper records each original
child in a separate 30-second capsule while retaining those roots and ordering.
It never resets a root between phases or primes a replacement hot fixture. The
whole campaign wall time is reported separately and cannot be labeled an
aggregate 30-second pass. Pending children retain cleanup ownership.

`vfs-restart-misses.js` separately records three actual restart repetitions for
budget compaction and controlled ordinary-file regeneration. A half-sized cache
budget must compact loaded rows; replaced files must regenerate the corresponding
documents. Both states remain unqualified warm phases even when all independent
consumer bytes match. These controls do not replace the full nine-step campaign.
