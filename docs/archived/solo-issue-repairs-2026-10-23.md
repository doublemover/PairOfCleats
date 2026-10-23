# Solo issue repair receipt — 2026-10-23

Status: Active source implementation; runtime qualification deferred by user.
Branch: `codex/pr557-audit-repairs-20261012`; Windows; Node 26.12.1.
Baseline: `ed0b0c5420e16be9b4a0b4b19b0c06de53461523`.

The user resumed solo work, requested frontloaded implementation before runtime
tests, and authorized granular commits/pushes and PR overviews every 20 commits.
No workers were resumed. This document supplements the
[previous comprehensive receipt](github-issue-repairs-2026-10-21.md) and
[pause handoff](implementation-pause-2026-10-23.md); it does not replace their
revision-bound evidence. Latest qualified source remains
`d4dcba4134f6103e3a59703d90fdbde5ca54d09e`.

## Inventory and order

Read-only GitHub snapshot: 1,151 open reports, #147–#1722; title priorities
P0 0 / P1 58 / P2 574 / P3 105 / P4 0 / Perf 125 / other 289.
The previous snapshot had 970. Delta: 181, including 12 older/reopened issues.
The author-workspace raw snapshot at `.tmp/tasks/windows-post-wave-20261022/`
is historical, not promised in clean checkouts. The table below preserves the
portable identity/title inventory. It is an intake list, not proof of full review
or implementation. Read actual bodies before repair. Work order: P0–P4, Perf,
then other work, grouped by shared owner and prerequisites.

## Committed source checkpoints

| Reports | Commit | Repair and remaining proof |
| --- | --- | --- |
| #1679 | `1e7f8d25d` | Explicit scalar environment projection precedes receipt/fingerprint construction. Credentials, opaque options and unknown variables are omitted without reading their getters. Artifact/summary/report and secret-rotation controls authored, unrun. Historical local receipts are not sanitized or deleted. |
| #1582 | `2796364ad` | Domain/version/role/UTF-8-byte-length framing of exact code/doc inputs replaces ambiguous newline concatenation. LRU, prior reuse, file/global/reference cache producers and readers require chunk-input v2; old caches remain untouched. Delimiter collision, EOL, absent/empty and persistent reuse controls authored, unrun. Model identity and codec remain unchanged. |
| #1574; original storage observation | `3ec08cb83` | Actual CLI/MCP cleanup uses existing reader exclusion, bounded writer inventory and generated-file retention proof; never recursively removes a repos parent or unqualified backend root. Real-reader, late admission, saved evidence and successful disposable cleanup controls authored, unrun. Full index/backend category adapters are still incomplete; retained outcomes are explicit failures/partial cleanup rather than false success. |
| #1693; #1574 shared owner | `416cb4be9` | Lock-refused benchmark attempts cannot acquire cleanup ownership. Admitted cleanup reuses the same authority owner; workload and cleanup outcomes remain distinct, with both failures preserved. Existing dry-run control retained and actual lock-refusal finalizer regression authored, unrun. Parent reader drain/handoff remains a separate real-owner prerequisite. |

Only scoped `npm run format` and `git diff --check` ran for these batches.
No runtime/native/benchmark tests ran; no accepted closure, performance result,
full cleanup-category capability or deep-suite green is claimed.

## Additional source batches (runtime unqualified)

- #1554 (`cc967c5f8`): verified immutable TUI install generations and atomic
  selection; see the qualification limits below.
- #1579: the real processor's attempt guard now spans claim acquisition,
  estimation, provider completion, token-row release and cache publication.
  Every acquired claim settles on failure; successful earlier claims retain
  their vectors. Finalizers are identity-qualified/idempotent and cannot delete
  a replacement claim. Terminal persistence cannot warm a healthy memory hit;
  ordinary advisory writes and estimation fallback remain supported. Regressions
  use the exported production coalescer/cache, deferred provider, first/second-key
  failures, cancellation/release failure, replacement ownership and capacity
  bypass, without native inference. Authored controls are unrun; scoped format
  and whitespace checks passed.

- #1571/#1572: removed the process-global path-only offsets success set. Each
  actual streaming invocation validates its current contained pair; abort reaches
  validation and stream decoding. Empty offsets with nonempty JSONL now produce
  the established corruption error before validation scratch allocation. Existing
  bounded window/boundary logic and row-count authority stay intact. Tiny loader
  controls cover same-size/restored-mtime corruption, deletion/replacement,
  changed containment, cancellation, paired-empty cases and descriptor closure.
  Authored fixtures are unrun; only scoped format/whitespace checks passed.

- #1567: mixed bitmap/Set unions now force admission of small Set buckets once
  a bitmap owns part of the union; conversion refusal uses the complete Set
  fallback. Representation preferences cannot discard matching IDs. Independent
  injected-operation controls plus threshold 255/256/257 real-roaring filter and
  context-caller controls are authored, unrun. Native availability is an explicit
  prerequisite, never a silent successful return. Source inputs and null/empty
  meanings are retained. Scoped format and whitespace checks passed.

- #1570/#1576: shared relative adjustment uses division for negative similarities
  under positive factors; definition/export/exact/phrase bonuses cannot penalize
  those candidates. Raw ANN evidence is retained. Graph/model/federation producers
  reconcile selected score/type after actual normalization, preserving at most
  three named source-stage pairs and existing components. Local/federated result
  key versions advance to 8 without deleting user caches. Authored direct
  fusion/rank, CLI-default pipeline, composition and budget controls are unrun.
- #1583: provider and stored ANN catches share caller/deadline/independent-abort
  classification after original resource observation. Stored deadline receipts
  retain actual scored work, remain incomplete, and stop further admission.
  Controlled actual-scorer block-yield regressions compare internal/caller/both
  cancellation, successful exact work and provider health; all unrun. Only scoped
  formatting and whitespace checks ran for these source batches.

