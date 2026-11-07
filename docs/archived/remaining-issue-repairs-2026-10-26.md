# Remaining issue repairs — 2026-10-26

Source: `c4bec36c8f0c40e5a9b794ab5da4c555f135aba3`; branch `codex/pr557-audit-repairs-20261012`, PR #572.

The first source batch repairs and closes #586, #670, #811 and #1642. Live
reconciliation at `2026-10-27T01:42:41.126Z` confirms **739 open issues**:
477 implementation records awaiting qualification, 147 partial/follow-up owners
and 115 unresolved implementation records. The original unresolved category was
carried from pending tracking; it never proved that all source was absent.

## Delivered behavior

- MCP search admits its shared advertised value schema through a cached validator
  before repository/cache work. Invalid booleans, numbers, queries and list
  members return INVALID_REQUEST without dispatch. Valid false/zero/list forms
  and intentional HTTP aliases/output differences remain covered.
- Triage decisions await the owned asynchronous runner and forward request
  cancellation. All three maintenance handlers have live-dispatch deadline and
  child-settlement controls. Queued work stays behind held settlement in its
  actual execution lane; status responsiveness and successful JSON remain covered.
- Snapshot fresh/already-frozen and CLI JSON responses retain the actual persisted
  verification result and checked counts. An unchecked snapshot cannot become
  verified merely through an idempotent request with verification enabled.
- VFS admits safe UTF-16 half-open spans against the original source occurrence
  before coalescing, slicing and hashing. Strict errors have stable reasons and
  source/chunk context; explicit legacy relative frames rebase once. Bounded
  permissive omission receipts survive tooling preparation and no-provider exits.
  Manifest-only document descriptors retain their scope and persisted row format.
  VFS routing producer version is **4** to invalidate old derived meaning.

## Checks and repairs found during checking

**29 unique affected fixtures have passing final observations**, all one attempt,
zero retries/native-status redo, one job/thread and 30-second limits. Initial
boundary selection passed 11/11; two stronger VFS cases passed 2/2. The gate ran
39/40 and exposed an invalid shared fixture segment. Its intended full-file
extent is now explicit. The 13 dependent cases passed nine initially; four
custom overrides had the same omitted-extent defect and passed after correction.
Six additional VFS/Java/Swift policy cases passed. The final expanded maintenance
fixture passed cancellation and deadline/capacity cases for all three handlers.
No assertions, deadlines, retries, backend rules or budgets were relaxed.

The failed gate case passed in its affected-owner recheck. The other 39 gate cases
retain unchanged inputs/behavior and were not repeatedly rerun. Formatting/ESLint,
config/environment budgets, generated freshness, command/workflow contracts and
diff checks passed. The initial expanded deadline harness incorrectly compared
independent legacy lanes; its probe now uses the same existing lane policy, with
no production QoS change. Two selector previews rejected before any test ran;
individual documented selectors were used without weakening the regex guard.

[Structured check/issue receipt](remaining-issue-repairs-2026-10-26.json) retains
initial failures, exact fixture observations and current source identity. Raw
`.tmp/tasks/remaining-issue-repairs-20261026/` and `.testLogs/` receipts are
historical author-workspace evidence, not files promised in clean checkouts.

## Execution queue

[The complete owner-grouped queue](remaining-issue-batches-2026-10-26.json) retains
all 743 baseline entries, the four verified closures, and severity/owner slices.
Highest-severity source gaps lead; performance and research expansion follow their
correctness dependencies. Qualification is shared by owner after its source batch
is ready. The active roadmap remains the canonical execution/status summary.

## Prior roadmap summary retained for provenance

The following was migrated from the roadmap at `fa9993845`. It describes earlier
implementation records and remaining programs, not new acceptance at this source.

The solo batches repair publication/recovery and resource lifetime, immutable
source/record identities, language extraction and declaration/flow ownership,
provider replay, triage/MCP evidence and bounded operator tooling. Rust/native
signature and HTML/R/SQL/custom-DSL handoffs retain source and grammar authority;
Python/Ruby ownership retains independent call facts. Embedding leases, ANN request
budgets, strict context reads and native/storage failures retain terminal owners.

Benchmark comparisons now bind admitted source/backend/input identity, completed
work, paired content parity and fresh-process phase scopes. Text-vector writes
admit bounded page-capacity turnover; VFS materialization and cold-cache reuse
qualify current content/root, live byte/count/metadata bounds and flush revisions.
Map writers share atomic publication and report final-inclusive boundary samples
separately from process-lifetime RSS. JSONL framing scans each new fragment once
(#1739); HTML chunks/metadata share one source-owned parse5 tree and retain compact
source-qualified facts (#1713). Session/generation URI lifetime remains partial
(#1643). Native include authority now shares lexical summaries, preserves argv
root order and bounds snapshot-local context/probe work (#1692). SDK MCP now
reserves bounded read-only diagnostic admission while retaining running cleanup
leases and total capacity (#1615). Native bridge manifests now admit bounded
canonical bytes before expansion and hash the same owned representation (#1701).
Finite heap operations now admit aggregate bytes/candidate work and reuse privately
owned immutable identity/read projections across joins and pages (#1694).
Retained graph enumeration now owns one verified pair per shard, bounded decode
windows, physical-work receipts and CLI output/cleanup lifetime (#1714).
Native flow now streams bounded construction into the existing writer, aborts
incomplete derived output and retains independent staging/tree cleanup failures
(#1682; native producer version3).
Provider merges now prepare source/group inventories once, combine provider and
generic row checks, and fence changed host selections before committing (#1597).
Bound service progress now revalidates one attempt through bounded classified
reads; executor binding/shared startup discovery remain partial (#1593).
Provider catalogs now reject normalized identity collisions before ordering,
cache work or preflight, retaining stable explicit instances (#1659).
Fatal worker owners now retain exit/close settlement, fence late results and bound
restart storms; diagnostics have passive byte/queue admission and cannot change
task outcomes (#1646, #1647).
Comment classification now preserves ordinary prose, explicit notice/exclusion
receipts and custom matcher policy; paired raw extraction is policy-versioned
with fresh consumer tokenization (#1657; sourceChunking34).
The curated ci-lite lane contains 1,375 cases. Most new/strengthened regressions
remain unrun; the review records its 27 passing checks. Batch detail and static-
check receipts are in the linked implementation archive and complete inventory.

Execution remains solo, Windows-only and implementation-first. Finish remaining
P1/P2 source gaps before perf and lower-priority intake. Open shared owners include
custom-backend cleanup authority (#1574), source-pinned Tantivy publication
(#1627), remaining grammar/documentation and call-occurrence handoffs, benchmark
settled-run retention (#1663), representative SQLite workload profiles and
repeated trials (#1733), and whole-process-tree RSS measurement (#1675).
SQL lexical quote/scope/catalog qualification and broader semantic dataflow
remain explicit. Native/optional model and platform qualification are separate
from these source repairs. The live inventory remains authoritative for every
partial/pending report; earlier test greens are not final-head acceptance.

