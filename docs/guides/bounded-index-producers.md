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


SQLite decode and insertion use a rolling shard window rather than whole-file batch barriers. Completed later shards retain their reservations until the single writer consumes them in manifest/shard order. An indivisible large shard runs alone; files are never partly committed. Current input lengths and decoded projection allowances are checked, and counters distinguish encoded reads, modeled projection/reservation peaks, decoded shards and execution/fallback reason. Worker creation is lazy and effective-memory/heap qualified. Failed retirement keeps credit/ownership and quarantines new work. Output/document-ID/late-shard rollback and contention controls are authored and unexecuted; native decoder utilization, writer busy time, RSS and throughput still require later measurement.


Benchmark report input has one invocation-owned directory inventory and captured length/identity for each selected log, diagnostics and progress stream. A 64 KiB byte transport assembles at most a 1 MiB line and feeds independent parity, preflight and legacy reuse reducers; repo-before-master event precedence remains separate from reuse observation order and task-payload precedence. Diagnostics and progress JSONL retain independent malformed-line counts and provenance. There is no retained raw-log cache.

Stable final lines without a newline retain the legacy parsing policy. Oversized lines are discarded as whole lines and explicitly mark the input incomplete. Append, truncation, replacement, read/close failures and unavailable directory evidence are reported in diagnostics.streamRead; incomplete input cannot report successful diagnostics parity. Counters describe actual opened stream files, read bytes and directory visits, not end-to-end speedup. Stream, UTF-8, append/truncate, precedence and deduplication controls are authored and unexecuted; timing/RSS and existing report parity qualification remain deferred.


Fixture health evaluation creates a fresh invocation-scoped integrity context per selected mode. Existing contained artifact readers record SHA-256 evidence from the same descriptor bytes they decode. JSONL raw-byte witnesses complete only after full stream consumption and descriptor verification; binary-columnar readers include padding/trailing bytes and decline an incomplete or backwards-frame witness. Unconsumed selected family members receive a bounded checksum-only scan. The context retains certificates and at most 8 MiB of encoded-equivalent small metadata, never raw family buffers or full chunk projections. Global stat-keyed artifact memoization is bypassed for these mutable evaluations.

File metadata contributes only SQL inventory, while one merged hot/cold chunk traversal checks UID presence, risk tags and SQL dialects. MinHash identity and packed validation remain mandatory. Health authority version 8 binds selected roots, exact manifest bytes, physical paths, lengths and fresh content digests, including cold and sidecar inputs. Contexts and decoded metadata are discarded between pre-lock, inside-lock and post-build evaluations. Warm stamps still require fresh file contents; same-size/mtime replacement, missing parts, incompatible hash identity and changed descriptors cannot borrow earlier authority. Sharing the physical scan can add cheap semantic examination to a warm-stamp evaluation; it is not a claim that every warm workload improves. New read-count, mutable-authority and merged-traversal controls are authored and unexecuted, and native/cold/binary layout plus end-to-end timing/RSS qualification remains deferred.


Production strict validation owns an invocation read plan for the selected mode root and exact manifest bytes. SHA-1, SHA-256 and xxh64 digests are computed from the same bounded contained JSON/JSONL/columnar bytes consumed by decoders. The final manifest gate borrows only current matching descriptor evidence and performs a 64 KiB checksum-only scan for every declared piece not covered by a complete decode witness, including unused cold, optional and binary families. Parsing rows does not constitute integrity success; checksum finalization and root/manifest/source identity checks complete before a validation report returns.

Manifest diagnostic order remains before family/schema diagnostics, independently of when the bytes are consumed. Standalone manifest validation and non-strict validation retain their eager policy. An oversized manifest declines fusion before decoding and retains that eager gate; witness metadata never silently substitutes later unrelated bytes for earlier decoded data. Small metadata reuse is scoped and bounded, raw buffers are not cached, cancellation owns stream destruction and actual close remains awaited. Internal read counters are opt-in instrumentation, not a new configuration surface. Digest parity, late mismatch, source/generation mutation, injected link metadata, cancellation, checksum-only coverage and production adoption controls are authored and unexecuted. Existing corruption/short-read/compression/layout acceptance and byte/time/RSS measurements remain deferred; no measured speedup is claimed.