- #1577/#1578: Tantivy now declares and consumes eligible-id Boolean completion,
  retaining positive-before-zero scores and bounded top-k memory. Only complement
  queries enumerate the admitted domain, with cancellation/work accounting. Native
  open/query failures reach the existing sparse unavailable/fallback policy;
  method-shape preflight and malformed-response admission are explicit. Original
  API receivers and filtered positive overfetch are retained. Actual planner →
  pipeline controls compare authored NOT/OR-NOT/nested/filtered oracles with JS
  BM25, and cover native failure/empty/abort and explicit/policy ANN fallback.
  These are unrun; real optional Tantivy and SQLite parity qualification remain
  separate. The following #1595 source batch adds result-cache outcome admission;
  runtime proof of this composed path remains pending.

- #1595 / #1578 cache follow-through: canonical bounded per-mode execution
  receipts now span real pipeline → session → immutable cache metadata → lookup
  and diagnostics. Transient failure, relevant cooldown/preflight fallback,
  budget exhaustion and optional-stage fallback/pending work refuse ordinary
  reuse. Legacy/malformed/partial metadata is rejected before timestamp touches.
  Healthy completed/empty/equivalent fallback execution remains reusable; receipt
  completion does not certify ANN recall. Existing publication/locking owners are
  retained. The actual session regression uses the existing recording vector/FTS
  seams and deterministic stub embeddings, with recovery without generation/key
  changes, healthy repeats/empties, cancellation and warning assertions. Positive
  storage fixtures now explicitly declare canonical authored execution metadata;
  their original publication/identity/resource assertions are retained. No runtime
  tests ran; real backend/model qualification and resulting-tree checks remain open.

- #1574/#1693 follow-through (`e29127c0d`): benchmark path planning now uses the
  existing path-only resolver, without creating a lifetime reader before any
  artifact access. Actual artifact readers still retain admission. The tiny
  planning/real-reader contrast is authored, unrun. This does not claim parent
  resource drain or category deletion authority; those remain protected.
- #951 follow-through: the existing all-settled mode fanout now tracks failure
  presence independently of value, and retains independent sibling failures by
  mode rather than reason identity. Frozen causes use the existing compositor.
  Deferred sibling, falsey/frozen and identical-reason controls are authored,
  unrun. Earlier sibling-drain work remains credited; runtime/backend disposal
  qualification is not replaced by these source changes.

- #1629: document progress no longer returns from a finally block, preserving
  original failures for short, suppressed and due-progress batches. Admission
  stops at the first document failure/cancellation; all admitted siblings settle
  before session unwind. Independent worker/logger failures retain original
  causes through the existing failure compositor. Deferred sibling, progress
  boundary, logger and healthy concurrency controls are authored, unrun.

- #1621: JSON-RPC retirement retains its physical framing owner until actual
  queued writes settle. A failed partial frame permanently retires that wire;
  pre-frame encoding failures remain local and stale handles cannot retire a
  replacement. Per-write observations identify original framing admission and
  settlement without serializing a payload twice. Held-header reacquisition,
  independent exact bytes, damaged-wire and cyclic-input controls are authored,
  unrun. Existing writer listener and queued-close regressions remain intact.

- #1626/#1628: parsed LSP envelopes require JSON-RPC 2.0, exclusive own
  result/error properties and structured errors before success settlement.
  Typed ID correlation and valid falsey/empty results remain supported; invalid
  correlated responses fail once and uncorrelated diagnostics are capped at
  eight per generation. Request write rejection now owns exact entry/generation
  settlement, clears timers and preserves original resource/cause context.
  Proven pre-frame failures keep the healthy transport; partial writes retire it
  through the existing child cleanup owner without claiming child closure.
  Independent framed fake-child controls cover malformed envelopes, server
  requests, falsey results, local cyclic input, disabled/captured finite timers,
  partial body failure and response/write races. The actual document-symbol
  fail-open matrix adds a valid-JSON invalid-envelope case. All are unrun;
  existing malformed-JSON/stream/timeout controls remain intact.

- #1630: collection cancellation now reaches pooled creation, disposal and
  exclusive lease waits. A cancelled queue link resolves only after its actual
  predecessor; later work cannot overtake an active lease. Shared creation and
  disposal retain their own completion owners. Idle pooled options no longer
  retain lease-only handlers/signals. Fixed-size admission counters distinguish
  queue wait/cancellation from provider timeouts; the lease boundary rechecks
  cancellation before replacing handlers. Deferred A/B/C, owned creation and
  prior-disposal controls use the production pool with an intercepted client
  factory and are authored, unrun. Existing active-client cleanup is retained.

- #1631: the shared method limiter withdraws cancelled queued closures while
  preserving running slots and neighbor order. Every interactive producer uses
  one admission owner that rechecks signal/deadline/budget at the acquired slot;
  skips cannot enter guard/client work, timeout/success metrics or negative cache.
  Method requested counters now follow actual guard admission; bounded queue
  counters distinguish enqueued/started/cancelled work, and cache hits spend no
  request budget. Production document hover/signature consumers use deferred
  slots, controlled time, cancellation, exact budget and positive warm-cache
  controls; generic neighbor/listener/concurrency controls remain independent.
  All controls are authored, unrun. LSP meaning advances to lspBindings45/rq11
  for this protocol/admission batch, with current contract references updated;
  previous caches remain untouched. See the [request admission contract](../contracts/lsp-request-admission.md).

