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
