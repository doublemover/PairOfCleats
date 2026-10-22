# Bounded index producer work

These implementation notes describe resource and parity contracts. They are not
benchmark results or runtime acceptance evidence.

Sparse binary writers use bounded data and sidecar blocks, preserve exact codec
bytes, complete positive short writes, and keep existing fsync/publication owners.
The packed writer records its digest while consuming encoded blocks. Generic JSON
traversal batches punctuation and scalar output, awaits actual backpressure and
cooperative yields, and never splits a UTF-16 surrogate pair across UTF-8 writes.
Compression processes start on demand; gzip does not create unused workers.

A process-pool submission starts only missing idle/initializing capacity. Ready
children run independently, while reservations remain held until confirmed child
termination. Producer-capacity waits subscribe to settlement-owned notifications,
not repeatedly to every outstanding task; byte/count caps and callback settlement
remain the release authority. Pressure telemetry selects one deterministic victim
without sorting its full cache for each ordinary overflow.

Structural match enrichment uses a file-owned interval index preserving original
match order and inclusive overlap for arbitrary query order. Lexicon filtering
uses constant-size category membership views rather than copied token sets.
Token MinHash updates once per distinct token while IDs, multiplicity, order and
frequency statistics retain their existing meaning. Symbol cache overflow evicts
LRU capacity independently of insertion-time expiry; fresh overflow does not scan
the full cache. SQLite vocabulary caches incrementally evict persisted LRU entries
after flushing pending identities, preserving SQL-backed IDs across cap crossings.

Discovery canonicalizes candidates through bounded asynchronous stat workers and
still requires real-root containment. Deferred queue claims build one running-job
alias lookup while holding the existing claim locks. Alias matching remains direct
and queue ordered; it does not turn transitive identity groups into duplicates.

Qualification must compare exact artifacts, identities, coverage and failures,
then report raw worker starts, byte/read/write counts, CPU, peak retained memory
and supported-platform timings. Cancellation, corruption and teardown failures
remain required controls. No bounds, coverage checks or performance verdict
thresholds are raised by these implementation changes.

Governance refresh owns one immutable discovery/input snapshot. Manifest generation,
evidence, taxonomy and audit share physical/logical case discovery and source
order/timing text while retaining their independent parsers and comparisons.
Generated manifests are captured only after writing; comparisons still use the
authoritative order IDs independently. A fresh refresh discovers source, rules and
case-sidecar changes again. Shared-module ledgers likewise inventory the union of
approved roots once per generation, derive boundary-aware subsets, and retain
independent fresh inventories for reproducibility generations. Explicit root files
authorize only themselves, never a recursive parent walk.

## Ordered source contracts

JSONL byte hints never control output lengths: encoded row bytes plus the newline own batching. Ignore files are ordered rule programs; repeated rules are retained and canonical parser whitespace/escape semantics are preserved. Generated ancestor traversal openings retain preceding child exclusions so selected descendants do not admit siblings.

PDF EOL flags terminate their own item, including empty markers. DOCX text/separator tokens remain in source order across styled runs; both extraction backends obtain physical paragraph ordinals and direct paragraph styles from the same bounded XML owner. Custom/inherited Word styles are retained as source style IDs rather than invented heading levels.

## Selected roots and evaluation receipts

Validation, stats and health capture published mode roots once. Explicit validation roots discover their own declared/present modes, including declared missing artifacts, independently of the current pointer. Stats exposes per-mode provenance; combined build/config fields are null for mixed generations. Health checks selected file families and recorded backend capabilities, distinguishing not-built/not-selected/unknown from a broken ready backend; zero-state waivers use the existing independent proof validator.

Setup forwards the explicit target repository to restore and all indexing stages. Huge-repository profile resolution reads only the canonical indexing.hugeRepoProfile path. Its leaf overrides supply defaults, with explicit repository leaf values taking precedence.

Evaluation uses canonical search mode expansion and independent ranking cohorts. Combined-mode judgments must name their mode; ambiguous unqualified judgments are refused before search. Metrics are macro means of judged cohorts and judged cases; unjudged cohorts remain null. Scores from separate lists are never concatenated into an invented global rank. Bakeoff resume identity version 2 binds canonical dataset content, query bytes, matching/metric producer sources, repository identity, and per-model selected generation manifests/index-state. Missing inputs fail before resume; old receipts cannot authorize reuse.

Benchmark waivers require an explicit supported schema, unique ID, owner, justification, finite expiry and exact failure/diagnostic scope. One invalid row invalidates the complete policy. Run watchdog interruption is terminal evidence before termination; a zero exit or retry cannot erase it. All controls here are authored and unexecuted.

## Coverage and browser qualification visibility

