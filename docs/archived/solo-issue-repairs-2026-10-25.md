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