Discovery no longer materializes a whole filesystem candidate list. A directory producer uses bounded opendir batches, sorts at most 256 rows/256 KiB in memory, and borrows the existing merge owner for wider directories. A private breadth-first frontier spills instead of growing an unbounded pending-directory array. Scratch payloads have a 256 MiB live-byte allowance and checked task-owned cleanup; exhaustion is a reported error. Directory links, replacement/identity changes, errors, depth and negated traversal rules retain explicit treatment. Candidate, actual lstat, directory-entry, first-admission, sort/spill and live scratch counters describe observed source work only.

Capped selection now has a defined order: breadth-first parent order with UTF-16 lexical children for filesystem discovery, and canonical UTF-16 path order for SCM discovery. Stat results commit in producer order; a slow earlier file cannot lose to a faster later file. maxFiles still counts accepted candidates, so rejected oversized/ignored/missing files do not consume capacity. The bounded window closes its upstream iterator and awaits pending work/cleanup at the terminal cap. Final admitted/skipped output remains sorted as before.

Qualified ordered async SCM adapters can stop at that same admission boundary. Unordered streams use the bounded sorter; legacy built-in provider arrays are borrowed without another full mapped list and retain their existing 64 MiB subprocess-output guard. Those legacy providers still materialize their own bounded result and are reported as such; this change does not claim a native streaming SCM command or a faster first result for a single very wide directory, which must establish lexical order. Candidate enumeration completeness is scoped to filtered discovery only and cannot certify import-target absence. Authored cap/rejection/order/spill/depth/permission/cancellation controls remain unexecuted; 100/10000/100000-path RSS/read/time measurements and existing contract matrix qualification are deferred.


Preprocessing retry products seal in `<repoCacheRoot>/preprocess/snapshot.json` under the existing repository cache-writer lease, before embedding or generation promotion. Every attempt still performs fresh filtered discovery. The bounded snapshot records that historical membership, skips and non-skipped file products; it cannot certify an absent import target or suppress a newly discovered candidate. Root identity, complete ignore policy, routing/cap/sample policies, exact Node identity and shared producer versions qualify reuse. Unknown ignore identity or root aliases retain ordinary preprocessing.

Current contained source bytes must match a retained SHA-256 before classification and line counts replay. Cold eligible files combine source hashing, bounded classification samples and line counting in one read. Changed prior products recompute, with a second count/read when necessary to bind the new classification sample to the same source digest. Samples survive only inside the bounded classification worker; skipped products are deliberately recomputed. Snapshot reads are capped at 32 MiB, product/membership serialization is admitted before whole-envelope assembly, and oversize or malformed caches recompute. Discovery errors cannot seal a replacement. Cancellation, cache ownership loss, containment and operational I/O failures remain errors and cannot authorize a new snapshot.

This is derived retry state independent of the last successful index, not a replacement for generation publication or continuous filesystem-journal authority. Aggregate fresh-discovery, content verification, classification/line-count hit/miss and membership delta counters report actual work, not measured throughput. Cold/warm parity, same-size/mtime mutation, add/delete/rename, policy changes, malformed products, cancellation, injected link metadata and lease-loss controls are authored and unexecuted; full matrix, interruption and time/RSS qualification remain deferred.


Chunk tokenization borrows a single awaited lookahead window from the existing worker/process pool. At most eight consecutive chunks and 128 KiB of UTF-8 token text share one task, under one unchanged language/dictionary policy and the existing language throttle. Results are independently owned, bounded to 8 MiB of encoded protocol payload, and consumed in chunk order. One failed member retains the existing per-chunk inline fallback; cancellation is never reclassified as successful inline work. Lookahead stops at cached/pretokenized products, file-line stream eligibility, changed policies or transformed text.

