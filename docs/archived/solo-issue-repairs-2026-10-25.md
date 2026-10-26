# Solo issue repairs — 2026-10-25

## Scope and execution policy

Continue on `codex/pr557-audit-repairs-20261012` and PR #572, using Node
26.12.1 on Windows. The user resumed implementation first on October 25:
batch related open issues, defer test execution until implementation is ready,
and commit/push completed source batches. No workers, worktrees, Linux/WSL,
elevation, security-setting changes, physical-link creation or merge is included.
Formatting and static/generated checks continue. Authored regressions below are
unvalidated unless a later source-bound receipt explicitly records execution.

The live GitHub intake contains **763 open issues**: P1 31, P2 336, P3 46,
Perf 115 and other/unprioritized 235. There are no P0/P4 reports in this snapshot.
Titles determine priority. This is an open-issue inventory, not a claim that
every open report has been independently reviewed or fixed. Existing PR coverage
and historical receipts remain separate from GitHub open/closed state.

## Completed implementation batches

- **#1746: VFS I/O benchmark deletion ownership.** `--outDir` selects a parent;
  the benchmark exclusively creates a unique child, uses exclusive file writes,
  joins every started writer before cleanup and starts no subsequent batch after
  failure. It rechecks admitted parent/root identities and removes only that
  child. Invalid modes fail before filesystem work. Cleanup failures preserve
  the original work error as cause and retain the refused run directory.
  `tests/perf/bench/vfs-io-ownership.test.js` covers the actual CLI, unrelated
  parent bytes, retained outputs, concurrent runs, held/failing writers and
  cleanup refusal. Execution is deferred.
- **Validation fixture repairs carried forward.** The completed-stage schema
  negative now constructs an explicitly unobserved producer, rather than
  deleting an optional reason from the observed checkout identity. Native job
  selection uses the current producer's exact disabled/expired-selection
  diagnostics. Native search fixture publication now receives the same explicit
  cache root as its isolated CLI child; parent environment configuration cannot
  silently redirect the fixture's artifacts. Assertions remain intact; rechecks
  are deferred.

## Authored priority batch

The following priority implementations are also authored with execution deferred:

- **#1742:** ANN health/preflight success preserves unknown latency. Only finite
  nonnegative numeric observations update the EWMA, whose first sample initializes
  directly. Healthy measured providers precede unknown providers in stable base
  order; cooldown/failure penalties remain independent.
- **#1730:** adaptive I/O growth uses actual configured/sampled FD caps. Unknown
  evidence remains null with explicit provenance, rather than copying current
  capacity into an invented ceiling. Cap contraction preserves admitted use.
- **#1736:** Python import continuation balances signed delimiter changes across
  logical lines and preserves blank/comment continuation lines. Both collector
  APIs and registry projection retain later independent imports. Import-resolution
  producer version advances **16 → 17** to invalidate incomplete cached extraction.
- **#1741:** shard-gap checks and binary sidecar/checksum selection use canonical
  artifact names separately from physical backup paths. Primary and backup reads
  retain the same missing-shard and checksum obligations.
- **#1740:** streamed binary rows enforce their byte allowance before allocation
  independently of aggregate data-file admission. Many small rows may still stream
  across a larger file; an oversized row reports a typed capacity error.
- **#1737:** zstd JSONL always uses the existing owned streaming decoder. The
  optional whole-buffer decoder had no decoded-output allocation bound. Its now
  unreferenced private reader resolver/threshold were removed after a repository
  reference search; writer/native dependency support is unchanged.
- **#1734:** watch startup and steady state share one closeout region, including
  discovery/backend/callback failures and startup cancellation. The original close
  receiver/method is captured once; each cleanup step proceeds despite sibling
  failure. Failed/unknown closure retains pending ownership. Exact listeners are
  removed, active work drained and terminal observations attempted on every exit.
- **#1729:** dense validity compares captured semantic fields without serializing
  the complete bitmap per lookup. SQLite ingestion admits a private mask snapshot
  once for array, buffer and async-row paths; later invocations re-admit changed
  metadata and retain invalid-count/mask rejection.
- **#1716:** symbolic graph admission captures bounded passive JSON before signal
  or hydration callbacks. Only privately owned frozen entries carry cached
  validation; the writer uses their admitted byte/hash measurement. Regressions
  exercise raw mutation, accessors/proxies, byte/node bounds, cache reuse and a
  real writer-to-reader roundtrip.
- **#1698:** decision, context-pack and history selection share one contained,
  bounded snapshot reader and reject requested/embedded identity conflicts.
  Decisions retain a compact receipt for exact admitted bytes and source/ID
  provenance. A later same-ID finding update cannot retarget an earlier receipt.
  Source extension fields remain supported; no outer record version is invented.
- **#1565:** replay, completion preload and missing-bundle recovery use the
  existing descriptor-verified source owner. Import scans pass their actual root
  and cancellation signal. Shared read entries carry private map/root/file
  receipts, fresh descriptor checks and a 16 MiB/256-entry retention bound;
  callers cannot forge admission or mutate retained bytes. SHA-1, semantic
  SHA-256 and text derive from the same snapshot. The existing one-payload-read
  bundle/import assertion remains, now observing actual descriptor reads and
  real fixture timestamps. Prefix preprocessing also passes containment authority.
  Original pending read/close errors cannot become ordinary cache misses.

- **#1598/#1599:** dictionary words stage until verified EOF and actual original
  descriptor closure. Operational/open/read/selection failures retain original
  diagnostics, path and cleanup ownership; permitted optional absence stays
  distinct. A single global reader budget hashes the same bytes it parses.
  Framed content/scope/normalization receipts invalidate metadata-only warm
  entries. Daemon vocabulary and shared buffers remain privately owned; returned
  sets/buffers and forged public entries cannot poison later runtimes. Structured
  input counts distinguish completion, optional absence and failure. Regressions
  cover partial reads, recovery, selection denial, scope changes, same-size edits,
  worker/inline agreement, global concurrency and pending close. Execution is
  deferred. Source: `3088ee1eb`.

- **#1684:** retained WASM uses one bounded, descriptor-verified binary snapshot
  tied to the pinned syntax manifest. Host recovery and deferred execution consume
  those exact bytes after original native closure. The adapter preserves byte
  coordinates/empty text semantics, task authority and final syntax checks. WASM
  producer advances **5 → 6**. Authored real-partition tests cover short reads,
  corruption/growth/truncation, byte admission, cancellation, close-only recovery
  and deferred handoff; no module instantiation. Source: `8ddd0a321`.
- **#1688:** named aliases and fresh typed view results share a bounded use
  classifier. Unsupported container insertion ends the canonical backing-root
  frontier and publishes incomplete alias/effect coverage. Earlier snapshots and
  independent slice sources retain their own histories. CFG producer advances
  **30 → 31**. Combined artifact/SQLite trace and owner/checker scaling regressions
  are extended. Source: `b38c5a22a`.
- **#1610/#1611:** an explicitly requested risk-rule input must complete bounded
  exact-byte acquisition and validation; missing, denied, malformed, oversized,
  canceled and unsettled inputs fail without policy fallback. The same admitted
  bundle is compiled/projected to workers, with original errors retained. Effective
  policy receipts bind file SHA-256, defaults/inline rules, regex policy and producer
  identity to enrichment/full reuse while preserving parse/lexical identities for
  policy-only changes. Risk producer advances **6 → 7**. Pure receipt/serialization
  ownership keeps signature consumers independent of file/regex acquisition.
  Authored tests cover actual local findings, worker parity, strict failures,
  descriptor recovery and the per-file reuse boundary. Source: `a1fdd2abc`.
- **#1397:** scheduler failure inspection preserves the original resource
  observation. Frozen errors and fallible diagnostic/termination fields cannot
  become an ownership-free TypeError or normal degradation. Both diagnostic
  buffers are flushed independently; secondary flush failures retain the primary
  pending child. Task retries are explicitly zero. The actual scheduler/writer
  release regression asserts exact child scope, unknown cleanup refusal, delayed
  original closure and confirmed-cleanup degradation. No native child is launched
  by that fixture; Windows live-child qualification remains deferred. Source:
  `4739ea325`. Existing structured teardown receipt checks remain in place.
- **#1635/#1636/#1637:** records path exclusions are terminal before optional
  content sniffing; prose/code and explicit triage-root routing stay independent.
  The builder reuses bounded deterministic discovery, obtains a terminal inventory
  receipt before publication/pruning and propagates root/subtree/source errors.
  Missing optional roots remain distinct from successful empty scans. Original
  decoded text owns ranges, UID input and literal tokens; scoring normalization
  and summary/source embedding representations are explicit. Records producer
  advances **7 → 8**, discovery selection **2 → 3**, and cached preprocessing
  routing is version-qualified. New regressions cover actual preprocessing and
  producer handoff, prior-manifest preservation, cold/warm/fresh products, Unicode,
  case/CRLF/astral extents and old receipt rejection. Source: `38214a128`.

- **#1562:** the existing namespace-aware SAX owner already handled prefixes,
  comments and self-closing paragraphs. This batch completes UTF-8/BOM/XML 1.0
  admission, explicit unsupported-encoding refusal, root/entity/character checks,
  depth/node/attribute/event/paragraph bounds and monotonic deadline checks.
  Structural admission precedes optional provider work. Physical ordinals include
  omitted revision paragraphs; old compacted-index assertions were identified by
  counting the fixture's actual Word paragraph elements, while all visible and
  excluded-content assertions remain. The pathname adapter uses bounded verified
  source admission with original close ownership. DOCX structure advances **2 → 3**
  and persisted format-specific normalization identity records that meaning.
  Authored coverage exercises prefix/default namespace rebinding, comments, empty
  and deleted paragraphs, tables/separators, actual preferred/fallback paths into
  the real chunker, BOM/encoding/grammar/capacity/deadline controls and direct
  pathname byte refusal. Source: `34d54951c`. Execution remains deferred.

- **#1563:** PDF page observations now retain actual total pages separately from
  text units/chunks, exact original page numbers, completed/no-text/failed/
  in-flight/unattempted counts and at most 256 state ranges with exact omission
  counts. Completion follows page cleanup. Unknown text coverage remains distinct
  from blank/scanned classification and OCR. Mixed PDFs keep useful text with a
  coverage-gap diagnostic; files with no observed text have a precise reason.
  Extraction cache, report and build-state summary preserve the same evidence;
  quality-sensitive policy marks unknown coverage without changing observations.
  PDF producer **1 → 2**, fidelity **1 → 2**, and normalization `v1:pdf-text:2`
  invalidate old completeness claims. Sources: `875251600`, `916a4e326`.
- **#1564:** immutable bundles carry a bounded versioned extraction receipt tied
  to the selected source hash/size. It preserves provider/format/chunker identity,
  effective policy, source-unit mapping, warnings and fidelity across JSON and
  msgpack, first-shard ownership, reassembly and Stage2 writeback. Admission checks
  shape, current policy/producer, extents/counts and page evidence before restoring
  metadata on the early replay return. Missing or malformed receipts require
  scoped refresh, and missing provenance cannot shrink the report denominator.
  Mode reuse resolves provider identity first; its separate document dependency
  domain preserves ordinary parse/lexical identities for policy-only changes.
  Invocation-only cache hints do not change persisted warnings/fidelity. Shared
  document extraction producer advances **4 → 5**. Authored actual partial-rebuild
  cases cover unchanged/changed supported sources, report membership/identity,
  policy decreases including two pages to one, scheduling/effective-policy
  controls, missing/corrupt receipts, Stage2 and real shard splitting in both
  encodings. Source: `916a4e326`. Execution remains deferred.

- **#1600:** lazy author hydration publishes a request-owned metadata/filter pair
  instead of mutating artifact-cache rows beneath another wrapper's stale index.
  Weakly retained materializations reuse the completed pair for equivalent warm
  requests. Construction completes before either derivative is installed. The
  authored fixture composes the actual index cache and backend wrapper with
  admitted SCM evidence, checks independent expected IDs across cold/warm and
  coordinated wrappers, generation replacement and construction failure, and
  asserts one metadata copy/filter build for the unchanged warm cohort. Source:
  `9007a937b`, qualification followup `4e9bb310c`. No allocation/latency gain is
  claimed from these unexecuted assertions.
- **#1605:** SCM selection and revision/policy admission precede author-cache
  lookup. Complete per-file evidence is retained under the existing freshness
  owner; failed/empty/partial/unsupported work is retryable on a later request,
  with lower-level provider backoff unchanged. Successful files are reused while
  unresolved files retry. Immutable map revisions preserve coherent filter
  overlays; subset receipts cannot certify unseen chunks in the same file.
  Retention is bounded to 16 entries/16 MiB of accounted evidence. Current and
  legacy build-ID forms use the SCM component, preferring explicit `repo.head`.
  Annotation cancellation and unconfirmed resources propagate through Git and
  provider normalization. Typed coverage and `chunk-author-unavailable` execution
  mark uncertain filtering partial, and final query-cache lookup/publication
  requires the privately admitted evidence identity. JJ still annotates through
  its existing adapter but cannot claim immutable historical cache authority
  because that adapter ignores the input revision. Authored cases cover recovery,
  partial-file reuse, source/policy/provider changes, shared row projections,
  actual query-cache invalidation, cancellation, original pending resources and
  retention bounds. Source: `4e9bb310c`. Execution remains deferred.

Implementation reconciliation also reviewed the existing reverse initialization
unwind and actual final-receipt failure fixture for **#1073** (`8d46b2a43`),
and terminal append/immutable error precedence plus multi-process regression for
**#1315** (`65e3d44d6`). Their coverage moves from partial to implemented; this
credits existing source, not new repairs or newly executed tests.

New/extended regressions cover the numeric, continuation, capacity, backup,
startup and per-ingestion invariants. They have not been executed in this wave;
no latency/memory speedup or acceptance count is inferred from these source changes.

Static formatting, config budget/environment checks, generated freshness and
command-surface checks passed for the earlier cleanup/fixture batch. Roadmap
history moved to a linked archive to restore its 20 KB budget. The missing inherited
trusted-config selection was omitted only from check children; no trust was granted.

## Remaining work

Implement remaining priority defects before perf/unprioritized work, retaining
the existing issue mappings and authored coverage. Finish the interrupted
Windows validation selection and resolve its outstanding export deadlines and
native lifecycle cases when execution resumes. Preserve the original failure
receipts and distinguish mixed-source passing observations from acceptance of
the final candidate. Update PR #572 with source batches and exact validation
status; no all-issues or whole-suite closure is claimed here.

Static closeout through source `38214a128`: formatting, config budget, environment
usage, script-inventory/shared-module freshness passed. The first command-surface
audit rejected the inherited missing trusted-config selector; its isolated-child
recheck passed after removing that stale selector without granting trust. Functional execution
and the complete front gate remain deferred; this is not final-tree acceptance.

Static followup at `34d54951c`: formatting and syntax checks passed. Runner list
mode discovered all eight newly authored dictionary/WASM/risk/scheduler/records/
DOCX regression files selected for this wave. Listing executed no fixtures.

Static closeout at `56cb3511f`: formatting, syntax, config budget, environment
usage and artifact-schema/shared-module freshness checks passed. Runner list mode
discovered both new PDF fixtures and the incremental receipt fixture; no fixture
executed. WASM diagnostics now retain the original failure plus source/partition
identity; the old corruption assertion now requires the verified reader's typed
integrity error instead of its superseded message (`56cb3511f`).