Coverage policy report schema 2 retains the complete changed-path inventory. Eligible observations, genuinely unobserved sources, target deletions, absent paths, unavailable file evidence, unsupported instrumentation and explicit artifact exclusions are separate states. Unknown counts remain null; observed zero remains numeric zero. Percentages and summaries use observed ranges only. Every critical-surface section carries its changed inventory and completeness status. No new enforcement threshold is introduced. Git path framing is NUL-delimited, preserving whitespace, Unicode and control characters.

Canonical preview and map benchmarks share an explicit viewer asset route owner. Benchmark startup reports listener readiness and an exact local module-graph smoke receipt separately from rendered readiness/FPS. Asset smoke is bounded and fails required HTTP/MIME/identity errors; it never authorizes a browser-performance claim. All server shutdown is awaited.

The separate browser qualification attaches bounded diagnostics before every navigation/page, gates each phase on unexpected exceptions, HTTP/resource and shader/render errors, and records exact scoped injected failures. It observes application renderer submission of the selected model/scene generation, useful geometry and sampled pixel variation; live canvas allocation alone cannot pass. Screenshots retain explicit viewport/DPR and requested/effective renderer identity. Software rendering, hardware/FPS and additional depth/fog fidelity scenarios remain separately labelled. Newly authored controls have not been executed.


## Dependency-qualified reuse and document coordinates

Document chunking snapshots unit coordinates once per extraction. Ordered units and chunk windows use monotonic cursors; arbitrary query order uses binary bounds. Unsorted or malformed unit metadata retains the original full-scan semantics. Page/paragraph anchors, headings and chunk identities remain source-derived.

Records reuse requires exact normalized source text, canonical sidecar content or explicit absence, discovery metadata, dictionary/stopword/synonym policies, lexical/MinHash producers and complete inline embedding identity. All immutable bundle shards are verified against the selected manifest before replay. Unknown model identity or incomplete products recompute. Replayed chunks are privately owned and receive current global IDs; postings are rebuilt under the current ordering. Permission and I/O failures remain errors, and sources are rechecked after asynchronous replay admission.

Token postings family reuse is narrower than whole-generation reuse. A current representation proof binds every chunk ID/UID/source span, vocabulary, term-frequency pair, document length, loaded dictionary meaning, lexical producer and exact output format/compression policy. Reuse additionally requires the selected publication and a manifest-selected sealed receipt covering every family member. Every source byte is rehashed; copies use exclusive creation, durable independent files and target verification. Existing destination members decline reuse before copying. Imported files join the ordinary generation validation and single publication commit; no hard links or early publication are introduced. Missing, corrupt or unknown authority recomputes; operational I/O failures propagate. Scalar proof hashing and integrity reads remain real work. Counters report family payload verification/copy bytes only; metadata reads are explicitly excluded. No measured speedup is claimed.

These authored controls are unexecuted. Native integration, interruption/copy fault injection, corruption/cancellation and unchanged-versus-partially-changed operation measurements remain qualification obligations.


Artifact JSONL zstd writers borrow one invocation-scoped codec resource. Its worker cap derives from the effective build CPU envelope, and CPU jobs use the existing scheduler through the internal stage2.codec queue. Codec admission reserves bounded block assembly, transfer and completed-output capacity; source objects and the current bounded JSONL row remain under the upstream artifact/row admission owner. This counter is not a total process-memory measurement. Reservations survive out-of-order completion until the ordered stream consumes the block. A large line is split across bounded codec frames without changing decoded JSONL bytes. Gzip retains its existing stream owner. Borrowers do not close the shared pool or wait for unrelated writers to become idle. The invocation awaits teardown; a termination deadline failure quarantines further codec startup rather than authorizing an overlapping retry. Standalone writers retain explicit ownership. No public configuration surface or measured throughput claim is added.


Tokenizer throttle capacity notifications wake one FIFO contender for that language. Global pressure transitions reconsider affected languages using one referenced quiet-period timer per pool, and one parent pressure observation per event-loop decision epoch. Owned-child RSS aggregation receives that same parent RSS value. Pending capacity wakes reserve priority until resumed admission; abort and close remove waiters promptly. Pressure hysteresis and hard limits remain unchanged.

Git batch metadata uses double-NUL commit framing and NUL path records. The churn-enabled lane derives latest commit/author/date and cumulative churn from one bounded numstat traversal. Rename/copy rows retain a narrow name-only metadata fallback because their path selection differs. Churn-disabled work keeps the cheaper name-only lane. Binary churn remains numeric zero, and path labels preserve whitespace, tabs/newlines and POSIX literal backslashes. Aggregate traversal/stdout counters report observed command work; merge/rename/native-repository parity and throughput controls remain unexecuted.


Compiler field overlap uses a root-owned canonical prefix index. Public widened null segments match public keys while private brands require their complete source/owner identity; literal '*' stays literal. Candidate output retains source order and duplicate-path semantics, with construction and actual candidate memberships charged to the existing field budget.