The producer derives exactly the existing embedded-language mode and comment-stripped token text; parser classification remains on its current owner. No caller source buffer is transferred. There is one outstanding task per file, no corpus-wide promise or result queue, and future results retain at most seven text/result pairs until ordered consumption. Child dispatch requests the existing scheduler's conservative input/output byte allowance; this is an estimate, not measured heap. Aggregate batch/task/text/output/retained counts expose operation work. Main-thread and single-chunk routes remain available under the existing file eligibility policy.

Ordered/scratch-ownership/byte-count/member-failure/cancellation/transformed-input and production-loop parity controls are authored and unexecuted. Native worker/process teardown, mixed-language/comment/checkpoint parity and the requested chunk-count/time/RSS workload measurements remain deferred. No measured batching break-even or speedup is claimed.


Enrichment-only refreshes may reuse a versioned lexical checkpoint inside the existing content-verified immutable incremental bundle. The checkpoint binds current parse/lexical dependency signatures, source hash, exact transformed UTF-16 token text and ordered span/segment/mode/language coordinates, dictionary/classifier/parser/phrase policy, MinHash identity, Node and shared producer versions. Enrichment and embedding signatures do not invalidate independent lexical products; fresh doc metadata, field assembly and embeddings still use their current owners. Older, malformed, incomplete or incompatible products recompute instead of trusting span equality.

Complete products include tokens, sequence, token IDs, MinHash, statistics, classification buckets and case-preserving phrase tokens. Replay receives private arrays. Native classification reuses only a matching policy and exact before/after budget transition from a previously successful native classification, or a deterministic disabled/budget-disabled path. An unqualified native fallback reclassifies from retained base products so later native availability can recover. Every replay preserves the remaining classification budget for following chunks. Checkpoint admission bounds row count, per-row graph/serialization and aggregate encoded/estimated bytes; oversize products fall back individually. It remains internal bundle state, with first-shard-only persistence and checksum/patch/replacement authority inherited from the ordinary bundle owner.

Authored source/policy/span/Unicode/older-corrupt-product/private-ownership/budget-transition and enrichment-refresh controls are unexecuted. Full artifact parity, producer/dictionary/comment/phrase/classifier matrices, native qualification and checkpoint-read/CPU/heap measurements remain deferred. No speedup or completed acceptance is claimed.


Semantic sinks coalesce family fragments in private append-only data/offset builders, bounded by the existing per-part row and byte limits. A builder retains only handles, hash state and counters between producer batches; prepared rows and transport buffers remain under the existing batch byte admission. Every acknowledged append still fsyncs both data and offsets. Coalescing reduces repeated opens, directory durability and offset validation at fragment granularity; it deliberately does not remove per-batch data durability.

A part descriptor joins the source partition only after data/offset sync, awaited actual close, private-name promotion, parent directory sync and full offset validation. Immutable completed names, family row order, contiguous node/edge IDs and canonical content hashes remain unchanged. Unfinished `.building` files have no published descriptor. Cancellation/error cleanup closes owned handles without borrowing canceled admission, then removes the private directory; disk credits remain reserved until deletion succeeds. Cleanup failure is attached to the primary producer/write failure, and explicit retry settlement remains available. A finalized source still belongs to the existing generation publisher.

Optional internal counters report acknowledged batches, part sizes/counts, owned opens/closes/syncs, offset validations, active-builder high-water and written data/offset bytes. Source-only controls cover tiny/large producer batches, physical roll/canonical parity, short writes, durable failure with cleanup refusal, cancellation and retry accounting. These controls and the existing native storage parity fixture remain unexecuted; append/roll/fsync/finalize interruption, actual FD/RSS and workload measurements remain required before acceptance or throughput claims.