- #1718: repository retirement now references existing actual SQLite close
  owners, retains implicit eviction/generation errors and reports them through
  explicit clear/close. Bounded safe receipts distinguish active leases from
  failed close; late original-owner reconciliation is observed without native
  retries or handle adoption. API shutdown attempts independent artifact/repo/
  embedding cleanup and preserves both failures; MCP clear propagates the same
  outcome. Real manager/cache/LRU, falsey/frozen close, healthy peer, generation,
  implicit eviction, outstanding lease, original-owner and actual router controls
  are authored, unrun. Existing generation fixtures now supply inert synchronous
  close methods required by the already-implemented native-close contract and
  assert exactly three closes; generation assertions remain intact.

## Remaining integration and qualification

- #1554 now has a source repair: complete immutable generations, exact staged
  binary/target/runtime/supervisor admission, existing per-target locks and one
  durable atomic selecting manifest. Prior generations/shared logs/siblings stay
  retained. New schema 2 is written inside install-v1; legacy schema-1 fixed-path
  launch checks remain. Existing CLI integrity negatives are preserved, and new
  fault/interruption/concurrency controls are authored, all unrun. Synthetic
  headers qualify only format/architecture, not native execution or actual
  Windows sharing behavior. Real-wrapper/native replacement qualification and
  explicit retained-generation cleanup remain open. The old stale-sibling prune
  assertion described the destructive behavior and now asserts preservation.
- New P2/P3/Perf intake below and prior partial owners remain pending; source
  mappings in the prior receipt do not count as final-head acceptance.
- Reconcile generated MCP 1.10 schemas, snapshots, script/fixture inventories and
  ordered lanes after source integration, using the registry generators.
- Preserve original resource observations through remaining SQLite/native/storage
  cleanup paths, import dependency closure and publication/completion recovery.
- Runtime validation waits for the source phase, then locked setup/native
  verification, affected cases, complete front gate and frozen Windows cohorts.
  No retries, larger deadlines, hidden omissions or destructive cache invalidation.

## New and reopened intake