Reaching-definition maps and sets are immutable once attached to a CFG block. Single-parent and no-op transfers share state; joins and writes clone only changed environments/sets. Strong scalar and qualified ordered writes still kill, while may-location writes union. Definition/symbol-copy visits have a separate bounded budget; exhaustion remains explicit partial coverage rather than silently dropping evidence.

CFG effect/exception routing shares ordered suffix projections over acyclic regions. No-op chains share the same immutable result array. Cycles and dense cache-capacity misses use the original DFS under the shared routing work cap. Initial effect edges still exclude exceptional successors, downstream traversal still includes them, and catch/abrupt-completion barriers retain their original semantics. Canonical output and partial outcomes require producer identity changes and differential qualification; all new controls here remain unexecuted.


Call-summary solving builds source-qualified parameter, alias and structural-key indexes once per invocation. A deterministic dirty worklist retains the existing SCC order and iteration/work limits. Calls rerun for changed target revisions or changed reverse dependencies; function derivation also tracks completeness and widening changes. Reachability results are scoped to that solve, bounded by query/membership allowances and invalidated when a newly added reverse edge reaches a watched node. Cache overflow recomputes, never certifies stale dependencies. Return, exception and effect channels remain independently monotone. Work counters are instrumentation; full recursive/effect differential acceptance and timings remain unrun.


Bundle checksum offloads request a checksum-only result; normalization consumers still request the complete normalized envelope. The internal explicit transform session owns one heap-qualified worker, request IDs, estimated input/result allowances and awaited teardown. Source buffers are cloned without detachment. Timeout fallback waits for actual worker retirement; retirement failure quarantines later offloads. Ordinary standalone calls retain one-operation ownership. Stage1 file processing now installs an invocation-owned session. The parent suspends its compute permit for admission and child execution, retaining its existing file/byte reservation, and reacquires compute before consuming the result or taking the inline path. Optional child admission reserves CPU, memory and estimated clone/output bytes immediately or declines without queueing behind retained parent resources. At most four waiting borrowed requests and 32 MiB of estimated queued input are accepted by the session; no queued cloned graphs are created. Session teardown remains inside the caller lifetime. Full result, timeout/cancel, source ownership, native heap and worker-reuse controls remain unexecuted.


Scheduler compute suspension applies only at explicit known wait boundaries. The original task retains its memory tokens, in-flight byte estimate and file/window ownership. CPU and adaptive compute-surface occupancy return to admission until the task fairly reacquires its exact CPU charge. Nested waits inside a suspended operation borrow that suspension; concurrent known waits join one reacquisition. Internal reacquisition remains available after caller cancellation for cleanup, but shutdown rejects it without replacing the primary wait error. Retained tasks have a separate count bound derived from the existing concurrency/pending envelope, and telemetry distinguishes retained-running from active-compute counts.

File source reads release CPU around actual open/stat/read/close promises and reacquire before verified hashing or other JS projections. Mixed I/O/provider callbacks retain their own compute admission because they may parse or serialize after a wait. Token workers and embedding compute explicitly own child CPU admission while the file parent waits. File byte charges are conservative estimates, not measured heap/RSS. The remaining provider-specific subprocess and semantic-stream wait boundaries still need refinement before #1330 is considered complete; whole mixed callbacks are deliberately not certified as I/O-only. Production session, contention/cancel, byte/memory exhaustion, surface fairness and output parity controls are authored and unexecuted. No throughput gain or final acceptance is claimed.


Parse checkpoint scheduling reads a small manifest-selected immutable descriptor instead of decoding a full lexical bundle and discarding it. Eligible entries are processed with bounded concurrent encoded-byte admission and streaming current-source verification; only path eligibility survives the preload. The ordinary processor still verifies its full bundle once. A separately verified nonsemantic geometry fallback survives missing lexical shards without claiming lexical or semantic replay. Semantic native/fact scheduling remains conservative. Descriptor bytes, source verification bytes and peak admission are observable work counters; all new correctness and workload measurements remain deferred.


Warm-parser lane count may use a recent measured cohort from the existing adaptive profile. Qualification binds the already-verified bootstrap receipt, Node/V8/platform/CPU identity, parser producer and complete normalized parser policy; this profiling identity is not a bootstrap readiness check. Successful explicit native warmup records child startup elapsed time, whole-child observed RSS high-water and actual wave cost throughput. At least three matching process observations are required, with a seven-day freshness limit. Unknown/mixed costs, missing/old history and unqualified warmup retain the previous lane-count fallback.

Qualified selection compares bounded deterministic weighted assignments using observed throughput, conservative per-child startup contention and parser memory. It honors the CPU/FD/memory execution envelope, chooses fewer caches when work is cheap or unsplittable, and requires a predicted gain above both startup and a 10% margin before adding lanes. Existing weighted assignment and canonical per-lane wave order remain authoritative. Decision metadata records estimates and reasons; predictions are not measured speedups. Synthetic lane/count/memory/history and production-handoff controls are authored and unexecuted, with native warm-start/memory and corpus parity measurements deferred.
