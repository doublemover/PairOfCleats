# Native Tree-sitter cache qualification

After normal bootstrap, run this explicit helper serially in an assigned native
measurement window, with a new absolute output directory:

```text
node tests/perf/qualification/tree-sitter-cache.js <new-absolute-receipt-directory>
```

The helper is outside ordinary test discovery. It invokes twelve independently
bounded 30-second subprocess capsules: three repetitions for each one/two-worker
and native query/traversal cohort. The two-worker cohort deliberately holds two
actual original Piscina isolates at the same barrier; it is not a second
concurrent campaign or an inference from multiplying a configuration value.
Existing public thread dispatch, original worker-exit tracking, pool destruction,
subprocess qualification and verified generated-work cleanup owners remain in use.
No new supported runtime options or dependency setup are introduced.

Each isolate uses the same 32 source identities, each containing 512 actual
JavaScript function declarations. Independent declaration names/kinds/source
ownership and a qualified native grammar are required. Replayed products must
match the full freshly parsed rows, including metadata. Final receipts join
source and semantic corpus identity across every worker/query/traversal cohort;
fields are not discarded to manufacture comparable meaning. A mismatch is
unqualified until inspected, rather than a performance result.

Instrumented work observations cover uncached native parsing, absent-cache
production, persisted file admission with empty process-local tiers, validated
memory hits and current-schema legacy-layout migration. Transparent original
JSON parse/stringify, native parse and clone delegates record calls, CPU and
operation wall time. Read/decoded bytes and hit/miss/eviction counters come from
the production cache owner. Clone byte values are independently calibrated
logical UTF-8 row-payload equivalents, not actual heap allocations; unknown
clone payloads remain null. Instrumentation is removed before the separate clean
32-call latency samples and p95 summaries. Content checks and preparation stay
outside those timed producer calls. The operating-system file cache is uncontrolled.

Count pressure uses the existing two-entry setting as a separate control. Byte
pressure must actually reach the unchanged 32 MiB per-isolate retained-accounting
budget before the 64-entry cap, with 8 MiB per-entry admission unchanged. One and
two simultaneously retained isolates must conserve one and twice the observed
logical cache charges for the same corpus. This does not establish an aggregate
process RSS cap: oracle data, grammar/native state and runtime overhead also exist.

Native `process.resourceUsage().maxRSS` is a fresh-process lifetime high-water
through the held-cache boundary. It includes bootstrap, grammar loading, oracles
and all sample phases. Worker heap observations are per isolate; RSS is shared
and is never added across worker reports or attributed to one parse phase.
The receipt does not assert a twofold RSS ratio, historical unsafe-reader
performance equivalence, a cold-disk condition or a speedup.

Each successful capsule closes its original worker pool before reclaiming only
the captured UUID/directory-identity generated cache work. Compact invocation,
raw sample and final receipts remain. Failure or unknown closure retains work
and original causes for diagnosis. No caller-selected index directory is admitted
to this cleanup owner. This source-authored plan is not native execution evidence.