| Issue | Report | Intake disposition |
| --- | --- | --- |
| [#147](https://github.com/doublemover/PairOfCleats/issues/147) | Risk packs: attach impacted tests, callers, and symbols to each flow | Pending full-scope review |
| [#173](https://github.com/doublemover/PairOfCleats/issues/173) | Diagnostics: add operator-grade reports for risk coverage, queue health, and stale-job root causes | Pending full-scope review |
| [#229](https://github.com/doublemover/PairOfCleats/issues/229) | LSP enrichment: add multi-stage symbol resolution, provenance, and confidence calibration | Pending full-scope review |
| [#275](https://github.com/doublemover/PairOfCleats/issues/275) | Bench throughput: separate report rendering from JSON refresh/materialization and remove side effects from the default read path | Pending full-scope review |
| [#277](https://github.com/doublemover/PairOfCleats/issues/277) | Bench throughput: replace mean-heavy summaries with statistically correct distributions and workload-normalized regressions | Pending full-scope review |
| [#279](https://github.com/doublemover/PairOfCleats/issues/279) | Bench throughput: add machine-readable outputs, stable contracts, and real behavioral coverage for report correctness | Pending full-scope review |
| [#284](https://github.com/doublemover/PairOfCleats/issues/284) | SQLite modes: reconcile bundle row counts and harden sqlite build-mode correctness | Pending full-scope review |
| [#289](https://github.com/doublemover/PairOfCleats/issues/289) | Clangd: contain documentSymbol timeout storms and make weak compile-context fallback deterministic | Pending full-scope review |
| [#347](https://github.com/doublemover/PairOfCleats/issues/347) | Build-root ownership: introduce a canonical active-generation resolver for sqlite, validation, and reports | Pending full-scope review |
| [#356](https://github.com/doublemover/PairOfCleats/issues/356) | Bench verdict policy: add a production-clean gate distinct from permissive passed_with_degradation success | Pending full-scope review |
| [#371](https://github.com/doublemover/PairOfCleats/issues/371) | Suggest-tests fidelity: distinguish graph-backed suggestions from heuristic fallback and make weak coverage explicit | Pending full-scope review |
| [#385](https://github.com/doublemover/PairOfCleats/issues/385) | Benchmark blocker closure policy: require live canary outcome changes, not diagnostics-only improvements | Pending full-scope review |
| [#1554](https://github.com/doublemover/PairOfCleats/issues/1554) | [P1] Preserve the working TUI installation until replacement bytes and metadata are verified | Source repair authored; fault/native qualification pending |
| [#1555](https://github.com/doublemover/PairOfCleats/issues/1555) | Make locked checkout bootstrap a strict plan-owned transaction with targeted recovery | Pending full-scope review |
| [#1556](https://github.com/doublemover/PairOfCleats/issues/1556) | Provide a verified end-user runtime bundle separate from contributor checkout bootstrap | Pending full-scope review |
| [#1557](https://github.com/doublemover/PairOfCleats/issues/1557) | [Setup] Stream truthful bootstrap progress with bounded per-task diagnostic logs | Pending full-scope review |
| [#1558](https://github.com/doublemover/PairOfCleats/issues/1558) | [TUI] Distinguish failed first searches from empty results and offer safe recovery | Pending full-scope review |
| [#1559](https://github.com/doublemover/PairOfCleats/issues/1559) | Make selected provider install recipes satisfy managed storage admission on clean machines | Pending full-scope review |
| [#1560](https://github.com/doublemover/PairOfCleats/issues/1560) | Separate model asset acquisition from inference initialization with cancellable resumable setup | Pending full-scope review |
| [#1561](https://github.com/doublemover/PairOfCleats/issues/1561) | [P2] Charge context-expansion work budgets for rejected candidate scans | Pending full-scope review |
| [#1562](https://github.com/doublemover/PairOfCleats/issues/1562) | [P2] Parse DOCX structure by XML namespace and element boundaries, not literal w: regexes | Pending full-scope review |
| [#1563](https://github.com/doublemover/PairOfCleats/issues/1563) | [P2] Preserve per-page PDF text coverage instead of calling mixed-content extraction complete | Pending full-scope review |
| [#1564](https://github.com/doublemover/PairOfCleats/issues/1564) | [P2] Retain document extraction provenance through incremental bundle replay | Pending full-scope review |
| [#1565](https://github.com/doublemover/PairOfCleats/issues/1565) | [P2] Admit indexing source bytes through contained descriptor-bound snapshots | Pending full-scope review |
| [#1566](https://github.com/doublemover/PairOfCleats/issues/1566) | [P3] Preserve strict artifact failures in streaming context-pack seed resolution | Pending full-scope review |
| [#1567](https://github.com/doublemover/PairOfCleats/issues/1567) | [P2] Preserve small Set buckets when unioning bitmap filter candidates | Source repair authored; native/runtime proof pending |
| [#1568](https://github.com/doublemover/PairOfCleats/issues/1568) | [P2] Require coverage for every returned source before marking semantic queries complete | Pending full-scope review |
| [#1569](https://github.com/doublemover/PairOfCleats/issues/1569) | [P2] Scope parser degradation by canonical VFS identity, not path substrings | Pending full-scope review |
| [#1570](https://github.com/doublemover/PairOfCleats/issues/1570) | [P2] Prevent metadata and phrase boosts from penalizing negative ANN scores | Source repair authored; runtime proof pending |
| [#1571](https://github.com/doublemover/PairOfCleats/issues/1571) | [P2] Scope offsets validation reuse to verified artifacts instead of process-global path strings | Source repair authored; runtime proof pending |
| [#1572](https://github.com/doublemover/PairOfCleats/issues/1572) | [P2] Reject empty offsets sidecars for nonempty JSONL artifacts | Source repair authored; runtime proof pending |
| [#1573](https://github.com/doublemover/PairOfCleats/issues/1573) | [P2] Bind federated result-cache reuse to each repository's effective retrieval plan | Pending full-scope review |
| [#1574](https://github.com/doublemover/PairOfCleats/issues/1574) | [P1] Fence clean-artifacts deletion against live cache readers and builders | Source partial; category owners/drain pending |
| [#1575](https://github.com/doublemover/PairOfCleats/issues/1575) | [P2] Delay standalone atomic zstd publication until owned codec teardown settles | Pending full-scope review |
| [#1576](https://github.com/doublemover/PairOfCleats/issues/1576) | [P2] Reconcile final score explanations after graph, model, and federated ranking | Source repair authored; runtime proof pending |
| [#1577](https://github.com/doublemover/PairOfCleats/issues/1577) | [P2] Preserve Boolean complement queries in the Tantivy sparse route | Source repair authored; optional-native/parity proof pending |
| [#1578](https://github.com/doublemover/PairOfCleats/issues/1578) | [P2] Distinguish Tantivy native failures from successful empty search results | Source/provider/cache repair authored; runtime proof pending |
| [#1579](https://github.com/doublemover/PairOfCleats/issues/1579) | [P2] Settle embedding coalescer claims when post-inference cache publication fails | Source repair authored; runtime proof pending |
| [#1580](https://github.com/doublemover/PairOfCleats/issues/1580) | [P2] Enforce semantic SQLite byte admission before hydrating related payloads | Pending full-scope review |
| [#1581](https://github.com/doublemover/PairOfCleats/issues/1581) | [Perf] Bound semantic trace continuation bytes and avoid copying full history per page | Pending full-scope review |
| [#1582](https://github.com/doublemover/PairOfCleats/issues/1582) | [P1] Frame code and documentation separately in embedding chunk cache identities | Source repair committed; runtime proof pending |
| [#1583](https://github.com/doublemover/PairOfCleats/issues/1583) | [P2] Classify stored-ANN planner timeouts before generic abort propagation | Source repair authored; runtime proof pending |
| [#1584](https://github.com/doublemover/PairOfCleats/issues/1584) | [Perf] Admit ONNX inference before padding and bound shared-session queue bytes | Pending full-scope review |
| [#1585](https://github.com/doublemover/PairOfCleats/issues/1585) | [P3] Apply count-aware ANN deadlines to provider preflight and stop expired dispatch | Pending full-scope review |
| [#1586](https://github.com/doublemover/PairOfCleats/issues/1586) | [P2] Stop producer execution when its last confirmed queue lease expires | Pending full-scope review |
| [#1587](https://github.com/doublemover/PairOfCleats/issues/1587) | [P2] Bound live build-state coalescing age and measure durable lag from pending work | Pending full-scope review |
| [#1588](https://github.com/doublemover/PairOfCleats/issues/1588) | [P2] Preserve member provenance and completion when merging federated risk packs | Pending full-scope review |
| [#1589](https://github.com/doublemover/PairOfCleats/issues/1589) | [P2] Preserve watch backlog when source classification cannot observe a path | Pending full-scope review |
| [#1590](https://github.com/doublemover/PairOfCleats/issues/1590) | [Perf] Avoid full-partition count sweeps for every semantic SQLite relation page | Pending full-scope review |
| [#1591](https://github.com/doublemover/PairOfCleats/issues/1591) | [P2] Preserve in-process daemon cleanup ownership before normalizing job failure | Pending full-scope review |
| [#1592](https://github.com/doublemover/PairOfCleats/issues/1592) | [P2] Enforce or retire SQLite FTS time and batch controls instead of only reporting them | Pending full-scope review |
| [#1593](https://github.com/doublemover/PairOfCleats/issues/1593) | [Perf] Bind service progress reads once and bound retained-generation discovery | Pending full-scope review |
| [#1594](https://github.com/doublemover/PairOfCleats/issues/1594) | [Perf] Preserve dependency-qualified import reuse across unrelated file-set changes | Pending full-scope review |
| [#1595](https://github.com/doublemover/PairOfCleats/issues/1595) | [P2] Keep transient degraded search results out of indefinitely refreshed healthy caches | Source repair authored; session/cache recovery proof pending |
| [#1596](https://github.com/doublemover/PairOfCleats/issues/1596) | [Perf] Admit Stage2 source preparation before hydration and share verified snapshots | Pending full-scope review |
| [#1597](https://github.com/doublemover/PairOfCleats/issues/1597) | [Perf] Prepare semantic provider merge inventories once per immutable batch | Pending full-scope review |
| [#1598](https://github.com/doublemover/PairOfCleats/issues/1598) | [P2] Reject partial dictionary reads before caching lexical analyzer state | Pending full-scope review |
| [#1599](https://github.com/doublemover/PairOfCleats/issues/1599) | [P2] Bind warm dictionary reuse to verified content rather than size and mtime | Pending full-scope review |
| [#1600](https://github.com/doublemover/PairOfCleats/issues/1600) | [P2] Keep cached filter indexes coherent after shared chunk-author hydration | Pending full-scope review |
| [#1601](https://github.com/doublemover/PairOfCleats/issues/1601) | [P2] Preserve chunk-wide punctuation limits when reusing file-line tokens | Pending full-scope review |
| [#1602](https://github.com/doublemover/PairOfCleats/issues/1602) | [P2] Honor cancellation through token and field postings materialization | Pending full-scope review |
| [#1603](https://github.com/doublemover/PairOfCleats/issues/1603) | [Perf] Bound file-line token reuse to admitted demanded ranges | Pending full-scope review |
| [#1604](https://github.com/doublemover/PairOfCleats/issues/1604) | [Enhancement] Make prose stopword and stemming profiles explicit and language-qualified | Pending full-scope review |
| [#1605](https://github.com/doublemover/PairOfCleats/issues/1605) | [P2] Retry unavailable chunk-author hydration instead of caching it as terminal evidence | Pending full-scope review |
| [#1606](https://github.com/doublemover/PairOfCleats/issues/1606) | [P2] Qualify branch filters against their declared source instead of stale index metrics | Pending full-scope review |
| [#1607](https://github.com/doublemover/PairOfCleats/issues/1607) | [Perf] Keep language routing and prose chunking outside the eager code-parser module graph | Pending full-scope review |
| [#1608](https://github.com/doublemover/PairOfCleats/issues/1608) | [P2] Preserve conflicting snapshot aliases through GET search admission | Pending full-scope review |
| [#1609](https://github.com/doublemover/PairOfCleats/issues/1609) | [P2] Recheck lint interval ends when source-ordered chunks are nested | Pending full-scope review |
| [#1610](https://github.com/doublemover/PairOfCleats/issues/1610) | [P2] Bind risk enrichment reuse to the effective loaded rule bundle and regex policy | Pending full-scope review |
| [#1611](https://github.com/doublemover/PairOfCleats/issues/1611) | [P2] Do not silently replace a requested risk-rule file with defaults or an empty policy | Pending full-scope review |
| [#1612](https://github.com/doublemover/PairOfCleats/issues/1612) | [P2] Give lint enrichment a repository-qualified policy and explicit completion receipt | Pending full-scope review |
| [#1613](https://github.com/doublemover/PairOfCleats/issues/1613) | [P2] Reject truncated SCM file inventories before declaring discovery complete | Pending full-scope review |
| [#1614](https://github.com/doublemover/PairOfCleats/issues/1614) | [P2] Preserve typed MCP request IDs in legacy admission and cancellation | Pending full-scope review |
| [#1615](https://github.com/doublemover/PairOfCleats/issues/1615) | [Perf] Preserve bounded diagnostic headroom in the MCP SDK tool queue | Pending full-scope review |
| [#1616](https://github.com/doublemover/PairOfCleats/issues/1616) | [P2] Carry runtime comparison deadlines through claim writer admission and publication | Pending full-scope review |
| [#1617](https://github.com/doublemover/PairOfCleats/issues/1617) | [P2] Validate map artifact prefixes and retain exact EOF before omitting source inputs | Pending full-scope review |
| [#1618](https://github.com/doublemover/PairOfCleats/issues/1618) | [Perf] Make runtime family discovery progress without rescanning the full destination per page | Pending full-scope review |
| [#1619](https://github.com/doublemover/PairOfCleats/issues/1619) | [P2] Make the MCP test reader framing-specific and invariant to stream fragmentation | Pending full-scope review |
| [#1620](https://github.com/doublemover/PairOfCleats/issues/1620) | [P2] Bound and settle legacy MCP outbound responses under stdout backpressure | Pending full-scope review |
| [#1621](https://github.com/doublemover/PairOfCleats/issues/1621) | [P3] Fence JSON-RPC writer replacement until the prior frame settles | Source repair committed; runtime proof pending |
| [#1622](https://github.com/doublemover/PairOfCleats/issues/1622) | [P2] Separate runtime claim-page budgets from citation integrity failures | Pending full-scope review |
| [#1623](https://github.com/doublemover/PairOfCleats/issues/1623) | [P2] Bind semantic drain publication to its admitted cache and configuration authority | Pending full-scope review |
| [#1624](https://github.com/doublemover/PairOfCleats/issues/1624) | [Perf] Separate scheduler demand from I/O pressure and expire adaptive wait evidence | Pending full-scope review |
| [#1625](https://github.com/doublemover/PairOfCleats/issues/1625) | [Perf] Derive scheduler autotune from bounded workload evidence, not the drained final snapshot | Pending full-scope review |
| [#1626](https://github.com/doublemover/PairOfCleats/issues/1626) | [P2] Validate LSP response envelopes before settling requests as successful | Source repair committed; runtime proof pending |
| [#1627](https://github.com/doublemover/PairOfCleats/issues/1627) | [P2] Publish Tantivy as a source-pinned generation instead of rebuilding the served path in place | Pending full-scope review |
| [#1628](https://github.com/doublemover/PairOfCleats/issues/1628) | [P3] Settle LSP requests when their outbound write rejects before a response is possible | Source repair committed; runtime proof pending |
| [#1629](https://github.com/doublemover/PairOfCleats/issues/1629) | [P2] Preserve LSP document failures and join sibling work before releasing the session | Source repair committed; runtime proof pending |
| [#1630](https://github.com/doublemover/PairOfCleats/issues/1630) | [P2] Cancel queued LSP lease waiters without acquiring or killing the pooled session | Source repair committed; runtime proof pending |
| [#1631](https://github.com/doublemover/PairOfCleats/issues/1631) | [P2] Recheck LSP request eligibility when queued method work acquires a slot | Source repair committed; runtime proof pending |
| [#1632](https://github.com/doublemover/PairOfCleats/issues/1632) | [P2] Derive per-mode validation verdicts from all owned semantic failures | Pending full-scope review |
| [#1633](https://github.com/doublemover/PairOfCleats/issues/1633) | [P2] Admit directory-backed artifact families before recovery publication and completion | Pending full-scope review |
| [#1634](https://github.com/doublemover/PairOfCleats/issues/1634) | [Perf] Reuse verified runtime families before allocating duplicate publication staging | Pending full-scope review |
| [#1635](https://github.com/doublemover/PairOfCleats/issues/1635) | [P2] Make explicit records exclusions terminal before content sniffing | Pending full-scope review |
| [#1636](https://github.com/doublemover/PairOfCleats/issues/1636) | [P2] Preserve records inventory failures instead of publishing them as empty or partial input | Pending full-scope review |
| [#1637](https://github.com/doublemover/PairOfCleats/issues/1637) | [P2] Keep records source ranges and literal evidence bound to original decoded text | Pending full-scope review |
| [#1638](https://github.com/doublemover/PairOfCleats/issues/1638) | [P2] Namespace repository and triage record identities before merging their sources | Pending full-scope review |
| [#1639](https://github.com/doublemover/PairOfCleats/issues/1639) | [P2] Qualify runtime observation references by immutable family in multi-family results | Pending full-scope review |
| [#1640](https://github.com/doublemover/PairOfCleats/issues/1640) | [P2] Qualify runtime source coverage for each requested source rather than any source | Pending full-scope review |
| [#1641](https://github.com/doublemover/PairOfCleats/issues/1641) | [P2] Bind live evaluation metric cutoffs to the depth actually requested from retrieval | Pending full-scope review |
| [#1642](https://github.com/doublemover/PairOfCleats/issues/1642) | Validate VFS coordinate frames and fail strict document admission before slicing | Pending full-scope review |
| [#1643](https://github.com/doublemover/PairOfCleats/issues/1643) | Bind VFS disk-cache hits to verified content and the current document root | Pending full-scope review |
| [#1644](https://github.com/doublemover/PairOfCleats/issues/1644) | Enforce VFS cold-cache memory budgets during load and live admission, not only persistence | Pending full-scope review |
| [#1645](https://github.com/doublemover/PairOfCleats/issues/1645) | [P2] Reject fusion depth sweeps beyond the captured channel prefix without exhaustion evidence | Pending full-scope review |
| [#1646](https://github.com/doublemover/PairOfCleats/issues/1646) | Retire indexer workers after fatal out-of-task errors instead of only logging the crash | Pending full-scope review |
| [#1647](https://github.com/doublemover/PairOfCleats/issues/1647) | Bound worker diagnostic envelopes separately from task IPC and make observation failures non-authoritative | Pending full-scope review |
| [#1648](https://github.com/doublemover/PairOfCleats/issues/1648) | [P2] Normalize benchmark utilization by declared units instead of value magnitude | Pending full-scope review |
| [#1649](https://github.com/doublemover/PairOfCleats/issues/1649) | [P2] Keep failed benchmark subprocesses from being reclassified as allowed skips | Pending full-scope review |
| [#1650](https://github.com/doublemover/PairOfCleats/issues/1650) | Preserve JSX and TSX syntax ownership instead of reparsing markup-separated fragments as programs | Pending full-scope review |
| [#1651](https://github.com/doublemover/PairOfCleats/issues/1651) | [P2] Bind canary environment probes and reuse to the effective child runner context | Pending full-scope review |
| [#1652](https://github.com/doublemover/PairOfCleats/issues/1652) | Separate Markdown container extents from embedded parser content and source maps | Pending full-scope review |
| [#1653](https://github.com/doublemover/PairOfCleats/issues/1653) | Use language-owned comment ranges instead of the generic quote and marker scanner | Pending full-scope review |
| [#1654](https://github.com/doublemover/PairOfCleats/issues/1654) | Preserve the validated content and source pieces of comment-derived config fences | Pending full-scope review |
| [#1655](https://github.com/doublemover/PairOfCleats/issues/1655) | [P2] Require comparable completed workloads before A/B sweep recommendations | Pending full-scope review |
| [#1656](https://github.com/doublemover/PairOfCleats/issues/1656) | Gate comment config parsing by consumer demand and avoid unused token materialization | Pending full-scope review |
| [#1657](https://github.com/doublemover/PairOfCleats/issues/1657) | Stop classifying ordinary documentation words as license comments | Pending full-scope review |
| [#1658](https://github.com/doublemover/PairOfCleats/issues/1658) | [P2] Preserve observed execution and judgment identity in live evaluation reports | Pending full-scope review |
| [#1659](https://github.com/doublemover/PairOfCleats/issues/1659) | Reject normalized provider ID collisions before ordering and execution | Pending full-scope review |
| [#1660](https://github.com/doublemover/PairOfCleats/issues/1660) | [P2] Bind bakeoff child phases to the effective sampling and embedding plan | Pending full-scope review |
| [#1661](https://github.com/doublemover/PairOfCleats/issues/1661) | [P2] Keep bakeoff phase progress live and terminal statuses truthful | Pending full-scope review |
| [#1662](https://github.com/doublemover/PairOfCleats/issues/1662) | [P2] Preserve import extraction coverage through graph admission and incremental reuse | Pending full-scope review |
| [#1663](https://github.com/doublemover/PairOfCleats/issues/1663) | [P2] Give benchmark reports run-owned paths and atomic checkpoint publication | Pending full-scope review |
| [#1664](https://github.com/doublemover/PairOfCleats/issues/1664) | [Perf] Apply collector admission and aggregate traversal budgets to strict JSON imports | Pending full-scope review |
| [#1665](https://github.com/doublemover/PairOfCleats/issues/1665) | [P2] Bound live-canary output and settle failed attempt resources and reports | Pending full-scope review |
| [#1666](https://github.com/doublemover/PairOfCleats/issues/1666) | [P2] Distinguish unknown flow metadata from verified empty facts during enrichment | Pending full-scope review |
| [#1667](https://github.com/doublemover/PairOfCleats/issues/1667) | [P2] Keep literal and comment text out of managed semantic flow metadata | Pending full-scope review |
| [#1668](https://github.com/doublemover/PairOfCleats/issues/1668) | [P2] Admit the requested query set before model and parity runs | Pending full-scope review |
| [#1669](https://github.com/doublemover/PairOfCleats/issues/1669) | [P2] Reject missing retrieval cohorts before scoring or enforcing backend parity | Pending full-scope review |
| [#1670](https://github.com/doublemover/PairOfCleats/issues/1670) | [P2] Qualify reported score deltas by score space and paired measurement support | Pending full-scope review |
| [#1671](https://github.com/doublemover/PairOfCleats/issues/1671) | [P2] Preserve Boolean operator semantics in generated benchmark queries | Pending full-scope review |
| [#1672](https://github.com/doublemover/PairOfCleats/issues/1672) | [P2] Preserve authoritative TypeScript callable metadata instead of reparsing display signatures | Pending full-scope review |
| [#1673](https://github.com/doublemover/PairOfCleats/issues/1673) | [P2] Join JavaScript callable metadata and flow by declaration occurrence, not display name | Pending full-scope review |
| [#1674](https://github.com/doublemover/PairOfCleats/issues/1674) | [P2] Retain JavaScript declaration expressions under the correct evaluation owner | Pending full-scope review |
| [#1675](https://github.com/doublemover/PairOfCleats/issues/1675) | [P2] Admit all benchmark query pools against one aggregate resource plan | Pending full-scope review |
| [#1676](https://github.com/doublemover/PairOfCleats/issues/1676) | [P2] Preserve JavaScript generator kind and distinguish return statements from returned values | Pending full-scope review |
| [#1677](https://github.com/doublemover/PairOfCleats/issues/1677) | [P2] Qualify low-hit remediation by judged outcomes and actual latency evidence | Pending full-scope review |
| [#1678](https://github.com/doublemover/PairOfCleats/issues/1678) | [P2] Separate argument previews and missing operands from source arity and positional type/risk evidence | Pending full-scope review |
| [#1679](https://github.com/doublemover/PairOfCleats/issues/1679) | [P1] Exclude API credentials from benchmark environment artifacts | Source repair committed; runtime proof pending |
| [#1680](https://github.com/doublemover/PairOfCleats/issues/1680) | [P2] Bind reconstructed historical benchmark measurements to the recorded attempt | Pending full-scope review |
| [#1681](https://github.com/doublemover/PairOfCleats/issues/1681) | [P2] Preserve unknown and matched observation scope in scan-profile rates | Pending full-scope review |
| [#1682](https://github.com/doublemover/PairOfCleats/issues/1682) | [Perf] Backpressure native control-flow row construction before bounded analysis writes | Pending full-scope review |
| [#1683](https://github.com/doublemover/PairOfCleats/issues/1683) | [P2] Skip WASM flow construction when disabled or deferred and preserve structural projection | Pending full-scope review |
| [#1684](https://github.com/doublemover/PairOfCleats/issues/1684) | [P2] Decode retained WASM from the same bounded snapshot that source verification admits | Pending full-scope review |
| [#1685](https://github.com/doublemover/PairOfCleats/issues/1685) | [P2] Resolve fork file URLs before joining process-boundary source candidates | Pending full-scope review |
| [#1686](https://github.com/doublemover/PairOfCleats/issues/1686) | [P2] Share qualified worker transfer options instead of selecting overwritten properties | Pending full-scope review |
| [#1687](https://github.com/doublemover/PairOfCleats/issues/1687) | [P2] Qualify and bound throughput result-file admission before aggregation | Pending full-scope review |
| [#1688](https://github.com/doublemover/PairOfCleats/issues/1688) | [P2] Revoke ordered storage precision when fresh typed-array views escape through containers | Pending full-scope review |
| [#1689](https://github.com/doublemover/PairOfCleats/issues/1689) | [P2] Preserve repository and occurrence identity in benchmark diagnostic replay | Pending full-scope review |
| [#1690](https://github.com/doublemover/PairOfCleats/issues/1690) | [P2] Preserve original read ownership before projecting CPU-profile or native-authority fallbacks | Pending full-scope review |
| [#1691](https://github.com/doublemover/PairOfCleats/issues/1691) | [P2] Keep benchmark progress confidence unknown until observations support it | Pending full-scope review |
| [#1692](https://github.com/doublemover/PairOfCleats/issues/1692) | [Perf] Parse native include directives once per snapshot and deduplicate admitted probes | Pending full-scope review |
| [#1693](https://github.com/doublemover/PairOfCleats/issues/1693) | [P1] Do not delete a benchmark cache after refusing its live index lock | Source repair committed; runtime proof pending |
| [#1694](https://github.com/doublemover/PairOfCleats/issues/1694) | [Perf] Bound aggregate finite-heap versions before hashing or cloning and reuse admitted read identity | Pending full-scope review |
| [#1695](https://github.com/doublemover/PairOfCleats/issues/1695) | [P2] Preserve selected-mode hits and source receipts in triage evidence packs | Pending full-scope review |
| [#1696](https://github.com/doublemover/PairOfCleats/issues/1696) | [P2] Capture adjacency delta batches before cancellation effects so replay receipts identify applied work | Pending full-scope review |
| [#1697](https://github.com/doublemover/PairOfCleats/issues/1697) | [Perf] Prepare lexical rename models once and preflight overlays before repeated source reconstruction | Pending full-scope review |
| [#1698](https://github.com/doublemover/PairOfCleats/issues/1698) | [P2] Bind saved triage decisions to contained, identity-matching finding snapshots | Pending full-scope review |
| [#1699](https://github.com/doublemover/PairOfCleats/issues/1699) | [Enhancement] Distinguish exact triage decision lineage from related precedents | Pending full-scope review |
| [#1700](https://github.com/doublemover/PairOfCleats/issues/1700) | [P2] Honor the accepted test-suggestion wall-clock budget | Pending full-scope review |
| [#1701](https://github.com/doublemover/PairOfCleats/issues/1701) | [Perf] Enforce native bridge manifest byte admission before full canonical expansion | Pending full-scope review |
| [#1702](https://github.com/doublemover/PairOfCleats/issues/1702) | [P2] Align change-impact direction with caller and importer dependency semantics | Pending full-scope review |
| [#1703](https://github.com/doublemover/PairOfCleats/issues/1703) | [P2] Preserve actionable API-contract diagnostics in policy failures and human reports | Pending full-scope review |
| [#1704](https://github.com/doublemover/PairOfCleats/issues/1704) | [P2] Preserve exact Bazel label identity instead of resolving unrelated package fallback files | Pending full-scope review |
| [#1705](https://github.com/doublemover/PairOfCleats/issues/1705) | [P2] Reject non-launchable command candidates without shadowing later valid PATH entries | Pending full-scope review |
| [#1706](https://github.com/doublemover/PairOfCleats/issues/1706) | [P2] Reject skipped architecture rules before reporting a complete clean evaluation | Pending full-scope review |
| [#1707](https://github.com/doublemover/PairOfCleats/issues/1707) | [Enhancement] Preserve source and policy witnesses in actionable architecture reports | Pending full-scope review |
| [#1708](https://github.com/doublemover/PairOfCleats/issues/1708) | [Perf] Reuse architecture policy matches and avoid preparing capped adjacency tails | Pending full-scope review |
| [#1709](https://github.com/doublemover/PairOfCleats/issues/1709) | [P2] Qualify API parameter requirements instead of interpreting TypeScript type syntax as runtime arity | Pending full-scope review |
| [#1710](https://github.com/doublemover/PairOfCleats/issues/1710) | [Perf] Prepare embedded-cache parents once and reuse qualified child opens across relocation | Pending full-scope review |
| [#1711](https://github.com/doublemover/PairOfCleats/issues/1711) | [P2] Reconcile chunk-seeded import projection with graph-witness endpoint domains | Pending full-scope review |
| [#1712](https://github.com/doublemover/PairOfCleats/issues/1712) | [P2] Collect CSS imports from tokens instead of comment/string substrings and truncated URLs | Pending full-scope review |
| [#1713](https://github.com/doublemover/PairOfCleats/issues/1713) | [Perf] Share one prepared parse5 document between HTML chunking and metadata | Pending full-scope review |
| [#1714](https://github.com/doublemover/PairOfCleats/issues/1714) | [Perf] Amortize retained graph evidence verification within owned page enumerations | Pending full-scope review |
| [#1715](https://github.com/doublemover/PairOfCleats/issues/1715) | [P2] Separate XML schema namespace identifiers from schema-location dependencies | Pending full-scope review |
| [#1716](https://github.com/doublemover/PairOfCleats/issues/1716) | [P2] Own symbolic graph bytes before hydration callbacks and validated-entry caching | Pending full-scope review |
| [#1717](https://github.com/doublemover/PairOfCleats/issues/1717) | [P2] Project JS/TS literals safely instead of JSON-stringifying parser values into type evidence | Pending full-scope review |
| [#1718](https://github.com/doublemover/PairOfCleats/issues/1718) | [P2] Surface retained SQLite closure failures through repository cache shutdown | Source repair committed; runtime proof pending |
| [#1719](https://github.com/doublemover/PairOfCleats/issues/1719) | [P2] Project SQL usages by AST role without erasing decoded identifier identity | Pending full-scope review |
| [#1720](https://github.com/doublemover/PairOfCleats/issues/1720) | [P2] Reject or model SQL table column-alias lists before resolving catalog columns | Pending full-scope review |
| [#1721](https://github.com/doublemover/PairOfCleats/issues/1721) | [P2] Qualify RST and AsciiDoc headings before partitioning literal and nested content | Pending full-scope review |
| [#1722](https://github.com/doublemover/PairOfCleats/issues/1722) | [Enhancement] Add source-qualified RST and AsciiDoc reference navigation without expanding includes | Pending full-scope review |