Field-postings compatibility reconstruction consumes completed shard bodies with a 64 KiB contained transport, preserving structural delimiters and UTF-8 bytes without materializing a shard-sized string. Fresh source length/framing/SHA-1 must match the producing task's receipt; descriptor identity, cancellation and actual close complete before the atomic legacy writer can publish. Each accepted output chunk receives privately owned bytes, so writable backpressure cannot expose reused input scratch. Existing required legacy output remains available. Whole-field emission now borrows the existing cooperative JSON encoder, and admission estimates reflect each part's actual selected fields rather than equal averages.

This is a partial #1364 repair. Existing field-count partitioning can still leave one dominant field in one large physical shard; stable term/row-range byte partitioning and its versioned reconstruction contract remain open. No hard physical shard-byte bound or balanced dispatch is claimed. Bounded transport/Unicode/empty framing/integrity/cancellation/injected-link controls are authored and unexecuted. Complete writer/search parity, late publication rollback, byte-range work planning and time/RSS/read-amplification measurements remain required.

Live build-state updates retain trailing coalescing while admitting a healthy-storage flush no later than two seconds after the oldest pending patch. New updates cannot move that deadline. An in-flight write owns its detached batch; best-effort arrivals merge into one next snapshot until it settles. Required writes and explicit captured-tail barriers retain their existing serialized order. Storage failure retains the failed snapshot and retry backoff, rather than creating immediate retry loops after the healthy age expires.

Durability lag is the age of the oldest unacknowledged logical update, including active and failed batches. `oldestPendingAgeMs`, `activeWriteAgeMs` and `newestLogicalUpdateAgeMs` separate queued, active and newest-update ages; acknowledgement timestamps describe the actual completed batch. The legacy `pendingSinceMs` telemetry remains an age alias. An older acknowledgement cannot reset a newer pending batch. Age telemetry uses the existing process wall clock; the healthy scheduling bound assumes that clock progresses normally and excludes blocked event-loop or storage time. Heartbeat warnings consume this production lag and retain the separate age/acknowledgement fields. Virtual-clock regression coverage is authored; runtime qualification is deferred.


Hard-pressure zero-slot tokenizer admission owns a monotonic liveness window before backend submission. It requests existing lifecycle downscale/relief once, waits up to five seconds without an independently draining request, and permits a bounded fifteen-second drain window when another admitted backend request may release memory. Genuine slot releases update progress; the absolute ceiling still bounds persistent pressure. These internal deadlines authorize failure only, never work outside a memory/CPU reservation. One owner refresh timer also wakes due admission deadlines, with no per-waiter polling timers.

Exhaustion records a precise retryable/resumable resource-pressure error, observed wait/drain/retained/progress and relief state. All new token admissions then fail, including lighter modes, so ordinary build failure/drain/checkpoint recovery can release retained contexts. Pool error handling and the chunk caller propagate this error rather than restarting the backend or computing inline. Committed-heap occupancy and owned RSS remain pressure proxies, explicitly not proof that the V8 hard heap limit was exhausted. Cancellation removes waiters/timers, and lifecycle teardown joins the owned relief request.

Virtual-time controls cover transient recovery, genuine-progress grace, persistent independent drain, no drain, terminal producer refusal and cancellation. They are authored and unexecuted. Mixed-language/source-AST retention, native lifecycle relief/teardown, insufficient cache relief and whole-build resumable behavior remain qualification obligations; no real memory-pressure or performance claim is made.


Implementation-review amendments retain the pre-existing independent admission of an indivisible semantic source-manifest row; producer-family rows keep their configured part-byte limits, and all disk reservations remain mandatory. Optional cooperative JSON writer timing separates active encoding from transport and cooperative waits, avoiding a streamed field's awaited I/O being labelled serialization CPU. These are authored source corrections, with no executed acceptance evidence.
