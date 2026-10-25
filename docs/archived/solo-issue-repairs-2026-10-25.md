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