Hosted CI at `875251600` remains red: the gate's postinstall patch-enforcement
fixture expected SIGTERM but observed a null signal at line 144. Policy passed;
Windows/authority/native/Rust/platform jobs were skipped behind that failed gate.
The [source-bound job log](https://github.com/doublemover/PairOfCleats/actions/runs/40190762343/job/121161077154)
was inspected; no Linux/WSL execution was started locally. Full front-gate,
functional and native/performance qualification remain deferred.

Signal-lifetime repair `ba78bbb4f` retains a dispatch turn for a self-signal and
keeps the existing bounded forwarding deadline referenced until tracked shutdown
settles. A fresh-process portable fixture controls delayed signal delivery and
unreferenced cleanup, including rejection, without issuing a POSIX signal. The
original postinstall SIGTERM assertion remains, with added status/stderr context.
Formatting/syntax passed; the fixture was discovered without execution. Hosted
requalification remains separate from this source repair.

## Admission and publication followup

- **#1609** (`fec7ee41e`): lint interval projection rechecks both ends for nested
  chunks while retaining the source-ordered sweep, provider ordering and exact
  fallback intersections. Lint producer identity advances to 2. Authored cases
  compare an independent interval oracle and the actual chunk processor/cache.
- **#1561** (`ca637a617`): context expansion charges rejected, duplicate, missing
  and empty-bucket candidates before expensive work; cancellation and time checks
  apply inside fanout. Index/filter preparation is reported separately. Authored
  cases preserve eligible-result order and exercise the actual mode adapter.
- **#1575** (`2b95a280a`): standalone atomic JSONL output closes descriptors and
  awaits its owned codec settlement before the existing replacement owner can
  publish. Borrowed pool ownership is unchanged. Authored cases retain a previous
  artifact through delayed/failed teardown, cancellation, destination and commit
  failure; successful output is decoded and compared exactly.
- **#1580** (`6bba53513`): semantic SQLite payload reads admit UTF-8 row and
  aggregate page bytes in SQL before exporting text. Iterative hydration retains
  deterministic member ordering and cursor boundaries. Oversize evidence remains
  an explicit output-limit failure; admitted invalid JSON is an integrity error.
  Authored cases cover all five related families, exact/multibyte boundaries,
  aggregate rejection, continuations, detail/trace consumers and cancellation.

Hosted gate at `04a1fd14d` still observed postinstall **status 0, signal null**
after its Git child died with SIGTERM; the first dispatch-turn repair did not
close the failure. [Job evidence](https://github.com/doublemover/PairOfCleats/actions/runs/40196892937/job/121179619742).
Followup `5a2d1958a` replaces the one-turn assumption with a bounded referenced
dispatch owner that releases on actual signal delivery, preserves custom handler
authority and fails closed if delivery never occurs. The portable regression now
delays delivery beyond an event-loop turn and covers custom handler ordering.
This source change still requires hosted confirmation.

Formatting and syntax checks passed for these source batches. Functional fixtures,
the complete front gate and final Windows qualification remain deferred. Current
coverage is 35 previously fixed, 368 implemented, 150 partial and 210 pending;
implementation does not close an issue or claim final-head acceptance.

## Live state and claim authority

- **#1587** (`07f2379ea`): live build-state coalescing retains the oldest
  two-second healthy-storage deadline. Best-effort arrivals during a write merge
  into one pending snapshot; required updates and captured-tail barriers preserve
  their serialized order. Each detached/failed batch retains its own logical age
  and acknowledgement. Heartbeat diagnostics distinguish queued/active/newest
  ages and consume actual oldest-unacknowledged lag. Authored virtual-clock cases
  cover continuous producers, slow storage, recovery, required ordering and an
  actual heartbeat warning.
- **#1586** (`bb5a68187`): the per-claim renewal owner tracks persisted expiry
  independently of replay/heartbeat I/O. A bounded safety margin cancels the
  original job signal and fences late completion. Same-expiry receipts cannot
  extend authority; late receipts cannot revive an abandoned execution. Original
  owner/version fences and outstanding I/O/cleanup ownership remain. Renewal
  intervals fit inside short leases. Authored clock/worker cases cover transient
  recovery, repeated failure, stuck reads/writes, no-write receipts, clock rollback,
  replacement claims, missing authority and delayed actual cleanup. Positive
  simulated claims now carry the real queue's persisted receipt fields; negative
  ownership and completion assertions remain intact.

Hosted [gate](https://github.com/doublemover/PairOfCleats/actions/runs/40200024025/job/121189039695)
and [policy](https://github.com/doublemover/PairOfCleats/actions/runs/40200024023/job/121189039223)
passed at **`76bf785cb638e3d181a2e252b119497a97c71c1c`**, confirming the gate
containing the original postinstall signal assertion after `5a2d1958a`. Its only
annotation was GitHub's Ubuntu runner-image migration notice. Dependent platform
jobs were queued when inspected. This supersedes the earlier red gate observation
for signal closure, not final-tree or Windows acceptance. No local Linux/WSL run
was started. New local fixtures remain unexecuted at the user's request.

Formatting/ESLint, syntax and affected generated refreshes passed for the new
source batches. Current coverage is **35 fixed / 370 implemented / 150 partial /
208 pending**. Latest live intake inspection still ends at #1748. No issue was
closed merely for implementation and no combined suite pass is claimed.

## Search selector authority

- **#1606** (`03e6cfca3`): branch predicates use one bounded current-checkout
  branch/HEAD observation, with ambient Git redirection removed, cancellation and
  truncation admission. Metrics cannot substitute stale or conflicting branches.
  Unknown/detached observations reject the requested predicate; known mismatch
  remains empty. Ordinary structured output retains the exact branch receipt,
  including through output compaction. Historical searches retain the documented
  current-checkout predicate. Authored cases include an isolated real two-branch
  repository, unchanged indexed metrics, exact expected file sets, cold/warm
  requests, synthetic source disagreements, cancellation and output budgets.
  The existing Git migration test retains environment isolation, real provenance
  and metadata assertions; its branch assertion now includes the revision receipt.
  `loadBranchFromMetrics` was removed only after a source/test/tool reference
  search proved its sole caller was the obsolete branch fallback; no tests were
  removed. No native or command-budget threshold was relaxed.
- **#1608 / #883 followup** (`4a9b093c7`): HTTP GET preserves both snapshot aliases
  until canonical admission and rejects distinct repeated historical scalars.
  Identical trimmed values remain equivalent; list-field accumulation remains.
  Explicit blanks cannot become latest through URL projection or shared request
  normalization. Authored GET/POST server cases assert invalid-request status and
  zero search cache admission. Positive adapter/MCP tables retain exact selected
  refs, one emitted selector, alias equality, omissions and path accumulation.
  The existing successful historical search witness remains unchanged.

Formatting/ESLint, syntax, generated shared-module/taxonomy refreshes and diff
checks passed. These fixtures remain unexecuted. Current inventory is **35 fixed /
372 implemented / 150 partial / 206 pending** across the same 763 open reports.

## Punctuation route parity

**#1601** (`f175ef11e`) applies one 20,000-match punctuation allowance to each
requested chunk. File-line reuse retains a sufficient bounded prefix per line
plus one truncation bit, preserving the same ordered first matches for later
independent chunks. Direct, reused and worker routes retain bounded
`stats.punctuation` evidence (limit, emitted, truncated), including through lexical
checkpoint replay. Malformed checkpoint evidence rejects reuse. Scoring analyzer
identity advances to `unicode-identifiers.v3` with its ICU suffix, and the shared
lexical producer advances to 3; incremental keys/checkpoints cannot reuse old
scoring meaning. Literal phrase tokens remain independent.

Authored cases cover below/exact/over-cap, one/two lines, a later independent
range, identifiers/operators and CRLF. They compare full ordered tokens, synonym
sequence, IDs, statistics, MinHash and actual appendChunk TF/doc lengths; the real
chunk processor proves exact-span route selection, and a separate real-worker
fixture compares its output. Existing large prose, worker failure/cleanup and
lexical replay fixtures remain. Execution is deferred.

The `cachedLexicalBySpan` adapter was removed after a complete source/tool/test
reference search found no producer/writer, only reads and one null fixture input.
The source-qualified full lexical checkpoint is the production replacement and
retains the original replay/content/identity/classification tests. No test was
deleted, no coverage assertion removed and no limit raised. Formatting/ESLint,
syntax, affected generated refreshes and diff checks passed. Coverage is now
**35 fixed / 373 implemented / 150 partial / 205 pending**.

## Sparse materialization cancellation

**#1602** (`5e7b00778`) threads the build signal through token/field assembly,
including vocabulary preparation, stable bounded-run sorting, common-term pair
copy/normalization, field construction and final success admission. The work
driver keeps ordinary no-wait work synchronous and suspends only for an actual
cooperative wait. Its elapsed active-work check operates at bounded batch
boundaries; it is not a whole-build/native comparison latency guarantee. Existing
token-ID mapping, equal-ID TF ordering, field names and length statistics remain.
No semantic output/version change is intended.

Map content consumption belongs to the attempt. Pre-aborted/unconsumed inputs can
retry after settlement. Once content is consumed, source identities cannot be
replayed as an empty index; the caller must rebuild its state. Truly empty inputs
retain existing vector-only fixture behavior. Pending cooperative owners keep
the request active until actual settlement, with no cancellation race releasing
reservations early. The original failure propagates.

Authored checks retain an independent legacy TF oracle, stable ordering, exact
artifacts, all cancellation phases, safe `__proto__` fields, pre-abort, final-return
admission, retained versus consumed ownership and concurrent retry refusal.
Existing shared/typed map, spill, vector-only and no-yield fixtures remain. Static
format/syntax/generated/diff checks passed; execution and measured peak/latency
qualification remain deferred. Coverage is **35 fixed / 374 implemented / 150
partial / 204 pending**.

## Typed MCP identity

**#1614** (`40483ef6c`) retains primitive ID type in legacy pending, active,
progress and cancellation keys. Numeric/string forms and zero remain independent;
same-type duplicate protection and actual execution settlement remain. Responses
retain original IDs. Domain validation matches the installed SDK's strings and
safe integers without importing its schema graph into production legacy startup.
The duplicate cancellation bypass was removed: the existing async message handler
executes cancellation synchronously before any await and now owns validation too.

Authored real-transport/parser controls use inert deferred tools and JSON-captured
responses, with virtual time for progress and timeout settlement. They cover
queued/active cancellation, unknown/invalid targets, typed duplicate diagnostics,
exact cleanup, peer progress state, empty string, safe bounds and SDK-domain parity.
Original numeric duplicate and native execution-settlement fixtures remain. No
framing, scheduling, timeout, drain or output-writer contract changed. Formatting,
syntax, generated refreshes and diff checks passed; functional execution remains
deferred. Coverage is **35 fixed / 375 implemented / 150 partial / 203 pending**.

## Runtime claim deadline ownership

**#1616** (`77f9c0329`) establishes the persistence budget before writer admission
and carries the comparison's original absolute deadline through that owner.
Lock waits receive remaining time; account admission, citation verification,
staging writes and pre-promotion gates share the same budget. Explicit caller
cancellation remains distinct from internal expiry. No nested operation renews
the allowance. Actual resource cleanup settles before ownership is released,
preserving independent failures and attempting both private staging removals.

Errors after a promotion attempt retain a producer-authenticated, bounded claim
generation/manifest identity and observed family/pointer state. HTTP and MCP
preserve that passive reconciliation receipt. An uncertain pointer rename is
reported as unconfirmed; a completed rename is reported as committed. Promoted
families remain immutable and retained. Serialized lookalikes confer no receipt
or mutation authority.

The authored fixture uses two tiny saved synthetic capture families, actual
destination leases and narrow virtual-clock/admission seams. It covers expired
comparison and standalone waits, caller cancellation, early-release success,
deterministic reuse, post-promotion/commit expiry, committed cancellation,
uncertain replacement, independent cleanup failure and public error projection.
Existing raw-integrity, contradiction and pagination controls remain. Formatting,
syntax, affected generated refreshes and diff checks passed. Functional execution
remains deferred. Coverage is **35 fixed / 376 implemented / 150 partial / 202
pending**.

## Isolated lint evidence

**#1612** (`305f2cf7a`) replaces the process-wide ESLint singleton and unsupported
legacy fallback with a bounded root/policy owner. The built-in policy disables
config search, executable repository plugins/processors, inline directives and
fixes. Absolute indexed roots and contained file identities are explicit; process
cwd is unchanged. Declared core rules/parser behavior and ESLint/Node/V8 versions
bind the effective policy identity. No public configuration knob was added.

Whole-file results distinguish completed, disabled, ignored, unsupported,
unavailable, failed and canceled outcomes. Only completed zero-message analysis is
clean. Messages retain their existing chunk projection while bounded counts,
source/policy/producer identity and failure diagnostics persist separately in
`docmeta.lintOutcome` and the immutable file bundle. Errors retain their original
in-process identity; diagnostic getters are not executed. Cancellation joins
actual lint settlement, and failed runtimes can recover without a sticky latch.

One owner captures source text once, admits the file cache and runs analysis once
per file. Enrichment signatures and worker identities share the policy/producer;
the lint projection version advances to 3. Replay requires matching whole-file
and chunk receipts. Deterministic unsupported/ignored/downshift states can replay
explicitly; execution/init failures, missing admission, unqualified empty results,
cancellation and truncated evidence cannot replay as clean output. Idle session
eviction bounds reuse; active saturation refuses additional initialization.

Authored controls cover real ESLint policy isolation in both root orders,
executable-config sentinels, inline directives, positive diagnostics and clean
controls, initialization/execution recovery, ignored/no-result, unsupported and
disabled outcomes, frozen/unreadable errors, cancellation/capacity, exact source
and policy invalidation, actual immutable bundle read-back and nested interval
coverage. All three new fixtures in this and the deadline batch appear in deep
test discovery. Format/ESLint, syntax, generated refreshes and diff checks passed;
functional execution remains deferred. Coverage is **35 fixed / 377 implemented /
150 partial / 201 pending**. The deadline fixture's writer path is canonicalized
in `4ccdaf639` so Windows path spelling cannot hide its admission barrier.
## Explicit MCP test framing

**#1619** (`86f14145d`) replaces the helper's mixed-framing heuristic with an
independent bounded byte reader. The existing server helper chooses the expected
transport before spawning. Legacy first-CRLF fragments stay owned until their
complete header/body arrives; SDK input requires newline framing. Non-protocol
stdout, invalid UTF-8/JSON/envelopes and malformed or unsafe lengths fail visibly.
Continuous listeners retain messages between reads; concurrent read owners are
rejected. EOF, cancellation and original stream errors settle pending reads and
detach the owned listeners.

Headers, body extent, queued messages, notification history and active delivery
are bounded. Fixed body slabs also bound buffer-object count under bytewise
fragmentation. Internal state reports logical retained wire bytes and segments,
not measured RSS. No production transport, writer, flush or execution-lifetime
contract changed; **#1620** remains a separate production outbound owner repair.

The discoverable authored fixture uses independent wire vectors at every split
point, including multibyte scalars, coalesced/bytewise delivery, a larger fragmented
body, framing/contamination negatives, bounds, EOF, cancellation, original errors
and listener cleanup. Actual server lifecycle coverage remains. Format/ESLint,
syntax, generated refreshes, discovery and diff checks passed. Functional execution
remains deferred. Coverage is **35 fixed / 378 implemented / 150 partial / 200
pending**.

## Complete SCM inventory admission

**#1613** (`8fb9fb262`) requires successful terminal state, qualified stdout
capture, exact complete byte counts, no loss/truncation and terminal record
framing before Git/JJ file inventories supply names. Git history enumeration
shares that guard while retaining ancestry qualification. A successful empty
inventory stays authoritative. JJ's existing compatibility output is qualified
independently; its unchanged changed-file cap now returns unavailable instead of
certifying a prefix. Caller cancellation propagates before/after producer work.

Registered wrappers require explicit completion and reject contradictory capture
evidence or invalid list shape. Discovery carries bounded `scmInventory` evidence
and actual selection policy through filesystem fallback. Complete filtered
filesystem candidates do not assert complete SCM coverage. Unsettled resource
failures bypass fallback catches; streaming candidates retain their iterator
settlement and early-cap behavior. Discovery selection producer advances to 4.

The authored fixture exercises actual Git/JJ adapters and wrappers with complete,
empty, truncated/partial-first, lossy, missing/unknown, extent, framing and signal
controls. It covers history, contradictory declarations, asserted JJ fallback/cap
warnings, omitted-tail filesystem fallback, no-crawl empty authority, and an
actual bounded Node-child collector handoff. Existing positive fixtures now
explicitly declare their simulated completion; all their assertions remain.
Format/ESLint, syntax, generated refreshes, test discovery and diff checks passed.
Functional execution remains deferred. Coverage is **35 fixed / 379 implemented /
150 partial / 199 pending**.

## Generated prefix and warm admission qualification

**#1617** (`f3dbdaae0`) captures prefix bytes and source extent from the same
contained descriptor. EOF exactly at the unchanged 8-KiB cap is complete, rather
than presumed truncation. Existing full buffers preserve extent before slicing;
custom readers with unknown extent cannot authorize omission. UTF-8 admission
distinguishes visible corruption from an unfinished scalar. All map routes now
share core/object-cache visible JSON/duplicate-key validation and the existing
depth limit. Marker, filename and renamed/legacy model restrictions remain.
Ordinary path discovery still performs no marker I/O, and the existing-content
route reuses its source buffer. No byte-8193 probe or whole-file read was added.

Policy `poc.generated-discovery@7` also binds a dedicated `sourceAdmission`
dependency. A changed/missing prior identity requalifies the current physical
prefix before cached chunks or semantic relocation. A stale text-cache buffer
cannot supply that observation. Ordinary sources retain parse/lexical products
and publish a new immutable bundle with current admission identity; records
bypass omission. Strict build-state/completed-stage schemas declare this exact
hash field and still reject unknown or invalid fields. Discovery selection is 5.

Authored controls cover complete/capped sizes around 8 KiB, actual EOF, malformed
visible map payloads, duplicate outer/reserved keys, escaped/partial UTF-8, unknown
reader extents, physical read bounds and malformed/owned discovery. The migration
fixture seeds a compatible pre-policy bundle plus a stale text cache for a
renamed marked input, and retains an ordinary sibling's cached parse witness.
Existing corpus/grammar, record-mode, zero-extra-I/O and descriptor-lifetime
assertions remain; capped fixtures now explicitly supply observed extent.
Format/ESLint, syntax, affected generated refreshes, discovery and diff checks
passed. Functional execution remains deferred. Coverage is **35 fixed / 380
implemented / 150 partial / 198 pending**.

A complete live GitHub metadata refresh at `173198cf9` matched all **763** open
IDs, with no additions or closures. It corrected the `[Performance]` classification
of #1394 and normalized #1530's Unicode title from GitHub. Current intake is P1
31, P2 336, P3 46, Perf 116 and other 234; implementation status is unchanged.


## Legacy MCP outbound ownership

**#1620** (`bdb040aba`) gives the legacy connection a bounded outbound owner.
Protocol helpers return delivery promises. A single control admission owner pauses
stdin and bounded parser consumption while its response waits; fast/slow tool
execution remains concurrent. The four reliable response reservations cover two
lanes, one control and serial shutdown cancellation. Tool capacity and typed IDs
join response settlement and actual handler/native teardown. Queued cancellation
retains its identity and reuses one response during concurrent close.

Frames capture UTF-8 once and retain exact Content-Length framing. Terminal bodies
are capped at 32 MiB, with one bounded INTERNAL/output-limit replacement preserving
the ID. Only progress is lossy: two latest pending typed keys, 64 KiB each, plus a
started physical frame. Reliable replies take priority. Internal counters include
retained/peak encoded wire bytes and distinguish delivered, known-unsent,
unconfirmed and rejected terminals; these are not RSS or latency measurements.

A five-second write deadline also covers pre-EOF stalls; a two-second active-flush
deadline bounds output drain. Shutdown stops admission and aborts all active work
before serial cancellation/join. EOF/exit await output receipt and choose failure
status for failed delivery. Physical callback/framing ownership survives an
unconfirmed timeout, independently of writer retirement and actual stream closure.
Neither output failure nor timeout frees still-running native work. A settlement
ordering repair releases the actual output reservation before waking its producer.

Three new discoverable fixtures cover parser pause/caps, independent exact wire
vectors/typed IDs, progress coalescing, terminal/byte headroom, a finite mixed
control/tool flood, oversized-response fallback, EPIPE/EIO, actual stream EOF,
shutdown/exit and delayed teardown under failed flush. Existing execution/typed-ID
fixtures retain their assertions with explicit asynchronous admission waits.
Format/ESLint, syntax, generated refreshes, discovery and diff checks passed.
Functional execution, empirical performance and final-head acceptance remain
deferred. Coverage is **35 fixed / 381 implemented / 150 partial / 197 pending**.


## Captured effective federation policy

**#1573** (`60045f6f8`) qualifies ranked outer reuse with every selected
repository/mode's normalized runtime policy. One existing argv owner supplies
core execution and admission. The CLI normalizer and runtime projection supply
the fingerprint, with model/dictionary and adaptive-provider policy. Effective
field weights and graph-ranking normalization share their execution owners.
Query-cache retention/prewarm settings and raw credential configuration are
excluded. The same identity reaches local query-cache signatures; the outer
producer namespace advances to 10. Index/workspace generation fences remain.

Policy loads once per repository with bounded concurrency, then captures each
pinned mode plan. Started preparation workers join before propagating errors.
An opaque process-local capture binds canonical root, exact argv/mode and score
override. Actual child config, normalized options, model/dictionary policy and
embedding intent consume that capture, preventing policy edits from mixing
execution and publication identity. Downstream mutation gets its own values.
Capturing policy avoids the full capability report's lazy native getter.

Custom search callbacks need a stable host execution-policy ID for persistent
outer reuse; unknown callback semantics still execute with normal generation and
request checks. Existing cache fixtures explicitly declare their simulated IDs,
retaining warm, corruption, strictness, generation, redaction and cancellation
assertions. No public CLI/config/API option was added or relaxed.

The authored fixture uses actual core retrieval over two tiny two-hit indexes,
with explicit before/after relation-ranking order, unchanged generations, warm
reuse, independent member policy, normalized override/cache-only changes,
environment policy and secret controls. It covers a mid-request config edit,
invocation binding, snapshot mutation, lazy capability reporting and unknown
custom callbacks. Format/ESLint, syntax, affected generated refreshes, discovery
and diff checks passed. Functional execution and measured performance remain
deferred. Coverage is **35 fixed / 382 implemented / 150 partial / 196 pending**.


## Claim verification versus page admission

**#1622** (`e022aa39f`) retains verification of every family citation and its
supporting/contradicting retained raw dependencies on every request. Response
records/bytes now govern only the returned page. Separate fixed physical
allowances bound two families, 128 citation rows, 1 MiB hydration and 128 MiB raw
verification, alongside existing metadata/index/member bounds and the original
single operation deadline. Internal diagnostic controls can only lower caps.

Refusal uses ERR_RUNTIME_QUERY_BUDGET rather than misclassifying a healthy row
as corruption. A strictly declared optional verification receipt separates
physical rows, hydration/raw/metadata/claim verification, selected row reads and
final response bytes. Bounded producer-attested refusal receipts preserve
consumed/next-required/limit basis through HTTP422 and MCP; serialized lookalikes
supply no authority. Missing, tampered, scope and cursor failures retain their
error classes. Selected claim and raw hash reads now preserve primary failure
alongside independent close failure, using the existing resource owner.

The authored fixture imports sixteen real distinct observations in two saved
captures, then publishes two claims with distinct support/contradiction subsets.
It checks a fitting small page below total citation bytes, identical first-claim
identity with a larger allowance, exact-once paging, repeated all-family work,
physical-cap refusals, original raw tampering/missing data, wrong scope and tracked
file closure. API/MCP/CLI parity preserves every content/physical field; it checks
response byte counts directly and omits only the owner's proven invocation-time
and consequent byte-count fields from cross-invocation equality.

Format/ESLint, syntax, affected schema/ledger/taxonomy refreshes, discovery and
diff checks passed. Functional execution remains deferred. Coverage is **35 fixed /
383 implemented / 150 partial / 195 pending**.


## Semantic drain publication authority

**#1623** (`ef238bec3`) captures canonical repository/cache/build publication
ownership and the existing effective content/environment/tooling projection.
The service clones caller configuration, and native/compiler verification uses
that same tooling configuration. Live trusted configuration is revalidated at
drain admission, after both normal-builder/runtime loads before mutation/storage
admission, at attachment, recovery and pre-publication. Runtime cache/build-root
ownership is checked explicitly. A changed owner rejects with bounded opaque
expected/actual identities; no old snapshot is forced over revoked authority.

Request domain v2 includes that authority identity, so journals cannot alias a
different configuration's operation. Historical journals remain preserved rather
than silently acknowledged. Task/artifact/journal shapes remain. Existing content
projection permits excluded cache-retention/runtime/logging changes while the
publication location stays independently bound. Independent release/close failure
now survives with the original drain failure through the existing context owner.

The authored real WASM fixture controls two ordinary builder barriers, switching
trusted cache A to B before entry or during initial policy selection before the
second config load. It covers loaded and supplied config routes, an early injected
owner mismatch, unchanged A pointers, no B creation, failed journals, released
leases and healthy A-to-A generation publication after an admitted cache-retention
change. Existing native/compiler, source/dependency mutation and cancelled/lost
lease fixtures retain their assertions. Format/ESLint, syntax, affected generated
refreshes, discovery and diff checks passed. Functional execution remains deferred.
Coverage is **35 fixed / 384 implemented / 150 partial / 194 pending**.

A new exhaustive GitHub metadata refresh at `ef238bec3` again matched **763** open
issues, with no added or closed IDs. The refresh is metadata evidence, not test
qualification or accepted issue closure.


## Federated risk member qualification

**#1588** (`4295cd4c8`) captures one immutable child-payload attestation per
selected repository, bounded by the existing 16-repository cap. Domain-separated
identities cover actual index/rule/config/artifact provenance, status, support,
stats and caps. Findings and evidence locations reference their exact member;
validators reject dangling, substituted or changed attestations and unsupported
artifact surfaces. Base-only summary/guidance/anchor scope is explicit; global
provenance/support/stats/caps defer to the registry. Completion is conservative
across capped, missing or otherwise unavailable members and repository omissions.

Risk contract 1.1.0 enforces the new exact-version boundary. JSON, Markdown and
SARIF retain member qualification; SARIF finding and physical/thread-flow
locations preserve the reference. Final-envelope budgeting includes rendered
companions. Optional risk is removed as a complete owner if it cannot fit;
strict risk preserves the existing refusal contract.

Authored controls extend the real direct/API/MCP federation fixture with distinct
member fingerprints, peer-only identity changes, a base swap, capped input and a
missing peer artifact. They retain all original alias/order assertions and add
rendered-output and public-validator negatives. A focused fixture covers registry
integrity, conservative status and whole-owner compaction. Format/ESLint, syntax,
affected generated refreshes, fixture discovery and diff checks passed.
Functional execution remains deferred. Coverage is **35 fixed / 385 implemented /
150 partial / 193 pending**.


## Per-source semantic query qualification

**#1568** (`1ebc6f5bb`) gives find, detail and trace one shared source-related
coverage qualifier. Each lookup must contain syntax and analysis evidence across
its associated physical partitions, and every present row must be complete.
Uncovered sources cannot borrow another source's complete phases. Raw physical
coverage remains page-local; five bounded monotone booleans retain whole-request
qualification through continuations, distinguishing missing and incomplete phases.
Enumeration status stays independent from analysis completeness. Detail also
retains unavailable requested evidence across pages instead of erasing an earlier
missing record when a later page completes.

The authored matrix uses actual artifact and SQLite stores, distinct source
identities and sibling syntax/analysis partitions. It covers both detail orders,
single/two-page requests, missing syntax, missing analysis, both missing,
partial/deferred/unsupported phases, covered positives, empty selectors, missing
record frontiers and monotonicity. Format/ESLint, syntax, affected ledger/taxonomy
refreshes, fixture discovery and diff checks passed. Functional execution remains
deferred. Coverage is **35 fixed / 386 implemented / 150 partial / 192 pending**.


## Canonical parser degradation scope

**#1569** (`a5b1e0897`) replaces substring/prefix inference with one scheduler
query owner and a versioned typed receipt. Explicit grammar failures remain
broad; container and segment occurrence failures match exact canonical VFS
identities. The VFS builder supplies encoding/case/coordinate round-trip admission.
Canonical historical summaries and exact-key adapters remain supported; raw,
ambiguous, noncanonical or unsupported paths stay diagnostically unknown rather
than becoming another path's authority. Explicit failed grammars survive an
unqualified additional receipt.

The crash publisher emits the same receipt in summaries and local/durable
forensics. Per-file diagnostics/checkpoints preserve scope counts, bounded cause
samples, omitted samples and unknown receipt counts. Source-chunking producer 29
invalidates old routing meaning. Authored counting-adapter fixtures retain healthy
sentinel chunks through prefix/sibling collisions and cover container, occurrence,
grammar, mixed-language, encoding/Unicode/case, historical/invalid receipts,
lookup release and cold/checkpoint parity. The real publisher fixture checks its
receipt without changing existing failure assertions. Format/ESLint, syntax,
affected ledger/taxonomy refreshes, discovery and diff checks passed. Functional
and native execution remain deferred. Coverage is **35 fixed / 387 implemented /
150 partial / 191 pending**.


## In-process daemon cleanup authority

**#1591** (`83438cd59`) captures the original resource observation before daemon
failure diagnosis or result normalization. Pending ownership rejects through the
existing queue exact-claim cleanup hold, without normal completion/retry,
session recycling or subprocess fallback. Core build outcome presentation uses
the same rule and shared failure context rather than assigning onto frozen
errors. Diagnostic getter/logging failures retain original and secondary causes.
Confirmed settled cancellation keeps exit 130; build outcome/publication metadata
survives ordinary result normalization and queue completion.

The cross-boundary fixture injects an inert build at the real daemon boundary,
then drives the actual executor, lifecycle registry, queue worker and durable queue
owners. It covers pending/mutable/frozen/hostile and abort-cleanup errors, original
observer mutation, retained exact-claim fences, zero normal finalization before
release, exact-once recovery and a separate sibling's later success. Additional
controls cover settled failure/cancellation/success/post-publication context,
fallible diagnostics and frozen core outcome presentation. Format/ESLint, syntax,
affected ledger/taxonomy refreshes, discovery and diff checks passed. Functional
execution remains deferred. Coverage is **35 fixed / 388 implemented / 150 partial /
190 pending**.


## Runtime source scope and observation occurrence ownership

**#1639 and #1640** (`b77f72e80`) retain per-requested-source/hash qualification in
each pinned family. Snapshot presence, exact retained observation counts and
absence/no-retained-observation reasons remain separate. Global join counts are
explicitly family-wide. Indexed pair predicates avoid row hydration and report
physical predicate counts under the original deadline. Excluded captures retain
not-selected receipts and cannot downgrade selected capture completion. Source
execution coverage remains unknown; retained-row scan completion is a different
fact. OR row selection, existing hard limits and immutable verification remain.

Each observation is an explicitly qualified projection occurrence. Compact family
handles resolve through the complete pinned generation/manifest/capture table;
retained row hashes qualify observations, explanations and omissions. Logical IDs
remain stable across same-capture reimports without deduplicating or overwriting
attribution variants. Each retained occurrence keeps its own row verification.
Public schemas/cross-reference validators enforce these associations; query
identity v2 invalidates prior semantic cursors without changing stored artifacts.

Authored fixtures use actual imports and physical row-byte/hash oracles, indexed
predicate instrumentation, absent versus present/unobserved sources, wrong hashes,
source OR order, stable coverage through cursor pages, excluded partial captures,
family order, duplicate logical IDs, invalid references and tampered sibling rows.
The existing real published-semantic witness adds verified/ambiguous/unverified
same-capture variants across one-record pages. Original distinct-capture and
selection assertions remain. Format/ESLint, syntax, affected schema/ledger/taxonomy
refreshes, discovery and diff checks passed; functional and public-surface
execution remain deferred. Coverage is **35 fixed / 390 implemented / 150 partial /
188 pending**.

A complete metadata refresh at `b77f72e80` again found **763 open issues**, with no
added/closed IDs or changed titles. No issue is closed on unexecuted source alone.


## Live evaluation depth qualification

**#1641** (`36c0dddf3`) gives live judged evaluation an explicit immutable metric
plan: operator-requested retrieval depth, standard cutoffs within that depth plus
the depth itself, matching/cohort/judgment policy and censored MRR@depth. Search
requests keep the operator's depth. Cohorts retain requested/observed lengths;
short responses keep exhaustion unknown rather than guessing from array length.
Existing numeric MRR is qualified by the shared plan. Silver/gold and cohort
macro denominators remain. Missing/failed cohorts and output omissions retain
existing unavailable-evidence admission.

The plan key binds report and summary semantics. Comparison rejects mismatched
or legacy/unqualified plans; model bakeoff consumes this gate, binds the new
owner in resume identity, prints MRR with its depth and represents unavailable
cutoffs as n/a. The actual-runner module-hook fixture supplies fixed rankings with
relevant ranks 1/2/4/6/11, depths 1/3/5/10/20, silver/gold and independently ranked
mixed cohorts. It checks every advertised cutoff, depth and denominator, a short
response's unproven exhaustion, plan integrity and incompatible comparisons.
Format/ESLint, syntax, affected inventory/ledger/taxonomy refreshes, discovery and
diff checks passed. Functional execution remains deferred. Coverage is **35 fixed /
391 implemented / 150 partial / 187 pending**.


## Typed validation findings and mode verdicts

**#1632** (`e672aad3e`) gives every validation helper a shared finding owner with
mode/capability, stable code, severity, artifact, state and detail. Global
issue/warning strings project from those findings; display prefixes do not supply
ownership. Final mode and aggregate verdicts reconcile after deferred manifest
and backend checks, without new artifact reads. Present invalid identities no
longer leave their mode green or become missing-artifact summaries. Known I/O
observation failures and skipped checks retain unverified status. Backend-wide
and mode-owned SQLite/LMDB findings keep distinct scope.

Manifest workers preserve original diagnostic order, including deferred checksum
insertion at its original typed anchor. Appended finding batches merge without
reprojecting the growing full report on each piece; final projection occurs once.
Human output uses the resulting state and preserves failing aggregate exit status.
The existing contract matrix gains mode-error assertions; its intended checksum
mismatch now uses a correctly sized false SHA-1 instead of a malformed digest.

The authored two-mode capsule covers either mode failing with symbol collision,
fractional posting, invalid metadata schema, embedding identity, checksum,
missing-piece or read failure, plus optional-only warnings and human/JSON CLI
projection. Pure owner controls check deferred ordering and backend scope.
Format/ESLint, syntax, affected ledger/taxonomy refreshes, discovery and diff checks
passed. Functional execution remains deferred. Coverage is **35 fixed / 392
implemented / 150 partial / 186 pending**.


## Captured fusion depth availability

**#1645** (`665928c55`) versions saved fusion captures to 2 and records per-channel
captured count, ranked-prefix semantics and requested capture depth (unknown when
not supplied). Larger replay depths require an explicit capture-owner exhausted
enumeration receipt bound to eligible count, ordered source-key prefix hash and
query/corpus generation/source identity. A short or empty list does not mint that
claim. Receipts state capture-owner enumeration evidence; replay does not recover
unseen ranks or qualify live latency.

Replay retains requested/effective depth and availability reasons. Sweeps admit
every query/configuration depth without silently clipping or dropping a query.
Scalar grids are captured before asynchronous work. New schema/source, depth
policy, checkpoint and frozen selection identities invalidate stale capture or
selection meaning. Existing scoring/gating/boost/diversity owners and hard bounds
remain. No production ranking default changes.

Authored controls cover independent sparse/dense depth zero/exact/one-past/100,
bound exhausted positives, query/generation/prefix/count tampering, old-version
rejection, capture mutation, mixed query depths in either order and a genuinely
captured rank3 whose known export boost changes the selected result and sweep
winner. Original baseline/held-out/cancellation/restart assertions remain.
Format/ESLint, syntax, affected schema/ledger/taxonomy refreshes, discovery and
diff checks passed. Functional execution remains deferred. Coverage is **35 fixed /
393 implemented / 150 partial / 185 pending**.

A complete metadata refresh at `665928c55` again found **763 open reports**, with
no added/closed IDs or changed titles. Source implementation remains distinct
from accepted closure and current-tree runtime qualification.


## Watch source observation and retry ownership

**#1589** (`d0539aad2`) distinguishes known policy exclusions and confirmed
absence from unknown I/O observations. Unknown paths retain membership and
backlog. Owned retries re-enter only the affected path without another event,
with 50 ms exponential backoff capped at 5 seconds. Persistent failures remain
visible; snapshots bound detailed paths to 16. Explicit unlink invalidates late
observations. ENOENT/ENOTDIR without unlink requires two consecutive observations;
a new event resets absence evidence. Replacement gaps preserve source membership.

Both backend selections share this owner. Parcel's stability prerequisite now
runs inside the update queue, preserving typed observation failures and active
shutdown ownership. Its former separate retry timers are replaced by this same
bounded owner; standalone boolean stability checks keep their previous contract.
Rebuild/pre-publication admission waits for unresolved classification. Recognized
failure aborts active publication through the existing abort owner. Shutdown
cancels timers, drains active observations and retains unresolved backlog.
Original resource release prerequisites cannot become ordinary I/O retries.

Authored pure-owner and real watch orchestration controls cover one-event
recovery, new source bytes in exact published entries, no skipped substitution,
successful siblings, both backend selections, persistent errors under virtual
time, real deletion, atomic-save gaps, Parcel stability observation failure,
active-build publication cancellation, unlink versus gated old observation and
active/timer shutdown. The previous queue no-loss assertion now requires the
valid source in entries and absent from skips. No assertions or wrappers were
removed. Format/ESLint, syntax, affected ledger/taxonomy refreshes, discovery and
diff checks passed. Functional execution remains deferred. Coverage is **35 fixed /
394 implemented / 150 partial / 184 pending**.


## SQLite FTS cooperative work qualification

**#1592** (`dc3e4e3df`) makes the existing chunk-size control govern actual
qualification/hydration batches and gives candidate SQL, cursor steps, metadata
hydration and term queries one cooperative dispatch allowance. Native tokenizer,
Boolean/literal eligibility still precede SQL LIMIT. Qualified rows retain
stable SQL ties and global weighting/normalization before final top-N selection.
The existing native cursor is disposed on completion, deadline, cap, cancellation
and error. Metadata/term failures retain their original propagation contracts;
only native candidate-query failures use the existing unavailable fallback.
Unconfirmed cleanup retains resource ownership and cannot become empty success.

Synchronous SQLite work cannot be interrupted by a JavaScript timer. Receipts
explicitly declare cooperative dispatch, no hard deadline and no native
interruption, with observed overrun, batches, cursor steps and phase timings.
Scoring/cleanup count toward observed total; route/tokenizer preflight is outside
the declared allowance. After an overrun no further budgeted call dispatches.
Deadline-truncated execution remains partial/uncacheable through the shared
`sparse-budget` reason even when a separate sparse fallback finds hits. Work
policy version participates in query-cache identity. Row and time defaults and
existing tail profile overrides remain.

Authored controls cover virtual-time dispatch/qualification boundaries, real
batch-size differences, zero/one/multiple batches, cap and cleanup failures,
real native SQLite cursor disposal/cancellation/syntax failure, metadata/term
allowance exhaustion, cold/warm weighted Boolean/literal results with independent
expected IDs and a pipeline/cache partial-outcome witness. The former budget
fixture retains default-value assertions and labels them diagnostic plumbing.
Format/ESLint, syntax, affected ledger/taxonomy refreshes, discovery and diff
checks passed. Functional and serial latency qualification remain deferred.
Coverage is **35 fixed / 395 implemented / 150 partial / 183 pending**.


## Benchmark utilization units and terminal outcomes

**#1648 and #1649** (`3d7e57c64`) version the generic runner report to 2.
Percentage fields retain their declared scale at zero/fractional/exactly-one
values. Scheduler ratios and paired token-counter fallback carry source/unit
and occupancy scope; no hardware/per-core CPU measurement is inferred. Null,
invalid and nonfinite values remain unavailable and may use valid fallback.
Absent/mixed-scope aggregates are null, with separate scope summaries. A bounded
ring retains 2048 samples and a 512-entry timeline; counts retain observed,
valid, unavailable and omitted observations. Historical reports are not rewritten.

One terminal outcome owner supplies status, mutually exclusive summary counts
and final exit. Timeout/signal/spawn/nonzero/null-exit failures outrank any skip
receipt. Allowed skips require clean process execution, explicit suite policy,
missing expected measurement output and a bounded final stdout receipt matching
the selected benchmark ID. Incidental log words cannot waive missing output or
process failure. Missing-output diagnostics and skip reason remain separate.
The optional filter-index unavailable branch keeps its human message and adds
the canonical terminal receipt. Original native resource ownership cannot be
retired during child failure presentation.

The actual runner has an internal suite/child seam. Authored fixtures exercise
real tiny child completion/skip/nonzero/missing-output cases and aggregate exit;
injected facts cover signal, timeout and spawn failure portably. Pure and actual
runner numerical controls use independent expected percentage/ratio statistics,
missingness, mixed scopes and retained-suffix values. Existing cap/log-line
assertions remain. Schema controls reject old version and missing scope.
Format/ESLint, syntax/JSON syntax, affected script/ledger/taxonomy refreshes,
discovery and diff checks passed. Functional execution and real measured workload
qualification remain deferred. Coverage is **35 fixed / 397 implemented / 150
partial / 181 pending**.


## Admitted query input plans

**#1668** (`dd7934f98`) replaces coercive comparison/parity query loading with
version 1 immutable input plans. Selected strings, normalization, limit,
source-content hash, source policy and ordered occurrence IDs/unit weights remain
in reports. Deliberate repeats stay separate. JSON primitives/records/blank
entries cannot silently become unrelated string queries. Explicit files fail on
missing, malformed, unreadable, empty or invalid UTF-8 content before index/search
work. Parity's optional missing-default smoke fallback is explicitly named in the
plan and is unavailable for malformed/empty/default read failures. The legacy
optional helper only suppresses actual absence; resource uncertainty propagates.

The matrix preserves its intentionally selected query-field text projection but
captures admitted strings into a unique run-owned JSON input before child
dispatch, retaining original plans and the ordered-pool policy. It no longer
silently deduplicates repeated pool occurrences. The search benchmark uses the
same plan. Comparison/parity rows retain case IDs and weights; source paths remain
human provenance rather than substitutes for content identity.

Authored controls cover primitives/records/blank/malformed/top-level rejection,
literal object-looking strings, explicit query-field projection, duplicates,
frozen state, changed file content and selected limits, fallback provenance,
read failures, pending resource ownership and UTF-8. Actual CLI child fixtures
reject invalid explicit files before builds/searches; a matrix dry-run fixture
checks captured text and repeated occurrence identity without an index. Format/
ESLint, syntax, affected script/ledger/taxonomy refreshes, discovery and diff checks
passed. Functional execution remains deferred. Coverage is **35 fixed / 398
implemented / 150 partial / 180 pending**.

A complete metadata refresh at `dd7934f98` again found **763 open reports**, with
no added/closed IDs or changed titles. Response/observed-backend, judgment and
performance qualifications remain distinct from input admission.


## Generated Boolean query intent

**#1671** (`bf8594995`) constructs literal/phrase/AND/OR/leaf-negation expressions
and validates each newly admitted query through the production parser with exact
intended operators, leaf kinds and literal contents. API OR and symbol/type/API/
behavior exclusions no longer become whole literal phrases. Intentional phrase
strategies retain their shape. Parenthesized signatures, dotted names, literal
backslashes and alternate quote delimiters follow the actual grammar. A literal
containing both quote delimiters is explicitly rejected; bounded rejection
counts/samples remain in generation qualification. Structural/parser defects
propagate rather than becoming ignored candidate failures.

Workload semantics/JSON format advance to 2 through a shared contract constant.
Rows retain intended/observed classes and actual parsed operator/leaf counts;
JSON/text metadata records shape distribution and requested/emitted completeness.
Seed/intent weights, unique-query generation and existing attempt bounds remain.
Duplicate candidates are recognized before repeated parser work. The input-plan
owner advances to 2, admits the declared workload only when rows/string list/
counts/generation agree, and retains producer-declared completeness separately.
Its identity changes; older input receipts are not silently reused. This format
is an input projection, not independent runtime or representative-quality proof.

Independent OR/exclusion token witnesses, literal OR/hyphen controls, quote and
backslash round trips, dotted names, signatures, unsupported literals, repeated
fixed seeds, actual parsed distributions and declared-workload mismatch controls
supplement the existing language-family/count/weight assertions. Format/ESLint,
syntax, affected script/ledger/taxonomy refreshes, discovery and diff checks
passed. Functional execution remains deferred. Coverage is **35 fixed / 399
implemented / 150 partial / 179 pending**.


## Live evaluation input and observed execution identity

**#1658** (`f237f29f9`) retains ordered selected queries/cohorts, captured silver/
gold judgments, limit and depth/matching policy in an immutable live-input
identity with case IDs. Human dataset paths remain provenance. Live report
version 2 carries matchMode and per-case execution references. Retrieval's existing
effective query-policy hash now reaches output metadata through the real render
handoff without exposing raw configuration. Observed backend, source generation/
surface/profile/signature, fallback/fidelity, actual mode execution and cache
facts remain distinct from requested flags.

A passive owner interns at most 256 receipts, 8 KiB each and 512 KiB of retained
receipt bytes. Source signature hashing shares the bounded admission; live input
frames allow 128 KiB each. Unknown/omitted observations preserve descriptive
numbers without becoming qualified. Cache facts do not invent a changed system.
The run detects generation changes across modes and backend/effective-policy
changes within declared selection contexts; no new run-wide native lease is
claimed. Strict bakeoff comparison requires a stable complete registry with
matching selected input/metric identity. It preserves registry/receipt integrity
and source-bound resume identity; fallback, partial, unknown, mixed and retained-
evidence limits cannot authorize a quality recommendation. Saved replay/oracle
sections keep their separate provenance.

The authored actual-runner fixture uses inert search/filesystem/display seams
and the real metadata producer. It covers equal numerical hits under distinct
backends, stable/changed generations and policies, fallback, missing evidence,
requested versus observed ANN, cache interning, retention limits, copied
snapshots, changed labels/queries/matching mode and tampered/passive evidence.
Existing response/cohort/cleanup assertions remain. Format/ESLint, syntax,
affected script/ledger/taxonomy refreshes, discovery and diff checks passed.
Functional and real model/backend execution remain deferred. Coverage is **35
fixed / 400 implemented / 150 partial / 178 pending**.


## Retrieval comparison response admission

**#1669** (`2233afe28`) shares successful response/selected-cohort/retained-hit
admission with judged evaluation, parity and model comparison. Missing/null/
non-array/failed/malformed/omitted-hit observations remain unavailable, not
fabricated empty arrays. Explicit empty arrays remain valid zero-hit observations.
Passive identity/score snapshots precede later work; unknown IDs stay incomparable.
Valid sibling cohorts survive another selected cohort's failure. Each query and
its exact comparison denominator remains in version 2 parity/model reports.
Missing physical timing/memory and unavailable means remain null.

Each arm/model uses the bounded observed execution registry. Requested versus
actual backend, fallback/fidelity and generation remain distinct. FTS-positive
claims need actual FTS execution. Parity compares exact selected source generation
between arms; model reports preserve their existing logical-corpus guard. Strict
parity fails on unavailable/mismatched/mixed evidence and absent positive cohort
witnesses independently of optional FTS quality warnings. Invalid responses fail
after complete result retention, including non-enforced reports. The matrix
requires fresh version 2 reports with qualified comparison/positive coverage.
The small shared cohort owner avoids pulling comparison-only dependencies into
judged cohort selection. Bakeoff resume identity includes these owners.

Authored shared-owner controls and twelve independently discovered process cases
exercise actual parity and model-report reducers with named adapters: positive
and changed rankings, explicit emptiness, missing/null/non-array/failed/malformed
cohorts, output omissions, unknown identity, wrong backend and mixed valid/
unavailable queries. Existing partial-rank assertions remain. Its independent
single-hit prose control preserves the former prose numeric overlap/delta/rank-
correlation contribution while supplying a real positive witness. The real matrix
capsule now explicitly declares its intended default profile instead of missing
source identity. Canned adapters retain a fixture profile/reason/signature and do
not claim native/backend quality qualification.

Format/ESLint, syntax, sidecar discovery, affected script/ledger/taxonomy refreshes
and final staged diff checks passed. A trailing blank line found in the staged
check was removed before publication. Functional execution remains deferred.
Score-space/paired-measurement admission remains #1670; response admission alone
is not its numerical score proof. Coverage is **35 fixed / 401 implemented / 150
partial / 177 pending**.


## Qualified paired score measurement and stable system identity

**#1670** (`a1395ceac`) replaces implicit missing/component score substitution
with final finite observations and fixed-size score-space receipts. Ranking/output
owners bind resolved model/dictionary/ranking policy, selected source generation,
actual provider metric, calibration, fusion, FTS normalization/variant, adjustment
and graph outcome. Identified model reranking replaces that coordinate. Unknown
metrics/adapters remain unknown. Hash allocation is restricted to retained hits;
the pooled fusion owner retains/releases the extra provider fact. Compact and
budgeted output preserve receipts. Query-cache key version 10 invalidates old
results without coordinate ownership, and rendering never reuses a prior output
receipt as authority. Production score/rank calculations remain unchanged.

Comparisons preserve measured zero, distinguish missing values/unknown spaces/
incompatible spaces/nonfinite differences, and retain bounded domain-pair samples.
Disjoint and both-empty results have zero paired measurements and null delta.
Rank/membership comparisons stay independent. Report means distinguish comparison
macro and pooled shared-hit units with requested/defined/complete counts. Strict
numerical parity requires complete shared-pair measurement for every requested
comparison, independently of optional FTS quality warnings. Different-model or
BM25/FTS scales cannot satisfy a numerical tolerance merely through equal values.

Source review also exposed a follow-up to **#1658**: `eqp1` includes query text,
so using it as the stable system key marked ordinary multi-query runs mixed.
The original invocation identity remains; `esp1` removes only query text from the
same resolved policy. Execution receipt/registry version 2 and their hash domains
advance together. Backend/model/filter/policy changes still invalidate system
consistency, and historical missing system identity cannot silently qualify.

Authored controls cover zeros/missing/component-only scores, empty/disjoint
intersections, unknown/conflicting spaces, model/metric/calibration changes,
monotone rescaling, finite-arithmetic overflow, passive fields, distinct macro/pair
denominators, real pooled fusion/rank/output ownership and model-stage replacement.
Nineteen independently discovered actual parity/model report cases retain prior
response assertions and add seven score controls. The actual evaluation identity
fixture now witnesses distinct production query hashes under one stable system.
Historical fusion/score assertions remain, with explicit new provenance fields.

Full format, scoped ESLint, syntax, generated script/ledger/taxonomy refreshes,
fixture discovery and staged diff checks passed. Functional fixtures, native/model
execution, performance and the final front gate remain deferred by instruction.
Coverage is **35 fixed / 402 implemented / 150 partial / 176 pending**.


## Aggregate benchmark query admission and retirement capacity

**#1675** (`5a23ec9db`) now admits all selected query backends against one global
concurrency/shared memory estimate. Memory and the canonical SQLite resource class
share an allowance; sqlite/sqlite-fts/fts retain their requested workload identities
while sharing serialization and per-query retirement. When simultaneous minimum
capacity cannot fit, the existing grouped pool/queue executes separate stages,
closing each before allocating the next. An oversize required worker produces an
explicit unsupported plan before launch. No backend/query coverage is dropped;
existing empty-mode admission and generation/cancellation owners remain.

Source review also found that a successful retiring worker became available as
soon as its response cleared activeRequest, before awaited process close. Another
worker's completion could pump a replacement during that retirement. A separate
running reservation now spans the entire run/retirement promise. Lifecycle events
count actual live processes, and start/completion RSS samples retain short queries.
Reports distinguish global planned capacity, submitted reservations, running
queries, live processes and per-backend counts. SQLite alias spelling no longer
bypasses resource sizing, serialization or retirement.

The authored actual-entry fixture uses named inert artifact/search adapters and
the real planner/executor/report reducers. Six discovered cases cover default,
all, alias and single selections with limits 1/4, checking one aggregate admission
call, stage allocations and exact executed denominators. Independent size inputs
reproduce the 8 GiB shared-budget example and reject an oversize plan before any
pool creation. A separate real IPC-worker fixture uses a parent barrier, delayed
SQLite shutdown and independent live-PID counting to witness the retirement cap,
per-alias execution and memory-worker reuse. These fixtures are not executed yet.

**Partial remains deliberate:** sampled RSS covers the benchmark parent and known
query workers, including idle/retiring generations, with missing samples explicit.
Arbitrary nested descendant memory has no measurement owner; whole-process-tree
RSS remains null/unavailable. That requested qualification is not represented by
known-worker samples or an estimate and remains implementation scope for #1675.
No performance improvement or final native acceptance is claimed.

Full format, scoped ESLint, syntax, affected generated inventories, seven-case
discovery and staged diff checks passed. Functional execution and the final front
gate remain deferred. A complete live metadata refresh at `242dc95e1` reconfirmed
763 open issues, no additions/closures or title changes. Coverage is **35 fixed /
402 implemented / 151 partial / 175 pending**.


## Owned adjacency bootstrap and transition capture

**#1696** (`3ffdf2230`) captures one passive bounded canonical bootstrap/batch
before option getters or cancellation effects. Validation, digest, coalescing,
application, destination world/completeness and replay ledger all consume that
private value. The byte allowance covers aggregate metadata and rows/edits before
JSON parsing; replacement snapshots also use bounded encoding. Accessors, sparse/
decorated arrays, hidden fields and invalid typed data are rejected without getter
execution. Bootstrap byte configuration must itself be passive.

Initial cancellation now observes one value, each distinct support update polls
the original signal, and a final poll precedes next-view construction. Cancellation
retains the old authoritative handle and leaves the batch unconsumed. Exact replay
still precedes cancellation polling. Ordinary algebra, valid-input hashes and the
1024-entry checkpoint boundary remain unchanged; this private WeakMap-owned pilot
has no indexed semantic producer or durable replay product requiring a version bump.

The authored regression changes edits, endpoints/source refs, destination world,
completeness, ID and definition at first/later/final cancellation polls. It checks
hand-computed old/new cursor bags, independent clean-bootstrap equality, root/
ledger identity, exact replay and conflicting replay. Native cancellation, option
getter mutation, work rejection, passive-array/object negatives and byte overflow
before JSON parsing remain explicit. The existing 40-transition flat multiset
oracle and arbitrary-precision support assertions are retained.

Format/ESLint, syntax, affected generated inventories, new-case discovery and staged
diff checks passed. Functional execution and the final front gate remain deferred.
Coverage is **35 fixed / 403 implemented / 151 partial / 174 pending**.


## Explicit regex benchmark engine and operation identity

**#1724** (`abba3b867`) removes auto-selected engine labels and the asymmetric
wrapped-JS/direct-native comparison. Both arms explicitly select and verify their
requested SafeRegex backend and effective flags before warmup/timing. Missing
optional native RE2 remains unavailable. The public-wrapper comparison resets
lastIndex to zero before every test operation; repeated matching witnesses check
first-match position/groups across engines before timing. Production regex auto
selection and ranking/search behavior are unchanged.

Version 2 reports retain requested/effective engines, installed package versions
or unknown, Node/V8/ABI/platform/arch, operation policy, normalized flags, UTF8
input bytes and an exact UTF16-code-unit hash. Work counts distinguish measured
and warmup operations. Sample count is clamped to iterations so short runs cannot
execute excess operations through the shared sampler; observed callback count
must match the declared work. Raw sample durations are retained, with a null rate
for zero duration. Other shared sampler callers retain their existing behavior.

The authored regression instruments the actual SafeRegex selector and actual
RE2JS backend. An explicitly named RegExp-backed optional-native adapter provides
present/absent dispatch controls, not native speed evidence. Exact compile/exec
counts, matching/nonmatching inputs, global state reset and sample admission are
checked; engine substitution and result disagreement fail before sampling.
Invalid count/flag controls remain explicit. No benchmark or native performance
execution has been claimed.

Full format, scoped ESLint, syntax, affected generated inventories, discovery and
staged diff checks passed. Functional execution and the final front gate remain
deferred. Coverage is **35 fixed / 404 implemented / 151 partial / 173 pending**.


## WASM structural catalog and optional flow admission

**#1683** (`f7eb8f489`) separates decoded functions/instructions/storage and byte
ranges from optional stack/CFG construction. Standalone syntax owns a bounded
immutable catalog and one retained binary/evidence sidecar. The solver consumes
that exact catalog, adding only derived values/blocks/operands/edges in analysis.
Off, ungranted deferred and ineligible targets never invoke it. A flow-budget
failure preserves structural rows and source evidence, with partial local-flow
coverage after an actual attempt. Structural-budget failures retain the module
marker/original source and explicit partial syntax without inventing a flow
attempt or overriding the requested off/deferred state.

Decoder/native validation, source/generation/replay/publication owners and flow
caps remain. Structural admission has its own bounded canonical snapshot and
catalog. Byte ranges identify imports, function bodies, storage and instruction
extents; initializer/offset instructions also remain visible. Source bytes are
captured before asynchronous work/callbacks, and bare Uint8Array inputs encode
correctly as base64. Flow and structure share the retained sidecar. Host
projections reuse one pending result per creation, including failed results, so
member lookups cannot repeat failed analysis or overlap duplicate projections.

Shared identities now distinguish **wasmStructure 1 / wasmFlow 7**. Structural
cache/parser identity uses the structural producer; analysis/host meaning binds
the flow version. Binary task inventory/dependency version 2 binds both producers
and the validator runtime. Existing WASM products need a normal rebuild; no user
cache is deleted. Deferred publication preserves the original structural IDs,
rows and hash while adding granted flow. No public CLI/configuration knob is added.

Six authored bounded cases exercise the 256-local/128-block counterexample under
off/deferred/ineligible/eager/granted admission and a small successful flow case.
They spy on actual analyzer calls, compare syntax content/hash, check physical
function/memory/instruction ranges, preserve original bytes through callback
mutation, check cross-partition references and retain construction counters in
runner output. Counts distinguish attempted, allocated and retained work; they
are not heap/RSS or throughput measurements. The existing deferred production
fixture now also checks exact structural rows and the initial absence of solver
products. Existing host, proposal, flow, source, decoder, cancellation and replay
assertions remain for their deferred rechecks.

Full format, scoped ESLint, syntax, affected generated inventories, six-case
discovery and staged diff checks passed. Functional execution and the final front
gate remain deferred. Coverage is **35 fixed / 405 implemented / 151 partial /
172 pending**.


## Impact dependency direction

**#1702** (`c66d7da8e`) maps downstream impact to incoming recorded
caller/importer/user edges and upstream dependencies to outgoing edges. Both
retains bidirectional traversal. One policy owner supplies ordinary/empty
results and capability validation. Reports retain the requested product
keyword and record effective traversal, selected relation orientations and
policy version; human output displays both. The graph-impact path producer is
1.1.0. Canonical adjacency, source-oriented witness edges, depth and cap owners
remain unchanged. No indexed semantic producer or derived index meaning changes.

The authored fixture uses the actual graph writer, pieces sealing, normal strict
preparation and CLI against consumer → API → helper plus an isolated node. It
compares prepared cold/warm CSR and legacy inputs for calls, usage and imports,
depth 1/2, both, multi-seed, true empty, changed-set equivalence, node/path caps,
canonical witness orientation and incoming suggest-tests control. Existing
hand-authored fixtures had encoded the reversed impact policy; their assertions
remain, with appropriate seeds/product direction. The real-source workflow now
requests downstream to find importing tests. Capability negatives remain.

Full format, scoped ESLint, fixture syntax, affected inventory refresh, fixture
discovery and staged diff checks passed. These are static/discovery observations;
functional execution and the final front gate remain deferred. Coverage is
**35 fixed / 406 implemented / 151 partial / 171 pending**.


## Chunk-seeded import witness projection

**#1711** (`9ffb2af10`) retains canonical file import adjacency and emits a typed
containing-file alias when traversal enters imports from a chunk. Context edges
and witnesses carry the same versioned chunk/file/canonical-endpoint association.
Qualification checks the association against selected-generation chunk facts;
returned validation checks its typed endpoint mapping and chain connectivity.
Arbitrary import endpoint domains remain invalid. Self-imports retain the
current chunk endpoint rather than manufacturing a disconnected file witness.
Ordinary and qualified output use the same projection; human context output
shows the canonical file import and alias. Source extraction and runtime
feasibility remain unqualified. Graph-context/impact response producers are
1.1.0/1.2.0, and the private neighborhood cache key is version 2.

Imports-only CLI selections now recover the requested chunk's file from
canonical chunk metadata in the selected generation, attaching only that fact
to a private prepared-index view. Cached graph metadata remains unchanged for
other callers. Conflicting file identities fail admission. This also applies
to chunk-seeded impact through the same preparation owner.

The existing reciprocal/directed fixture now opts into graph-witness with an
exact matching signature, preserving source/evidence/CSR assertions. New raw,
legacy and CSR cases cover out/in/both, paths off/on, depth 1/2, ordinary/qualified
content parity, source imports, mixed call/import chains, file/call-only controls,
self-import and rejection of a self-consistent alias rebound to an unrelated
file. The actual writer/preparation fixture now covers imports-only context and
impact CLI requests; the existing small real-source workflow additionally checks
a chunk-seeded imports-only CLI response against its actual indexed importer.

Full format, scoped ESLint, syntax, affected generated refresh, fixture discovery
and staged diff checks passed. An EOF whitespace failure was corrected and its
check rerun. Functional execution and the final front gate remain deferred.
Coverage is **35 fixed / 407 implemented / 151 partial / 170 pending**.


## Suggestion computation deadline and owned discovery

**#1700** (`5a8676921`) consumes the accepted maxWallClockMs option through one
monotonic computation owner shared by admission, live discovery, reverse-import
preparation/traversal, every seed, selection, fallback and witnesses. Zero stops
at computation admission; finite non-negative numeric values floor to integer
milliseconds, and invalid/nonfinite/unsafe values fail admission. Existing count
caps remain independent. Explicit allowances retain the effective provenance
cap and a strict execution receipt with completed scope, observed work, stop
phase, elapsed time, confirmed settlement and overrun. CLI preparation time is
measured separately; configuration/input/artifact loading and rendering are
explicitly excluded. Synchronous operations/sorts and required cleanup are
cooperative units, not a promised hard wall-clock interrupt.

Expiry admits no further fallback, records deadline truncation/fidelity and
keeps empty results partial rather than inventing no-match/no-tests evidence.
Only fully inventoried and closed directories admit candidates; incomplete
prefixes are discarded. Fresh bounded inventory observation remains mandatory
on warm cache hits, and expired inventories cannot publish cache entries.
Development .cache/.tmp trees are excluded alongside existing generated roots.
The private reverse-import preparation helper's sole caller reads only incoming
adjacency; its unused outgoing map and sort have been removed. No retained
relation, assertion or script coverage is removed.

Directory ownership is now explicit. Normal read/open errors propagate rather
than being swallowed. Pending reads prevent close and retain the original
resource observation plus the exact directory session. Failed closes retain the
same handle for explicit recovery after prerequisites settle; recovery never
reruns discovery. Frozen failures, secondary close errors and falsey throws
retain ownership. An unresolved resource cannot become a settled partial report.

Authored virtual-clock cases independently advance time during directory I/O and
BFS across raw/legacy/CSR inputs, prove multi-seed sharing and exact next-read
admission, preserve under-budget graph/witness and heuristic results, check zero,
invalid/fractional values, count caps, fresh warm observations, excluded trees,
raw counters, bounded diagnostics and pending/failed-close recovery. The real
writer/preparation fixture also exercises the canonical CLI option/report path
with an independently measured 25 ms excluded preparation interval. These are
authored controls, not runtime timing observations.

Full format, corrected scoped ESLint, syntax, affected generated refresh,
fixture discovery and staged diff checks passed. Functional execution and the
final front gate remain deferred. GitHub search returned only 100 items despite
a larger requested limit; a complete existing gh metadata query independently
reconciled **763 open reports, zero additions/closures/title changes**. Its raw
snapshot under .tmp is historical author-workspace evidence, not a clean-checkout
requirement. Coverage is **35 fixed / 408 implemented / 151 partial / 169 pending**.


## Offline SQL table-column alias admission

**#1720** (`d271e4902`) takes the issue's conservative repair: preserve
independently valid physical table evidence, but never resolve exposed column
names through a binding whose ordered column aliases are not modeled. The
bounded source qualifier now consumes and retains the table-reference/alias/
column-list structure, quote policy and exact spans. The catalog adapter marks
those columns `table_column_alias_list_unsupported`, with no fabricated physical
target or candidate. Qualified ordinary bindings in the same query remain
usable; unqualified references that could belong to an unsupported binding do
not resolve by ignoring it. Ordinary alias identity is cross-checked with the
parser; parentheses inside one quoted alias name remain a name.

Primary PostgreSQL documentation and pinned parser 5.4.0 grammar were inspected,
without executing a parser or database. The grammar supports ordered quoted
column names after an unquoted alias, but its quoted-table-alias branch does not
accept a following list. That latter case retains syntax/dialect uncertainty.
Adapter/report version **3** and shared **compilerBindings 26** prevent older
resolved evidence from being silently replayed. The catalog's missing physical
column-order contract is explicit: tableColumnAliases remains false. Broader
#1188 SQL catalog integration stays partial.

The existing actual-parser/canonical writer/detail fixture is extended with
swapped and qualified lists, partial lists, quoted/case-sensitive exposed names,
duplicate/overlong lists, self-joins, a literal-parenthesis alias and the pinned
quoted-table-alias syntax exclusion. Physical expected offsets are independently
authored. Unsupported columns never become detail navigation candidates, while
table navigation and typed query witnesses survive persistence. Existing
search_path, ambiguity, temporary objects, stale source/context and no-database
assertions remain. These regressions are authored, not executed.

Full format, scoped ESLint, syntax, affected generated refresh, fixture discovery
and staged diff checks passed. Functional execution and final front gate remain
deferred. The intake receipt keeps its prior head/open field names while retaining
the complete metadata-refresh witness. Coverage is **35 fixed / 409 implemented /
151 partial / 168 pending**.


## SQL relation-role and decoded occurrence evidence

**#1719** (`8916a5e3c`, partial) replaces arbitrary table-property traversal with
declared SQL AST roles. Only physical relation-head observations feed legacy
usages display; column qualifiers, opaque aliases, possible CTE references and
derived scopes remain distinct. CREATE TABLE/VIEW targets remain declarations;
CREATE INDEX/ALTER TABLE inputs remain relation uses, without promoting an ALTER
new-name action to another usage. Unsupported statement roles are explicit.
Already-decoded characters are retained exactly. Ordered db/schema/table parts
separate qualification from literal dots, brackets/backticks and edge spaces.
No second delimiter-stripping pass remains. The replaced helpers were private
and their sole call path is replaced by the new owner; no fixture/assertion or
script coverage is deleted.

Strict versioned sqlRelationEvidence binds a UTF-16LE text hash, dialect, parser
version, statement scope, AST path and typed occurrence identity. Decoded-name
IDs identify observations, not catalog bindings; lost lexical quote/case facts
and conservative CTE scope remain unqualified. Source extents are retained only
when supplied by the AST. Reasons, source admission, queues, nodes, depth,
occurrences, identifiers and retained bytes are bounded. Unavailable/failed
parser, source budget and partial empty cannot become recognized empty. Unknown
omitted counts stay null. Artifact validation checks roles, counts, source extent
bounds, unique/recomputed IDs and conservative display.

The complete envelope survives buildFileRelations and JSON/sharded publication,
but is stripped from per-chunk codeRelations to avoid duplication. The actual
cross-file fingerprint owner already hashes full file relations, preserving
qualification through reuse. Shared **sqlRelations 2**, actual parser
availability/version, ordinary parse dependencies and semantic runtime
dependencies fence historical output. The parser version reader activates no
parser or native module. No cache is deleted or live database introduced.

Authored registry/parser-route cases cover alias renaming, schema names, literal
dots, decoded bracket/backtick/space characters, exact CREATE/use name identity,
CTE shadowing, derived aliases, qualified columns, ALTER rename actions, valid
empty, parser failure and source admission. They persist/reload both real JSON
and sharded file relations, compare content and actual usage-cache fingerprints,
and reject forged roles/identities. Native declaration/scanner and offline
catalog assertions remain. Runtime execution is deferred.

This deliberately remains **partial**: the wider shared extraction-coverage
result/first durable handoff/graph summary in #1662 is not repaired by adding the
SQL file receipt, and full lexical quote/scope/catalog qualification remains
explicitly unavailable here. Full format, corrected scoped ESLint, syntax,
affected generated refresh, fixture discovery and staged diff checks passed.
Functional execution and final gate remain deferred. Coverage is **35 fixed /
409 implemented / 152 partial / 167 pending**.

## Import extraction outcomes through graph publication and replay

**#1662** (`4425ddabd`) introduces a shared source-qualified extraction receipt
without changing public CLI/configuration or evaluating config code. YAML, TOML,
Proto and XML preserve parser identity/readiness, declared static scope, parser
failure/rejection, collector budgets and parser-owned limits. Valid partial empty,
unavailable, invalid, unsupported and cancelled outcomes remain distinct. Existing
array consumers retain the receipt privately without a second parse or source
retention; legacy arrays are explicitly unqualified. Parser metadata versions
are identity inputs, not activation/native qualification.

Normalization and the unchanged 512 distinct-import cap compose exact local
duplicate/invalid/omitted accounting. Unknown producer omissions and visited
source extent remain null. UTF-16LE source and retained-entry hashes bind each
receipt, including literal provenance and collector hints. Idempotent projection
retains prior loss. The file receipt binds stored imports; independent scan
qualification can describe a larger vector without certifying a capped bundle.

The actual registry, scan, post-scan, resolver and file-relation owners carry
failures even with no candidate specifier. Empty failure never creates an edge
or bypasses graph node admission. File summaries remain separate from resolver
warnings/taxonomy, including deterministic bounded samples, file-state totals,
SQL usage qualification and explicit sample/reason omissions. JSON, sharded
graph/file publication, graph loading and byte measurement retain the metadata.
Strict artifact admission checks binding and aggregate arithmetic. Existing
graph fidelity warnings expose incomplete import/SQL usage extraction.

Incremental reuse requires a matching array, source-bound receipt, identified
available parser, existing fingerprint and explicit qualification policy.
Successful static subsets can retain their partial qualification; degraded,
failed, capped, cancelled, unknown-parser and legacy outcomes refresh. Actual
parser package versions and Node join import fingerprints; code parse identities
include extraction runtime identity. Shared **importResolution 18** and
**graphRelations 2** fence historical meaning. Known filesystem read failures
produce unavailable file evidence only after settlement; programming defects
and pending/unreadable resource owners still throw. No cache is cleared.

Two authored fixtures cover one-parse negative/empty production handoff,
parser/budget/cancellation variants, fake-clock expiry, exact 513/512 projection,
duplicate-only input, mutated source/entry/provenance, artifact rejection, real
JSON/sharded round trips, zero-edge graph summaries, qualified empty replay,
capability recovery and pending-resource/programming-error propagation. Existing
literal-identity assertions remain, with fresh rescanning required for legacy
unqualified cache rows. No assertion/script coverage was removed.

Full format/ESLint, syntax on all 33 changed JavaScript files, affected generated
refresh/freshness, discovery of both new fixtures and staged diff checks passed.
The repeated-surface CLI invocation was rejected, then each freshness check
passed individually. **Functional fixtures and the final front gate have not
run**, per the implementation-first instruction. No current-head runtime, native,
performance or CI acceptance is claimed. #1719 retains its separate lexical
quote/scope/catalog remainder. Coverage is **35 fixed / 410 implemented / 152
partial / 166 pending**; all 763 issue IDs remain mapped exactly once.

## Qualified flow presence and owned managed syntax

**#1666–#1667** (`b72bcd9d4`) repair the shared default/docmeta/flow/enrichment
boundary together. Absent/null facts stay absent; explicitly produced false and
empty values stay values. The merge owns its output and mutable flow values,
retaining frozen/shared inputs. It uses field kind, scope, source and authority
instead of truthiness or a false-to-true override. Qualified negatives retain
precedence over unqualified positives. Incomparable scopes/kinds stay separate;
equal-authority disagreement keeps the first value with conflict state and
bounded diagnostics. Disabled analysis removes ordinary fields and records
disabled state; missing analysis remains unknown/unavailable, never a successful
all-zero result.

Versioned flowEvidence binds UTF-16LE source, range, declared owner, language,
optional generation, producer, scope, fact kind and per-field value identities.
It distinguishes unknown/disabled/unavailable/partial/produced-empty/
produced-positive/conflict states. Legacy producers remain partial observations;
registration/capability profiles alone cannot manufacture parser authority.
Final docmeta, metadata v2, serialization and incremental bundles retain the
receipt. Typed metadata admission checks value binding and chunk-range agreement.
Shared **flowMetadata 1** fences ordinary code/semantic reuse.

The managed raw-text dataflow/keyword/throw/await/yield/return callback is replaced.
Its private helper and private keyword options had one caller, now served by the
owned-product adapter; shared lexical helpers used by other routes remain.
No test script or assertion coverage is removed. The shared heuristic fixture
now rejects fabricated numeric summaries from ownerless slices, with separate
positive native coverage authored below.

During the existing declaration/call traversal, Dart/Scala/Groovy/Julia/R can copy
a bounded subset of recognized native control/effect node counts within an
admitted callable body. Existing declaration/body/scope barriers exclude header
evaluation, other declarations and unowned nested callables. Comments/string
contents do not create effect nodes. Counts/effects remain explicitly syntactic
and partial, with traversal/recovery/body limitations retained. Semantic
reads/writes/mutations/aliases remain unavailable. No tree/node handle is cloned
or retained. Source hashing is shared per invocation. **nativeFlowFacts 1** joins
only affected native chunk cache signatures.

Templates and unsupported flow routes keep unavailable per-field qualification;
literal output cannot become generic assignments/branches/returns. Existing
template section/lookup evidence, native calls and complete source retention
remain. This does not claim whole-language unsupported analysis, full semantic
effects or a measured speedup.

Authored pure tables cover absent/undefined/null/empty/false/positive fields,
mixed enabled/disabled flags, precise-negative precedence, equal conflicts,
incomparable scopes, different source/range/generation, frozen inputs and
owned outputs. Registered-adapter injected facts exercise real enrichment,
assembly, metadata serialization and incremental bundles, explicitly qualifying
that handoff rather than parser correctness. A separate real Mustache
chunker/adapter/enrichment/payload fixture retains lookup/section syntax and
ordinary literal tokenization without fabricated flow. Actual native Groovy
fixtures compare comment/string insertions, real statements, two declarations,
an anonymous nested body, disabled/unavailable products, stale-source rejection
and native-derived incremental replay.

Full format/ESLint, syntax on 21 changed JavaScript files, affected generated
refresh/freshness (including MCP schema), discovery of both new fixtures and
staged diff checks passed. **Functional execution and the final front gate
remain deferred.** No runtime/native/performance/CI acceptance is claimed.
Coverage is **35 fixed / 412 implemented / 152 partial / 164 pending** across
all 763 currently tracked open issue IDs.

## Bounded source-qualified RST and AsciiDoc outlines

**#1721** (`cdf5b0d40`) replaces the two context-free scanners with separate
format owners over shared bounded original-source line admission. RST preserves
indentation, directive/literal ownership, observed adornment style, exact title
range and one overline/underline envelope. ASCII geometry is qualified; ambiguous
Unicode/control widths remain explicit partial evidence rather than guessed
UTF-16 widths. AsciiDoc tracks exact delimiters, content model and nested
non-section/list contexts before admitting sections. Unsupported custom boundary
behavior stops projection; includes/preprocessors/extensions are never executed.
Primary rules are linked in the source-outline contract.

Heading occurrence IDs are separate from display titles, source envelopes,
parent context and authored anchors. Repeated titles remain distinct; intervening
body content consumes anchors. Unsupported prior candidates leave ancestry
unqualified. Source/line admission precedes bounded index allocation; incomplete
lines cannot become syntax facts, and an oversized line stops later guesses.
Heading/depth/work limits retain reasons and bounded samples. Unknown omitted
headings remain null. Prefix and full-source identities remain distinct.

Chunks retain the complete source, including preambles, ignored literal/comment
content and unscanned suffixes. Conservative source-only fallback is distinct
from admitted headings. Metadata v2 is the single persisted outline owner;
assembly removes its temporary duplicate. Typed validation checks title/source
extent, work admission and occurrence identity. Shared **sourceOutline 1** fences
semantic and prose/extracted-prose parse reuse. Existing chunk guardrails and
public surfaces remain; no parser dependency or renderer was added. The removed
scanners were the replaced implementations, not independent legacy coverage;
their shared helper functions remain available to other format owners.

The authored independent exact occurrence/title-span/envelope/parent oracles
exercise direct, smartChunk and actual segment paths. Cases include original
counterexamples, transitions, alternate/short adornments, repeated titles,
CRLF/UTF-16 prefixes, unsupported title width, quoted/directive literals,
matching/mismatching adornments, exact/nested delimiters, list continuation,
anchors, unsupported boundaries and tiny admission limits. Payload serialization
retains metadata qualification. The existing format-fidelity fixture now checks
persisted negative/alternate headings and exact title ranges in its same build;
its prior positive assertions remain.

Full format/ESLint, syntax on all 15 changed JavaScript files, affected generated
refresh/freshness, fixture discovery and staged diff checks passed. Functional
fixtures, format-fidelity indexing and the final front gate remain **unrun** at
the user's request. No runtime/performance/CI acceptance is claimed. A fresh
complete GitHub metadata query at `25bab8aec` again found **763 open reports**,
zero additions/closures/title changes. Coverage is **35 fixed / 413 implemented /
152 partial / 163 pending**, with all current issue IDs mapped once.

## JavaScript declaration and evaluation ownership (2026-10-26)

**#1673, #1674 and #1676** (`cfa33b5da`) replace display-name accumulation in
the lightweight JavaScript path with a bounded per-source catalog. Occurrence
identity binds source hash, actual Babel/Acorn/Esprima version, exact UTF-16
range, declaration role and the shared **javascriptRelations 1** producer.
Explicit AST wrapper associations and indexed range joins keep static/instance,
getter/setter, nested/anonymous, class-expression and external/internal names
separate. Ambiguous display aliases cannot lend metadata. The separate compiler
CFG and semantic collectors retain their existing owners.

One prepared AST/relation traversal supplies docmeta and flow. Bounded child
descriptors retain conditional parameter initializers, computed keys, heritage,
module evaluation and static/instance initializers under their actual owner and
phase. Binding positions do not become expression reads. Declared async/generator
kind stays independent of observed yield; bare return, return arguments and
concise-arrow implicit values remain distinct. Missing, disabled, split or
incomplete observations cannot become a verified false aggregate.

The real registry and file processor preserve occurrence identity through capped
pair/detail channels, native range aliases, fragments, supplemental missing
declaration/evaluation chunks and segment-to-container mapping. Supplemental
owners can overlap declaration envelopes by qualified identity; legacy geometric
gaps still reject overlap. Replayed projections do not duplicate owners. Argument,
literal/default and returned-call ranges are rebased; original source occurrence
IDs remain local to their parsed snapshot. Canonical metadata and call sites keep
typed evidence, and artifact admission checks source/range/alias identities.
File catalogs persist once rather than duplicating per chunk. Ordinary parse and
semantic reuse include the producer version.

The removed JavaScript regex control-flow constant had one production consumer;
that route now uses the prepared syntax owner. Repository search found no
remaining references. The shared helper and Python configuration remain used.
Existing caller assertions now explicitly project the raw occurrence protocol;
the cross-file parameter fixture uses a real callable boundary and public chunk
projection, retaining its destructuring/default/rest assertions.

Authored fixtures exercise actual Babel/Acorn routes, an actual supported Esprima
case, collisions, nested/anonymous owners, phases, declaration modifiers, return
shapes, disabled analysis, stale source and capped indexes. Every call in the
collision source must survive under exactly one output owner. A second fixture
covers fragment/crossing calls, embedded offsets, canonical call sites and
metadata, tampered source identities/aliases, JSON and sharded file relations,
and real incremental bundle replay. Functional execution is **deferred**.

Full format/ESLint, syntax on 33 changed JavaScript files, affected generated
refresh/freshness, fixture discovery and staged diff checks passed. The final
front gate, runtime/native/performance checks and hosted CI are not claimed.
Generated local inventories remain author-workspace reports where the registry
marks them uncommitted; tracked generated outputs did not drift.

A complete fresh GitHub intake contains **766 open reports**, with #320, #429
and #473 newly reopened against the previously published source. All remain
pending under their new audit scope. Coverage is **35 fixed / 416 implemented /
152 partial / 163 pending**; every open report appears once. Implemented means
source work attempted with validation deferred, not accepted issue closure.

## Reopened release, census and machine-stream audits (2026-10-26)

**#320** (`4aeabfb4c`) pins every downstream release checkout to prepare's full
immutable Git SHA and wires trust generation directly to prepare. Reports observe
`HEAD^{commit}` themselves before and after work. Bundle assembly rejects
cross-revision or simulated build/verification reports before publishing its
manifest; the bundle retains its own observed checkout. Trust generation checks
that observation against prepared metadata and bundle identity, records it in
provenance/checksum/trust evidence, and binds CycloneDX source properties.
Conflicting existing properties fail. Readiness qualifies every report role,
trust record and actual SBOM document against the prepared revision. Original
byte checks, attestation, build-once publication and final tag guard remain.
No workflow was dispatched, tag moved or artifact released.

Authored workflow mutations reject mutable downstream refs and missing direct
prepare dependencies. Synthetic role, bundle, trust and SBOM mismatches reject
mixed revisions before promotion. Existing valid fixtures now use the real
observed checkout where they invoke generators; synthetic readiness evidence
remains explicitly synthetic. Existing missing/invalid/report-role/authority
negatives remain. Release execution and hosted promotion remain separate.

**#429** (`1c82964c8`) adds tests to both directions of the consumer graph and
removes the code-extension filter from declared file accounting. Python and
opaque inputs remain visible without pretending they are JavaScript imports.
The one existing scoped inventory remains shared; graph parsing still uses JS
extensions. Full admitted scan sets survive truncated display samples. Policy
recomputes missing admission from independent expected/scanned lists, and the
report records justified generated/dependency/cache prefix exclusions. The
removed extension predicate had no remaining consumer after this replacement.

The small authored filesystem fixture checks real test-import backlinks,
Sublime Python and opaque-file scope, explicit cache exclusion, and an unassigned
expected file despite a falsely empty generated gaps list. The regenerated
local census at `4d2c08f72` accounts for 8,229 scope files, including 88 Python
files across the declared roots, and 1,541 test consumer nodes. These are static
inventory observations, not completed adoption reviews or performance results.

**#473** (`dc7e80c62`) enables full raw stdout JSON parsing for machine pipe
captures. Stderr diagnostics cannot contaminate that input or count as stdout
pollution. Empty, invalid and trailing-warning stdout retain parse errors and
raw evidence paths in the case/size/mode review report. Human output remains
unparsed; PTY remains a layout surface. Expected process exit and QA scoring
stay independent. The CLI and bounded stream fixture share the actual capture
owner; the CLI's index admission remains required. Authored real-child cases
cover clean JSON, stderr diagnostics, trailing stdout warnings, empty output,
expected nonzero JSON and human text without creating a search index.

**`4d2c08f72`** adds the three new regressions and both JavaScript declaration
fixtures to the existing ordered `ci-lite` lane and regenerates its manifest
through the authoritative builder: 1,237 entries, five additions, no removed or
reordered previous members. No observed duration or functional pass is claimed.

Full format/ESLint, syntax on 19 changed JavaScript files, YAML parsing, affected
generated refresh/freshness, discovery and ordered-lane selection, and diff
checks passed. All functional fixtures, the final front gate and runtime/release
qualification remain deferred. The reconciled intake remains 766 open reports:
**35 fixed / 419 implemented / 152 partial / 160 pending**. The three reopened
reports remain open, with source implementation distinct from accepted closure.


JavaScript indexing follow-up **`04f2b9c6b`** keeps a valid empty occurrence-index
lookup empty instead of rescanning all file calls/details for each declaration
without calls. The authored production-projection tripwire rejects either
unnecessary file-array scan while retaining the stale/capped-index negatives.
Full format/ESLint and syntax on both changed JavaScript files passed; execution
remains deferred. This is an algorithmic work reduction, not a measured timing.


## Directory-backed final recovery inventory (2026-10-26)

**#1633** (`c791cc01b`) admits the existing LanceDB directory representation
through a specific final-recovery contract. Canonical contained paths, unique
family/metadata authority, model/variant/dimensions/count and embedding-generation
identity must agree. The metadata member's extent and observed digest bind the
receipt. Actual ordered directory member names, kinds, exact sizes and SHA-256
digests bind its physical payload; recorded native inventory must agree when
present. Required table/version/data shape is checked without importing LanceDB.
Metadata is requalified after payload reads. Aggregate byte/count/digest output
remains bounded and exact; null directory bytes never become a fabricated zero.

The existing backend inventory implementation is factored into a shared owner,
with its tooling export retained directly for existing callers and its copy
owner unchanged. File/directory operations use the existing lifetime owners;
physical stamps are captured and compared across hashing to reject membership,
kind and same-size mutations. The previous 4,096-entry, 512 KiB and depth-32
bounds remain. Exceeding them is an explicit pre-publication unsupported result,
not verified empty or an increased corpus-wide metadata allowance. Private test
bounds can only lower admission. No native dependency or public knob is added.

Final output identities are established before recovery pointer commit and
carried unchanged into durable completion. Confirmation requalifies the same
outputs. Existing post-commit error/context handling remains for unexpected
persistence/notification failures. Stage2 snapshots/copy/restore explicitly
retain their regular-file scope; file-only/graph selections stay independent of
optional final backend families. No generic existence-only directory allowance
or alternate copy walker is introduced.

The new real-filesystem fixture runs actual backend publication and manifest
owners over explicitly synthetic closed-writer table bytes. It checks mixed
ordinary/directory/metadata members, replay identity, payload mutation and
membership/type changes, canonical paths, duplicate authority, bounded
unavailability versus known empty, and rejection before Stage2 copy creation.
A link-admission branch uses an explicit lstat observation without creating a
symlink; real escape admission remains covered. This is not physical-link or
native-decoding qualification.

The existing retained-stage recovery fixture keeps all prior no-recomputation,
publication, historical-failure, alreadyComplete and post-commit assertions. It
now adds a directory family through the real publisher, rejects a mismatched
generation before pointer creation, completes valid directory-backed publication
and confirms its final output identity. Native query execution stays disabled
in this named artifact/recovery fixture; standalone native qualification is not
claimed. The new bounded fixture joins `ci-lite`, whose generated manifest now
has 1,238 entries with prior ordering preserved.

Full format/ESLint, syntax on ten changed JavaScript files, affected generated
refresh/freshness, fixture discovery/ordered selection and diff checks passed.
An EOF blank-line check failed once and was corrected before commit. Functional
fixtures, the final front gate and native/runtime/performance qualification
remain deferred. Current coverage: **35 fixed / 420 implemented / 152 partial /
159 pending**, across all 766 current open reports. No new closing reference was
added and no issue was closed on unrun regression evidence.

## Effective canary child context (2026-10-26)

**#1651** (`264f260cd`) resolves one immutable command/arguments/cwd/final
environment plan before observing tool versions. The same plan reaches the real
child; later parent edits cannot alter its environment. Existing binary discovery
and Windows command invocation owners resolve tools against the selected cwd and
PATH. Node version/platform/architecture are observed in that context. Windows
case aliases merge once. Parent bootstrap facts remain separately labeled.

The version-2 context receipt uses canonical SHA-256 over the existing safe
environment projection, requested tool observations and explicit execution
coordinates. Full environment values are immutable and non-enumerable, never
serialized or used as a secret-derived cache key. Unrepresented overrides are
partial evidence; unavailable versions stay unknown. Only owned operational path
fields normalize, preserving raw provenance and unrelated paths. Injected probes
are synthetic and cannot qualify blocker closure. Informational Git/npm absence
does not change an unrelated workload result. Probe memoization is local to one
invocation; each new invocation reobserves local configuration and tool selection.

The new curated fixture checks key-order equivalence, allowed-setting/cwd/PATH
changes, private values, immutable state, unknown versions, invocation reuse and
refresh. Real Node fixture children and explicitly synthetic PATH commands record
their actual cwd and allowed settings, including a parent mutation between probe
and child launch. It makes no real-provider qualification claim.

Full format/ESLint, changed-JavaScript syntax, affected generated freshness,
fixture discovery/ordered selection and diff checks passed. One EOF blank-line
check was corrected before commit. The generated ci-lite manifest has 1,239
entries. Functional checks remain deferred. Current coverage: **35 fixed / 421
implemented / 152 partial / 158 pending**, across 766 current open reports. No
issue was closed and no closing reference was added from unrun evidence.

## Bounded canary attempt ownership and reports (2026-10-26)

**#1665** (`1580cdf87`) makes one attempt scope own setup, effective environment,
shared child execution, payload admission, contract evaluation and cleanup. It
removes unbounded callback arrays and uses the shared 256 KiB-per-stream capture
and observed/retained/dropped/encoding receipts. A separately verified complete
artifact remains authoritative when diagnostics truncate; stdout fallback requires
complete capture. The existing contained reader admits at most 8 MiB before
allocation and across reading, with complete UTF-8 JSON and an explicit metrics
envelope. Typed read/parse/schema/process failures remain failed outcomes.

Original child/read release observers survive reporting. Cleanup checks the
original native directory identity and shared removal owner, retaining paths and
termination receipts for pending close, failed tree cleanup, failed reads, changed
roots or unconfirmed removal. Internal recovery is coalesced/idempotent and cannot
be reconstructed from serialized diagnostics. There is no timer-based or
post-restart deletion authority and no new supervisor or public configuration.

Malformed individual results continue the lane; cancellation/pending ownership
stops admission and records every selected-unrun entry and reason. The summary
retains bounded diagnostics, failure phases, result receipts and explicit coverage
counts. Failures without issue IDs no longer make the lane pass. Forbidden
regressions cannot remain baseline-success outcomes. Graceful interruption reaches
finalization and the existing atomic JSON/Markdown publication owners, with JSON
the authoritative checkpoint. Abrupt host termination is outside that guarantee.

The new curated fixture uses tiny real Node children for large/split-multibyte
output, valid artifact/stdout, malformed/oversized/unreadable/schema/encoding and
missing results, nonzero exit and normal timeout. Controlled original observers
cover unknown close, delayed release, concurrent cleanup, unrelated/replaced
directories, cancellation and lane accounting without real orphans or elevation.
The prior child-context fixture's payload envelope was corrected by source review.

Full format/ESLint, syntax on seven changed JavaScript files, affected generated
refresh/freshness, fixture discovery/ordered selection and diff checks passed.
ci-lite now contains 1,240 entries. These functional fixtures and final gate remain
deferred. Current coverage: **35 fixed / 422 implemented / 152 partial / 157
pending** across 766 current open reports. No issue closure or new closing
reference was inferred from unrun fixtures.

## Historical measurement attempt qualification (2026-10-26)

**#1680** (`5d3dd08c9`) removes implicit current-repository metric/config reads
from historical throughput and stage-timing reconstruction. The language
aggregate, throughput renderer and explicit materializer share recorded source
resolution. Embedded scan-profile modes, throughput and indexing observations
remain usable without the original repository. Each modality selects its own
complete counter/clock family. Missing/null/string measurements stay unavailable;
absent timing profiles remain null and partially observed profiles enumerate
known/unavailable stages. An observed embedding stage is not added twice.

Optional external facts require a versioned reference beneath the actually read
report directory, matching its explicit run attempt, bounded exact bytes and
SHA-256. The existing contained reader enforces path/link authority and read
limits. Changed, missing, malformed or mismatched sources stay unavailable;
original pending I/O ownership propagates. No current pointer, mtime stamp or
repository path supplies historical measurement identity. No public knob or
index format allowance is added.

Versioned derivation receipts retain source digests, original timestamps, per-mode
sources and attempt evidence. Materialized fallback stays fallback on readback;
old unqualified fallback is reconstructed from recorded inputs rather than
promoted to native. Genuine native ledgers retain priority. Derived indexing and
ledger content is stable for unchanged recorded observations, and a saved summary
remains paired with its own artifacts. Live structural build-state analysis is
not claimed as an immutable attempt snapshot. Environment/performance baseline
comparability remains its separate qualification owner.

The removed private repo-metrics loader and its private read helper had only the
two reconstruction consumers replaced here; their imports are also removed.
The separately named current feature-metrics utility remains for explicit
inspection. Existing cache-root/invalidation/resilience assertions are retained
against that utility, with a new historical-admission negative. No legacy test
file or meaningful assertion was removed.

The new curated fixture uses actual aggregate and ledger callers with saved A
measurements and deliberately different live B metrics. It changes/removes B and
current config, counts forbidden live reads, checks embedded counter/clock pairing,
matching/mismatched/missing snapshot identity and authority, native priority,
unknown duration and stable materialization/provenance round trips. No benchmark,
model or indexing process was executed.

Full format/ESLint, syntax on ten changed JavaScript files, affected generated
refresh/freshness, fixture discovery/ordered selection and diff checks passed.
ci-lite now contains 1,241 entries. Functional fixtures and final gate remain
deferred. Current coverage: **35 fixed / 423 implemented / 152 partial / 156
pending** across 766 current open reports. No issue was closed or closing
reference added on unrun evidence.

## Bakeoff effective policy and observed sampling (2026-10-26)

**#1660** (`b4e8576da`) resolves one immutable bakeoff policy for child launch,
reporting and checkpoint compatibility. The resolved sample limit and seed are
always set, including zero, so inherited or configured positive sampling cannot
survive an explicit/profile-disabled decision. The production sampling resolver
is shared with the parent policy. Its absent normalized environment value no
longer acts as a disabling zero instead of allowing configured sampling. Existing
quick/full defaults and the deterministic sample algorithm remain intact.

Build/evaluation model environments and compare receive the same selected intent.
Explicit stub reaches compare's supported flag; deliberate inherited stub/off
policy remains visible when there is no conflicting choice. Raw execution values
are private and immutable. Canonical requested model plans reuse the existing
embedding execution-plan owner and stable digests enter settings/resume identity.
Requested plans are labeled separately from actual generation/evaluation evidence;
no real-provider or pinned-native-execution qualification is inferred from them.

Stage3 publication now retains a versioned eligible/selected/completed file and
chunk observation, compact selected-input identity and embedding-generation
binding in index-state extensions. Projection requires ready/nonpending state,
valid counts and the same embedding generation. Actual state/manifest bytes bind
the bakeoff generation receipt. A retained sampled index stays sampled when a
new full profile requests zero without rebuilding. Missing legacy receipts or
requested-but-absent modes remain unknown. Diagnostic parsing/size unavailability
does not replace the existing streamed generation identity with a fabricated
empty result; pending I/O ownership still propagates.

The former private resolver had one production call, now served by its shared
sampling owner; all other numeric-coercion uses remain. The unused
`samplingActive` local had no readers or side effects and is replaced by the
persisted observed counts. No existing test/assertion was removed.

The new curated fixture exercises pure defaults through actual policy/environment
construction and the production resolver. Real tiny child processes read three
owned files and call the existing test-gated stub path, independently asserting
all-three versus one-file selection and completed-vector counts. Build/eval/compare
share the selected policy; the fixture refuses real/off provider activation. Real
published fixture generations demonstrate sampled and missing-mode/legacy
coverage, stable generation identity and changed state identity without indexing,
model downloads or native backend activation.

Full format/ESLint, syntax on eight changed JavaScript files, affected generated
refresh/freshness, fixture discovery/ordered selection and diff checks passed. A
trailing-space check was corrected before commit. ci-lite now contains 1,242
entries. Functional execution and final gate remain deferred. Current coverage:
**35 fixed / 424 implemented / 152 partial / 155 pending**, across 766 current
open reports. No issue closure or new closing reference was claimed.

## Complete intake refresh after the policy wave (2026-10-26)

A fresh complete GitHub open-issue listing contains **770** unique reports,
including newly observed #131, #216, #248 and #292; none of the prior 766 IDs
closed. The four additional reports enter pending intake without borrowing
historical closure or unrun source evidence. Priority totals are P1 31, P2 336,
P3 46, Perf 116 and other 241. Coverage is now **35 fixed / 424 implemented /
152 partial / 159 pending**. The prior 766-report counts remain dated history.

## Responsive bakeoff phase lifecycle (2026-10-26)

**#1661** (`9488126c9`) replaces synchronous evaluation/compare waits with the
existing asynchronous subprocess owner. JSON stdout remains a complete bounded
result with truncation/encoding-loss admission; stderr supplies a bounded redacted
last-diagnostic adapter. Build output retains its JSON-mode stderr routing and
human stream placement, with existing quiet policy respected. Build nonzero
failures now retain their original result/exit evidence alongside the diagnostic.
No new general subprocess supervisor or public setting is introduced.

One narrow phase owner serves build, eval and compare: started/running and
succeeded/failed/cancelled states are versioned, timers are cleared on every
terminal path, and elapsed waiting never advances productive success counts.
Known planned phases remain visible. Settled and successful counts are separate.
The original bar/display owner supplies rendering and quiet/non-TTY policy.
Successful completion is announced only after its terminal checkpoint succeeds;
a failed child, parse/admission or evaluation-qualification result has no
completed-success finalizer. Evaluation contract checks remain inside the phase.

Cancellation reaches the same child/backoff owner. Campaign signal listeners and
display cleanup are finalized on failures as well as success. Child, checkpoint,
display and frozen/falsey error authority remain together through the existing
failure-context owner. Bounded failure receipts preserve exit/signal, capture,
termination and related diagnostics without dumping a whole captured result on
uncaught process exit. Projection reads own data fields, excludes unknown payload
keys and does not invoke diagnostic getters. Pending child release is never
manufactured by timer/display cleanup. Checkpoint namespace/atomicity remains
tracked by #1663; this batch does not claim to complete that publication owner.

The new curated fixture holds real inert child processes open until actual phase
status/elapsed callbacks run. It covers the real build and JSON adapters for
build/eval/compare, clean JSON plus stderr, invalid JSON, nonzero exit,
cancellation, stopped timers, unchanged success counters on failure, terminal
checkpoint failure, original pending/frozen error plus checkpoint/display
failures, actual quiet display behavior and getter-free diagnostic projection.
No real provider, corpus or benchmark was executed.

Full format/ESLint, syntax on four changed JavaScript files, affected generated
refresh/freshness, fixture discovery/ordered selection and diff checks passed.
The source move also removed the superseded synchronous wrapper and duplicate
compare heartbeat/finalizer; their production callers now use the shared phase
owner. Existing fixtures/assertions remain. ci-lite now contains 1,243 entries.
Functional execution and final gate remain deferred. Current coverage: **35 fixed
/ 425 implemented / 152 partial / 158 pending** across 770 current open reports.
No issue closure or new closing reference was inferred from this source batch.

## Bakeoff checkpoint publication owner, first #1663 slice (2026-10-26)

**#1663 remains partial.** `c42fee0eb` repairs its bakeoff checkpoint branch;
A/B invocation/report binding and settled-run evidence retention are still open,
with comparable recommendation admission tracked independently by #1655.

The existing file-lock owner now fences the complete invocation, including
resume admission, all child phases and pending checkpoint writes. Competing
writers get an explicit busy result. Closed/sealed capabilities cannot write
into a later invocation, and concurrent local publications are rejected. Pending
writes are drained before lock release; original child/persistence settlement
observations remain with the existing lock owner. No force-reclaim or alternate
supervisor is introduced.

Publication uses the existing atomic persistence owner, retaining prior complete
bytes on failure before commit. Every invocation has an exclusive compact run
directory, owner marker, exact incoming checkpoint copy and separate create-only
terminal receipt. Versioned metadata binds run/revision/settings and source
identity. The old default latest path and explicit --checkpoint interface remain.
A sealed final receipt cannot be selected as a mutable target; copying it to a
chosen checkpoint path provides explicit compatible import without overwriting
history. Startup-only failures can retain their terminal report independently
while preserving an earlier usable latest checkpoint. Native/index/model work is
not replayed by publication recovery.

Contained bounded UTF-8 reads distinguish absent, incompatible settings, malformed
or inconsistent checkpoint and active writer. Corrupt input is preserved and
fails before work; it no longer becomes an empty resume through catch-all error
handling. Valid model reuse retains the generation and evaluation-input checks,
and exclusions are explicit in the resume receipt. A fixed 32 MiB report bound
may only be lowered by private fixtures. Generic JSON writers outside this owner
are unchanged.

The new real-filesystem fixture covers valid unchanged resume, exact original
bytes, immutable history, read-only sealed targets, corrupt input without work,
two competing writers, expired A after B, actual atomic before-commit failure,
prior-byte preservation, lock release after settled failure, startup-only
publication, settings mutation and concurrent writes. It requires no models,
corpus, native backend or elevated Windows permissions.

Full format/ESLint, syntax on three changed JavaScript files, affected generated
refresh/freshness, fixture discovery/ordered selection and diff checks passed.
ci-lite now contains 1,244 entries. Functional execution and final gate remain
deferred. Current coverage: **35 fixed / 425 implemented / 153 partial / 157
pending** across 770 current open reports. No issue closure or new closing
reference was inferred from this partial source batch.

## Comparable A/B work and immutable reports, #1655/#1663 (2026-10-26)

`1475e1658` implements #1655 and the A/B invocation binding branch of #1663.
#1663 remains partial for settled-owned evidence retention/cleanup across the
A/B and bakeoff report owners. No global history deletion is introduced.

A/B version 2 separates hard admission from its versioned duration objective.
Failed, timed-out, required-skipped, unknown, incomplete or mismatched work has
no score. Completed workload and correctness witnesses, exact data/configuration
identities, same host observations, unchanged entry bytes and clean matching Git
boundaries are required. Otherwise eligible cohort mismatch suppresses the whole
comparison. Declared optional work leaves the denominator only for an identical
clean skip across every variant. Requested knob settings need actual applied
receipts; unsupported and unverified settings remain distinct. Missing stall or
utilization is never silently zero and token occupancy does not drive selection.
No qualified candidate, cancellation or incomplete matrix means no recommendation
and failing CLI status. Existing producers without measurement evidence retain
raw reports with explicit exclusion reasons.

Each invocation now owns an exclusive directory, experiment ID, owner marker,
create-only raw reports and immutable final receipt. The existing observability
context carries exact experiment/variant/request/workload identity to the runner.
Parent admission reads the actual contained bounded UTF-8 report even after
nonzero exit, retaining real failed rows, exit/signal facts, diagnostic tails,
raw-file bytes and SHA-256. It does not prefer stdout or substitute synthetic
empty results. Explicit JSON summaries use atomic replacement; later invocations
cannot overwrite historical raw paths. The runner/sweep share exact suite,
argument, token and optional-policy resolution. Sync capture now reuses the
existing bounded collector and emits truncation/encoding receipts; the replaced
private trim helper had no other consumers.

A fixed 256-distinct-variant limit, 64 MiB per raw report and 512 MiB invocation
allowance bound accumulation within one experiment. Incomplete oversized reports
preserve terminal outcomes when the compact envelope fits; storage/cancellation
or budget stops account for every remaining variant. Large diagnostics remain on
disk rather than being duplicated into every summary. These bounds do not claim
to complete historical retention policy or production latency qualification.

The original successful plumbing assertions remain and now use a real tracked
knob-aware fixture with equal checksum work and an explicitly synthetic known
ranking. New independent controls cover slow-success versus fast-failure,
all-failed/required-skipped/missing/invalid/zero measurements, correctness,
coverage/config/invocation/source/host mismatch, truncation, unsupported/unverified
knobs, common versus one-sided optional skips and incomplete matrices. Actual
child/report fixtures cover nonzero details, interleaved child-write/parent-read
barriers, later-run byte preservation, malformed/foreign files, immutable final
receipts, bounded matrices and pre-launch cancellation. Sync capture controls
cover exact output, failure facts, bounded tails, invalid UTF-8, disabled capture
and line mode. They remain unrun under the implementation-first instruction.

Full format/ESLint, syntax on 15 changed JavaScript files, affected generated
refresh/freshness, ordered fixture discovery and diff checks passed. One combined
list filter matched no IDs because the runner takes a literal selector; separate
selectors discovered all three newly registered fixtures. ci-lite now contains
1,247 entries. Functional execution and final gate remain deferred. Current
coverage: **35 fixed / 426 implemented / 153 partial / 156 pending** across 770
open reports. No GitHub closure or new closing reference was inferred.

## Scan-profile missingness and matched scope, #1681 (2026-10-26)

`6e87abdbf` implements #1681. The actual report-artifacts throughput precursor
and scan-profile producer now share narrow strict numeric admission and rate
calculation. Null/omitted/string/boolean/negative/nonfinite counters are unknown;
counts require safe integers. Measured zero stays zero, and zero/missing duration
cannot support a rate. Supplied rates cannot override matched observed counts
and timing or invent missing work. Cache hit rates remain within 0–1.

Scan-profile version 2 requires coverage for each counter and rate: selected,
observed/missing and matched/excluded mode sets, observed subtotals, matched
numerator/duration and explicitly named measured-subset rates. Whole totals and
rates remain unavailable with incomplete required coverage. The concrete
100-lines/1000ms plus unknown-lines/1000ms case retains whole-run unknown and an
explicit 100-lines/s measured subset, never an unqualified 50. Sum-of-mode work
and duration do not claim unique repository counts or end-to-end wall time.
Known-empty work participates; unobserved work does not become zero.

Existing status-health selection remains authoritative. Its fallback index
paths and zero artifact sizes can exist for unbuilt modes; explicitly unselected
modes cannot invent a denominator. Selected missing metrics remain missing.
Current root checks, own-key maps, extraction quality, indexDir and reuse
observations remain. Legacy version 1 retains its integer-total schema; version
2 requires coverage and supports nullable raw timing observations. Unsupported
versions fail admission. Existing populated positive assertions remain intact.

The report adapter derives the same matched scope from recorded mode fields,
preserves source schema version, and handles observed zero as real data. Recorded
measurement readers recognize both artifact versions. Derivation version advances
to 2, and older derived indexing/ledger materializations are recomputed when
recorded sources are available. Read-only derivation does not rewrite historical
inputs; native observations retain their owner. No mutable user cache is read
as a historical measurement source.

The new small fixture exercises the actual producer, artifact validator,
throughput precursor, recorded-evidence reader and report consumer. Controls
cover partial/unknown totals, matched subsets, known-empty work, malformed numeric
types, supplied/contradictory rates, zero/missing time, unbuilt-mode exclusion,
old materialization refresh and schema/version negatives. Execution remains
deferred. Full format/ESLint, syntax on 10 changed JavaScript files, affected
generated refresh/freshness, direct generated artifact-index comparison, ordered
fixture discovery and diff checks passed. The generated artifact index also
catches up existing extractionCoverage fields already present in source.
ci-lite now contains 1,248 entries. No functional suite or final gate ran.

Current coverage: **35 fixed / 427 implemented / 153 partial / 155 pending**
across 770 current open reports. No closure or new closing reference was inferred.

## Diagnostic occurrence and repository replay, #1689 (2026-10-26)

`879367406` implements #1689. New diagnostic stream version 3 retains the
existing class fingerprint and occurrence counter while adding one UUID per
runProcess invocation and explicit occurrence-delta cost semantics. Every mirror
receives the exact same payload. A restarted command gets a distinct execution
identity. Producer cost fields preserve unknown versus numeric zero; safe integer
work counts remain distinct from duration. Existing per-occurrence process
summary accumulation and concise interactive signatures remain.

Replay now separates repository/source fingerprint presence, repository/type
presence, logical occurrence identity and transport-copy identity. Parity keeps
its presence denominator. Repeated observations contribute their own cost once;
master copies suppress only the exact qualified observation. Master-only A/B
and missing-repo-stream evidence survive even with the same class fingerprint.
Unknown master labels stay in explicit unknown-source buckets, surfaced within
legacy repository-presence counts rather than merged into a known repository.

Version 3 duplicate counts mean actual repeated transport copies. Occurrence
counts and repeated-fingerprint occurrence counts expose useful repeated work.
Costs have observed/unknown counts, observed subtotals and scope explicitly
separate from wall time. Historical v1/v2 and unversioned rows remain readable
with conservative projected-field copy matching and explicit legacy execution
uncertainty. They cannot acquire modern execution qualification from a class
fingerprint. Unsupported/current non-delta semantics, conflicting same-occurrence
copies, overflow and exhausted identity allowance remain incomplete and prevent
a passing parity claim. The fixed invocation-local 100,000-identity bound can
only be lowered by fixtures. No raw-log cache or extra stream pass is added.

The existing summary fixture's old duplicate=1 expectation described its real
fallback occurrence 2 as a transport duplicate. Its presence/parity assertions
remain; the oracle now requires seven occurrences, six presences and no transport
copy, with the unknown master repository explicitly counted. The process fixture
checks every row's shared execution UUID, positive occurrence and delta receipt.
New actual JSONL controls independently exercise two 10ms occurrences versus two
mirrors, master A/B, partial master fallback, process restart/reset, repeat copies,
reordered inventory, legacy matching, unknown labels, conflicting copies,
bounded identities, unsupported semantics/version and primitive zero/unknown
costs. All authored functional checks remain deferred.

Full format/ESLint, syntax on eight changed JavaScript files, affected generated
refresh/freshness, ordered fixture discovery and diff checks passed. ci-lite now
contains 1,249 entries. No local functional suite or final gate ran. Read-only
hosted status at `fd9e582fa` showed Ubuntu/macOS failures; those platform jobs are
outside the current Windows-only execution scope and were not rerun locally.
Current coverage: **35 fixed / 428 implemented / 153 partial / 154 pending**
across 770 open reports. No closure or new closing reference was inferred.

## Observed progress confidence and replay, #1691 (2026-10-26)

`95e7411e6` implements #1691. Progress-confidence version 2 retains its component
weights/thresholds while requiring actual component sample sufficiency. Completed
positive heartbeat intervals and actual stall observations replace the previous
zero-observation no-stall award; queue and in-flight components require two
samples. Silent/ordinary children and a lone task-start remain unknown. Typed
numeric admission prevents null/boolean/string telemetry from manufacturing
samples or a zero score. Components retain observed scores, eligibility,
minimums and sample counts; partial useful evidence remains explicit.

Snapshots carry process observation bounds, current age, last phase/task context,
the existing 30-second heartbeat threshold and retained historical component
score. Insufficient, stale or unknown-age evidence has no current numeric score.
Recovery can restore observed evidence. Interactive text explicitly says
last-observed heuristic and displays age. Component retention remains bounded;
process observation bounds do not invent a common exact retained interval for
all components. No refresh timer or competing timeout/active-task owner is added,
and existing watchdog admission, decisions and cleanup remain unchanged.

Replay uses the same primitive finite-or-unknown admission and recomputes current
row eligibility from its recorded component/sample receipt. Missing or stale
current evidence cannot become measured via an authored score/bucket. Historical
recorded rows remain readable. Unknown rows stay in bucket/event coverage while
being excluded from numeric average/min/max and measured ranking. Real zero
remains observed. Current rows participate in copy matching with their execution
identity and retain freshness/age in latest details. Unsupported future versions
cannot supply a numeric score.

Existing pure high/low/partial weighted positives remain. New deterministic
clock controls advance healthy evidence into silence and recovery, preserve
historical score, expose age and reject reversed clocks. The actual process
fixture now checks primitive finite positive-case scores and persisted evidence;
small silent, ordinary, explicit-null and start-only children assert returned and
persisted unknown results. Structured negative controls include valid protocol
timestamps and assert actual heartbeat/queue/in-flight route counts, so malformed
fixture input cannot fake coverage. New actual JSONL controls prove null beside
0.8 yields numeric mean/min/max 0.8 with one unknown row; true zero participates;
invalid types, stale/current unsupported evidence and exact mirrors remain visible.
These authored functional checks are still unrun.

Full format/ESLint, syntax on six changed JavaScript files, affected generated
refresh/freshness, ordered fixture discovery and diff checks passed. ci-lite now
contains 1,250 entries. Complete GitHub refresh reconfirmed 770 open issues with
no additions or closures. Current coverage: **35 fixed / 429 implemented / 153
partial / 153 pending**. Functional execution and final gate remain deferred;
no issue closure or new closing reference was inferred.

## Bounded throughput result-file admission, #1687 (2026-10-26)

`cc70899b3` implements #1687. Inspection and explicit materialization now share
one result-file admission owner. Supported current/unversioned/legacy measured
and explicit empty/failed envelopes remain visible. Known non-run reports and
manifests are distinguished from unsupported kind/version, malformed, oversized,
missing and unreadable inputs. A date, filename or truthy parsed JSON cannot
establish a benchmark run or displace a legitimate latest measurement.

The existing directory/file owners provide contained UTF-8 reads and original
settlement checks. Metadata is parsed sequentially and retains only source
extent/hash, normalized repository/history identity, timestamp and selection
facts. Existing repository filtering, timestamp ordering and stable filename ties
remain. Selected bodies are re-read against captured bytes/hash/private file
identity before expensive sections; changed or missing selected files fail
admission. Descriptor authority is not serialized. Repository/history helpers
move unchanged into a thin owner and remain reexported by analysis, avoiding an
unnecessary metrics/analysis dependency in the input loader. The generic JSON
helper remains for its separate risk/cache consumers; formatting caught and
corrected its remaining import before publication.

Fixed invocation allowances cover 32 MiB/file, 512 MiB read allowance, 128 MiB
retained selected payload bytes, 8 MiB file metadata and 10,000 discovered JSON
files. Private fixtures only lower limits. Inventory exhaustion has a bounded
stop receipt. Failed native reads conservatively consume their admitted read
allowance while observed successful bytes remain distinct. These encoded-byte
banks do not claim heap/RSS measurement. Cancellation is checked between files
and derivation phases through owned signal listeners; no competing supervisor
or timeout policy is introduced.

Report version 2 carries result-file scope, discovered/selected/admitted/processed,
excluded/failed counts, source receipts, inventory/cancellation state and budgets.
Useful healthy observations can remain visible with an explicit partial cohort
and nonzero CLI status. Empty inspection yields an explicit typed empty report;
zero readable/rejected inputs are not mislabeled no-files-found. Materialization
uses the same admission and reports input failures separately from write failures;
rejected/non-run files remain untouched. Default inspection still performs no
writes. Optional derived analysis readers and workload/backend qualification
retain their separate owners.

Comparison version 2 checks both complete internally consistent report/input
models before deltas. Wrong/partial/empty child reports, nonzero/signal execution
and incomplete capture produce incomparable rows with a failing status. Capture
uses the existing bounded subprocess owner. The selector's former arbitrary-{}
fixture becomes a recognized zero-query envelope while preserving its ordering
assertions; positive profile/comparison assertions remain and use the canonical
version constant.

New small controls cover healthy plus malformed/unrelated/legacy/failed/non-run
inputs, latest admission, missing/changed selected files, byte/metadata/file
allowances, cancellation, inspection byte preservation, explicit materialization
refusal, real zero-exit wrong/partial child output and typed empty reports.
Functional execution remains deferred. Final full format/ESLint, syntax on ten
changed JavaScript files, parsing of two changed JSON files, affected generated
refresh/freshness, ordered fixture discovery and diff checks passed. ci-lite now
contains 1,251 entries. Current coverage: **35 fixed / 430 implemented / 153
partial / 152 pending** across 770 open reports. No issue closure or new closing
reference was inferred; the final gate and functional qualification remain open.

### #1687 envelope and companion follow-up

`58dd2d7b7` closes two source-review edge cases before functional qualification.
Malformed runs arrays, primitive summaries and unsupported empty summary objects
cannot masquerade as a canonical run. Explicit failed-run summary entries remain
supported. Canonical terminal receipts reuse the existing terminal parser; actual
attempt-snapshot envelopes are recognized as non-run companions. Snapshot and
derivation version constants move unchanged to a thin contract owner, preserving
existing reexports without pulling file/metrics readers into selection.

Additional negative controls cover those malformed shapes and supported failure/
snapshot cases. Full format/ESLint, syntax on four changed JavaScript files,
affected generated freshness and diff checks passed. Functional execution remains
deferred. Inventory counts stay **35 fixed / 430 implemented / 153 partial / 152
pending**; no accepted closure is inferred from this follow-up.


### #1695 selected-mode triage evidence

`0d3891702` replaces triage's direct payload[mode] access with the existing shared
retrieval-cohort selector. Extracted-prose now selects extractedProse. Missing,
malformed or unsuccessful selected output becomes an unavailable query with a
query/mode/repository-bound diagnostic and outer warning; an explicit empty array
remains a successful zero. Native pending-ownership failures propagate through
the existing storage observation owner before ordinary error projection.

The canonical version 1 evidence projection retains the actual local search-root
identity, available backend/fidelity/cache and selected-mode generation receipts,
score-space metadata, chunk/source identity and known/unknown line/offset ranges.
Absent facts remain null; no hashes, global repository identity or source
verification are invented. Bounded previews are explicitly lossy. Saved source
navigation remains unavailable until revalidated; the projection never reads
current same-path bytes as historical evidence. MCP preserves its artifact-path
handoff and now carries the evidence version and searched-repository receipt.
The old local display projection is replaced; the unreferenced, nonexported
extractRecordId function had no caller and is removed.

The existing real CLI fixture retains its finding, exposure, history, import and
positive-hit assertions. Its tiny fixture now includes independent code/prose/
comment controls and compares persisted identity/range/backend/generation facts
with direct search. New boundary controls cover malformed/missing output,
explicit zeroes/unknowns, two same-path repositories and changed generations;
an actual MCP handler fixture covers arguments, cancellation and artifact return.
Functional execution remains deferred. Full format/ESLint, six changed JavaScript
syntax checks, affected generated freshness, ordered discovery and diff checks
passed. The source commit was pushed and its exact remote SHA verified.

### #1677 evidence-qualified language remediation

`edb099f1c` replaces low-nonempty causal tuning advice with version 2 inspection
hypotheses. The real benchmark now records version 1 selected-primary-mode query
outcomes by invocation backend/mode/stratum, keeping effective backend and unknown
backend observations separate. Throughput query-file inputs remain unjudged;
no public input surface changes. An internal collector reuses canonical judgment
admission and distinct-document matching for explicit positive/negative controls.
Counts conserve successful, empty, unavailable, unknown, known-positive and
expected-negative outcomes. Arbitrary irrelevant hits cannot improve judged
positive-target success. Invalid receipts and legacy availability-only summaries
remain explicit, with unknown mode/stratum/judgment coverage where absent.

Decisions inspect each cohort; the best-backend rate remains only a legacy
display metric. Expected-empty success, missing judged targets and unknown
expectations receive different diagnoses. Suggestions retain applicability,
observations, missing/contradicted evidence and abstention reasons; priorities
are uncalibrated heuristics, production changes remain unqualified, and every
loop retains false acceptance with null post-change/delta fields. Workload
weight/generator changes are workload design and cannot establish a product
quality gain without an independent frozen matched holdout.

Actual per-query retrieval-service elapsed samples retain sample coverage,
cache-state counts and effective concurrency. A combined search's service time
is associated with its selected-mode cohorts, not apportioned mode latency or
independent samples across modes. Batch wall-per-completion retains throughput
cost meaning and cannot trigger query-latency or rerank-budget advice. Even
observed slow service warrants inspection without a demonstrated rerank cause.
Taxonomy totals and zero-hit subsets retain separate per-backend counts and
backend-search occurrence scope: four total with three zero-hit remains 4 / 3.

The existing report-shape/ordering fixture retains positive suggestion, sort,
aggregation and loop checks with corrected diagnostic semantics. New controls
exercise buildReportOutput for expected negatives, positive misses, irrelevant
hits, unjudged workloads, changed workload identity, concurrency-only wall-cost
changes, fixed service observations, conflicting unqualified cause flags,
per-backend misses hidden by a high best rate, malformed receipt counts, typed
unknowns and taxonomy subsets. Both report fixtures join the curated lane.
Full format/ESLint, eight changed JavaScript syntax checks, affected generated
freshness and diff checks passed. Discovery initially exposed that the old
plumbing fixture was outside ci-lite; it is now explicitly selected there along
with the new evidence fixture. ci-lite contains 1,255 entries. No functional
fixture, gate, native or performance campaign ran in this implementation wave.

Current coverage: **35 fixed / 432 implemented / 153 partial / 150 pending**
across 770 open reports. These are source implementations awaiting qualification;
no issue closure or new closing reference is inferred.


### #1733 SQLite fixture admission and smoke correctness

`66b2cffa0` repairs both executable fixture boundaries. The shared factory uses
the canonical artifact surface version and immutable snapshot writer, retaining
complete selected inventories and exact generated-source hash/size/dependency
metadata. Chunk offsets now correspond to their generated source lines. Updated
manifests preserve top-level identity and publish a complete replacement snapshot;
old selected snapshots remain immutable. The obsolete named-bundle helper had
only the factory/update callers, both now replaced by the canonical publisher.
No production format, checksum, source, path, capability or change-ratio gate is
relaxed. Nonpositive/noninteger CLI sizes fail explicitly; the one-file update
smoke requires at least three files to fit the existing production ratio.

Each invocation uses a unique directory under the existing development artifact
owner, removing the former shared-root recursive reset. Validation runs outside
build/update timing and compares stored chunk contents, resolved posting tokens
and frequencies, document lengths, file manifest, FTS retrieval and applicable
sealed filter facts against admitted snapshots. Missing filter seals retain
explicit unavailable/fallback scope rather than being rebuilt outside timing.
The sparse-only workload checks absent dense/phrase/chargram work as zero.
Expected row mutations and baseline/current content parity precede any smoke
delta. Observed source/bundle bytes, files/chunks/postings, lane scope and stable
content identity are printed. Single fixed-order trials are labeled smoke and
sustained performance remains unqualified.

A real production build/update fixture covers exact format/snapshot admission,
independent synthetic source/hash/offset witnesses, original snapshot retention,
expected mutations/unchanged content and deliberate posting corruption rejection.
Six separately bounded CLI cases cover both entry points in baseline/current/
compare modes. All seven cases join ci-lite, now 1,262 entries. Functional
execution remains deferred. Full format/ESLint, six changed JavaScript syntax
checks, cases JSON parsing, affected generated refresh/freshness, discovery and
diff checks passed. The following bookkeeping edits do not change that JS tree.

#1733 remains partial: qualification profiles still need independently varied
changed/new/deleted/shrinking/growing/repeated work, observed threshold/batch
coverage and repeated alternating independent trials with lifecycle timing and
explicit cache conditions. The fixture admission repair is source-complete;
these additional harness features and representative execution remain open.
Current coverage: **35 fixed / 432 implemented / 154 partial / 149 pending** across
770 open reports. No accepted issue closure is inferred.


### #1638 repository and triage source namespaces

`6501c431d` introduces canonical version 1 recordSource references binding the
selected repository, configured root, source kind, relative path and original
byte hash. Both repository and triage inputs receive disjoint .record-sources/v1
storage keys; human display paths remain separate. Equal text and identical old
human paths cannot merge physical inputs or sidecar metadata. The union derives
paths from the actual admitted roots, diagnoses conflicting duplicate source
declarations and deterministically chooses one triage authority when the same
file is also discovered inside the repository. Root fingerprints retain local
Windows path-case equivalence without inventing portable/global repository IDs.

The same reference reaches chunk UID namespace, canonical metadata, hot/cold
chunk projection, file metadata/columnar rows/fingerprint, incremental entries
and SQLite metadata. Records producer 8 becomes 9; logical-content identity v3
becomes v4 and includes the source reference. Existing producer-qualified replay
now also checks the selected entry/chunk reference. Old unqualified products are
recomputed rather than silently sharing the new meaning. Oversize chunk metadata
cannot truncate/drop a new reference into a misleading ordinary file identity;
its minimal exact representation either fits or fails ERR_RECORD_SOURCE_LIMIT.
Human result labels retain source kind/path and do not create an unverified
current-file hyperlink for a virtual source reference.

Source and sidecar reads now use their selected repository/records authority
roots rather than the immediate parent as a substitute authority. Sidecar error
projection observes original settlement, retains missing-vs-invalid behavior and
preserves cancellation. Deferred embedding reads select exactly one admitted
root and verify original bytes before each file's cache replay/provider work.
The old triage-prefix candidate fallback is removed. New references whose root,
repository, shape or hash changed require a rebuild. Unprefixed legacy repository
records remain readable with a matching original byte hash; ambiguous old
triage/records keys and missing identities require rebuilding for deferred reads.
Existing published records remain readable. No links, models, native installs,
security settings, cache invalidation or indexing campaign were used here.

New ordinary-file controls cover different/equal bytes, colliding human names,
reversed union discovery, nested basenames, inside-repository deduplication,
conflicting duplicates, changed roots/hashes, no root fallback and legacy
unambiguous/ambiguous admission. A second fixture exercises the actual records
builder with an injected publication boundary, real immutable incremental
products, file/hot/cold metadata, real SQLite storage, fresh/replay identity,
sidecar distinction and deferred-source selection. The existing records exclusion
fixture retains its positive/negative assertions using the new source-relative
identity rather than a stale storage-path literal. Both new fixtures join ci-lite,
now 1,264 entries. Their execution remains deferred.

Full format/ESLint, syntax on 17 changed JavaScript files, direct generated
schema-index comparison, affected generated refresh/freshness, ordered discovery
and diff checks passed. The artifact-schema index is refreshed from canonical
schemas; its registered functional contract fixture remains deferred. Following
bookkeeping edits do not change the checked JS tree. A complete live GitHub
refresh still contains exactly 770 reports, with no added, closed or edited
records since the prior complete refresh.

Current coverage: **35 fixed / 433 implemented / 154 partial / 148 pending**.
#1733's representative harness/qualification remainder remains explicit. No issue
closure, new closing reference or final-head functional acceptance is inferred.


### #1726–#1727 observed search microbenchmark work and baseline admission

`c6275bd85` introduces distinct retrieval and result-cache work modes for both
search microbenchmark runners. Retrieval bypasses only query-result lookup and
persistence through a private symbol; quality/ranking policy and existing cache
entries remain intact. A frozen bounded query schedule records order and duplicate
occurrences, with independent phase cursors. Initial/warmup/measured observations
are separate. The first call after index-handle clearing is explicitly initial;
process, model and filesystem coldness are not invented. The old coldMs alias
retains compatibility without supporting a cold-result-cache claim.

Stats-enabled searches now expose invocation-owned query-embedding requests,
actual embedding API calls and process-cache reuse through the existing resolver.
They do not claim native kernel counts. That owner supplies actual dimensions,
provider/stub state, canonical verified artifact or immutable revision and hashed
format/profile identity. Unknown model artifacts remain unqualified. Candidate
and actual vector-provider stages, complete canonical execution, exact selected
generation, score policy, cache strategy/hot path and ordered output identity
bind the measured work. Disabled ANN stages and fallbacks are not vector work.
All calls contribute to conserved counters; each phase retains 64 bounded sample
receipts plus exact omissions and per-query drift controls. Tinybench reports up
to 10,000 raw samples with exact omissions. Timing excludes receipt projection.
Both executables dispose their existing SQLite cache owner before successful
report publication, preserving primary and cleanup failures together.

The version 2 Tinybench report separates source-code provenance from controlled
workload identity. Its pure comparator requires matching observed source, query
schedule, mode, policy, output, cache/model/backend and Node/ABI/CPU/platform
controls, complete measured cycles and qualified work counts before any delta.
An explicit storage-backend axis requires actual backend exercise and matching
remaining controls. The ordinary runner's ANN-provider comparison uses the same
admission owner; unexercised/unknown-model arms cannot produce speedup ratios.
Legacy/missing/malformed reports yield structured incomparable reasons and no
numeric deltas. Comparison never overwrites a baseline; the existing explicit
write action remains. Statistical/representative qualification stays separate.

Four new regression owners cover work receipts, bounded sample conservation,
model unknowns, cleanup failure preservation, frozen input limits, comparator
positive/negative controls, actual sparse search/Tinybench invocation, and actual
resolver API-vs-cache work with a deterministic injected embedding entry point.
The real runner fixture retains balanced-query miss/hit controls, verifies an
indexed source before timing, preserves policy/output parity across cache work
modes and distinguishes a pre-existing cache hit from a supposed cold miss.
They join ordered ci-lite, now 1,268 entries. No test was executed in this batch.

Full format/ESLint, syntax checks on 21 JavaScript files, affected generated
refresh/freshness, discovery of all four fixtures and diff checks passed. The
complete live intake remains 770 with no added, closed or changed reports since
the preceding refresh. Bookkeeping changes do not alter the checked JS tree.
The required functional/front gate and runtime/performance campaigns remain
explicitly deferred under the user's implementation-first instruction.
Current coverage: **35 fixed / 435 implemented / 154 partial / 146 pending**.
Neither issue was closed; no new closing references or final-head acceptance
were asserted. Contract: docs/contracts/search-microbenchmark-evidence.md.


### #813 native type identity and #985/#1058/#1059 replay/lease controls

`8009ce69c` removes JavaScript/TypeScript/JSX/TSX spelling-based rewrites of
Boolean/String/Number and integer/float from the shared canonical normalizer.
Boxed and primitive native expressions remain distinct, with quoted/template
literal contents, identifier case and original spelling preserved. Existing
Python and qualified-prefix contracts remain. Strict return filters keep exact
expression matching and tooling precedence; they are not weakened into synonyms
or assignability. Proven-stale boxed-type expectations in two existing fixtures
are corrected while retaining their other language, literal and qualified-name
assertions. The historical security-alert guide now explicitly labels its old
boxed-type expectation superseded by this semantic repair.

The actual tooling-application function moves intact into a small internal owner
used by production and the deterministic handoff fixture. This avoids booting
provider orchestration just to exercise fact application. The new fixture uses
supported TypeScript parser-retained source annotations as an independent oracle,
then actual signature parsing, LSP candidate merge, provider payload admission,
tooling application, durable cross-file read/write and strict filter/index
consumers. It checks boxed/primitive/union/custom/literal pairs, stale declaration
precedence, source spelling, reversed inputs and stable repeated normalization.
It does not claim a live language-server execution. Shared typeNormalization
advances 11→12, lspBindings 48→49 and the local LSP request policy rq11→rq12.
Provider-result cache keys now include the shared normalizer/LSP producer versions
so already-normalized old facts cannot survive a semantic version change.

Source review confirms the existing #985 registry capability owner checks its
private minted handle, exact root/domain, active state and live on-disk lock ID;
its regression now also denies wrong-root and replaced-disk-identity use. It uses
an isolated project-owned test root rather than an unrelated OS temp directory.
The existing #1058 fingerprint hashes the complete relation object before replay
can replace it. Expanded real-cache controls cover imports/exports/inheritance
and an extension field without fileRelations: unchanged input admits the cache;
changed input misses and cannot overwrite fresh relations. The existing #1059
pipeline refuses cross-file tooling replay/persistence while compiler/config/
ambient identity remains incomplete. A new actual-pipeline fixture seeds a valid
complete stale output, proves direct admission as a control, then requires both
original and configuration-changed invocations to reach the selected in-memory
fixture provider and retain fresh facts. No external command/server is selected.
These three existing source repairs receive implementation credit with pending
runtime qualification, rather than being rewritten or called accepted fixes.
#1054 remains partial; persistence-error inspection/ownership needs further review.

Full format/ESLint, syntax checks on 12 JavaScript files, affected generated
refresh/freshness, two new fixture discoveries and diff checks passed. A trailing
blank line on the newly extracted module was removed after staged diff review;
its syntax was rechecked, with no behavior change. Two new and five original
fixtures join ci-lite, now 1,275 entries. Functional/front-gate execution remains
deferred. Current coverage: **35 fixed / 439 implemented / 150 partial / 146
pending** across 770 open reports. No issues were closed or new closing references
added. Contract: docs/contracts/native-type-expression-identity.md.


### #1054 crash-evidence failure ownership and scheduler closeout

`261d715db` replaces fallible diagnostic projection inside the crash sink catch
with a private persistence owner. Original and inspection failures retain their
actual resource-settlement prerequisites; frozen errors, unreadable metadata,
falsey values and throwing observations cannot suppress independent local,
durable or external sinks. Public code/message text is bounded and copied.
Warning batches have explicit omissions while the failure/resource inventory
remains retained. Presentation and warning operations are separately tracked so
held callbacks cannot block later events' serialized evidence writes. The final
wait joins both work sets. Pending work or unresolved resources cannot report
persistence.ok; settled failures remain explicit degraded telemetry.

`c64a51d02` joins that owner across normal, preparation, execution, cancellation
and lookup exits. Normal admission and finalization share one original cached
wait and deadline; neither restarts failed work or extends the deadline. Original
scheduler and independent persistence failures retain both causes/owners.
Only the existing cleanup owner's actual minted timeout receives the persistence
owner's live settlement observation. A timeout-shaped external exception cannot
claim it. Pending persistence now propagates failure rather than continuing as
completed telemetry. The returned scheduler exposes a defensively copied
persistence receipt. No native crash retry, parser/backend disablement or larger
deadline was introduced; the existing cleanup deadline remains 30 seconds.

The new ownership fixture covers held original/inspection resources, forbidden
pre-settlement diagnostic inspection, independent sink completion, held warnings
and later evidence, actual timeout identity, no sink retry after release, falsey
failures, real atomic tracker publishers, exceptional closeout, one cached wait
and dual failures. Existing presentation controls now assert warning failures
instead of discarding them; their original sink/error-class assertions remain.
The existing native crash-fallback fixture asserts completed positive persistence
and defensive copying. These fixtures are authored, not executed. One new and
three existing coverage owners join ordered ci-lite, now 1,279 entries. No native
crash, indexing or functional test campaign was run.

Final source checks passed: full format/ESLint, syntax (five JS files for the
initial owner and four for closeout), affected generated refresh/freshness,
discovery and staged diff checks. Intermediate formatting also completed; a
later ownership-ordering change received fresh final checks rather than using
earlier observations as final acceptance. Shared semantic producer versions do
not change: this batch changes telemetry/lifetime and diagnostic receipts, not
retained language facts. Contract: docs/contracts/scheduler-crash-persistence.md.
Current coverage: **35 fixed / 440 implemented / 149 partial / 146 pending**.
No issue was closed and no new closing reference was added.

The latest inspected hosted CI belongs to `05c0b9b3d`: gate, policy and rust-tui
reported success; Windows, Windows authority and Windows native inspection were
still in progress; Ubuntu/macOS jobs reported failure. This is historical source-
bound status and does not qualify the later candidate. Work remains Windows-only.

### Disk-full recovery and disposable fixture cleanup

A source-file creation failed when C: reported zero free bytes. The attempted new
file was verified empty and restored completely before source checks/commit;
existing tracked sources were unchanged by that failed creation. Two disposable
issue snapshots were deleted only after parsed JSON equality with the retained
complete open-issues-20261026-micro-refresh.json snapshot (770 reports), reclaiming
9,514,298 bytes without losing unique intake data. These .tmp paths are historical
author-workspace receipts, not promised clean-checkout inputs.

The shared test-cache helper identifies .tmp/dev/tests/cache as disposable test
fixture storage. Process inventory found no active indexing, test, benchmark or
formatter process using it. Cleanup verified the absolute target stayed inside
the workspace .tmp owner and that all root ancestors were ordinary directories.
A single PowerShell/.NET traversal deleted only that fixture root, handling each
reparse point without following its target and removing directories only after
their admitted children. It removed 121,582 ordinary files (1,885,940,353 bytes)
and 12 fixture reparse points. The completed operation reported 2,007,941,120 free
bytes; later free-space observations varied. No user cache/index, dependencies,
Git data, test/crash receipts, WSL or security settings were changed. No elevated
permissions or symlink creation were used. The initial broad read-only size scan
was stopped; the scoped reclamation inventory excluded reparse targets.

### Historical roadmap detail retained from 05c0b9b3d

The active roadmap's completed-batch prose was condensed into a current status
and execution-order summary; its original detail is retained below with its
original source and qualification limits. It is historical, not current counts.

New solo batches cover #1746, #1742, #1741, #1740, #1737, #1736, #1734, #1730,
#1729, #1724, #1719–#1721, #1716, #1711, #1702, #1700, #1696, #1698, #1683, #1565, #1598, #1599, #1684, #1688, #1610, #1611,
#1397, #1561–#1564, #1568–#1569, #1573, #1575, #1580, #1586–#1589, #1591–#1592, #1600–#1602, #1605–#1606, #1608–#1609, #1612–#1614, #1616–#1617, #1619–#1620, #1622–#1623, #1632 and #1635–#1637, #1639–#1641, #1645, #1648–#1649, #1658, #1662, #1666–#1671 and #1673–#1674/#1676. Their authored regressions remain deferred; the
source receipt records exact ownership, identity, capacity and lifecycle changes.
#1719 now preserves SQL role/name occurrences and durable file qualification;
#1662 now carries qualified import outcomes through graph metadata and replay;
full SQL lexical quote/scope/catalog qualification remains explicit.
#1666–#1667 qualify flow field presence/authority and consume owned native syntax;
raw template output no longer becomes generic semantic flow.
#1721 now preserves bounded RST/AsciiDoc block-qualified heading occurrences and
full source coverage, with unsupported geometry/extensions explicit.
#1673–#1674/#1676 now preserve source-owned JavaScript declarations, evaluation
phases and generator/return syntax through chunks, metadata and replay.
The reopened #320, #429 and #473 audits now have source repairs for immutable
release revision evidence, complete scan accounting and machine-stdout QA.
Their new regressions and the JavaScript ownership fixtures join the curated PR
lane; execution remains deferred.
#1633 now qualifies bounded directory-backed final outputs before recovery
publication, retaining explicit Stage2 file-copy scope and post-commit errors.
#1651 now binds canary probes to the actual immutable child launch context;
private environment values remain outside reports and cross-invocation caches.
#1665 now bounds canary diagnostics/results, retains unsettled attempt paths and
atomically reports failed/interrupted lanes with every selected entry accounted.
#1680 now reconstructs historical throughput/timing from recorded observations or
exact attempt snapshots, preserving derivation provenance after materialization.
#1660 now carries effective sampling/stub intent across bakeoff child phases,
keeping requested model plans separate from generation-bound observed coverage.
#1661 now keeps bakeoff waits asynchronous and phase terminal/checkpoint states
truthful, with bounded diagnostic progress and independent success/settled counts.
#1655 now admits only completed comparable A/B work with actual knob receipts;
failed/unqualified variants retain their reports and cannot win.
#1663 now binds immutable A/B raw reports to each invocation and fences bakeoff
checkpoint publication; settled-owned evidence retention/cleanup remains open.
#1681 now preserves unknown scan counts and matched-mode rate coverage through
the version 2 artifact and recorded report adapters, including stale derivations.
#1689 now separates diagnostic occurrence costs from fingerprint parity and
transport copies, retaining repository identity and explicit legacy uncertainty.
#1691 now gates progress confidence on actual samples, labels last-observed
heuristic age and keeps unknown/stale scores out of replay numeric denominators.
#1687 now admits bounded typed result inputs before selection/derivation and
requires complete source-file cohorts before throughput comparisons.
#1695 now preserves selected triage hits, repository/generation receipts and
explicit empty/unavailable outcomes through saved packs and MCP references.
#1677 now separates selected-mode query outcomes from nonempty frequency and
service time from batch cost; remediation remains unaccepted inspection work.
#1726–#1727 now distinguish retrieval from result-cache replay and qualify frozen
query, generation, policy, cache, model and runtime controls before performance
deltas; four new regression owners remain unrun.
#813 now retains boxed/native type expression identity through LSP and replay;
#985/#1058/#1059 retain existing ownership/cache fixes with strengthened controls.
#1733 now uses admitted immutable SQLite benchmark snapshots and validates smoke
output contents; larger workload profiles and repeated qualification remain open.
#1638 now namespaces repository/triage record sources through UID, metadata,
SQLite and deferred source reads, with explicit migration and byte authority.
#1675 now uses one global query resource plan and retirement-aware pools; whole
process-tree RSS measurement remains open, with known-worker samples labeled.


### #1470 Rust outer documentation and declaration-owned prefix metadata

`a7d8cc7e7` adds a Rust-specific combined declaration/prefix owner to the native
converter. It walks actual preceding comment/attribute siblings once, preserving
full source coverage while using the pinned grammar's outer/inner/doc fields to
qualify attached documentation. Module/implementation inner docs and ordinary
comments cannot become item doc facts; neighboring declarations stop ownership.
Line/block content and doc-before/after stacked/multiline attributes survive
Unicode and CRLF. Existing Python decorated and C++ template wrapper behavior is
retained. The shared converter's existing generic extraction remains for other
languages; a Rust empty doc result cannot fall back to borrowing prior text.

Version 1 attachedDocumentation records exact UTF-16 declaration/prefix,
comment/content and outer-attribute ranges/roles, with outer-prefix-syntax scope
and explicit not-requested attribute evaluation. The existing 300-character
preview stays bounded. Up to 512 metadata ranges are retained; overflow preserves
the full source envelope and preview, counts exact omissions and reports partial
syntax coverage. This does not evaluate conditional/computed doc attributes or
claim compiler binding or configuration inclusion. The registered Rust projector
carries the receipt through docmeta, assembled artifact rows and incremental
replay. No native handles escape into metadata or worker products.

Native declaration fields supply parameter source patterns, return annotation,
visibility and actual function modifiers. Doc/attribute strings, a generic Fn
constraint and unsafe callback types cannot manufacture function parameters or
modifiers. The human preview remains separate. Existing heuristic helpers remain
for their actual fallback callers. Prepared native metadata avoids the prior
whole-file line split and unnecessary header slicing; no latency improvement is
claimed without measurement. Native chunk version 12→13 and shared sourceChunking
29→30 prevent old metadata from qualifying the new meaning.

One authored real-native fixture covers query/traversal conversion, registered
Rust enrichment, payload assembly, warm native reuse, immutable incremental
read/write, precise roles/ranges, neighboring declarations, Unicode/CRLF,
line/block/ordinary/inner docs, stacked/multiline attributes, bodyless methods,
Fn constraints, parameter attributes, unsafe callback types and allowance
conservation. The original cross-language declaration-role fixture and Python
parenthesized-prefix fixture also join ordered ci-lite, now 1,282 cases. Their
existing assertions are preserved. Functional execution remains deferred.

Full format/ESLint passed; a later removal of unnecessary native Rust text work
received scoped ESLint and final syntax checks on all six changed JavaScript
files. Affected generated refresh/freshness, new fixture discovery and staged diff
checks passed. No bootstrap, compiler, native parser/test execution, model,
benchmark, WSL or platform campaign was run. The complete live GitHub intake
remains 770 reports, unchanged in number/content since the preceding refresh.
Bookkeeping changes do not alter the checked JS tree.
Current coverage: **35 fixed / 441 implemented / 148 partial / 146 pending**.
No issue was closed or new closing reference added.
Contract: docs/contracts/rust-attached-documentation.md.


### #740 native signature handoff and #1459/#1474 declarator controls

`7a81f3c84` repairs a remaining JavaScript metadata handoff: the doc projector
ignored a valid parsed chunk signature and rescanned the whole declaration with
a regex that could stop inside a quoted parameter. It now prefers the existing
source-qualified JavaScript declaration record, then the parsed chunk preview,
using the old fallback only when neither owner provides a nonblank signature.
The fallback's ordinary caller behavior remains. This avoids the redundant scan
on the parsed path without promoting signature metadata into flow evidence.
Shared sourceChunking advances 30→31 because retained signatures/field tokens
change meaning. The native body-boundary and bounded lexical extraction repair
is retained rather than replaced by a new independent parser.

The new real-native fixture runs query/traversal input routes for JS/TS/C/C++.
Independent source headers cover destructuring, quoted closing-parenthesis/
semicolon/brace/arrow punctuation, comments, multiline and nested object-return
syntax, plus the simple function control. It follows actual registered enrichment,
canonical payload/metaV2 assembly, enabled signature-field tokenization, the
retrieval metadata resolver and real map member construction. The last parameter
remains a positive field-token witness while implementation tokens remain absent
from that field. Bodyless C/C++ and template-wrapped functions retain complete
headers and source roles. No source/metadata content assertion is relaxed.

Existing C declarator/prototype owners already distinguish typed return names
from nested declarators and pointer bindings. New consumer controls retain
getCount/otherCount as separate function names with typedef returns, tagged
pointer returns, prototypes and a function-pointer parameter. They deny callable
rows named after return types, callback parameters, pointer variables and typedefs.
The original C/C++ parenthesized/returned-pointer/prototype fixture is retained
and added to ci-lite alongside the existing shared boundary fixture. Those two
issues receive implementation credit with native execution pending.

The new signature fixture and prior Rust documentation fixture now supply an
explicit source-bound native chunk-cache key and assert the existing cache-hit
metric. The earlier Rust warm assertion had only repeated equal output without
an admitted cache key. This is corrected in the authored fixture before runtime
validation; no cache-hit execution was claimed or fabricated. Cache persistence
is not enabled and no user cache is selected. The shared payload helper gains an
optional field-token selector whose default preserves all existing callers.

Full format/ESLint, syntax on five JS files, affected generated refresh/freshness,
new fixture discovery and staged diff checks passed. One new and two original
fixtures join ordered ci-lite, now 1,285 entries. Functional/front-gate, native
lifecycle, platform and performance execution remain deferred. Bookkeeping does
not change the checked JS tree. Current coverage: **35 fixed / 444 implemented /
145 partial / 146 pending** across 770 reports. No issue was closed or new closing
reference added. Contract: docs/contracts/native-signature-projection.md.

### #1488/#1497 parsed HTML and R dependency handoffs

`5b3f3cd5a` repairs the remaining parsed-value/scanner boundary. HTML now exposes
typed parse5-decoded entries to the registry. Its owned attribute observations
retain raw spelling and UTF-16 source offsets separately from decoded identity;
comments, raw script contents and unrelated attributes remain excluded. The
existing registered metadata handoff remains intact. Scoped receipts identify
the recovered-DOM attribute owner and installed parse5 version, which also joins
the import-scan runtime fingerprint. This does not certify HTML validity or
runtime dependencies. Invalid/control/overlength values still degrade admission.

The R argument collector already has bounded argument binding, string decoding,
named-option handling and lookalike/dynamic exclusions. Its adapter now marks
those decoded values as literals, retaining whitespace/punctuation/quote identity
through the outer registry. Collector finalization retains its original budget
diagnostics and an unqualified receipt; literal provenance never manufactures
full parser coverage or warm replay authority. Config and template adapters reuse
one evidence-preserving literal projection. The shared import producer advances
18→19 so old collapsed identities cannot qualify as current derived scans.

The new regression uses actual registry, prepared adapters, production scans and
canonical incremental bundle read/write. It retains distinct comma/semicolon/
parenthesis/quote/space identities, entity decoding, duplicate source occurrences,
raw attribute ranges, qualified HTML warm replay, required R refresh and legacy
cache rejection. The original R case table gains exact outer-registry assertions
and explicit original repro controls. Existing config/template/HTML-negative
fixtures remain intact; all five affected owners join ordered ci-lite, now
1,290 entries. No language statements, parser tests or functional assertions ran.

Full format/ESLint, nine JS syntax checks, affected generated refresh/freshness,
new fixture discovery and staged diff checks passed. Functional/front-gate,
native, performance and platform validation remains deferred as requested.
Bookkeeping changes retain the same checked JS tree. Current coverage is
**35 fixed / 446 implemented / 143 partial / 146 pending** across 770 reports.
No issue was closed or new closing reference added.
Contract: docs/contracts/parsed-import-identity.md.

### #1482 Ruby/PHP header exclusion and #1469 Python consumer ownership

`bc8e61bba` retains the existing native syntax-call owner and repairs Ruby's
lexical fallback. Dropping only the first line previously lost semicolon/endless
body calls and could scan multiline defaults as body code. The fallback now
prefers validated copied grammar body bounds; otherwise it finds an ordinary
balanced header boundary with a 65,536-character allowance. Quotes/comments,
multiline arguments, continuations, setters, singleton names, semicolon bodies
and simple endless methods stay within this narrow scope. Ambiguous regexp,
percent/heredoc or incomplete/over-budget headers remain partial rather than
being scanned as invocation code. Ruby default expressions keep their existing
native method-execution policy; the lexical fallback owns body evidence only.
Shared callFlow advances 48→49 for changed fallback meaning.

Native regression controls cover idle, recursion, command/no-parenthesis,
singleton/operator/endless methods and defaults. Actual PHP interface/abstract
and bodyful/recursive methods retain exact content through canonical call-site
projection and the existing brace-delimited fallback. Sibling Java/C#/Go/Perl/
Kotlin/Shell helpers remain unchanged. Existing overload, budget, split-window
and independent JavaScript-owner assertions are preserved.

The Python collector already uses interleaved lexical stacks and source-qualified
scope IDs for calls/flow. Its existing local-class regression now follows actual
registered relations, call indexing and public metadata for two local classes,
async methods, a class inside a method, ordinary nested functions and same-named
function redefinitions. Exact calls, reads and return totals stay distinct; the
original decorated-factory boundary checks remain. This reconciles #1469's
existing source repair without fabricating an execution result.

Full format/ESLint, six JS syntax checks, affected generated refresh/freshness,
new fixture discovery and staged diff checks passed. One new and three original
fixtures join ordered ci-lite, now 1,294. All functional/front-gate, CPython/native,
platform and performance execution remains deferred. Bookkeeping retains the
checked JS tree. Coverage: **35 fixed / 448 implemented / 141 partial / 146
pending**, all 770 reports retained, no issue closure or new closing reference.
Contracts: docs/contracts/native-call-owner-projection.md and
 docs/contracts/python-declaration-ownership.md.

### #1349 inline and daemon embedding lifetime reconciliation

`63f0cfade` qualifies the source ownership of the existing inline/daemon repair
with additional authored recording controls. Inline close is registered both
immediately during runtime initialization and in normal build teardown. It stops
admission, joins batcher/inference/observation work and returns only its own lease;
retained unresolved child failures and explicit reconciliation remain intact.
Daemon warm keys retain actual leases with bounded eviction/recycle/shutdown
retirement. These owners were already implemented; this batch preserves them.

The older prewarm-hook fixture discarded returned leases and selected an
unqualified external model path. It now explicitly selects deterministic stub
artifacts while still executing actual adapter lease/cache APIs and preserving
all original normalized-hook/skipped-preload assertions. It joins every lease,
asserts shared reuse/final disposal, and proves a failed prewarm preserves an
independent query lease. Inline tests add compatible sibling attempts and
factory acquisition failure without invented disposal. New daemon integration
passes actual prewarm leases through replacement and shutdown, then exercises
the still-live query before returning its final lease. Failed prewarm cannot
publish a warm key or leave a hidden cache drain. No forced GC is involved.

Full format/ESLint, three JS syntax checks, affected generated refresh/freshness,
new fixture discovery and staged diff checks passed. One new and seven original
cleanup/retirement/unwind fixtures join ci-lite, now 1,302 entries. No functional
assertions, real model/native inference, front gate or platform qualification ran.
Bookkeeping retains the checked JS tree. Coverage is **35 fixed / 449 implemented
/ 140 partial / 146 pending**; no issue closed or new closing reference added.
Contract: docs/contracts/embedding-attempt-lifetime.md.
