# GitHub repair receipt — 2026-10-21

Starting source: `8685a0decb70fde42f32896f52825009c5970dda`. Branch:
`codex/pr557-audit-repairs-20261012`; integration PR [#572](https://github.com/doublemover/PairOfCleats/pull/572).

## Inventory and acceptance

The live open-issue inventory contains 957 issues, #584–#1540, including 873
new reports after #667. Title/body priority census: P0 0, P1 52, P2 448, P3 102,
P4 0, Perf 102, and unprioritized 253. There are no labels in this inventory.
Priority-marked performance reports remain in their priority cohort. Unprioritized
feature work is not silently elevated above reported correctness defects.

The [active roadmap](../roadmap.md) owns execution order. The
[previous issue receipt](github-issue-repairs-2026-10-20.md) retains the 77 earlier
implementation claims and their individual acceptance limits. Neither an issue
report nor a historical green run establishes acceptance for new source.

Windows-only execution and Node 26.12.1 remain in force. Do not launch WSL or
change machine security settings. No merge is authorized. Current source-only checkpoints are published before validation at explicit user direction; earlier qualified batches retain their separate checks.

## Batches

1. Snapshot/diff deletion authority, protected retention, non-destructive dry runs
   and trustworthy frozen bytes: #686, #688, #778, #806, #811, #819, #832, #835.
   Status: all eight implementations are repaired. Seventeen focused Windows cases and the complete front gate pass. The user removed physical-link creation from acceptance; replacement metadata-boundary and ordinary-filesystem cases pass without creating links.
2. Storage, embedding identity, queue lifetime and destructive-tool admission:
   #671, #782, #853, #872, #874, #889, #894, #896, #945, #961, #962, #982,
   #1039, #1040, #1060, #1064, #1091, #1092, #1104, #1108, #1114, #1341,
   #1357. Status: 23 implementations have focused proof and the complete front
   gate passes. Remaining P1 owners continue after this publication batch.
3. Immutable shard/checkpoint publication, bounded storage recovery, vector/cache
   lifetimes and the release contract gate: #673, #718, #833, #857, #858, #860,
   #870, #875, #890, #895, #897, #907, #908, #927, #934, #958, #960, #971,
   #1006, #1022, #1025, #1041, #1071, #1078, #1079, #1094, #1095, #1096,
   #1098, #1111, #1113, #1115, #1340. Status: 33 implementations have focused
   proof; the complete publication gate passes. Adjacent #782/#896/#1039 hardening
   is included without counting those issues a second time.
4. Remaining P2, then P3, then Perf, then unprioritized scope. Reconcile explicit
   dependencies before implementing overlapping requests.


### Batch 1 implementation and proof

Registry readers and writers now reject malformed keys, mismatched IDs and linked
registry entries before planning or mutation. Deletion targets are independently
rechecked as canonical direct children. GC validates before stale cleanup; dry
runs report planned staging while preserving bytes. Shared retention classification
protects pinned/tagged pointers and leaves forensic expiry to explicit GC. Freeze
keeps pinned protection unless a new tier is requested.

Frozen files use independent copies (filesystem copy-on-write is allowed),
including legacy hardlink requests and optional SQLite/LMDB files. Source walks
reject links/junctions/cycles and detect changed source identity. Verified regular
pieces without a declared checksum compare a captured source digest; malformed
or unsupported declared checksums fail. Unchecked freezes publish status skipped,
ok false and null counts, preserving the existing strict schema.

The first focused selection passed 14 cases and failed freeze promotion with
Windows EPERM. Inspection found SHA1/xxhash file helpers settled at stream end
before actual descriptor close. A controlled delayed real-close regression fails
on original source and passes after the shared hash owner waits for close on
success and error. Freeze now asserts no owned hash descriptor remains at
promotion; the real operation passes with delayed closure, without test retries.
No antivirus, native-crash or unrelated process attribution is claimed.

Five source-extracted regression controls fail against checkpoint 8685a0dec on
Node 26.12.1 (registry authority, dry-run staging, retention, regular-piece integrity
and directory-source authority). Two additional controls demonstrate mutable
hardlink bytes and false-green unchecked verification; a separate original hash
control proves early completion with a live descriptor. These isolate original
owners with unchanged dependencies/current fixture helpers; they are not a
full original-tree/native installation qualification. All fixtures are task-owned.
Original logs are preserved under ignored
`.tmp/tasks/github-issue-repairs-20261021/batch01-baseline/`.

Final affected selection: 17 passes, zero failures/timeouts/skips, one job/thread,
30-second individual deadlines, zero retries/native-status redo; slowest 18.4 s.
Seven new regressions retain ci-lite ordered membership. A capability probe before
the user changed scope returned EPERM; no further links are created. The user
removed physical-link creation as an acceptance prerequisite. The new source and
registry authority fixtures now use real ordinary-filesystem positive controls,
real sentinel/publication checks and injected link metadata. Their final three-case
selection (including the documentation contract) passes. Existing physical-link
assertions remain available for optional capability qualification; no such result
is represented as a physical-link pass. No security setting changes
or WSL execution occurred. The prior private optional copier and hardlink helper
were removed only after all local call sites moved to the tested shared copy owner;
existing directory-piece and checksum fault assertions remain.

The complete required front gate passes: formatting, config budget, environment,
generated-surface freshness, command surface, workflow contracts, all 40 gate
cases and diff checks. The final documentation/authority selection passes three
cases after replacing physical-link setup with injected metadata. These results
qualify this repair batch; they do not establish a new full deep-suite baseline.

### Batch 2 implementation and proof

File replacement no longer accepts an unrelated recent destination as evidence
that a missing temp was published. Concurrent success requires the captured
nonzero file identity. Oversized or invalid build-state/progress inputs fail
before overwrite. Failed detached patches rebase in the serialized persistence
owner before newer batches acknowledge success. Spill checkpoints bind ordered
input paths/content, comparator generation and output identity; reused merged
runs also require matching content hashes. Callers must supply a stable comparator
generation to reuse checkpoints, and change it when captured semantics change.

SQLite replacement checkpoints committed WAL bytes through SQLite before moving
the database and refuses busy coordination. Incremental cleanup leaves sidecars
to SQLite. MinHash compaction preserves validated sampling/hash metadata. Dense
updates distinguish unreadable artifacts from validated zero-row replacements,
including canonical sharded and binary metadata. New/recreated ANN tables backfill
unchanged base rows. LMDB clear and encoded replacement puts share one write
transaction; encoding failure rolls back the original authority.

Worker payload transfer clones mutable quantization buffers. Vector-extension
reuse rechecks current policy, registration and bytes, while negative attempts
remain repairable; the default nonloading verifier checks integrity. Embedding
mapping refuses cross-file numeric/structural guesses. Manifest refresh recovers
only valid prior authority and otherwise fails. Readiness follows manifest
publication, validation and its runtime receipt. Query embeddings check observed
provider/artifact identity after inference, preserving normalized provider aliases.
LanceDB evaluates every bounded candidate batch instead of truncating the allowed
set by global rank. Raw/compressed artifact outputs serialize a single-use iterator
once and wait for both bounded sinks before admitting either manifest entry.
This proves joint admission, not atomic visibility of two filesystem renames.

Fatal queue lanes stop new claims, cancel siblings and await execution, lifecycle
cleanup and finalization before reporting stopped. Already pending claims/setup
settle cancelled; secondary failures retain the original cause. The shutdown
monitor joins an outstanding refresh before its final stopped write. Archive
extraction exclusively creates its destination and preserves caller-owned existing
bytes on valid/malformed input refusal. Cleanup checks directory identity and
retains the original extraction error plus a recovery path on refusal. The only
caller that precreated its extraction directory now lets the helper own it;
Go/clangd callers already supplied fresh destinations. Forced piece assembly
resolves all inputs and rejects physical/lexical overlap before changing output,
including Windows case aliases and outputs nested inside input trees.

Focused proof includes the storage agent's five initial cases and nine second-batch
cases, the vector agent's eight P1 cases plus affected integration/alias checks,
and the lead's archive, real assembly CLI and four queue cases. All passing results
use 30-second deadlines, one job/thread, zero retries and no native-status redo.
The native LanceDB regression has 1,000 rows and 501 allowed candidates. SQLite
WAL controls retain committed transactions from an abruptly terminated task-owned
child. ANN backfill uses real SQLite with an explicit virtual-table SQL shim;
it does not qualify the optional sqlite-vec native extension. Fanout tests use real
gzip plus controlled slow/failing sinks, cancellation and finalization faults.
Expected query fallback/refusal diagnostics are captured and asserted.

Original-source controls fail for eight storage cases and representative vector
cases; their exact loader boundaries and transitive source copies are retained
under ignored `.tmp/tasks/github-issue-repairs-20261021/{storage-agent,vector-agent}/`.
The archive and destructive assembly controls fail against their unchanged
owners, and the original queue owner returns before sibling cancellation/cleanup.
One added late-setup fixture initially deadlocked its own finalization gate and
hit 30 seconds; its original timeout is retained. The gate was corrected to block
only initial sibling setup, and all five race variants now pass. This was a fixture
repair, not a production timeout increase or retry. A stricter dense-reader
integration failure exposed canonical sharded metadata selection; its owner was
fixed and both direct and existing manifest integration controls pass. These
receipts are historical author-workspace evidence, not clean-checkout assets.

The combined integration selection passed 29 cases and found one stale download
fixture that assumed artifact existence alone was sufficient for verification.
The fixture now supplies the explicit expected SHA256 of its known inert binary,
asserts approved-integrity verification and asserts native loading was not
attempted; its affected rerun passes. No runtime trust boundary was weakened.
The first complete front gate passes at 20092549f. Before publication, a delayed
real-close probe demonstrated that merge SHA256 rejection on hash.update could
return with an open descriptor. SHA256 now reuses the shared close-aware hash
owner; SHA1 uses the same asynchronous digest owner. Read, creation, update and
digest faults retain their initiating error and await descriptor close. The
three affected hash/merge/freeze cases pass. The complete final front gate passes
at source checkpoint `f05fb0d4e803a032153c119fd5490eb286b90572`: formatting,
config budget, environment, generated freshness, command/workflow contracts,
all 40 gate cases and diff checks. No retries, native-status redo or skips count
toward these results. The 30-case integration receipt retains its initial 29/1
outcome; the corrected download fixture and later hash changes have separate
affected receipts rather than being relabeled as an original 30/30 run.

At the batch 2 checkpoint, immediate storage follow-ups included refusing non-ENOENT fingerprint errors
and orphaned backup WAL before replacement. These adjacent recovery cases were
identified during final review and were not included in batch 2's oversized
state/ordinary committed-WAL acceptance. Batch 3 below now supplies their repair
and focused proof. Remaining owner spans continue in the same checkout.

No full
deep-suite, real-model, optional-backend or measured performance claim is made.

### Batch 3 implementation and proof

Compaction and token-postings writers stage immutable UUID generations and
generation metadata before the existing pieces-manifest commit. Old selected,
canonical and retained backup bytes survive metadata/manifest faults and actual
child interruption. Readers follow the selected generation rather than stale
canonical shards. Checkpoint sidecars use the same generation/index discipline;
failed index publication cannot mutate acknowledged cache state or delete old
reader slices. An explicitly empty committed index cannot resurrect legacy data.
Detached flush barriers include already captured work, and a concurrent finish
latches its required durable write. Active-root trimming is bounded by its
starting inventory instead of looping forever when all entries are active.

SQLite input validation precedes mutation: binary short reads loop to completion
or reject EOF, absent optional document IDs preserve typed rows, malformed bundle
shards fail closed, and incremental planning uses the same bound snapshot as
ingestion. ANN outages fall back to base rows and recover by backfilling existing
tables; ANN DDL and base-vector updates share rollback. Mode outputs cannot alias
one physical database, and completed runners remove owned exit listeners.
Follow-ups reject non-ENOENT fingerprint failures, checkpoint orphan backup WAL,
and check dense row/count/dimension consistency before opening the destination.

LanceDB query leases preserve active native handles through TTL, capacity and
explicit-clear retirement, coalesce simultaneous table opens and release each
handle once. Explicit empty candidates avoid backend admission. Late embedding
flight rejection cannot delete a replacement entry. Backend variant failures are
independent. Embedding batches reject nonfinite/wrong-width vectors, fp16 rounding
handles subnormal carry, and text-cache rows bind precision, encoding, exact length
and digest; legacy rows miss without deleting their database. Cache rotation reads
the actual locked shard size, mapping preserves exact filenames, and the standalone
embedding entry enforces bootstrap readiness.

Fixed-path LanceDB replacement builds and closes in staging, validates payload
presence/count, then promotes under the existing file lease with a recoverable
prior pair and internal journal. This is not a claim of atomic simultaneous file
and directory renames. Build/close/cleanup faults preserve the initiating error;
failed rollback keeps its journal-owned prior directory/metadata. Recovery does
not create a second untracked backup. Journal staging binds its publication ID
and contained no-link paths. Strict backend admission rejects regular files, empty
directories and missing/empty manifests or data fragments. This non-loading
inventory proves presence/type, not native decoding of arbitrary bytes. Real
HNSW replacement retains the fixed backup consumed by its production loader.

Streamed plain/gzip/zstd JSONL uses a stateful UTF-8 decoder while preserving raw
byte limits, malformed-byte policy and backpressure. Every multibyte split and
real compressed streaming controls pass. Stats verification rejects same-length
checksum corruption, malformed/unsupported declared digests and hash-read errors
with a failing exit. The release doc-contract owner reads canonical search options
and aliases: 105 source/documented flags, zero missing/extra flags. The actual
release **contracts phase only** passes; this does not qualify other release phases.

The 29-case integration receipt records 28 passes and one incorrect new L2 fixture
expectation (1 versus the existing negative-distance score, -0). Its corrected
affected rerun passes with lifecycle assertions unchanged. Three additional
native publication/admission cases pass, and the existing real HNSW/LanceDB/SQLite
generation integration passes. All use one job/thread, 30-second deadlines, zero
retries/native-status redo; there are no timeouts or skipped cases. Earlier new
fixture failures for canonical manifest metadata and one-shot fault injection are
retained separately. Original-owner loader controls at b84da1b92 fail on all three
new native cases: writing the published directory, accepting a regular payload
file, and failing to expose the retained fixed backup. Lead JSONL/checksum/doc-gate
controls also fail before their repairs; storage controls retain their own receipts.

Ignored author-workspace receipts are under
`.tmp/tasks/github-issue-repairs-20261021/`: `batch03-focused.json`,
`batch03-lancedb-query-final.json`, `batch03-native-publication-final.json`,
`batch03-native-generations.json`, `batch03-original-owner-controls.json`,
`jsonl-boundaries-{before,after}.json`, `stats-checksum-{before,after}.json`,
`doc-contract-{before,after}.json` and `release-contracts-report.json`.
The native publication receipt includes its earlier payload-fixture failure;
the corrected payload owner passes in native-generations. Results are not
combined into a fictitious final-tree full-suite run. Twenty-three new IDs retain
ordered ci-lite membership. No test or coverage assertion was removed.

Both agents develop independent owner spans directly in assigned real files;
the lead owns all shared formatting, integration, validation, Git and publication.
No peer coordination, commit-slot wait, worktree, elevation or physical link
creation is required. Follow-up implementations are not counted in this batch.

Final source checkpoint: `d4dcba4134f6103e3a59703d90fdbde5ca54d09e`.
The complete front gate passes: formatting, config budget, environment,
generated freshness, command surface, workflow contract, all 40 gate cases and
diff checks. The following documentation-only status commit does not change
production/test source. This qualifies the batch; full deep-suite and remaining
backlog acceptance are still open. There are 141 implementation claims across
the previous 77 and these 64 new repairs, each retaining its individual limits.

### Broad development pass — validation deferred by user

After the qualified d4dcba413 source checkpoint, the user requested implementation
across the backlog before further validation and exclusive editing of real files.
Completed drafts were applied to their actual owners before work continued.
No tests, syntax campaigns, formatter, native verification or front gate have run
since that correction. Development commits are publication/recovery checkpoints,
not passing evidence. The 141 previously documented implementations retain their
original acceptance boundaries; new edits do not expand those claims.

New source work includes bounded exact reads and descriptor disposal; strict
artifact/publication identity and source containment; exact cache/source/type/SCM
identities; source preamble/Unicode coverage; isolated logger destinations and
terminal crash evidence; mixed-mode SQLite root selection; watch post-commit
retention and contention replay; fail-closed current pointers; import invalidation
at exhausted check budgets; complete piece UID remapping and declared optional
artifact preservation; honest non-composable risk statistics; queue path authority
and retained logical retry identity; and finite workspace admission/scheduling.
Authored fixtures preserve ordinary-file positives, meaningful content/failure
assertions and original query inputs. They have not yet been executed.

The official VSIX packager and XML reader are now exact development dependencies
in package.json/package-lock.json. Only lockfile resolution ran, with scripts
suppressed; the changed dependency installation still needs locked bootstrap.
Editor archive format repairs do not claim official host installation acceptance.
Required host qualification and current-source Windows acceptance remain pending.

Further development checkpoints add request-pinned retrieval/filter/cache identity,
strict provider/disposal behavior, immutable verified ONNX closures, exact source
chunking/import/resource policies, semantic editor replay and captured explanation,
Sublime saved scope/completion ownership, TUI scalar-safe framing and structured
task state, shared rendered-row review panes, stable pagination selection and
map instance/source-result disposal. The matching actual Rust/Three/ONNX/HTTP
regressions are authored only. No latency or memory improvement is claimed from
source edits or operation-count reasoning.

The generic Python `env/` ignore rule also matched the tracked JavaScript source
owner `src/shared/env/`. That source directory now has an explicit exception;
development caches and Python environments remain ignored. No force-add or
permission escalation was used to publish source.

Development checkpoint `78ddb06a9` adds scheduler
hard admission, observed tokenization route/wall evidence, bounded extraction,
SCM generation/history ownership and fixture-root publication admission.
`0953a2abf` adds explicit build terminal outcomes, subprocess line forwarding,
profile/stat provenance, immutable managed Lua selection, scoped setup, inference
origins, upstream risk coverage and release report-role qualification. Source
amendments already in the next span remain uncommitted until their owner handoff.
`3f50f2260` generates USR report, envelope/alias and capability schemas from their
runtime contracts, with semantic-parity freshness ownership. Generation is a
source update; no freshness test was run. `55fdf91d7` checkpoints 47 further
storage/index P3 mappings, including structural callsite identity version 2,
prototype-safe records, composite/filename identities, bounded scheduler scans,
ordered callbacks, short reads and metadata authority. All these checkpoints
are unvalidated and do not expand the accepted repair count.

Detailed implementation/proof obligations are recorded in the historical
author-workspace handoffs under ignored
`.tmp/tasks/github-issue-repairs-20261021/`. These are bookkeeping receipts, not
clean-checkout artifacts or executable code drafts. Root integration, new fixture
lane membership, generated governance, affected checks and final qualification
remain outstanding. No issue is accepted solely because code was committed.

Development continued on 2026-10-22. `f7c2074e5` introduces extension/window-owned
operation scopes, bounded cancellation/disposal, latest-search fencing, correct
provider token signatures and source/policy-qualified inline publication. Indexed
file aggregates are labelled as summaries; dirty buffers are not precise Problems
findings. Missing authoritative index generation disables cross-request payload
reuse. HTTP/process helper failures and unconfirmed teardown remain explicit;
real editor-host/descendant closure is still a qualification obligation.
`f61e715a7` validates singleton postings and honors zero-byte record sniffing in
initial/watch classification. `c384b1232` retains volatile rejected settings drafts
and requires reload/revalidation after stale revisions, without reusing preview
authority. `7e7eb83c0` and `d06667671` repair map page/inspector/filter agreement,
admitted-row materialization, typed endpoint ownership, geometry retirement/reuse
and per-frame hover. `0aa1e8434` repairs the previously unmapped #780 by binding
service progress to an execution correlation shared with its actual executor.

`0f3cf2158` records 36 retrieval/graph/cache P3 mappings with authored regression
sources; #1116 reuses the existing lease repair with an additional delayed-connect
control. Likewise #946 maps to the existing copied-buffer owner with repeated-view
coverage. Bundle schema 3, query-plan schema 2 and callsite producer identity 2
invalidate prior meaning. Early performance checkpoints include `50cde5093`:
bounded binary/packed/JSON output, demand-driven workers, single-victim pressure
eviction, explicit-jobs hardware-probe avoidance and synchronous no-yield postings.
Later spans prepare immutable semantic rows once, reuse source/structural/compiler
inventories, propagate sealed checksums and bound capacity/vocabulary/queue work.
These are source/work-reduction claims only. No tests, syntax checks, formatter,
bootstrap, native probes, benchmarks or new performance measurements were run.

## Complete starting inventory

| Issue | Priority | Report | Repair disposition |
| --- | --- | --- | --- |
| [#584](https://github.com/doublemover/PairOfCleats/issues/584) | P1 | [P1] Keep legacy MCP capacity reserved until timed-out tool teardown settles | implemented previously; acceptance pending |
| [#585](https://github.com/doublemover/PairOfCleats/issues/585) | P2 | [P2] Recover dead cleanup owners before rejecting normal cache readers | implemented previously; acceptance pending |
| [#586](https://github.com/doublemover/PairOfCleats/issues/586) | P2 | [P2] Propagate MCP cancellation and deadlines through synchronous maintenance handlers | implemented previously; acceptance pending |
| [#587](https://github.com/doublemover/PairOfCleats/issues/587) | P2 | [P2] Allow filter-only federated searches through HTTP request validation | implemented previously; acceptance pending |
| [#588](https://github.com/doublemover/PairOfCleats/issues/588) | P2 | [P2] Reconcile restored paused TUI selection against the new session | implemented previously; acceptance pending |
| [#589](https://github.com/doublemover/PairOfCleats/issues/589) | P2 | [P2] Give artifact-page rows identities independent of their display name | implemented previously; acceptance pending |
| [#590](https://github.com/doublemover/PairOfCleats/issues/590) | P2 | [P2] Hydrate semantic query results using their envelope generation | implemented previously; acceptance pending |
| [#591](https://github.com/doublemover/PairOfCleats/issues/591) | other | Honor watch cancellation before publishing a validated generation | implemented previously; acceptance pending |
| [#592](https://github.com/doublemover/PairOfCleats/issues/592) | other | Parse LSIF item edges in their specified result-to-range direction | implemented previously; acceptance pending |
| [#593](https://github.com/doublemover/PairOfCleats/issues/593) | other | Separate GNU Global cxref source text from ingested filenames | implemented previously; acceptance pending |
| [#594](https://github.com/doublemover/PairOfCleats/issues/594) | other | Fail closed when CAS GC cannot read the full reachability inventory | implemented previously; acceptance pending |
| [#595](https://github.com/doublemover/PairOfCleats/issues/595) | other | Preserve Python signatures with comparison and shift defaults when finding the parameter-list end | existing provider adapters plus quote-aware outer parameter consumers de40c0b14; authored actual seven-route parser/document controls unvalidated; full grammar/server proof open |
| [#596](https://github.com/doublemover/PairOfCleats/issues/596) | other | Align TypeScript doctor compatibility with the compiler host API requirements | implemented previously; acceptance pending |
| [#597](https://github.com/doublemover/PairOfCleats/issues/597) | other | Align first-run prerequisites with mandatory Node 26.10 and native source builds | implemented previously; acceptance pending |
| [#598](https://github.com/doublemover/PairOfCleats/issues/598) | other | Give promoted release assets unique filenames instead of only unique display labels | implemented previously; acceptance pending |
| [#599](https://github.com/doublemover/PairOfCleats/issues/599) | other | Reconcile required pre-merge CI Long policy with tag/manual-only execution | implemented previously; acceptance pending |
| [#600](https://github.com/doublemover/PairOfCleats/issues/600) | other | Apply Boolean/literal eligibility before exhausting the SQLite FTS candidate window | implemented previously; acceptance pending |
| [#601](https://github.com/doublemover/PairOfCleats/issues/601) | other | Keep federated prose enumeration confined to the selected eligible mode | implemented previously; acceptance pending |
| [#602](https://github.com/doublemover/PairOfCleats/issues/602) | other | Expire or time-bind federated cache entries for relative modification filters | implemented previously; acceptance pending |
| [#603](https://github.com/doublemover/PairOfCleats/issues/603) | other | Delete semantic_discovery rows when removing a stale analysis partition | implemented previously; acceptance pending |
| [#604](https://github.com/doublemover/PairOfCleats/issues/604) | other | Preserve artifact projection identity and restore permitted metadata across owner privacy changes | implemented previously; acceptance pending |
| [#605](https://github.com/doublemover/PairOfCleats/issues/605) | P2 | [P2] Honor configured retries for background jobs with no per-job override | implemented previously; acceptance pending |
| [#606](https://github.com/doublemover/PairOfCleats/issues/606) | P1 | [P1] Dispose claimed-job resources when progress setup or state synchronization fails | implemented previously; acceptance pending |
| [#607](https://github.com/doublemover/PairOfCleats/issues/607) | P2 | [P2] Fence shared log/report cleanup against concurrent queue partitions | implemented previously; acceptance pending |
| [#608](https://github.com/doublemover/PairOfCleats/issues/608) | P2 | [P2] Enforce the configured running-job cap atomically at claim time | implemented previously; acceptance pending |
| [#609](https://github.com/doublemover/PairOfCleats/issues/609) | P2 | [P2] Keep repository-targeted MCP cache cleanup within its requested scope | implemented previously; acceptance pending |
| [#610](https://github.com/doublemover/PairOfCleats/issues/610) | P1 | [P1] Bundle the runtime config contract inside the Sublime package | implemented previously; acceptance pending |
| [#611](https://github.com/doublemover/PairOfCleats/issues/611) | P2 | [P2] Include the selected index root and generation in code-map cache identity | implemented previously; acceptance pending |
| [#612](https://github.com/doublemover/PairOfCleats/issues/612) | P2 | [P2] Send destination-bound authentication for Sublime API workflows | implemented previously; acceptance pending |
| [#613](https://github.com/doublemover/PairOfCleats/issues/613) | P2 | [P2] Keep cancellation and watch paths compatible with the advertised Sublime runtime | implemented previously; acceptance pending |
| [#614](https://github.com/doublemover/PairOfCleats/issues/614) | P2 | [P2] Launch checkout JS commands with a supported external Node runtime | implemented previously; acceptance pending |
| [#615](https://github.com/doublemover/PairOfCleats/issues/615) | other | Make the nightly soak selector select a real case before claiming extended qualification | implemented previously; acceptance pending |
| [#616](https://github.com/doublemover/PairOfCleats/issues/616) | other | Remove duplicate nightly execution paths for the same script-coverage fixtures | implemented previously; acceptance pending |
| [#617](https://github.com/doublemover/PairOfCleats/issues/617) | other | Validate resolved script-coverage targets instead of a regex that matches none of them | implemented previously; acceptance pending |
| [#618](https://github.com/doublemover/PairOfCleats/issues/618) | other | Restore explicit hosted coverage for API authorization and search contracts | implemented previously; acceptance pending |
| [#619](https://github.com/doublemover/PairOfCleats/issues/619) | P2 | [P2] Apply TUI viewport offsets and render the live log tail | implemented previously; acceptance pending |
| [#620](https://github.com/doublemover/PairOfCleats/issues/620) | P2 | [P2] Handle Ctrl+C distinctly from the ordinary cancel-job shortcut | implemented previously; acceptance pending |
| [#621](https://github.com/doublemover/PairOfCleats/issues/621) | P2 | [P2] Preserve an explicit empty graph selection in context packs | implemented previously; acceptance pending |
| [#622](https://github.com/doublemover/PairOfCleats/issues/622) | P2 | [P2] Reconcile semantic evidence metadata after response-budget omission | implemented previously; acceptance pending |
| [#623](https://github.com/doublemover/PairOfCleats/issues/623) | P2 | [P2] Enforce suggest-tests maxNodes before admitting seeds and neighbors | implemented previously; acceptance pending |
| [#624](https://github.com/doublemover/PairOfCleats/issues/624) | P2 | [P2] Preserve ordinary source and query payloads in SSE search results | implemented previously; acceptance pending |
| [#625](https://github.com/doublemover/PairOfCleats/issues/625) | P2 | [P2] Forward MCP index-build cancellation into the core build lifecycle | implemented previously; acceptance pending |
| [#626](https://github.com/doublemover/PairOfCleats/issues/626) | other | Scope LSP response-cache keys to the document, not just identical source bytes | implemented previously; acceptance pending |
| [#627](https://github.com/doublemover/PairOfCleats/issues/627) | other | Parse Rust lifetimes and tuple returns without corrupting signature metadata | existing Rust lifetime/tuple owner retained; shared generic arrows de40c0b14 and qualified roots b51df8499/typeNormalization4; authored actual consumers unvalidated |
| [#628](https://github.com/doublemover/PairOfCleats/issues/628) | other | Preserve grouped Go parameters and channel directions in LSP signatures | actual provider enclosure de40c0b14 plus Go quoted tag/generic header46d59d99f; lspBindings33/rq8 current; authored actual controls unvalidated, full Go/Swift/server proof open |
| [#629](https://github.com/doublemover/PairOfCleats/issues/629) | other | Do not publish retained old ANN artifacts as ready under a new embedding identity | implemented previously; acceptance pending |
| [#630](https://github.com/doublemover/PairOfCleats/issues/630) | other | Complete the declared Linux/macOS deep and native release-target qualification | pending |
| [#631](https://github.com/doublemover/PairOfCleats/issues/631) | other | Resolve remaining real optional-tool installation and post-install verification blockers | pending |
| [#632](https://github.com/doublemover/PairOfCleats/issues/632) | other | Establish representative retrieval, edit-to-search and retained-memory evidence | pending |
| [#633](https://github.com/doublemover/PairOfCleats/issues/633) | other | TUI missing functionality: select repositories and safely edit validated configuration | implemented previously; acceptance pending |
| [#634](https://github.com/doublemover/PairOfCleats/issues/634) | other | TUI missing functionality: run real searches and navigate ranked results/source | implemented previously; acceptance pending |
| [#635](https://github.com/doublemover/PairOfCleats/issues/635) | other | TUI missing functionality: configure and operate index and embedding workflows | implemented previously; acceptance pending |
| [#636](https://github.com/doublemover/PairOfCleats/issues/636) | other | TUI missing functionality: expose doctor and supported tooling/provider setup | partial source forms; operational provider qualification open |
| [#637](https://github.com/doublemover/PairOfCleats/issues/637) | other | TUI missing functionality: control owned services and preview maintenance actions | partial exact service/job controls plus canonical native storage locator b66a06e36; authored controls unvalidated; actual host qualification open |
| [#638](https://github.com/doublemover/PairOfCleats/issues/638) | other | TUI missing functionality: select jobs and inspect their results/artifacts | implemented previously; acceptance pending |
| [#639](https://github.com/doublemover/PairOfCleats/issues/639) | other | TUI missing functionality: open recorded sessions and explicitly distinguish passive/live attachment | partial replay source; native/platform qualification open |
| [#640](https://github.com/doublemover/PairOfCleats/issues/640) | other | TUI missing functionality: expose registered analysis/report workflows with command-surface parity | partial canonical catalog and explicit unsupported adapters 4a17a5e83; remaining workflows and native qualification open |
| [#641](https://github.com/doublemover/PairOfCleats/issues/641) | other | Hash the full admitted triage payload before using it as fallback record identity | implemented previously; acceptance pending |
| [#642](https://github.com/doublemover/PairOfCleats/issues/642) | other | Preserve a single generic triage record when it contains array-valued fields | implemented previously; acceptance pending |
| [#643](https://github.com/doublemover/PairOfCleats/issues/643) | P2 | [P2] Accept the risk truncation caps actually emitted by context-pack assembly | implemented previously; acceptance pending |
| [#644](https://github.com/doublemover/PairOfCleats/issues/644) | P2 | [P2] Make strict risk fail when either required stats or summaries are missing | implemented previously; acceptance pending |
| [#645](https://github.com/doublemover/PairOfCleats/issues/645) | P2 | [P2] Preserve directed graph edges and call-site evidence during incoming traversal | implemented previously; acceptance pending |
| [#646](https://github.com/doublemover/PairOfCleats/issues/646) | P2 | [P2] Read risk guidance from CSR adjacency instead of stripped metadata nodes | implemented previously; acceptance pending |
| [#647](https://github.com/doublemover/PairOfCleats/issues/647) | other | Honor the repository model when --model is omitted | implemented previously; acceptance pending |
| [#648](https://github.com/doublemover/PairOfCleats/issues/648) | other | Do not skip configured model setup because an unrelated cache entry exists | implemented previously; acceptance pending |
| [#649](https://github.com/doublemover/PairOfCleats/issues/649) | other | Keep interactive setup prompts off JSON stdout | implemented previously; acceptance pending |
| [#650](https://github.com/doublemover/PairOfCleats/issues/650) | other | Refetch missing dictionary bytes instead of accepting a stale 304 receipt | implemented previously; acceptance pending |
| [#651](https://github.com/doublemover/PairOfCleats/issues/651) | P2 | [P2] Honor service subprocess timeout and capture defaults when options are omitted | implemented previously; acceptance pending |
| [#652](https://github.com/doublemover/PairOfCleats/issues/652) | P1 | [P1] Fix the undeclared error projection in streaming search failure handling | implemented previously; acceptance pending |
| [#653](https://github.com/doublemover/PairOfCleats/issues/653) | P2 | [P2] Preserve unrelated defaults when normalizing partial service configuration | implemented previously; acceptance pending |
| [#654](https://github.com/doublemover/PairOfCleats/issues/654) | P1 | [P1] Preserve atomic target visibility during normal shared file replacement | implemented previously; acceptance pending |
| [#655](https://github.com/doublemover/PairOfCleats/issues/655) | P2 | [P2] Normalize accepted sync policies before selecting Git operations | implemented previously; acceptance pending |
| [#656](https://github.com/doublemover/PairOfCleats/issues/656) | other | Pass the Python AST, not relPath, into the language registry relation builder | implemented previously; acceptance pending |
| [#657](https://github.com/doublemover/PairOfCleats/issues/657) | other | Keep distinct virtual document origins when VFS hash routing is enabled | implemented previously; acceptance pending |
| [#658](https://github.com/doublemover/PairOfCleats/issues/658) | other | Translate Python AST UTF-8 columns before building JavaScript source ranges | sparse scalar checkpoint source c16c615f0 replaces per-byte column tables; independent geometry controls authored; native/memory/latency proof open |
| [#659](https://github.com/doublemover/PairOfCleats/issues/659) | other | Map Python positional-only defaults over the combined positional parameter list | implemented previously; acceptance pending |
| [#660](https://github.com/doublemover/PairOfCleats/issues/660) | other | Wire HTML metadata through registry relations and chunk enrichment | implemented previously; acceptance pending |
| [#661](https://github.com/doublemover/PairOfCleats/issues/661) | P2 | [P2] Do not report removed risk flows when an artifact failed to load | implemented previously; acceptance pending |
| [#662](https://github.com/doublemover/PairOfCleats/issues/662) | P2 | [P2] Replace correlated MinHash seed orderings that collapse similarity to a minimum-token match | implemented previously; acceptance pending |
| [#663](https://github.com/doublemover/PairOfCleats/issues/663) | P3 | [P3] Honor zero-valued relation boost weights and caps instead of restoring defaults | implemented previously; acceptance pending |
| [#664](https://github.com/doublemover/PairOfCleats/issues/664) | P2 | [P2] Correct rank correlation for partially overlapping retrieval hit lists | implemented previously; acceptance pending |
| [#665](https://github.com/doublemover/PairOfCleats/issues/665) | P2 | [P2] Keep failOnWarn independent of the API report warning-detail cap | implemented previously; acceptance pending |
| [#666](https://github.com/doublemover/PairOfCleats/issues/666) | P2 | [P2] Preserve TypeScript export identity for export-only API contract reports | implemented previously; acceptance pending |
| [#667](https://github.com/doublemover/PairOfCleats/issues/667) | P2 | [P2] Retry partial dense-vector binary writes before publishing artifacts | implemented previously; acceptance pending |
| [#668](https://github.com/doublemover/PairOfCleats/issues/668) | other | Reuse declared JSDoc parsers instead of regex-scanning JavaScript chunk text | pending |
| [#669](https://github.com/doublemover/PairOfCleats/issues/669) | P2 | [P2] Share effective filter facts so indexed prefilters cannot discard exact matches | development implemented; integration/validation deferred |
| [#670](https://github.com/doublemover/PairOfCleats/issues/670) | other | Share search request value schemas so MCP advertises supported filters and backends | pending |
| [#671](https://github.com/doublemover/PairOfCleats/issues/671) | P1 | [P1] Retain batch ownership until sibling queue workers settle after a failure | implemented; focused proof and front gate pass |
| [#672](https://github.com/doublemover/PairOfCleats/issues/672) | other | Remove the superseded native tree-sitter-lua dependency after the scoped-grammar cutover | pending |
| [#673](https://github.com/doublemover/PairOfCleats/issues/673) | P1 | [P1] Read canonical search options in the release doc-contract gate | implemented in batch 3; focused proof and front gate pass |
| [#674](https://github.com/doublemover/PairOfCleats/issues/674) | other | Reconcile active HTTP contracts with shipped envelopes, streaming errors and auth policy | pending |
| [#675](https://github.com/doublemover/PairOfCleats/issues/675) | other | Make ANN and sparse provider types describe cancellation and FTS eligibility contracts | pending |
| [#676](https://github.com/doublemover/PairOfCleats/issues/676) | P2 | [P2] Let core build orchestration own SQLite instead of rebuilding all modes in MCP | development implemented; integration/validation deferred |
| [#677](https://github.com/doublemover/PairOfCleats/issues/677) | other | Document and type subprocess termination evidence and retained cleanup ownership | current callable contract/JSDoc and consumer example 2a886e872; exact tracking authority fac945c93; unvalidated |
| [#678](https://github.com/doublemover/PairOfCleats/issues/678) | P2 | [P2] Preserve Unicode scalar boundaries in TUI protocol chunks | development implemented; validation deferred |
| [#679](https://github.com/doublemover/PairOfCleats/issues/679) | P2 | [P2] Share an early HTTP request lifetime across semantic and runtime routes | development implemented; integration/validation deferred |
| [#680](https://github.com/doublemover/PairOfCleats/issues/680) | P2 | [P2] Allocate complete piece-assembly UID remaps before rewriting forward relations | development implemented; validation deferred |
| [#681](https://github.com/doublemover/PairOfCleats/issues/681) | other | Remove four unconsumed dependency roots and orphan SWC/ripgrep install permissions | pending |
| [#682](https://github.com/doublemover/PairOfCleats/issues/682) | P2 | [P2] Share lexical signature/body boundaries so fallback chunks survive nested punctuation | actual TS/native JS comment-boundary consumers 4952fc1c6, sourceChunking10/callFlow22; authored grammar/default/line-budget controls unvalidated; general lexical completeness open |
| [#683](https://github.com/doublemover/PairOfCleats/issues/683) | other | Reject missing benchmark evidence in the rollout gate instead of reporting healthy zero deltas | source repair and regression authored; canonical verdict/input identity c804b6d04 rejects malformed/missing/inconsistent comparison evidence and keeps unknown timing deltas null; original assertions retained with corrected impossible fixture totals; authored actual producer/direct/CLI controls unvalidated |
| [#684](https://github.com/doublemover/PairOfCleats/issues/684) | P2 | [P2] Preserve symbol identity when context seed envelopes also carry a path | development implemented; integration/validation deferred |
| [#685](https://github.com/doublemover/PairOfCleats/issues/685) | P2 | [P2] Calibrate ANN scores by metric before dense/hybrid blending | development implemented; integration/validation deferred |
| [#686](https://github.com/doublemover/PairOfCleats/issues/686) | P1 | [P1] Honor pinned retention in create-time and explicit pointer snapshot pruning | fixed; focused Windows checks and front gate pass |
| [#687](https://github.com/doublemover/PairOfCleats/issues/687) | P2 | [P2] Preserve filter-search continuation in the workspace viewer projection | development implemented; integration/validation deferred |
| [#688](https://github.com/doublemover/PairOfCleats/issues/688) | P2 | [P2] Keep snapshot GC dry runs from deleting stale staging directories | fixed; focused Windows checks and front gate pass |
| [#689](https://github.com/doublemover/PairOfCleats/issues/689) | P2 | [P2] Preserve omitted thresholds and missing measurements in benchmark guardrails | development implemented; integration/validation deferred |
| [#690](https://github.com/doublemover/PairOfCleats/issues/690) | P1 | [P1] Protect the published watch generation from failed-attempt retention cleanup | development implemented; validation deferred |
| [#691](https://github.com/doublemover/PairOfCleats/issues/691) | P2 | [P2] Reject simulated and wrong-scope release reports at the readiness gate | development implemented; integration/validation deferred |
| [#692](https://github.com/doublemover/PairOfCleats/issues/692) | P2 | [P2] Prevent overlapping eval judgments from counting one retrieval hit multiple times | development implemented; integration/validation deferred |
| [#693](https://github.com/doublemover/PairOfCleats/issues/693) | P2 | [P2] Encode VS Code modified-since filters as integers for HTTP searches | development implemented; validation deferred |
| [#694](https://github.com/doublemover/PairOfCleats/issues/694) | P2 | [P2] Generate USR report schemas from runtime contracts and verify semantic parity | development implemented; integration/validation deferred |
| [#695](https://github.com/doublemover/PairOfCleats/issues/695) | P2 | [P2] Fence ranked federated results to the manifest generation used for cohort admission | development implemented; integration/validation deferred |
| [#696](https://github.com/doublemover/PairOfCleats/issues/696) | P2 | [P2] Preserve missing embedding channels instead of normalizing quantized zero sentinels into ANN matches | development implemented; integration/validation deferred |
| [#697](https://github.com/doublemover/PairOfCleats/issues/697) | P2 | [P2] Reschedule retained watch changes after index-lock backoff expires | development implemented; validation deferred |
| [#698](https://github.com/doublemover/PairOfCleats/issues/698) | P2 | [P2] Keep index help requests from dispatching the default index build | development implemented; integration/validation deferred |
| [#699](https://github.com/doublemover/PairOfCleats/issues/699) | P2 | [P2] Resolve workspace indexes from each mode's retained build root | development implemented; integration/validation deferred |
| [#700](https://github.com/doublemover/PairOfCleats/issues/700) | P2 | [P2] Respect end-of-options in search help and argument preflight scanners | development implemented; integration/validation deferred |
| [#701](https://github.com/doublemover/PairOfCleats/issues/701) | P2 | [P2] Forward the configured MCP input buffer limit into the SDK stdio transport | development implemented; integration/validation deferred |
| [#702](https://github.com/doublemover/PairOfCleats/issues/702) | P2 | [P2] Preserve the selected search hit when continuation inserts earlier-mode results | development implemented; VSCode/Sublime continuation progress893a0ce67/fda82b27d rejects cursor cycles/no-new-identities/total contradictions and retains original selected view; actual registered/serialized-project controls authored unvalidated |
| [#703](https://github.com/doublemover/PairOfCleats/issues/703) | P3 | [P3] Fill hydrated context-index ID lookups without rebuilding discarded name and file maps | development implemented; integration/validation deferred |
| [#704](https://github.com/doublemover/PairOfCleats/issues/704) | P2 | [P2] Bind exported story source to the exact successful compile input | development implemented; validation deferred |
| [#705](https://github.com/doublemover/PairOfCleats/issues/705) | P2 | [P2] Dispose instanced mesh resources when rebuilding the map scene | exact renderer generations and partial returned construction resources7e378d245; original shadow/listener/canvas owners retained; authored controls unvalidated, actual browser/GPU/retry acceptance open; returned normal-texture ownership and late callback fencing203b55251 authored unvalidated; original diagnostic/descriptor/ownership snapshots364b9ac4b preserve independent inspection failures through actual construction/resource/fallback; authored inert controls unvalidated; generic native-retry prerequisites remain separately open |
| [#706](https://github.com/doublemover/PairOfCleats/issues/706) | P3 | [P3] Avoid retaining duplicate string adjacency when graph assembly already has admitted CSR | development implemented; integration/validation deferred |
| [#707](https://github.com/doublemover/PairOfCleats/issues/707) | P2 | [P2] Share width-aware viewports for TUI settings and workflow review screens | development implemented; validation deferred |
| [#708](https://github.com/doublemover/PairOfCleats/issues/708) | P2 | [P2] Resolve VS Code diagnostics through the configured CLI, not scripts inside the target repository | development implemented; validation deferred |
| [#709](https://github.com/doublemover/PairOfCleats/issues/709) | P2 | [P2] Encode the root completion key before emitting Bash associative-array assignments | development implemented; integration/validation deferred |
| [#710](https://github.com/doublemover/PairOfCleats/issues/710) | P2 | [P2] Preserve empty numeric environment overrides instead of disabling MCP resource bounds | development implemented; integration/validation deferred |
| [#711](https://github.com/doublemover/PairOfCleats/issues/711) | P3 | [P3] Reuse generation-scoped graph node indexes across graph-reranking queries | development implemented; integration/validation deferred |
| [#712](https://github.com/doublemover/PairOfCleats/issues/712) | P2 | [P2] Preserve ambiguity instead of positionally pairing duplicate logical chunk keys in index diffs | development implemented; integration/validation deferred |
| [#713](https://github.com/doublemover/PairOfCleats/issues/713) | P2 | [P2] Compare model hits by stable corpus identity instead of generation-local document ordinals | development implemented; integration/validation deferred |
| [#714](https://github.com/doublemover/PairOfCleats/issues/714) | P3 | [P3] Keep invalid settings drafts editable after canonical validation rejects them | development implemented; integration/validation deferred |
| [#715](https://github.com/doublemover/PairOfCleats/issues/715) | P2 | [P2] Separate guided setup dependency installation from the indexed repository | development implemented; integration/validation deferred |
| [#716](https://github.com/doublemover/PairOfCleats/issues/716) | P3 | [P3] Distinguish file identity from member identity in map selection edge summaries | development implemented; integration/validation deferred |
| [#717](https://github.com/doublemover/PairOfCleats/issues/717) | P3 | [P3] Keep workspace relationship filters usable beyond the first projection page | development implemented; integration/validation deferred |
| [#718](https://github.com/doublemover/PairOfCleats/issues/718) | P1 | [P1] Preserve UTF-8 across streamed JSONL artifact chunk boundaries | implemented in batch 3; focused proof and front gate pass |
| [#719](https://github.com/doublemover/PairOfCleats/issues/719) | P3 | [P3] Reconcile the retained selection inspector when rebuilding a workspace page | development implemented; integration/validation deferred |
| [#720](https://github.com/doublemover/PairOfCleats/issues/720) | P3 | [P3] Avoid rebuilding the full extracted-comment join map for every search request | development implemented; integration/validation deferred |
| [#721](https://github.com/doublemover/PairOfCleats/issues/721) | P2 | [P2] Share the qualified embedding model profile with prefetch and setup readiness | actual local-reranker tensor/pipeline ownership and original native-work/session prerequisites60d6f49b0; authored inert controls unvalidated; real model/resource/quality qualification open; original diagnostic/consumer failure observations af8e871f1/7275e6658 remain pending before fallback |
| [#722](https://github.com/doublemover/PairOfCleats/issues/722) | P2 | [P2] Classify TUI job and task states from structured status, not display text | development implemented; validation deferred |
| [#723](https://github.com/doublemover/PairOfCleats/issues/723) | P2 | [P2] Reconcile VS Code require-mode admission across operator and search workflows | development implemented; validation deferred |
| [#724](https://github.com/doublemover/PairOfCleats/issues/724) | P2 | [P2] Reconcile unfinished TUI tasks when their owning job terminates | development implemented; validation deferred |
| [#725](https://github.com/doublemover/PairOfCleats/issues/725) | P2 | [P2] Verify same-size source edits with preserved fine-grained mtimes before incremental reuse | development implemented; validation deferred |
| [#726](https://github.com/doublemover/PairOfCleats/issues/726) | other | [Enhancement] Reuse SCM change sets for impact and test-suggestion workflows | pending |
| [#727](https://github.com/doublemover/PairOfCleats/issues/727) | P3 | [P3] Merge federated top-N from ranked heads instead of cloning and sorting every candidate | development implemented; integration/validation deferred |
| [#728](https://github.com/doublemover/PairOfCleats/issues/728) | P3 | [P3] Materialize only admitted workspace search rows and reuse accepted projection work | development implemented; integration/validation deferred |
| [#729](https://github.com/doublemover/PairOfCleats/issues/729) | P3 | [P3] Keep unchanged stack pipe geometry across selection and visibility updates | original geometry source repair; expanded renderer integration open |
| [#730](https://github.com/doublemover/PairOfCleats/issues/730) | P3 | [P3] Avoid repeatedly serializing unchanged oversized context packs during response budgeting | development implemented; integration/validation deferred |
| [#731](https://github.com/doublemover/PairOfCleats/issues/731) | P2 | [P2] Let explicit test-discovery patterns admit non-JavaScript test files | development implemented; integration/validation deferred |
| [#732](https://github.com/doublemover/PairOfCleats/issues/732) | P2 | [P2] Close compressed JSONL source streams when artifact iteration stops early | development implemented; validation deferred |
| [#733](https://github.com/doublemover/PairOfCleats/issues/733) | other | [Enhancement] Replace TUI full-model JSON frame signatures with revision-based invalidation | source repair and regression authored; unvalidated |
| [#734](https://github.com/doublemover/PairOfCleats/issues/734) | other | [Enhancement] Batch stack bases and member shapes across bounded spatial cells | existing bounded source/reveal owners plus committed failure-state and stale source callback fences ac9091018; authored controls unvalidated; full viewer/transport qualification open |
| [#735](https://github.com/doublemover/PairOfCleats/issues/735) | other | [Enhancement] Find and navigate entities across the loaded workspace response | source authored; unvalidated |
| [#736](https://github.com/doublemover/PairOfCleats/issues/736) | other | [Enhancement] Format only visible TUI job and task rows and reuse filtered identities | source repair and regression authored; unvalidated |
| [#737](https://github.com/doublemover/PairOfCleats/issues/737) | other | [Enhancement] Cache immutable TUI preview text and materialize only visible detail lines | source repair and regression authored; unvalidated |
| [#738](https://github.com/doublemover/PairOfCleats/issues/738) | other | [Enhancement] Preserve structured search diagnostics in editor and TUI results | source authored; unvalidated |
| [#739](https://github.com/doublemover/PairOfCleats/issues/739) | other | [Enhancement] Bound TUI log-wrap materialization and reuse width-keyed layouts | source repair and regression authored; unvalidated |
| [#740](https://github.com/doublemover/PairOfCleats/issues/740) | P2 | [P2] Derive native Tree-sitter signature previews past nested parameter punctuation | actual native JS/JSX/TS/TSX signature policy wired 4952fc1c6, local chunk7/sourceChunking10; authored helpers unvalidated, real parser/worker acceptance open |
| [#741](https://github.com/doublemover/PairOfCleats/issues/741) | P3 | [P3] Build AST token membership sets lazily instead of allocating them for phrase-only eligibility | development implemented; integration/validation deferred |
| [#742](https://github.com/doublemover/PairOfCleats/issues/742) | P3 | [P3] Coalesce stack-view hover picking to the latest pointer per frame | coalescing source repair; spatial/modern picking scope open |
| [#743](https://github.com/doublemover/PairOfCleats/issues/743) | other | [Enhancement] Give the TUI event drain an explicit fairness budget before input and rendering | source repair and regression authored; unvalidated |
| [#744](https://github.com/doublemover/PairOfCleats/issues/744) | P3 | [P3] Reconcile the documented core status overload and type its includeAll contract | development implemented; integration/validation deferred |
| [#745](https://github.com/doublemover/PairOfCleats/issues/745) | P3 | [P3] Bound retained stability-history payloads before selecting the newest runs | development implemented; integration/validation deferred |
| [#746](https://github.com/doublemover/PairOfCleats/issues/746) | P2 | [P2] Make VS Code Explain Search display the returned ranking explanation | development implemented; validation deferred |
| [#747](https://github.com/doublemover/PairOfCleats/issues/747) | P3 | [P3] Defer test-report schema compilation for metadata-only runner commands | development implemented; integration/validation deferred |
| [#748](https://github.com/doublemover/PairOfCleats/issues/748) | P3 | [P3] Use count-aware graph neighbor iteration to avoid materializing capped fanout tails | development implemented; integration/validation deferred |
| [#749](https://github.com/doublemover/PairOfCleats/issues/749) | P2 | [P2] Keep retrieval parity overlap bounded when hit keys repeat | development implemented; integration/validation deferred |
| [#750](https://github.com/doublemover/PairOfCleats/issues/750) | P2 | [P2] Keep a successful empty SCM file list authoritative during discovery | development implemented; integration/validation deferred |
| [#751](https://github.com/doublemover/PairOfCleats/issues/751) | P2 | [P2] Do not re-stamp stale SCM metadata as current after an unvalidated refresh | development implemented; integration/validation deferred |
| [#752](https://github.com/doublemover/PairOfCleats/issues/752) | P2 | [P2] Preserve unknown benchmark measurements through run-diff averages and deltas | development implemented; integration/validation deferred |
| [#753](https://github.com/doublemover/PairOfCleats/issues/753) | P2 | [P2] Invalidate SCM history metadata for files changed then reverted between heads | development implemented; integration/validation deferred |
| [#754](https://github.com/doublemover/PairOfCleats/issues/754) | P2 | [P2] Include churn requirements in Git metadata prefetch cache identity | development implemented; validation deferred |
| [#755](https://github.com/doublemover/PairOfCleats/issues/755) | P3 | [P3] Reuse prepared relation-boost evidence across candidates sharing file relations | development implemented; integration/validation deferred |
| [#756](https://github.com/doublemover/PairOfCleats/issues/756) | P3 | [P3] Retain predecessor links and defer suggest-tests witness paths until output selection | development implemented; integration/validation deferred |
| [#757](https://github.com/doublemover/PairOfCleats/issues/757) | P2 | [P2] Keep unmeasured AST counts from satisfying deep-analysis and observation checks | development implemented; integration/validation deferred |
| [#758](https://github.com/doublemover/PairOfCleats/issues/758) | P2 | [P2] Queue concurrent EG2 queries instead of skipping ANN and evicting the warm adapter | existing shared EG2 admission plus generic direct-provider/output drain and pending-cancellation warm retirement0a2625667; ordinary cancellation warmth covered; actual runtime/performance open |
| [#759](https://github.com/doublemover/PairOfCleats/issues/759) | P2 | [P2] Bind delayed Sublime completions to the original buffer version and replacement range | development implemented; validation deferred |
| [#760](https://github.com/doublemover/PairOfCleats/issues/760) | P2 | [P2] Preserve source case for case-sensitive phrase eligibility | development implemented; integration/validation deferred |
| [#761](https://github.com/doublemover/PairOfCleats/issues/761) | P2 | [P2] Cancel Sublime search option prompts without executing a search | development implemented; validation deferred |
| [#762](https://github.com/doublemover/PairOfCleats/issues/762) | P2 | [P2] Preserve Sublime search scope in history, repeat and hit-context reruns | development implemented; validation deferred |
| [#763](https://github.com/doublemover/PairOfCleats/issues/763) | P2 | [P2] Separate literal phrase tokens from normalized sparse scoring tokens | development implemented; integration/validation deferred |
| [#764](https://github.com/doublemover/PairOfCleats/issues/764) | P2 | [P2] Preserve compare-profile semantics in throughput JSON and CSV exports | development implemented; integration/validation deferred |
| [#765](https://github.com/doublemover/PairOfCleats/issues/765) | P2 | [P2] Recheck missing files after joining a Git metadata prefetch flight | development implemented; integration/validation deferred |
| [#766](https://github.com/doublemover/PairOfCleats/issues/766) | P3 | [P3] Replace full-window scans in uncapped graph edge merging | development implemented; integration/validation deferred |
| [#767](https://github.com/doublemover/PairOfCleats/issues/767) | P2 | [P2] Use immutable JJ commit identities for SCM metadata freshness | development implemented; integration/validation deferred |
| [#768](https://github.com/doublemover/PairOfCleats/issues/768) | perf | [Perf] Evaluate exact-length embedding batches to reduce within-bucket padding | development implemented; integration/validation deferred |
| [#769](https://github.com/doublemover/PairOfCleats/issues/769) | P2 | [P2] Preserve filename whitespace in SCM metadata snapshot keys | development implemented; validation deferred |
| [#770](https://github.com/doublemover/PairOfCleats/issues/770) | P2 | [P2] Apply throughput run filters before computing summaries and exported totals | development implemented; integration/validation deferred |
| [#771](https://github.com/doublemover/PairOfCleats/issues/771) | P2 | [P2] Prevent superseded editor searches from taking over newer results | development implemented; integration/validation deferred |
| [#772](https://github.com/doublemover/PairOfCleats/issues/772) | P3 | [P3] Map normalized search tokens back to original excerpt text for highlighting | development implemented; integration/validation deferred |
| [#773](https://github.com/doublemover/PairOfCleats/issues/773) | P3 | [P3] Honor VS Code provider cancellation before spawning and while navigation runs | development implemented; integration/validation deferred |
| [#774](https://github.com/doublemover/PairOfCleats/issues/774) | other | [Enhancement] Reuse per-leaf tokenization when building a cold query plan | pending |
| [#775](https://github.com/doublemover/PairOfCleats/issues/775) | other | [Enhancement] Reopen cached VS Code history results without rerunning search | source authored; unvalidated |
| [#776](https://github.com/doublemover/PairOfCleats/issues/776) | P2 | [P2] Rank throughput regressions with one format-independent total ordering | development implemented; integration/validation deferred |
| [#777](https://github.com/doublemover/PairOfCleats/issues/777) | P2 | [P2] Do not silently truncate deep graph witness paths at the internal 5,000-node guard | development implemented; integration/validation deferred |
| [#778](https://github.com/doublemover/PairOfCleats/issues/778) | P2 | [P2] Reject nested directory links that escape snapshot freeze sources | fixed; ordinary filesystem and injected metadata controls pass |
| [#779](https://github.com/doublemover/PairOfCleats/issues/779) | perf | [Perf] Reuse unpadded ONNX token rows between count estimation and inference | development implemented; integration/validation deferred |
| [#780](https://github.com/doublemover/PairOfCleats/issues/780) | P2 | [P2] Bind service progress monitoring to the claimed job's build identity | development implemented; integration/validation deferred |
| [#781](https://github.com/doublemover/PairOfCleats/issues/781) | P2 | [P2] Emit schema-valid SARIF thread flow locations and empty-evidence results | development implemented; integration/validation deferred |
| [#782](https://github.com/doublemover/PairOfCleats/issues/782) | P1 | [P1] Preserve committed WAL transactions when SQLite replacement rolls back | implemented; focused proof and front gate pass |
| [#783](https://github.com/doublemover/PairOfCleats/issues/783) | P2 | [P2] Percent-encode source filenames when exporting SARIF artifact URIs | development implemented; integration/validation deferred |
| [#784](https://github.com/doublemover/PairOfCleats/issues/784) | other | [Enhancement] Reconcile priority-only service status with actual queue dispatch | pending |
| [#785](https://github.com/doublemover/PairOfCleats/issues/785) | P2 | [P2] Preserve absent context-expansion limits instead of converting defaults to hard zero caps | development implemented; integration/validation deferred |
| [#786](https://github.com/doublemover/PairOfCleats/issues/786) | P2 | [P2] Preserve stronger risk states and distinct witnesses at converging call edges | development implemented; validation deferred |
| [#787](https://github.com/doublemover/PairOfCleats/issues/787) | P2 | [P2] Include the full taint set in risk propagation state identity | development implemented; validation deferred |
| [#788](https://github.com/doublemover/PairOfCleats/issues/788) | P3 | [P3] Reuse the shipped config schema across loads so validator caching can work | development implemented; integration/validation deferred |
| [#789](https://github.com/doublemover/PairOfCleats/issues/789) | P2 | [P2] Preserve named core search options when callers add extra CLI arguments | development implemented; integration/validation deferred |
| [#790](https://github.com/doublemover/PairOfCleats/issues/790) | other | [Enhancement] Bound editor HTTP response bodies before decoding and retaining diagnostics | source authored; unvalidated |
| [#791](https://github.com/doublemover/PairOfCleats/issues/791) | P2 | [P2] Retry valid short reads in random-access JSONL offset and row readers | development implemented; validation deferred |
| [#792](https://github.com/doublemover/PairOfCleats/issues/792) | P2 | [P2] Report context-expansion omissions when per-hit and total limits stop candidate loops | development implemented; integration/validation deferred |
| [#793](https://github.com/doublemover/PairOfCleats/issues/793) | P2 | [P2] Apply zero context-expansion candidate and reason caps before initial admission | development implemented; integration/validation deferred |
| [#794](https://github.com/doublemover/PairOfCleats/issues/794) | P3 | [P3] Memoize immutable callsite sampling across risk propagation states | development implemented; integration/validation deferred |
| [#795](https://github.com/doublemover/PairOfCleats/issues/795) | P2 | [P2] Do not mark packed MinHash corrupt after a valid short file read | development implemented; validation deferred |
| [#796](https://github.com/doublemover/PairOfCleats/issues/796) | P2 | [P2] Preserve end columns of multiline VS Code navigation ranges | development implemented; validation deferred |
| [#797](https://github.com/doublemover/PairOfCleats/issues/797) | P2 | [P2] Retry short VFS manifest reads before caching missing Tree-sitter rows | development implemented; validation deferred |
| [#798](https://github.com/doublemover/PairOfCleats/issues/798) | P3 | [P3] Document and type both MCP overload error envelopes for clients | development implemented; integration/validation deferred |
| [#799](https://github.com/doublemover/PairOfCleats/issues/799) | perf | [Perf] Skip unused chunk metadata hydration for indexed completions | development implemented; integration/validation deferred |
| [#800](https://github.com/doublemover/PairOfCleats/issues/800) | P2 | [P2] Preserve logical idempotency identity when retrying quarantined jobs | development implemented; validation deferred |
| [#801](https://github.com/doublemover/PairOfCleats/issues/801) | perf | [Perf] Make deferred queue claim duplicate checks linear instead of quadratic | development implemented; integration/validation deferred |
| [#802](https://github.com/doublemover/PairOfCleats/issues/802) | P2 | [P2] Apply logger redaction before retaining crash-event metadata | development implemented; validation deferred |
| [#803](https://github.com/doublemover/PairOfCleats/issues/803) | other | Preserve existing routing metadata when importing normalized generic triage records | pending |
| [#804](https://github.com/doublemover/PairOfCleats/issues/804) | other | Do not use a vulnerability or package alone as a unique generic triage finding ID | pending |
| [#805](https://github.com/doublemover/PairOfCleats/issues/805) | other | Normalize AWS Inspector CVSS arrays and scoringVector instead of dropping all scores | pending |
| [#806](https://github.com/doublemover/PairOfCleats/issues/806) | P1 | [P1] Default hardlink freeze does not preserve immutable snapshot bytes | fixed; focused Windows checks and front gate pass |
| [#807](https://github.com/doublemover/PairOfCleats/issues/807) | P2 | [P2] Size automatic runtime policy from effective process resources, not host totals | development implemented; validation deferred |
| [#808](https://github.com/doublemover/PairOfCleats/issues/808) | P2 | [P2] Honor crash-log ring limits in default text logging mode | development implemented; validation deferred |
| [#809](https://github.com/doublemover/PairOfCleats/issues/809) | P3 | [P3] Capped text helper reports a valid short read as complete file content | development implemented; integration/validation deferred |
| [#810](https://github.com/doublemover/PairOfCleats/issues/810) | other | Bound triage context-history reads and retain only the requested top candidates | pending |
| [#811](https://github.com/doublemover/PairOfCleats/issues/811) | P2 | [P2] Mark snapshot verification as skipped when --verify false | fixed; focused Windows checks and front gate pass |
| [#812](https://github.com/doublemover/PairOfCleats/issues/812) | P2 | [P2] Preserve nested activity origins when preparing history artifacts | development implemented; integration/validation deferred |
| [#813](https://github.com/doublemover/PairOfCleats/issues/813) | P2 | [P2] Preserve case-sensitive type identities and literal contents during normalization | actual provider quoted spelling plus local candidate ownership bf5a375b7, typeNormalization5/lsp37/rq10; generic contents remain owned, own case-sensitive aliases and malformed forms preserved; authored local/cross-file/provider controls unvalidated; full grammar/source/runtime proof open |
| [#814](https://github.com/doublemover/PairOfCleats/issues/814) | other | [Enhancement] Bound worker metric cardinality across worker generations | pending |
| [#815](https://github.com/doublemover/PairOfCleats/issues/815) | P2 | [P2] Keep adaptive scheduler reversal guards active across hold samples | development implemented; validation deferred |
| [#816](https://github.com/doublemover/PairOfCleats/issues/816) | perf | [Perf] Index archive span intersections instead of rescanning the source plan per fragment | development implemented; integration/validation deferred |
| [#817](https://github.com/doublemover/PairOfCleats/issues/817) | P2 | [P2] Preserve Python Optional and Union nesting during type canonicalization | partial actual local candidate containment and case/own alias source bf5a375b7; typeNormalization5; authored local/cross-file controls unvalidated; complete type grammar/scope/runtime narrowing remains open |
| [#818](https://github.com/doublemover/PairOfCleats/issues/818) | other | [Enhancement] Preserve source confidence and define the basis of propagated type scores | pending |
| [#819](https://github.com/doublemover/PairOfCleats/issues/819) | P2 | [P2] Verified snapshot counts checksum-less regular pieces without checking bytes | fixed; focused Windows checks and front gate pass |
| [#820](https://github.com/doublemover/PairOfCleats/issues/820) | P2 | [P2] Stop attributing parent-process pressure samples to individual workers | development implemented; validation deferred |
| [#821](https://github.com/doublemover/PairOfCleats/issues/821) | other | Keep triage JSON and Markdown artifacts coherent across concurrent updates and failed writes | pending |
| [#822](https://github.com/doublemover/PairOfCleats/issues/822) | P2 | [P2] Short SQLite control-header read can trigger false semantic repair | development implemented; validation deferred |
| [#823](https://github.com/doublemover/PairOfCleats/issues/823) | P2 | [P2] Retry short reads of verified runtime evidence and claim rows | development implemented; validation deferred |
| [#824](https://github.com/doublemover/PairOfCleats/issues/824) | other | [Enhancement] Select capped type candidates by evidence strength before display ordering | pending |
| [#825](https://github.com/doublemover/PairOfCleats/issues/825) | P3 | [P3] Avoid rescanning unchanged blocked scheduler backlogs on every enqueue | development implemented; integration/validation deferred |
| [#826](https://github.com/doublemover/PairOfCleats/issues/826) | P2 | [P2] Defer CAS deletion when a present lease cannot be read | development implemented; validation deferred |
| [#827](https://github.com/doublemover/PairOfCleats/issues/827) | P3 | [P3] Account for replacement when concurrent filter scans admit the same cache key | development implemented; integration/validation deferred |
| [#828](https://github.com/doublemover/PairOfCleats/issues/828) | P2 | [P2] Keep POSIX repository-path normalization case-sensitive | development implemented; validation deferred |
| [#829](https://github.com/doublemover/PairOfCleats/issues/829) | P2 | [P2] Include validation strictness in loaded-index cache and in-flight identity | development implemented; integration/validation deferred |
| [#830](https://github.com/doublemover/PairOfCleats/issues/830) | P3 | [P3] MCP cache_gc reports invalid no-limit requests as successful tool calls | development implemented; integration/validation deferred |
| [#831](https://github.com/doublemover/PairOfCleats/issues/831) | perf | [Perf] Replace repeated pending-window races with bounded capacity notifications | development implemented; integration/validation deferred |
| [#832](https://github.com/doublemover/PairOfCleats/issues/832) | P1 | [P1] Reject traversal snapshot IDs before GC and pointer-prune recursive deletion | fixed; focused Windows checks and front gate pass |
| [#833](https://github.com/doublemover/PairOfCleats/issues/833) | P2 | [P2] Preserve replacement query-embedding flights when an evicted promise fails late | implemented in batch 3; focused proof and front gate pass |
| [#834](https://github.com/doublemover/PairOfCleats/issues/834) | perf | [Perf] Prepare each VFS document once before attaching its chunk targets | development implemented; integration/validation deferred |
| [#835](https://github.com/doublemover/PairOfCleats/issues/835) | P1 | [P1] Diff prune can recursively delete outside diff cache via manifest entry ID | fixed; focused Windows checks and front gate pass |
| [#836](https://github.com/doublemover/PairOfCleats/issues/836) | P2 | [P2] Admit and expose supported API correlation headers for allowlisted browser clients | development implemented; integration/validation deferred |
| [#837](https://github.com/doublemover/PairOfCleats/issues/837) | P2 | [P2] Preserve explicit sparse field weights when enabled fields have empty vocabularies | development implemented; integration/validation deferred |
| [#838](https://github.com/doublemover/PairOfCleats/issues/838) | other | [Enhancement] Validate effective retrieval guardrails before issuing settings save previews | pending |
| [#839](https://github.com/doublemover/PairOfCleats/issues/839) | P2 | [P2] Sanitize server filesystem paths embedded in ordinary API error messages | development implemented; integration/validation deferred |
| [#840](https://github.com/doublemover/PairOfCleats/issues/840) | P2 | [P2] Make rolling chargram hashes independent of substring position | development implemented; integration/validation deferred |
| [#841](https://github.com/doublemover/PairOfCleats/issues/841) | P2 | [P2] Preserve qualified keyword call evidence consistently across lexicon filter projections | development implemented; validation deferred |
| [#842](https://github.com/doublemover/PairOfCleats/issues/842) | P2 | [P2] Record classifier's .txt content-sniff allowlist is unreachable | development implemented; validation deferred |
| [#843](https://github.com/doublemover/PairOfCleats/issues/843) | P3 | [P3] Intersect selective BM25 eligibility before traversing full common-term postings | development implemented; integration/validation deferred |
| [#844](https://github.com/doublemover/PairOfCleats/issues/844) | P2 | [P2] Short reads can hide shell shebangs and record signals during build/watch | development implemented; validation deferred |
| [#845](https://github.com/doublemover/PairOfCleats/issues/845) | P2 | [P2] Keep unresolved context-envelope seeds compatible with the primary output contract | development implemented; integration/validation deferred |
| [#846](https://github.com/doublemover/PairOfCleats/issues/846) | P2 | [P2] Short Markdown read silently drops authorized code correlations | development implemented; validation deferred |
| [#847](https://github.com/doublemover/PairOfCleats/issues/847) | other | [Enhancement] Let TUI settings remove one override without resetting the whole configuration | source removal contract authored; unvalidated |
| [#848](https://github.com/doublemover/PairOfCleats/issues/848) | P2 | [P2] Apply the same dictionary case policy when indexing and querying | development implemented; integration/validation deferred |
| [#849](https://github.com/doublemover/PairOfCleats/issues/849) | perf | [Perf] Reuse prepared build-time lexicon drop sets for files sharing language and policy | development implemented; integration/validation deferred |
| [#850](https://github.com/doublemover/PairOfCleats/issues/850) | P3 | [P3] Validate BM25 parameter domains before silently dropping matching documents | development implemented; integration/validation deferred |
| [#851](https://github.com/doublemover/PairOfCleats/issues/851) | P2 | [P2] Honor auto-install policy and detected languages before bootstrap ensures Pyright | development implemented; integration/validation deferred |
| [#852](https://github.com/doublemover/PairOfCleats/issues/852) | P2 | [P2] Reuse selected dictionary readiness in bootstrap instead of forcing English | development implemented; integration/validation deferred |
| [#853](https://github.com/doublemover/PairOfCleats/issues/853) | P1 | [P1] assemble-pieces --force can delete its own input directory | implemented; focused proof and front gate pass |
| [#854](https://github.com/doublemover/PairOfCleats/issues/854) | perf | [Perf] Avoid discarding tooling detection probes before the installer immediately repeats them | development implemented; integration/validation deferred |
| [#855](https://github.com/doublemover/PairOfCleats/issues/855) | P2 | [P2] Align query code-dictionary selection and language scope with indexed tokenization | development implemented; integration/validation deferred |
| [#856](https://github.com/doublemover/PairOfCleats/issues/856) | P2 | [P2] Key automatic repository-stat reuse by effective ignore policy | development implemented; validation deferred |
| [#857](https://github.com/doublemover/PairOfCleats/issues/857) | P1 | [P1] compact-pieces publishes shards before metadata and manifest transaction | implemented in batch 3; focused proof and front gate pass |
| [#858](https://github.com/doublemover/PairOfCleats/issues/858) | P1 | [P1] compact-pieces deletes its old shard backup when rollback fails | implemented in batch 3; focused proof and front gate pass |
| [#859](https://github.com/doublemover/PairOfCleats/issues/859) | P3 | [P3] Encode graph edge identities without delimiter collisions in valid file paths | development implemented; integration/validation deferred |
| [#860](https://github.com/doublemover/PairOfCleats/issues/860) | P1 | [P1] Token-postings shard writer loses recovery backup across failed promotion | implemented in batch 3; focused proof and front gate pass |
| [#861](https://github.com/doublemover/PairOfCleats/issues/861) | perf | [Perf] Avoid re-sorting the entire dependency-lane ready queue for every component | development implemented; integration/validation deferred |
| [#862](https://github.com/doublemover/PairOfCleats/issues/862) | P2 | [P2] Make dependency-lane SCC traversal stack-safe for admitted configured maps | development implemented; validation deferred |
| [#863](https://github.com/doublemover/PairOfCleats/issues/863) | P2 | [P2] Strict artifact manifest loader follows junction outside index root | development implemented; validation deferred |
| [#864](https://github.com/doublemover/PairOfCleats/issues/864) | other | [Enhancement] Reuse a page-scoped identity lookup for workspace selection | pending |
| [#865](https://github.com/doublemover/PairOfCleats/issues/865) | P3 | [P3] Watch record sniff treats configured zero-byte cap as 16 KiB | development implemented; integration/validation deferred |
| [#866](https://github.com/doublemover/PairOfCleats/issues/866) | P2 | [P2] Short ZIP header read misclassifies valid inference-history export | development implemented; integration/validation deferred |
| [#867](https://github.com/doublemover/PairOfCleats/issues/867) | P2 | [P2] Bound automatic repository-scan directory admission and pending stat work | development implemented; validation deferred |
| [#868](https://github.com/doublemover/PairOfCleats/issues/868) | P2 | [P2] Reject duplicate architecture rule IDs before attributing violations | development implemented; validation deferred |
| [#869](https://github.com/doublemover/PairOfCleats/issues/869) | P3 | [P3] Short log reads can make get-last-failure select a success log | development implemented; integration/validation deferred |
| [#870](https://github.com/doublemover/PairOfCleats/issues/870) | P2 | [P2] SQLite dense-binary stream stops at first positive short read | implemented in batch 3; focused proof and front gate pass |
| [#871](https://github.com/doublemover/PairOfCleats/issues/871) | P2 | [P2] Valid per-file varint range fails on positive short read | development implemented; validation deferred |
| [#872](https://github.com/doublemover/PairOfCleats/issues/872) | P1 | [P1] Archive extraction helper deletes pre-existing destination on failure | implemented; focused proof and front gate pass |
| [#873](https://github.com/doublemover/PairOfCleats/issues/873) | P2 | [P2] Lua language-server update deletes working install before replacement succeeds | development implemented; integration/validation deferred |
| [#874](https://github.com/doublemover/PairOfCleats/issues/874) | P1 | [P1] Preserve build-state batch order when retrying a failed detached patch | implemented; focused proof and front gate pass |
| [#875](https://github.com/doublemover/PairOfCleats/issues/875) | P2 | [P2] Make flushBuildState await already-detached in-flight writes | implemented in batch 3; focused proof and front gate pass |
| [#876](https://github.com/doublemover/PairOfCleats/issues/876) | P2 | [P2] Stop strict workspace scheduling after signal and spawn failures | development implemented; validation deferred |
| [#877](https://github.com/doublemover/PairOfCleats/issues/877) | P2 | [P2] Reject watch mode in finite workspace build fanout or implement workspace watch ownership | development implemented; validation deferred |
| [#878](https://github.com/doublemover/PairOfCleats/issues/878) | P2 | [P2] Normalize workspace boolean flags instead of forwarding accepted forms to child builds | development implemented; validation deferred |
| [#879](https://github.com/doublemover/PairOfCleats/issues/879) | P2 | [P2] Resolve historical roots for implicitly searched extracted-prose modes | development implemented; integration/validation deferred |
| [#880](https://github.com/doublemover/PairOfCleats/issues/880) | P1 | [P1] Queue job ID traversal writes report outside queue root | development implemented; validation deferred |
| [#881](https://github.com/doublemover/PairOfCleats/issues/881) | P2 | [P2] Preserve config-dump preview semantics in workspace build instead of reporting builds | development implemented; validation deferred |
| [#882](https://github.com/doublemover/PairOfCleats/issues/882) | other | [Enhancement] Account for unstarted repositories in strict workspace build summaries | pending |
| [#883](https://github.com/doublemover/PairOfCleats/issues/883) | P3 | [P3] Reject explicit blank historical selectors instead of querying latest | development implemented; integration/validation deferred |
| [#884](https://github.com/doublemover/PairOfCleats/issues/884) | P2 | [P2] Preserve disabled chargram token-length caps from configuration through index generation | development implemented; validation deferred |
| [#885](https://github.com/doublemover/PairOfCleats/issues/885) | P2 | [P2] Artifact publication record marks a failed validation wrapper as successful | development implemented; validation deferred |
| [#886](https://github.com/doublemover/PairOfCleats/issues/886) | P2 | [P2] Publication family validator accepts manifest entries with swapped artifact names | development implemented; validation deferred |
| [#887](https://github.com/doublemover/PairOfCleats/issues/887) | P2 | [P2] Mode-blind discovery/preprocessing can drop files allowed by by-mode caps | development implemented; validation deferred |
| [#888](https://github.com/doublemover/PairOfCleats/issues/888) | P2 | [P2] Federated enumeration appends continuation cursor after CLI option terminator | development implemented; integration/validation deferred |
| [#889](https://github.com/doublemover/PairOfCleats/issues/889) | P1 | [P1] File replacement silently succeeds with missing temp and unrelated recent final | implemented; focused proof and front gate pass |
| [#890](https://github.com/doublemover/PairOfCleats/issues/890) | P2 | [P2] HNSW retained backup is randomized but recovery only reads fixed .bak | implemented in batch 3; focused proof and front gate pass |
| [#891](https://github.com/doublemover/PairOfCleats/issues/891) | P2 | [P2] Valid managed clangd binary is rejected after a positive short header read | development implemented; integration/validation deferred |
| [#892](https://github.com/doublemover/PairOfCleats/issues/892) | P3 | [P3] Shared readFileRangeSync silently truncates a range after positive short read | development implemented; integration/validation deferred |
| [#893](https://github.com/doublemover/PairOfCleats/issues/893) | P2 | [P2] Packed token-postings short read triggers unbounded whole-file fallback | development implemented; validation deferred |
| [#894](https://github.com/doublemover/PairOfCleats/issues/894) | P2 | [P2] Archive extractor follows pre-existing destination junction outside extraction root | implemented; focused proof and front gate pass |
| [#895](https://github.com/doublemover/PairOfCleats/issues/895) | P2 | [P2] Bound build-state patch-stage trimming when every cached root is active | implemented in batch 3; focused proof and front gate pass |
| [#896](https://github.com/doublemover/PairOfCleats/issues/896) | P1 | [P1] Oversized build state is treated as empty and overwritten by the next patch | implemented; focused proof and front gate pass |
| [#897](https://github.com/doublemover/PairOfCleats/issues/897) | P2 | [P2] Failed checkpoint-index write can leave published index pointing to deleted sidecar | implemented in batch 3; focused proof and front gate pass |
| [#898](https://github.com/doublemover/PairOfCleats/issues/898) | P3 | [P3] Checkpoint mode sanitization aliases distinct keys to one sidecar file | development implemented; integration/validation deferred |
| [#899](https://github.com/doublemover/PairOfCleats/issues/899) | P3 | [P3] Top-K reducer ignores an explicit zero final limit | development implemented; integration/validation deferred |
| [#900](https://github.com/doublemover/PairOfCleats/issues/900) | P3 | [P3] Bitmap union drops valid entries when the first slot is null | development implemented; integration/validation deferred |
| [#901](https://github.com/doublemover/PairOfCleats/issues/901) | P3 | [P3] Query-plan disk reload reverses LRU age and evicts the newest restored plan | development implemented; integration/validation deferred |
| [#902](https://github.com/doublemover/PairOfCleats/issues/902) | P2 | [P2] Boundary-marked filename chargrams prune valid substring matches | development implemented; integration/validation deferred |
| [#903](https://github.com/doublemover/PairOfCleats/issues/903) | P2 | [P2] Regex filename prefilter requires one alternation branch and drops valid matches | development implemented; integration/validation deferred |
| [#904](https://github.com/doublemover/PairOfCleats/issues/904) | P2 | [P2] Quoted file and author filters split one value into unrelated OR matchers | development implemented; integration/validation deferred |
| [#905](https://github.com/doublemover/PairOfCleats/issues/905) | P2 | [P2] Git line-author helper ignores requested commit and blames current checkout | development implemented; validation deferred |
| [#906](https://github.com/doublemover/PairOfCleats/issues/906) | P2 | [P2] Unpinned Git blame cache returns stale authors after a same-process commit | development implemented; validation deferred |
| [#907](https://github.com/doublemover/PairOfCleats/issues/907) | P2 | [P2] Incremental SQLite update can retain old ANN rows when vector extension is unavailable | implemented in batch 3; focused proof and front gate pass |
| [#908](https://github.com/doublemover/PairOfCleats/issues/908) | P2 | [P2] SQLite incremental planner accepts a valid bundle for the wrong manifest file | implemented in batch 3; focused proof and front gate pass |
| [#909](https://github.com/doublemover/PairOfCleats/issues/909) | P2 | [P2] Resolve inherited tsconfig baseUrl relative to its defining config | development implemented; validation deferred |
| [#910](https://github.com/doublemover/PairOfCleats/issues/910) | P2 | [P2] Resolve package tsconfig extends from its config entry, not Node main | development implemented; validation deferred |
| [#911](https://github.com/doublemover/PairOfCleats/issues/911) | P2 | [P2] Match TypeScript path-mapping specificity instead of shortest resolved filename | source 8a294daf4 corrects TypeScript precedence; local fingerprint/shared importResolution4 retire old meaning; authored compiler-oracle controls unvalidated |
| [#912](https://github.com/doublemover/PairOfCleats/issues/912) | P2 | [P2] Honor array-valued tsconfig extends when resolving import aliases | development implemented; validation deferred |
| [#913](https://github.com/doublemover/PairOfCleats/issues/913) | P2 | [P2] Null expiresAt invalidates every positive import-resolution spec cache entry | development implemented; validation deferred |
| [#914](https://github.com/doublemover/PairOfCleats/issues/914) | P2 | [P2] Do not resolve case-mismatched explicit imports on case-sensitive repositories | development implemented; validation deferred |
| [#915](https://github.com/doublemover/PairOfCleats/issues/915) | P3 | [P3] Result-bundle synthetic missing-file key collides with a valid filename | development implemented; integration/validation deferred |
| [#916](https://github.com/doublemover/PairOfCleats/issues/916) | P3 | [P3] Body-summary helper serves cached pre-edit source text in one process | development implemented; integration/validation deferred |
| [#917](https://github.com/doublemover/PairOfCleats/issues/917) | P3 | [P3] Context cleaner drops meaningful lines written without ASCII letters or digits | development implemented; integration/validation deferred |
| [#918](https://github.com/doublemover/PairOfCleats/issues/918) | P2 | [P2] Reject out-of-root artifact piece paths before manifest and publication | development implemented; validation deferred |
| [#919](https://github.com/doublemover/PairOfCleats/issues/919) | P2 | [P2] Preserve distinct case-sensitive files during Windows incremental bundle writeback | development implemented; integration/validation deferred |
| [#920](https://github.com/doublemover/PairOfCleats/issues/920) | P2 | [P2] Do not publish a stale filter index after current-generation build failure | development implemented; validation deferred |
| [#921](https://github.com/doublemover/PairOfCleats/issues/921) | P2 | [P2] Include non-source file metadata in incremental file_meta cache identity | development implemented; validation deferred |
| [#922](https://github.com/doublemover/PairOfCleats/issues/922) | P2 | [P2] Resolve inherited TypeScript emit directories relative to the declaring tsconfig | development implemented; validation deferred |
| [#923](https://github.com/doublemover/PairOfCleats/issues/923) | P2 | [P2] Do not suppress ordinary missing test imports as fixture references | development implemented; validation deferred |
| [#924](https://github.com/doublemover/PairOfCleats/issues/924) | P2 | [P2] Do not suppress missing TypeScript build-script imports without an emit counterpart | development implemented; validation deferred |
| [#925](https://github.com/doublemover/PairOfCleats/issues/925) | P3 | [P3] Report missing SQLite database paths instead of claiming better-sqlite3 is absent | development implemented; integration/validation deferred |
| [#926](https://github.com/doublemover/PairOfCleats/issues/926) | P3 | [P3] Keep composite dedupe keys distinct in the SQLite multi-row inserter | development implemented; integration/validation deferred |
| [#927](https://github.com/doublemover/PairOfCleats/issues/927) | P2 | [P2] Prevent later SQLite mode builds from replacing a configured shared DB | implemented in batch 3; focused proof and front gate pass |
| [#928](https://github.com/doublemover/PairOfCleats/issues/928) | P2 | [P2] Preserve Node package #imports instead of dropping them during normalization | development implemented; validation deferred |
| [#929](https://github.com/doublemover/PairOfCleats/issues/929) | P2 | [P2] Do not declare junction-backed import targets absent in the filesystem existence index | development implemented; validation deferred |
| [#930](https://github.com/doublemover/PairOfCleats/issues/930) | P3 | [P3] Ignore Razor @using directives inside multiline Razor comments | development implemented; integration/validation deferred |
| [#931](https://github.com/doublemover/PairOfCleats/issues/931) | P3 | [P3] Exclude imports inside Nix block comments | development implemented; integration/validation deferred |
| [#932](https://github.com/doublemover/PairOfCleats/issues/932) | P3 | [P3] Exclude block-commented imports in Dart, Groovy, and Scala collectors | development implemented; integration/validation deferred |
| [#933](https://github.com/doublemover/PairOfCleats/issues/933) | P3 | [P3] Do not downgrade future ordering-ledger versions during state merge | development implemented; integration/validation deferred |
| [#934](https://github.com/doublemover/PairOfCleats/issues/934) | P2 | [P2] Preserve forced final checkpoint flush during an in-flight periodic write | implemented in batch 3; focused proof and front gate pass |
| [#935](https://github.com/doublemover/PairOfCleats/issues/935) | P2 | [P2] Propagate cancellation during embedding job enqueue instead of finalizing as done | development implemented; validation deferred |
| [#936](https://github.com/doublemover/PairOfCleats/issues/936) | P2 | [P2] Preserve all search metrics under concurrent query sessions | development implemented; integration/validation deferred |
| [#937](https://github.com/doublemover/PairOfCleats/issues/937) | P3 | [P3] Warn when a forced SQLite backend is ignored for records-only search | development implemented; integration/validation deferred |
| [#938](https://github.com/doublemover/PairOfCleats/issues/938) | P3 | [P3] Retain query-cache entries from concurrent search sessions | development implemented; integration/validation deferred |
| [#939](https://github.com/doublemover/PairOfCleats/issues/939) | P3 | [P3] Keep distinct score-buffer schemas from colliding in the reuse pool | development implemented; integration/validation deferred |
| [#940](https://github.com/doublemover/PairOfCleats/issues/940) | P3 | [P3] Preserve JSONL callback order in SQLite small-source fast paths | development implemented; integration/validation deferred |
| [#941](https://github.com/doublemover/PairOfCleats/issues/941) | P3 | [P3] Normalize sorted token posting rows in the default truncate path | development implemented; integration/validation deferred |
| [#942](https://github.com/doublemover/PairOfCleats/issues/942) | P3 | [P3] Do not report a sparsity-cache hit when the profile entry is missing | development implemented; integration/validation deferred |
| [#943](https://github.com/doublemover/PairOfCleats/issues/943) | P3 | [P3] Keep Tree-sitter scheduler artifact paths unique across grammar keys | development implemented; integration/validation deferred |
| [#944](https://github.com/doublemover/PairOfCleats/issues/944) | P2 | [P2] Reject duplicate virtual paths while merging scheduler result indexes | development implemented; validation deferred |
| [#945](https://github.com/doublemover/PairOfCleats/issues/945) | P1 | [P1] Do not detach source embeddings while quantizing dense-vector channels | implemented; focused proof and front gate pass |
| [#946](https://github.com/doublemover/PairOfCleats/issues/946) | P2 | [P2] Deduplicate shared ArrayBuffers in quantize-worker transfer lists | development implemented; integration/validation deferred |
| [#947](https://github.com/doublemover/PairOfCleats/issues/947) | P2 | [P2] Preserve distinct repo-map entries whose fields contain :: | development implemented; validation deferred |
| [#948](https://github.com/doublemover/PairOfCleats/issues/948) | P3 | [P3] Keep exported sequence-ledger counters live after transitions | development implemented; integration/validation deferred |
| [#949](https://github.com/doublemover/PairOfCleats/issues/949) | P3 | [P3] Avoid shard-subset ID collisions for distinct external shard keys | development implemented; integration/validation deferred |
| [#950](https://github.com/doublemover/PairOfCleats/issues/950) | P2 | [P2] Reject malformed --meta-json instead of silently removing the search constraint | development implemented; integration/validation deferred |
| [#951](https://github.com/doublemover/PairOfCleats/issues/951) | P2 | [P2] Drain sibling search modes before disposing request-owned backends on failure | development implemented; integration/validation deferred |
| [#952](https://github.com/doublemover/PairOfCleats/issues/952) | P2 | [P2] Preserve __proto__ symbol lookups in persisted context indexes | own argument propagation80ad120e9 plus actual own parameter parsers/enrichment/public MetaV2 54f5baae7, lspBindings30/rq6; authored consumer/replay controls unvalidated |
| [#953](https://github.com/doublemover/PairOfCleats/issues/953) | P3 | [P3] Invalidate case-insensitive file-relation lookup after store mutation | development implemented; integration/validation deferred |
| [#954](https://github.com/doublemover/PairOfCleats/issues/954) | P2 | [P2] Keep context-expansion cache writes out of frozen snapshots | development implemented; integration/validation deferred |
| [#955](https://github.com/doublemover/PairOfCleats/issues/955) | P2 | [P2] Do not cool down healthy ANN providers when a search is cancelled | development implemented; integration/validation deferred |
| [#956](https://github.com/doublemover/PairOfCleats/issues/956) | P3 | [P3] Do not satisfy vector-only retrieval with MinHash fallback hits | development implemented; integration/validation deferred |
| [#957](https://github.com/doublemover/PairOfCleats/issues/957) | P2 | [P2] Reject malformed positional FTS weights instead of shifting field meanings | development implemented; integration/validation deferred |
| [#958](https://github.com/doublemover/PairOfCleats/issues/958) | P2 | [P2] Return no LanceDB hits for an explicitly empty candidate set | implemented in batch 3; focused proof and front gate pass |
| [#959](https://github.com/doublemover/PairOfCleats/issues/959) | P2 | [P2] Preserve filtered recall beyond Tantivy's fixed global overfetch window | development implemented; integration/validation deferred |
| [#960](https://github.com/doublemover/PairOfCleats/issues/960) | P2 | [P2] Return no SQLite-vector hits for an explicitly empty candidate set | implemented in batch 3; focused proof and front gate pass |
| [#961](https://github.com/doublemover/PairOfCleats/issues/961) | P1 | [P1] Revalidate vector-extension trust when cached load policy changes | implemented; focused proof and front gate pass |
| [#962](https://github.com/doublemover/PairOfCleats/issues/962) | P1 | [P1] Verify extension integrity in the default non-loading verification path | implemented; focused proof and front gate pass |
| [#963](https://github.com/doublemover/PairOfCleats/issues/963) | P3 | [P3] Use process CPU fallback for Windows pipeline checkpoints | development implemented; integration/validation deferred |
| [#964](https://github.com/doublemover/PairOfCleats/issues/964) | P2 | [P2] Do not interpret Windows' unsupported load average as idle CPU in adaptive scheduling | development implemented; validation deferred |
| [#965](https://github.com/doublemover/PairOfCleats/issues/965) | P3 | [P3] Preserve special channel names in runtime telemetry snapshots | development implemented; integration/validation deferred |
| [#966](https://github.com/doublemover/PairOfCleats/issues/966) | P3 | [P3] Give concurrent startup calibration probes unique temporary files | development implemented; integration/validation deferred |
| [#967](https://github.com/doublemover/PairOfCleats/issues/967) | P2 | [P2] Bind scheduler autotune recommendations to the current resource envelope | development implemented; validation deferred |
| [#968](https://github.com/doublemover/PairOfCleats/issues/968) | P2 | [P2] Keep concurrent indexing runtimes' log identity and destination isolated | development implemented; integration/validation deferred |
| [#969](https://github.com/doublemover/PairOfCleats/issues/969) | P2 | [P2] Rescan learned auto-profile features after nested repository changes | development implemented; validation deferred |
| [#970](https://github.com/doublemover/PairOfCleats/issues/970) | P2 | [P2] Do not classify truncated directory-only repo samples as high-confidence tiny | development implemented; validation deferred |
| [#971](https://github.com/doublemover/PairOfCleats/issues/971) | P2 | [P2] Enforce bootstrap readiness before the standalone Stage-3 embeddings entry | implemented in batch 3; focused proof and front gate pass |
| [#972](https://github.com/doublemover/PairOfCleats/issues/972) | P3 | [P3] Avoid test-file weight penalties for production names containing “test” | development implemented; integration/validation deferred |
| [#973](https://github.com/doublemover/PairOfCleats/issues/973) | P3 | [P3] Encode callsite identity fields without colon-boundary collisions | development implemented; integration/validation deferred |
| [#974](https://github.com/doublemover/PairOfCleats/issues/974) | P3 | [P3] Headline frequency counts mis-rank inherited Object keys such as `constructor` | development implemented; integration/validation deferred |
| [#975](https://github.com/doublemover/PairOfCleats/issues/975) | P2 | [P2] TOML chunker drops top-level keys before the first table header | development implemented; validation deferred |
| [#976](https://github.com/doublemover/PairOfCleats/issues/976) | P3 | [P3] Segment rebasing mutates the source chunk metadata and compounds on reuse | development implemented; integration/validation deferred |
| [#977](https://github.com/doublemover/PairOfCleats/issues/977) | P3 | [P3] Registry lock domain can escape the cache lock directory | development implemented; integration/validation deferred |
| [#978](https://github.com/doublemover/PairOfCleats/issues/978) | P3 | [P3] Relative import candidate generation misses `index.*` inside dotted directory names | development implemented; integration/validation deferred |
| [#979](https://github.com/doublemover/PairOfCleats/issues/979) | P2 | [P2] Heading-based chunkers omit document content before the first heading | development implemented; validation deferred |
| [#980](https://github.com/doublemover/PairOfCleats/issues/980) | P2 | [P2] Synonym expansion inserts inherited functions into token sequences | development implemented; validation deferred |
| [#981](https://github.com/doublemover/PairOfCleats/issues/981) | P3 | [P3] Exposed mutable SCM runtime config can change without its freshness signature | development implemented; integration/validation deferred |
| [#982](https://github.com/doublemover/PairOfCleats/issues/982) | P1 | [P1] Spill merge resumes checkpointed outputs from a different input run set | implemented; focused proof and front gate pass |
| [#983](https://github.com/doublemover/PairOfCleats/issues/983) | P2 | [P2] GitHub Actions YAML chunking omits workflow-level configuration before the first job | development implemented; validation deferred |
| [#984](https://github.com/doublemover/PairOfCleats/issues/984) | P2 | [P2] SQLite validation treats any zero-state marker file as proof no DB is required | development implemented; validation deferred |
| [#985](https://github.com/doublemover/PairOfCleats/issues/985) | P2 | [P2] Borrowed registry lock accepts any release-shaped object without ownership check | live borrowed capability mapping plus worker/owned release failure context 0d6d09d5b; authored normal/frozen/falsey/borrowed controls unvalidated |
| [#986](https://github.com/doublemover/PairOfCleats/issues/986) | P2 | [P2] Strict ordering-ledger validation silently substitutes another build stage | development implemented; validation deferred |
| [#987](https://github.com/doublemover/PairOfCleats/issues/987) | P3 | [P3] Diff event totals lose or corrupt counts for inherited-key event kinds | development implemented; integration/validation deferred |
| [#988](https://github.com/doublemover/PairOfCleats/issues/988) | P3 | [P3] Field-postings builder silently drops a __proto__ field | development implemented; integration/validation deferred |
| [#989](https://github.com/doublemover/PairOfCleats/issues/989) | P2 | [P2] Chunk externalDocs misclassifies Node and Python standard-library imports as packages | development implemented; validation deferred |
| [#990](https://github.com/doublemover/PairOfCleats/issues/990) | P2 | [P2] Omitted relation-inference limits silently truncate every signal to zero | development implemented; validation deferred |
| [#991](https://github.com/doublemover/PairOfCleats/issues/991) | P2 | [P2] Concurrent VFS manifest appends duplicate spilled rows | development implemented; validation deferred |
| [#992](https://github.com/doublemover/PairOfCleats/issues/992) | P2 | [P2] Custom risk semantics treat null and boolean argument indices as real positions | development implemented; validation deferred |
| [#993](https://github.com/doublemover/PairOfCleats/issues/993) | P2 | [P2] CDC byte-size limits are enforced as UTF-16 code units | development implemented; validation deferred |
| [#994](https://github.com/doublemover/PairOfCleats/issues/994) | P3 | [P3] Performance profile crashes on inherited-key language IDs | development implemented; integration/validation deferred |
| [#995](https://github.com/doublemover/PairOfCleats/issues/995) | P2 | [P2] Perf-profile cost estimator triple-counts an observed file's duration | development implemented; integration/validation deferred |
| [#996](https://github.com/doublemover/PairOfCleats/issues/996) | P2 | [P2] Legacy string file-text cache bypasses freshness checks and can index stale text | development implemented; validation deferred |
| [#997](https://github.com/doublemover/PairOfCleats/issues/997) | P3 | [P3] Piece-assembly TF normalizer skips validation for single-entry lists | development implemented; integration/validation deferred |
| [#998](https://github.com/doublemover/PairOfCleats/issues/998) | P3 | [P3] Stage checkpoint summary corrupts inherited-key stage names | development implemented; integration/validation deferred |
| [#999](https://github.com/doublemover/PairOfCleats/issues/999) | P2 | [P2] Stage1 finalizer rejects valid sparse commit cursors | development implemented; validation deferred |
| [#1000](https://github.com/doublemover/PairOfCleats/issues/1000) | P3 | [P3] Overlapping language spans multiply per-file feature duration | development implemented; integration/validation deferred |
| [#1001](https://github.com/doublemover/PairOfCleats/issues/1001) | P2 | [P2] PDF extraction timeout and page errors leave pdf.js loading work undisposed | original PDF destroy/late-work owners778078017 plus automatic queue/shard retry refusal91f2ef74f; authored actual owner/queue controls unvalidated; real pdf.js/full consumer/platform acceptance open |
| [#1002](https://github.com/doublemover/PairOfCleats/issues/1002) | P2 | [P2] Tree-sitter wave order drops additional groups in the same bucket and wave | development implemented; validation deferred |
| [#1003](https://github.com/doublemover/PairOfCleats/issues/1003) | P2 | [P2] Proto and GraphQL chunkers omit source preambles before first definition | development implemented; validation deferred |
| [#1004](https://github.com/doublemover/PairOfCleats/issues/1004) | P3 | [P3] Ingest summary counters corrupt inherited-key kinds and languages | development implemented; integration/validation deferred |
| [#1005](https://github.com/doublemover/PairOfCleats/issues/1005) | P2 | [P2] SPDX boilerplate tag swallows all following header lines | development implemented; validation deferred |
| [#1006](https://github.com/doublemover/PairOfCleats/issues/1006) | P2 | [P2] Embedding batch validator accepts non-finite vector elements | implemented in batch 3; focused proof and front gate pass |
| [#1007](https://github.com/doublemover/PairOfCleats/issues/1007) | P2 | [P2] Strict chunk-meta validation can hide primary loader failure behind stale JSON fallback | development implemented; validation deferred |
| [#1008](https://github.com/doublemover/PairOfCleats/issues/1008) | P2 | [P2] Stage1 watchdog drops recorded SCM process-queue wait from lifecycle durations | development implemented; validation deferred |
| [#1009](https://github.com/doublemover/PairOfCleats/issues/1009) | P3 | [P3] Lifecycle duration helper treats null timestamp sentinels as epoch zero | development implemented; validation deferred |
| [#1010](https://github.com/doublemover/PairOfCleats/issues/1010) | P3 | [P3] Phrase-postings builder emits undersized grams after an empty token | development implemented; integration/validation deferred |
| [#1011](https://github.com/doublemover/PairOfCleats/issues/1011) | P2 | [P2] Shared chargram set exceeds per-chunk cap across fields | development implemented; validation deferred |
| [#1012](https://github.com/doublemover/PairOfCleats/issues/1012) | P2 | [P2] Dense-vector builder zeroes float-only chunks in a mixed representation batch | development implemented; integration/validation deferred |
| [#1013](https://github.com/doublemover/PairOfCleats/issues/1013) | P2 | [P2] Shared line-index cache reuses offsets for different text with equal line count | development implemented; validation deferred |
| [#1014](https://github.com/doublemover/PairOfCleats/issues/1014) | P3 | [P3] Scan-profile count maps silently discard reserved category keys | development implemented; integration/validation deferred |
| [#1015](https://github.com/doublemover/PairOfCleats/issues/1015) | P3 | [P3] Feature-metrics recorder drops inherited-name language and setting buckets | development implemented; integration/validation deferred |
| [#1016](https://github.com/doublemover/PairOfCleats/issues/1016) | P3 | [P3] NUMA worker assignment telemetry stays empty when crash logging is disabled | development implemented; integration/validation deferred |
| [#1017](https://github.com/doublemover/PairOfCleats/issues/1017) | P2 | [P2] DOCX ZIP fallback can inflate past the document size policy without a bound | development implemented; integration/validation deferred |
| [#1018](https://github.com/doublemover/PairOfCleats/issues/1018) | P2 | [P2] Lexicon filter keeps qualified keyword calls but drops their details and ranges | development implemented; validation deferred |
| [#1019](https://github.com/doublemover/PairOfCleats/issues/1019) | P2 | [P2] Strict JSON chunker rejects valid nested empty objects and arrays | development implemented; validation deferred |
| [#1020](https://github.com/doublemover/PairOfCleats/issues/1020) | P3 | [P3] Embeddings cache index loses reserved entry keys and file paths | development implemented; integration/validation deferred |
| [#1021](https://github.com/doublemover/PairOfCleats/issues/1021) | P3 | [P3] Tree-sitter batching skips language metadata for a single entry | development implemented; integration/validation deferred |
| [#1022](https://github.com/doublemover/PairOfCleats/issues/1022) | P2 | [P2] LanceDB rebuild deletes prior index before validating or publishing replacement | implemented in batch 3; focused proof and front gate pass |
| [#1023](https://github.com/doublemover/PairOfCleats/issues/1023) | P2 | [P2] Postings validation accepts fractional document IDs | development implemented; validation deferred |
| [#1024](https://github.com/doublemover/PairOfCleats/issues/1024) | P2 | [P2] SQLite metaV2 parity check falsely flags equivalent reordered JSON objects | development implemented; validation deferred |
| [#1025](https://github.com/doublemover/PairOfCleats/issues/1025) | P2 | [P2] Float16 text-vector cache rounds boundary embedding values to zero | implemented in batch 3; focused proof and front gate pass |
| [#1026](https://github.com/doublemover/PairOfCleats/issues/1026) | P3 | [P3] Risk artifact validator misses positive call-site count when flows reference none | development implemented; integration/validation deferred |
| [#1027](https://github.com/doublemover/PairOfCleats/issues/1027) | P3 | [P3] Import reason lookup accepts inherited object names as registered reasons | development implemented; integration/validation deferred |
| [#1028](https://github.com/doublemover/PairOfCleats/issues/1028) | P2 | [P2] Prose dispatch bypasses Markdown heading chunker for .markdown files | development implemented; validation deferred |
| [#1029](https://github.com/doublemover/PairOfCleats/issues/1029) | P3 | [P3] MetaV2 declared types silently omit a __proto__ parameter | actual dynamic-name parsers/merge/cache/enrichment reach existing public MetaV2 with own __proto__ data54f5baae7; authored consumer/JSON controls unvalidated |
| [#1030](https://github.com/doublemover/PairOfCleats/issues/1030) | P2 | [P2] Large docs search fast scan mistakes nested fields for page metadata | development implemented; integration/validation deferred |
| [#1031](https://github.com/doublemover/PairOfCleats/issues/1031) | P3 | [P3] Adaptive scheduler accepts invalid persisted bucket counts as one | development implemented; integration/validation deferred |
| [#1032](https://github.com/doublemover/PairOfCleats/issues/1032) | P2 | [P2] Root-level .markdown files are excluded from both indexing modes | development implemented; validation deferred |
| [#1033](https://github.com/doublemover/PairOfCleats/issues/1033) | P2 | [P2] Worker-pool lifecycle loses cleanup handle when destroy rejects | development implemented; integration/validation deferred |
| [#1034](https://github.com/doublemover/PairOfCleats/issues/1034) | P2 | [P2] Token-classification budget is spent before confirming Tree-sitter can run | development implemented; validation deferred |
| [#1035](https://github.com/doublemover/PairOfCleats/issues/1035) | P2 | [P2] Process-pool destroy rejection leaves aggregate memory capacity reserved | development implemented; integration/validation deferred |
| [#1036](https://github.com/doublemover/PairOfCleats/issues/1036) | P2 | [P2] Risk sanitizer after a sink suppresses earlier same-line taint flow | development implemented; validation deferred |
| [#1037](https://github.com/doublemover/PairOfCleats/issues/1037) | P2 | [P2] Risk assignment parser drops taint when RHS contains comparison text | development implemented; validation deferred |
| [#1038](https://github.com/doublemover/PairOfCleats/issues/1038) | P2 | [P2] Risk sink flow uses tainted variables outside the matched sink call | development implemented; validation deferred |
| [#1039](https://github.com/doublemover/PairOfCleats/issues/1039) | P1 | [P1] SQLite dense update treats unreadable vector artifact as empty and deletes existing vectors | implemented; focused proof and front gate pass |
| [#1040](https://github.com/doublemover/PairOfCleats/issues/1040) | P1 | [P1] SQLite dense ANN table rebuild skips unchanged base vectors | implemented; focused proof and front gate pass |
| [#1041](https://github.com/doublemover/PairOfCleats/issues/1041) | P2 | [P2] SQLite dense update drops old ANN table before replacement can be validated | implemented in batch 3; focused proof and front gate pass |
| [#1042](https://github.com/doublemover/PairOfCleats/issues/1042) | P3 | [P3] Stage1 stall top-N selection ignores tie-break order at the cutoff | development implemented; integration/validation deferred |
| [#1043](https://github.com/doublemover/PairOfCleats/issues/1043) | P3 | [P3] Stage1 stall snapshot defaults null idle duration to zero | development implemented; integration/validation deferred |
| [#1044](https://github.com/doublemover/PairOfCleats/issues/1044) | P2 | [P2] Identity reconciliation misses chunk-meta rows absent from chunk_uid_map | development implemented; validation deferred |
| [#1045](https://github.com/doublemover/PairOfCleats/issues/1045) | P2 | [P2] Byte-limited chunking splits UTF-16 surrogate pairs into replacement characters | development implemented; validation deferred |
| [#1046](https://github.com/doublemover/PairOfCleats/issues/1046) | P2 | [P2] Partial chunk-role override silently removes the other default size cap | development implemented; validation deferred |
| [#1047](https://github.com/doublemover/PairOfCleats/issues/1047) | P2 | [P2] Postings reservation release is not idempotent and undercounts other work | development implemented; integration/validation deferred |
| [#1048](https://github.com/doublemover/PairOfCleats/issues/1048) | P2 | [P2] Postings queue grants capacity to an already-aborted caller | development implemented; integration/validation deferred |
| [#1049](https://github.com/doublemover/PairOfCleats/issues/1049) | P2 | [P2] Dart package import with unknown current package name resolves unrelated local file | development implemented; validation deferred |
| [#1050](https://github.com/doublemover/PairOfCleats/issues/1050) | P1 | [P1] Piece assembler remaps forward chunk references before UID collisions are known | development implemented; validation deferred |
| [#1051](https://github.com/doublemover/PairOfCleats/issues/1051) | P2 | [P2] Piece assembler keeps only the first input's risk-interprocedural stats | development implemented; validation deferred |
| [#1052](https://github.com/doublemover/PairOfCleats/issues/1052) | P2 | [P2] Chunk relation diff collapses distinct structured targets | development implemented; validation deferred |
| [#1053](https://github.com/doublemover/PairOfCleats/issues/1053) | P2 | [P2] Heuristic and template chunkers omit text before the first heading/block | development implemented; validation deferred |
| [#1054](https://github.com/doublemover/PairOfCleats/issues/1054) | P2 | [P2] Scheduler crash-forensics persistence failures are silently swallowed | scheduler evidence before fallible presentation/getters e4ef1a1fd with independent sink receipts; actual tiny atomic publisher controls unvalidated; real crash/Windows durability open |
| [#1055](https://github.com/doublemover/PairOfCleats/issues/1055) | P2 | [P2] Local type inference propagates from future assignments but misses multi-hop aliases | development implemented; validation deferred |
| [#1056](https://github.com/doublemover/PairOfCleats/issues/1056) | P2 | [P2] Artifact report can attribute published status to an unrelated latest build | development implemented; integration/validation deferred |
| [#1057](https://github.com/doublemover/PairOfCleats/issues/1057) | P2 | [P2] Import graph replay limit selects filesystem-order subset before sorting | development implemented; validation deferred |
| [#1058](https://github.com/doublemover/PairOfCleats/issues/1058) | P2 | [P2] Cross-file cache fingerprint ignores input import relations that it later overwrites | existing cross-file mappings plus own argument-map replay 80ad120e9, callFlow21; unvalidated; runtime/fine-grained resume acceptance open |
| [#1059](https://github.com/doublemover/PairOfCleats/issues/1059) | P2 | [P2] Non-symbolic tooling cache can reuse stale results after tooling configuration changes | existing configuration/world cache owners retained; quoted parse-key JSON tuple/input fidelity194869e7c, rq6/lsp30 current; actual cold/warm consumer acceptance deferred |
| [#1060](https://github.com/doublemover/PairOfCleats/issues/1060) | P1 | [P1] Incremental embedding mapping can assign an unknown file another file's vector | implemented; focused proof and front gate pass |
| [#1061](https://github.com/doublemover/PairOfCleats/issues/1061) | P2 | [P2] Worker-count environment override bypasses FD concurrency cap | development implemented; validation deferred |
| [#1062](https://github.com/doublemover/PairOfCleats/issues/1062) | P2 | [P2] Field-based phrase postings apply per-chunk cap separately to each field | development implemented; validation deferred |
| [#1063](https://github.com/doublemover/PairOfCleats/issues/1063) | P2 | [P2] Exported shard-state merge drops token identity and risk artifacts | development implemented; validation deferred |
| [#1064](https://github.com/doublemover/PairOfCleats/issues/1064) | P1 | [P1] SQLite compaction drops minhash hash-identity metadata | implemented; focused proof and front gate pass |
| [#1065](https://github.com/doublemover/PairOfCleats/issues/1065) | P2 | [P2] Git metadata batch parsers trim significant filename whitespace | development implemented; validation deferred |
| [#1066](https://github.com/doublemover/PairOfCleats/issues/1066) | P2 | [P2] Graph-relation edge cap counts duplicate links before deduplication | development implemented; validation deferred |
| [#1067](https://github.com/doublemover/PairOfCleats/issues/1067) | P2 | [P2] Crash-retention bundle advertises 32 MiB budget but never enforces it | development implemented; validation deferred |
| [#1068](https://github.com/doublemover/PairOfCleats/issues/1068) | P2 | [P2] Cross-file global call budget does not bound call summaries | development implemented; validation deferred |
| [#1069](https://github.com/doublemover/PairOfCleats/issues/1069) | P2 | [P2] Zero blocked-expansion cap emits every blocked edge in partial risk flows | development implemented; validation deferred |
| [#1070](https://github.com/doublemover/PairOfCleats/issues/1070) | P2 | [P2] Risk traversal discards alternate same-depth paths before maxPathsPerPair | development implemented; validation deferred |
| [#1071](https://github.com/doublemover/PairOfCleats/issues/1071) | P2 | [P2] Embeddings shard rotation uses stale indexed size despite actual append offset | implemented in batch 3; focused proof and front gate pass |
| [#1072](https://github.com/doublemover/PairOfCleats/issues/1072) | P1 | [P1] Import cache keeps unchecked unresolved edges when stale-edge budget is exhausted | development implemented; validation deferred |
| [#1073](https://github.com/doublemover/PairOfCleats/issues/1073) | P1 | [P1] Build runtime can leak worker pools when final receipt refresh fails | runtime initialization admission/unwind/failure receipts and own metadata retry ed620fcc5/faf9c9f0b; actual-runtime controls authored; qualification deferred |
| [#1074](https://github.com/doublemover/PairOfCleats/issues/1074) | P1 | [P1] Stage1 timeout cleanup kills unowned tracked subprocesses globally | development implemented; validation deferred |
| [#1075](https://github.com/doublemover/PairOfCleats/issues/1075) | P2 | [P2] Stage1 setup errors bypass perf logger and scheduler cleanup | development implemented; integration/validation deferred |
| [#1076](https://github.com/doublemover/PairOfCleats/issues/1076) | P3 | [P3] Empty Stage1 modality leaves external abort listener attached | development implemented; integration/validation deferred |
| [#1077](https://github.com/doublemover/PairOfCleats/issues/1077) | P2 | [P2] Import cache file-set invalidation trims significant path whitespace | development implemented; validation deferred |
| [#1078](https://github.com/doublemover/PairOfCleats/issues/1078) | P2 | [P2] Embeddings cache file lookup collapses leading/trailing-space filenames | implemented in batch 3; focused proof and front gate pass |
| [#1079](https://github.com/doublemover/PairOfCleats/issues/1079) | P2 | [P2] One LanceDB variant write failure skips remaining variants | implemented in batch 3; focused proof and front gate pass |
| [#1080](https://github.com/doublemover/PairOfCleats/issues/1080) | P2 | [P2] Include control-flow minimum filters in query-cache identity | development implemented; integration/validation deferred |
| [#1081](https://github.com/doublemover/PairOfCleats/issues/1081) | P2 | [P2] Artifact cleanup reports success when removals fail | development implemented; validation deferred |
| [#1082](https://github.com/doublemover/PairOfCleats/issues/1082) | P2 | [P2] Symbol and call-site artifact writers rewrite path identity whitespace | development implemented; validation deferred |
| [#1083](https://github.com/doublemover/PairOfCleats/issues/1083) | P2 | [P2] Include query match policy in search cache key | development implemented; integration/validation deferred |
| [#1084](https://github.com/doublemover/PairOfCleats/issues/1084) | P2 | [P2] LMDB chunk hydration skips file-level metadata when file and ext exist | development implemented; integration/validation deferred |
| [#1085](https://github.com/doublemover/PairOfCleats/issues/1085) | P2 | [P2] Non-strict artifact validation skips JSON artifacts listed in a manifest | development implemented; validation deferred |
| [#1086](https://github.com/doublemover/PairOfCleats/issues/1086) | P2 | [P2] Bind dense-vector metadata path to the manifested binary payload | development implemented; integration/validation deferred |
| [#1087](https://github.com/doublemover/PairOfCleats/issues/1087) | P2 | [P2] Piece assembly drops SCM and file-level metadata from input indexes | development implemented; validation deferred |
| [#1088](https://github.com/doublemover/PairOfCleats/issues/1088) | P2 | [P2] Piece assembly silently drops sharded field_tokens inputs | development implemented; validation deferred |
| [#1089](https://github.com/doublemover/PairOfCleats/issues/1089) | P1 | [P1] Strict piece assembly silently drops corrupt manifested relations and risk artifacts | development implemented; validation deferred |
| [#1090](https://github.com/doublemover/PairOfCleats/issues/1090) | P2 | [P2] Reject wrong-mode input directories during piece assembly | development implemented; validation deferred |
| [#1091](https://github.com/doublemover/PairOfCleats/issues/1091) | P1 | [P1] Embedding manifest refresh discards all prior pieces when primary manifest is corrupt | implemented; focused proof and front gate pass |
| [#1092](https://github.com/doublemover/PairOfCleats/issues/1092) | P1 | [P1] LMDB rebuild clears the published database before transactional replacement | implemented; focused proof and front gate pass |
| [#1093](https://github.com/doublemover/PairOfCleats/issues/1093) | P2 | [P2] LMDB builder omits valid sharded file_meta and field_tokens artifacts | development implemented; validation deferred |
| [#1094](https://github.com/doublemover/PairOfCleats/issues/1094) | P2 | [P2] Async dense-vector ingestion maps ID-less rows to document zero | implemented in batch 3; focused proof and front gate pass |
| [#1095](https://github.com/doublemover/PairOfCleats/issues/1095) | P2 | [P2] SQLite build runner retains a process exit listener after every invocation | implemented in batch 3; focused proof and front gate pass |
| [#1096](https://github.com/doublemover/PairOfCleats/issues/1096) | P2 | [P2] Bundle-to-SQLite helper treats a shard without chunks as a successful file | implemented in batch 3; focused proof and front gate pass |
| [#1097](https://github.com/doublemover/PairOfCleats/issues/1097) | P2 | [P2] Strict dense loaders hide malformed manifested vector artifacts | development implemented; integration/validation deferred |
| [#1098](https://github.com/doublemover/PairOfCleats/issues/1098) | P1 | [P1] `index stats --verify` exits successfully on artifact checksum mismatch | implemented in batch 3; focused proof and front gate pass |
| [#1099](https://github.com/doublemover/PairOfCleats/issues/1099) | P2 | [P2] `index stats --verify` rejects valid vector-only indexes | development implemented; integration/validation deferred |
| [#1100](https://github.com/doublemover/PairOfCleats/issues/1100) | P2 | [P2] Index stats reports only the largest chunk-meta shard as total rows | development implemented; integration/validation deferred |
| [#1101](https://github.com/doublemover/PairOfCleats/issues/1101) | P3 | [P3] `index stats` totalBytes omits file metadata and several artifact families | development implemented; integration/validation deferred |
| [#1102](https://github.com/doublemover/PairOfCleats/issues/1102) | P2 | [P2] Canceled worker tokenization is retried on the main thread and can return success | development implemented; integration/validation deferred |
| [#1103](https://github.com/doublemover/PairOfCleats/issues/1103) | P2 | [P2] `index stats --verify` accepts metadata-only required artifact families | development implemented; integration/validation deferred |
| [#1104](https://github.com/doublemover/PairOfCleats/issues/1104) | P1 | [P1] Stage-3 marks embeddings ready before final manifest publication and validation | implemented; focused proof and front gate pass |
| [#1105](https://github.com/doublemover/PairOfCleats/issues/1105) | P2 | [P2] Managed relation adapters let generic options override scoped parser selection | development implemented; validation deferred |
| [#1106](https://github.com/doublemover/PairOfCleats/issues/1106) | P1 | [P1] Preserve other mode generations when recovering an unreadable current pointer | development implemented; validation deferred |
| [#1107](https://github.com/doublemover/PairOfCleats/issues/1107) | P1 | [P1] Do not route searches to marker-only unpromoted builds during mode-root fallback | development implemented; validation deferred |
| [#1108](https://github.com/doublemover/PairOfCleats/issues/1108) | P1 | [P1] Do not delete incremental SQLite WAL after an unchecked or failed checkpoint | implemented; focused proof and front gate pass |
| [#1109](https://github.com/doublemover/PairOfCleats/issues/1109) | P1 | [P1] Default all-mode SQLite tool ignores mixed published mode roots | development implemented; validation deferred |
| [#1110](https://github.com/doublemover/PairOfCleats/issues/1110) | P2 | [P2] Strict index validation ignores SHA-256 checksums on packed postings metadata | development implemented; validation deferred |
| [#1111](https://github.com/doublemover/PairOfCleats/issues/1111) | P2 | [P2] Strict validation accepts empty or wrong-type declared LanceDB payloads | implemented in batch 3; focused proof and front gate pass |
| [#1112](https://github.com/doublemover/PairOfCleats/issues/1112) | P2 | [P2] Bind publication records to the mode and build root being promoted | development implemented; integration/validation deferred |
| [#1113](https://github.com/doublemover/PairOfCleats/issues/1113) | P2 | [P2] LanceDB cache eviction can close a table during an in-flight ANN query | implemented in batch 3; focused proof and front gate pass |
| [#1114](https://github.com/doublemover/PairOfCleats/issues/1114) | P1 | [P1] Preserve LanceDB recall for large candidate filters | implemented; focused proof and front gate pass |
| [#1115](https://github.com/doublemover/PairOfCleats/issues/1115) | P2 | [P2] Coalesce concurrent LanceDB table opens to avoid untracked native handles | implemented in batch 3; focused proof and front gate pass |
| [#1116](https://github.com/doublemover/PairOfCleats/issues/1116) | P3 | [P3] Clearing LanceDB cache during connect leaks the late connection | development implemented; integration/validation deferred |
| [#1117](https://github.com/doublemover/PairOfCleats/issues/1117) | P2 | [P2] VFS collector cleanup can delete another collector's live spill files | development implemented; validation deferred |
| [#1118](https://github.com/doublemover/PairOfCleats/issues/1118) | P2 | [P2] Reject unknown publication statuses and absent validation evidence | development implemented; validation deferred |
| [#1119](https://github.com/doublemover/PairOfCleats/issues/1119) | other | Add original-vector and stored-vector retrieval oracle adapters | partial independent original/stored scalar oracle 6af774d1a; real capture/live search proof open |
| [#1120](https://github.com/doublemover/PairOfCleats/issues/1120) | other | Add a reproducible fusion and candidate-depth sweep to existing reports | partial production-stage fusion/depth replay 0aed57100/0500f370a; original score-space identity retained; real workload qualification open |
| [#1121](https://github.com/doublemover/PairOfCleats/issues/1121) | other | Separate rerank pool from final output and prototype bounded local rerankers | actual local-reranker original native-work prerequisites, private owner evidence and falsey primary preservation60d6f49b0; authored adapter/resource controls unvalidated; model/native/quality/memory/retry proof open; original diagnostic/descriptor and outer consumer classification af8e871f1/7275e6658 preserve independent inspection owners and exact causes |
| [#1122](https://github.com/doublemover/PairOfCleats/issues/1122) | other | Add count-aware exact-versus-ANN planning with conservative fallback | partial explicit opt-in count-aware stored/ANN planner 416c55635; native recall/deadline/resource and public activation qualification open |
| [#1123](https://github.com/doublemover/PairOfCleats/issues/1123) | other | Shadow query-class routing and per-repository candidate allocation | partial saved-pool and actual pipeline/federation shadow consumers 56060a038/9c487a57a; primary parity and held-out calibration unvalidated |
| [#1124](https://github.com/doublemover/PairOfCleats/issues/1124) | other | Add explicit edit-safe and exploration context-pack policies | pending |
| [#1125](https://github.com/doublemover/PairOfCleats/issues/1125) | other | Enforce tokenizer-aware rendered context budgets alongside byte limits | pending |
| [#1126](https://github.com/doublemover/PairOfCleats/issues/1126) | other | Prototype deterministic coverage-aware evidence-set selection | pending |
| [#1127](https://github.com/doublemover/PairOfCleats/issues/1127) | other | Add state-conditioned missing-evidence requests without persistent agent memory | pending |
| [#1128](https://github.com/doublemover/PairOfCleats/issues/1128) | other | Add dependency-aware context rendering order independent of rank | pending |
| [#1129](https://github.com/doublemover/PairOfCleats/issues/1129) | other | Validate restored evidence against source and dependency state | pending |
| [#1130](https://github.com/doublemover/PairOfCleats/issues/1130) | other | Expose context selection provenance and bounded next-evidence annotations | pending |
| [#1131](https://github.com/doublemover/PairOfCleats/issues/1131) | other | Add retrieval-to-use span telemetry and atomic citation evaluation | exact requested/opened original document and deferred hit/file binding5e335196e; authored consumer controls unvalidated; task-span use/host/telemetry acceptance open |
| [#1132](https://github.com/doublemover/PairOfCleats/issues/1132) | other | Prototype per-summary dependency manifests and deletion-safe SCC reuse | pending |
| [#1133](https://github.com/doublemover/PairOfCleats/issues/1133) | other | Prototype demand-directed refinement through existing semantic frontiers | pending |
| [#1134](https://github.com/doublemover/PairOfCleats/issues/1134) | other | Add feature-conformance adapters for existing call-target producers | actual transparent compiler aliases8f7fd1cfc, LSP callee ownership4292ace2e and retained provider source/context/evidence joins5e6de9946; compilerBindings20/lspBindings37/cfgFlow23/callFlow25/valueSlice8; authored checker/retained/provider negatives unvalidated; full language/runtime/research proof open |
| [#1135](https://github.com/doublemover/PairOfCleats/issues/1135) | other | Specify distinct path semantics and validate bounded trace witnesses | pending |
| [#1136](https://github.com/doublemover/PairOfCleats/issues/1136) | other | Join risk candidates to source-pinned semantic value-flow evidence | pending |
| [#1137](https://github.com/doublemover/PairOfCleats/issues/1137) | other | Add call-slice and recorded-coverage evidence tiers to test suggestions | pending |
| [#1138](https://github.com/doublemover/PairOfCleats/issues/1138) | other | Explain source freshness, analysis freshness and completion independently | pending |
| [#1139](https://github.com/doublemover/PairOfCleats/issues/1139) | other | Prototype exact compressed finite-string witness handles | pending |
| [#1140](https://github.com/doublemover/PairOfCleats/issues/1140) | other | Add offline semantic-index coverage analysis and SQLite plan experiments | pending |
| [#1141](https://github.com/doublemover/PairOfCleats/issues/1141) | other | Shadow cost-aware scheduler choices using existing trace and admission owners | pending |
| [#1142](https://github.com/doublemover/PairOfCleats/issues/1142) | other | Prototype versioned vector quantization with original-vector reranking | pending |
| [#1143](https://github.com/doublemover/PairOfCleats/issues/1143) | other | Add bounded cross-generation declaration correspondence without changing immutable source identity | pending |
| [#1144](https://github.com/doublemover/PairOfCleats/issues/1144) | other | Add paired repository-cluster quality comparisons to existing evaluation reports | partial shared paired repository quality reports fa3c1d44c/66b9f758b; independent population and empirical qualification open |
| [#1145](https://github.com/doublemover/PairOfCleats/issues/1145) | other | Route validated provider semantic facts through one canonical durable sink | partial eight complete identity-bearing source-linked report bounds b822d2462, owned canonical metadata and local adapter2; authored boundary/actual expansion controls unvalidated; durable public/provider/runtime integration remains open |
| [#1146](https://github.com/doublemover/PairOfCleats/issues/1146) | other | Bind provider tool profiles to observed executable and project identities | partial source authored; integration/qualification open |
| [#1147](https://github.com/doublemover/PairOfCleats/issues/1147) | other | Publish provider and consumer declarations with a conformance SDK | partial declaration SDK source; concrete recipes/qualification open |
| [#1148](https://github.com/doublemover/PairOfCleats/issues/1148) | other | Add a bounded JSONL provider adapter and source-pinned report importer | partial transport source; host/process qualification open |
| [#1149](https://github.com/doublemover/PairOfCleats/issues/1149) | other | Prototype explicit request-local semantic enrichment without generation mutation | partial request-local overlay source; opt-in/host qualification open |
| [#1150](https://github.com/doublemover/PairOfCleats/issues/1150) | other | Complete source admission for provider-only Elixir, Haskell and Zig routes | partial Haskell provider parser/cache fidelity a148c790c only; normal Elixir/Haskell/Zig source admission and real tooling remain pending; authored downstream consumer controls unvalidated |
| [#1151](https://github.com/doublemover/PairOfCleats/issues/1151) | other | Prototype snapshot-consistent structured Python types through Pyright TSP | pending |
| [#1152](https://github.com/doublemover/PairOfCleats/issues/1152) | other | Prototype Go package and type facts through a bounded native adapter | pending |
| [#1153](https://github.com/doublemover/PairOfCleats/issues/1153) | other | Add differential parser qualification for consumer-visible AST migrations | partial qualification helper; concrete migration adapters open |
| [#1154](https://github.com/doublemover/PairOfCleats/issues/1154) | other | Adopt TypeScript 7 native LSP as a first-class operational JS/TS provider | pending |
| [#1155](https://github.com/doublemover/PairOfCleats/issues/1155) | other | Migrate structured TypeScript semantics to the TS7.1 API with snapshot and disposal safety | pending |
| [#1156](https://github.com/doublemover/PairOfCleats/issues/1156) | other | Upgrade Babel parsing to Babel 8 with consumer-compatible JS/TS extraction | pending |
| [#1157](https://github.com/doublemover/PairOfCleats/issues/1157) | other | Add explicit alternative Python LSP profiles for BasedPyright, ty and Pyrefly | partial explicit provider profiles; recipe/runtime qualification open |
| [#1158](https://github.com/doublemover/PairOfCleats/issues/1158) | other | Wire Ruby LSP as a selectable semantic provider beyond installation detection | partial explicit Ruby LSP profile; recipe/runtime qualification open |
| [#1159](https://github.com/doublemover/PairOfCleats/issues/1159) | other | Add a qualified Prism syntax adapter for Ruby with exact source mapping | pending |
| [#1160](https://github.com/doublemover/PairOfCleats/issues/1160) | other | Complete PHP semantic adapter consumption and classify licensed alternatives | pending |
| [#1161](https://github.com/doublemover/PairOfCleats/issues/1161) | other | Admit C++ and Objective-C semantic sources with translation-unit build variants | pending |
| [#1162](https://github.com/doublemover/PairOfCleats/issues/1162) | other | Integrate structured Clang AST and preprocessing facts into semantic consumers | pending |
| [#1163](https://github.com/doublemover/PairOfCleats/issues/1163) | other | Add explicit CUDA source admission and host/device semantic variants | pending |
| [#1164](https://github.com/doublemover/PairOfCleats/issues/1164) | other | Consume rust-analyzer structured symbols, expansion maps and type evidence | partial Rust ordinary quoted const-type and outer-clause parser/cache groundwork749bc13f8; authored cold/warm and Unicode controls unvalidated; structured rust-analyzer/expansion/source integration remains pending |
| [#1165](https://github.com/doublemover/PairOfCleats/issues/1165) | other | Integrate Swift compiler index-store relations and SourceKit build context | pending |
| [#1166](https://github.com/doublemover/PairOfCleats/issues/1166) | other | Add a toolchain-aligned SwiftParser syntax adapter with consumer parity | pending |
| [#1167](https://github.com/doublemover/PairOfCleats/issues/1167) | other | Modernize the patched Tree-sitter runtime and pinned upstream grammar build channel | pending |
| [#1168](https://github.com/doublemover/PairOfCleats/issues/1168) | other | Integrate official Kotlin LSP as a first-class opt-in JVM provider | pending |
| [#1169](https://github.com/doublemover/PairOfCleats/issues/1169) | other | Add a Kotlin Analysis API producer for structured JVM symbols and bindings | pending |
| [#1170](https://github.com/doublemover/PairOfCleats/issues/1170) | other | Extend Java JDT integration with project-qualified structured bindings | pending |
| [#1171](https://github.com/doublemover/PairOfCleats/issues/1171) | other | Integrate official standalone Roslyn LSP alongside csharp-ls | pending |
| [#1172](https://github.com/doublemover/PairOfCleats/issues/1172) | other | Add Roslyn compiler fact production with C# and Visual Basic source admission | pending |
| [#1173](https://github.com/doublemover/PairOfCleats/issues/1173) | other | Integrate Scala Metals and import source-pinned SemanticDB facts | partial existing SemanticDB report complete UTF-8 output admission b822d2462, local adapter2; authored controls unvalidated; actual Metals/source/runtime/public integration remains pending |
| [#1174](https://github.com/doublemover/PairOfCleats/issues/1174) | other | Add project-qualified Dart analyzer facts beside the Analysis Server route | pending |
| [#1175](https://github.com/doublemover/PairOfCleats/issues/1175) | other | Integrate bounded Groovy compiler facts and an explicit Groovy LSP profile | pending |
| [#1176](https://github.com/doublemover/PairOfCleats/issues/1176) | other | Admit F# sources and integrate FsAutoComplete with compiler-service facts | pending |
| [#1177](https://github.com/doublemover/PairOfCleats/issues/1177) | other | Integrate Bash and Perl navigation profiles with source-pinned diagnostics | partial existing ShellCheck report complete output admission b822d2462, local adapter2; authored controls unvalidated; Bash/Perl profiles and public runtime integration remain pending |
| [#1178](https://github.com/doublemover/PairOfCleats/issues/1178) | perf | [Perf] Remove synchronous per-candidate realpath stalls from index discovery | development implemented; integration/validation deferred |
| [#1179](https://github.com/doublemover/PairOfCleats/issues/1179) | other | Add PowerShell AST admission and a bounded PSES provider | pending |
| [#1180](https://github.com/doublemover/PairOfCleats/issues/1180) | perf | [Perf] Batch bounded chunk tokenization tasks instead of one awaited worker round trip per chunk | bounded ordered batch source a12d36d0c; execution/performance unvalidated |
| [#1181](https://github.com/doublemover/PairOfCleats/issues/1181) | other | Add Erlang source admission and ELP definition/reference integration | pending |
| [#1182](https://github.com/doublemover/PairOfCleats/issues/1182) | perf | [Perf] Compute MinHash once per distinct token and share lexical frequency work | development implemented; integration/validation deferred |
| [#1183](https://github.com/doublemover/PairOfCleats/issues/1183) | perf | [Perf] Reuse complete validated lexical products during enrichment-only incremental refresh | qualified lexical checkpoint source a12d36d0c; parity/resource proof open |
| [#1184](https://github.com/doublemover/PairOfCleats/issues/1184) | other | Add OCaml syntax and Dune-aware OCaml-LSP semantic integration | pending |
| [#1185](https://github.com/doublemover/PairOfCleats/issues/1185) | perf | [Perf] Index file structural-match intervals once for chunk enrichment and cached replay | development implemented; integration/validation deferred |
| [#1186](https://github.com/doublemover/PairOfCleats/issues/1186) | other | Integrate project-qualified R and Julia language-server facts | pending |
| [#1187](https://github.com/doublemover/PairOfCleats/issues/1187) | perf | [Perf] Amortize cross-file symbol-cache expiry instead of scanning 20k entries on every overflow | development implemented; integration/validation deferred |
| [#1188](https://github.com/doublemover/PairOfCleats/issues/1188) | other | Add offline schema-qualified SQL binding and PostgreSQL tooling | partial existing offline SQL report complete output admission b822d2462, local adapter2; authored controls unvalidated; PostgreSQL/tool/source/public integration remains pending |
| [#1189](https://github.com/doublemover/PairOfCleats/issues/1189) | other | Implement offline schema and reference facts for structured configuration | partial offline JSON/JSONC evidence source 595f40bc2; remaining formats/schema qualification open; complete identity-bearing report bounds/local adapter2 b822d2462 authored unvalidated |
| [#1190](https://github.com/doublemover/PairOfCleats/issues/1190) | other | Integrate Vue, Svelte and Astro framework semantic source maps | partial Astro TS and generated source adapters 72ee40772/9a8d2732d; framework service/public proof open; complete mapped report bounds/local adapter2 b822d2462 authored unvalidated |
| [#1191](https://github.com/doublemover/PairOfCleats/issues/1191) | other | Link GraphQL schemas and Protobuf descriptors into queryable evidence | partial GraphQL and Protobuf source 595f40bc2; operational compiler and published proof open; complete UTF-8 report bounds/local adapter2 b822d2462 authored unvalidated |
| [#1192](https://github.com/doublemover/PairOfCleats/issues/1192) | other | Add HCL/Terraform admission and offline terraform-ls schema integration | pending |
| [#1193](https://github.com/doublemover/PairOfCleats/issues/1193) | other | Add a static-first Nix language profile with explicit evaluation boundaries | pending |
| [#1194](https://github.com/doublemover/PairOfCleats/issues/1194) | other | Ingest configured build-graph snapshots for CMake, Bazel and Make | partial configured CMake/Make snapshot source 595f40bc2; automatic acquisition/consumer proof open |
| [#1195](https://github.com/doublemover/PairOfCleats/issues/1195) | other | Add source-linked web/template reference adapters without template execution | partial explicit local template registry source 595f40bc2; broader scopes/host proof open; complete report bounds/local adapter2 b822d2462 authored unvalidated |
| [#1196](https://github.com/doublemover/PairOfCleats/issues/1196) | other | Bridge existing SCIP ingest into source-pinned semantic facts and define LSIF compatibility | partial SCIP bridge source; binary decoder/real publication open |
| [#1197](https://github.com/doublemover/PairOfCleats/issues/1197) | other | Acquire and project structured LSP observations through shared semantic consumers | partial retained LSP invocation ownership4292ace2e and original source/context/evidence provider summary admission5e6de9946; lsp37/call25; actual retained merge/join controls unvalidated; full provider/public/compiler integration remains open |
| [#1198](https://github.com/doublemover/PairOfCleats/issues/1198) | perf | [Perf] Batch persistent embedding-cache writes and coalesce hit touches | development implemented; integration/validation deferred |
| [#1199](https://github.com/doublemover/PairOfCleats/issues/1199) | perf | [Perf] Replace per-file full embedding-cache index snapshots with bounded delta checkpoints | source authored; unvalidated |
| [#1200](https://github.com/doublemover/PairOfCleats/issues/1200) | perf | [Perf] Build embedding-cache shard summaries once for pruning and compaction | source authored; unvalidated |
| [#1201](https://github.com/doublemover/PairOfCleats/issues/1201) | perf | [Perf] Qualify fused ONNX pooling and selective output fetches | partial output selection source e70a92166; fused graph inactive and unqualified |
| [#1202](https://github.com/doublemover/PairOfCleats/issues/1202) | perf | [Perf] Qualify model-specific ONNX execution profiles under a shared CPU budget | inactive qualification owner plus exact ONNX cleanup 2d5a9bed4/16e53a2a6; authored controls unvalidated; actual native retry safety/models/resource proof open |
| [#1203](https://github.com/doublemover/PairOfCleats/issues/1203) | perf | [Perf] Read parse checkpoints without decoding full incremental bundles twice | source authored; unvalidated |
| [#1204](https://github.com/doublemover/PairOfCleats/issues/1204) | perf | [Perf] Avoid redundant synchronous full-model hashing through verified artifact leases | source authored; unvalidated |
| [#1205](https://github.com/doublemover/PairOfCleats/issues/1205) | perf | [Perf] Build semantic compiler-session identity indexes instead of repeated inventory scans | development implemented; integration/validation deferred |
| [#1206](https://github.com/doublemover/PairOfCleats/issues/1206) | perf | [Perf] Remove full-clear vocabulary-cache cliffs in SQLite bundle ingestion | development implemented; integration/validation deferred |
| [#1207](https://github.com/doublemover/PairOfCleats/issues/1207) | perf | [Perf] Pipeline SQLite bundle decoding with ordered byte-bounded ingestion | partial source authored; integration/qualification open |
| [#1208](https://github.com/doublemover/PairOfCleats/issues/1208) | perf | [Perf] Spool Stage-3 vector channels instead of retaining the full corpus | ordinal spool source 4f267c9bd; actual writers authored, native/resource proof open |
| [#1209](https://github.com/doublemover/PairOfCleats/issues/1209) | perf | [Perf] Use canonical binary vector streams for ANN handoff and avoid mandatory dual serialization | partial source authored; integration/qualification open |
| [#1210](https://github.com/doublemover/PairOfCleats/issues/1210) | perf | [Perf] Keep no-yield postings iterations synchronous instead of allocating a promise per item | development implemented; integration/validation deferred |
| [#1211](https://github.com/doublemover/PairOfCleats/issues/1211) | perf | [Perf] Stream SQLite dense-vector reconciliation instead of materializing both generations | source authored; unvalidated |
| [#1212](https://github.com/doublemover/PairOfCleats/issues/1212) | perf | [Perf] Encode semantic rows once per admitted batch for sizing, hashing and writing | development implemented; integration/validation deferred |
| [#1213](https://github.com/doublemover/PairOfCleats/issues/1213) | perf | [Perf] Reuse compatible HNSW generations with measured delta and rebuild thresholds | partial unchanged-generation reuse source; deltas/native proof open |
| [#1214](https://github.com/doublemover/PairOfCleats/issues/1214) | perf | [Perf] Coalesce semantic family parts without weakening durable completion boundaries | durable coalesced semantic parts source 9c67f4711; fault/runtime proof open |
| [#1215](https://github.com/doublemover/PairOfCleats/issues/1215) | perf | [Perf] Add generation-safe LanceDB delta writes and bounded maintenance | partial unchanged-generation reuse source; deltas/maintenance proof open |
| [#1216](https://github.com/doublemover/PairOfCleats/issues/1216) | perf | [Perf] Ingest LanceDB vectors through bounded typed columnar batches | pending |
| [#1217](https://github.com/doublemover/PairOfCleats/issues/1217) | perf | [Perf] Amortize isolated ANN startup and overlap bounded backend stages | source lifecycle authored; native/resource qualification open |
| [#1218](https://github.com/doublemover/PairOfCleats/issues/1218) | perf | [Perf] Share token-aware deduplicated batching with inline embedding attachment | source authored; unvalidated |
| [#1219](https://github.com/doublemover/PairOfCleats/issues/1219) | perf | [Perf] Fuse vector postprocessing without repeated normalized-channel copies | source authored; unvalidated |
| [#1220](https://github.com/doublemover/PairOfCleats/issues/1220) | perf | [Perf] Preserve partial embedding reuse when one chunk changes the file fingerprint | development implemented; integration/validation deferred |
| [#1221](https://github.com/doublemover/PairOfCleats/issues/1221) | perf | [Perf] Add a validated cache-only Stage-3 path that avoids loading ONNX | cache-only source 4f267c9bd; real-model/cache race qualification open |
| [#1222](https://github.com/doublemover/PairOfCleats/issues/1222) | perf | [Perf] Skip unchanged embedding bundle hydration using verified coverage digests | source authored; unvalidated |
| [#1223](https://github.com/doublemover/PairOfCleats/issues/1223) | perf | [Perf] Solve compiler call summaries with dirty dependencies instead of full SCC rescans | source repair and regression authored; unvalidated |
| [#1224](https://github.com/doublemover/PairOfCleats/issues/1224) | perf | [Perf] Avoid full reaching-definition Map/Set snapshots at every CFG block | source repair and regression authored; unvalidated |
| [#1225](https://github.com/doublemover/PairOfCleats/issues/1225) | perf | [Perf] Share CFG effect and exception reachability instead of traversing suffixes per call | source repair and regression authored; unvalidated |
| [#1226](https://github.com/doublemover/PairOfCleats/issues/1226) | perf | [Perf] Index field-path overlap candidates instead of comparing every path pair | source repair and regression authored; unvalidated |
| [#1227](https://github.com/doublemover/PairOfCleats/issues/1227) | perf | [Perf] Avoid idle compression-worker startup for gzip sharded artifacts | development implemented; integration/validation deferred |
| [#1228](https://github.com/doublemover/PairOfCleats/issues/1228) | perf | [Perf] Make process-pool startup demand-driven and dispatch ready children independently | development implemented; integration/validation deferred |
| [#1229](https://github.com/doublemover/PairOfCleats/issues/1229) | perf | [Perf] Replace full pressure-telemetry cache sorts on each overflowing file | development implemented; integration/validation deferred |
| [#1230](https://github.com/doublemover/PairOfCleats/issues/1230) | perf | [Perf] Index LSP semantic source and declaration joins and reuse the inventory digest | partial actual iterative DocumentSymbol projection373cf39c2 preserves occurrences/source and rejects active cycles; authored deep/enrichment controls unvalidated; full research integration open |
| [#1231](https://github.com/doublemover/PairOfCleats/issues/1231) | perf | [Perf] Bound and share finally CFG expansion without merging abrupt completion routes | source repair and regression authored; unvalidated |
| [#1232](https://github.com/doublemover/PairOfCleats/issues/1232) | perf | [Perf] Eliminate cross-language throttle wake storms and duplicate pressure sampling | source repair and regression authored; unvalidated |
| [#1233](https://github.com/doublemover/PairOfCleats/issues/1233) | perf | [Perf] Reuse parser-owned classification spans instead of reparsing every eligible chunk | pending |
| [#1234](https://github.com/doublemover/PairOfCleats/issues/1234) | perf | [Perf] Propagate sealed semantic piece checksums into publication manifests | development implemented; integration/validation deferred |
| [#1235](https://github.com/doublemover/PairOfCleats/issues/1235) | perf | [Perf] Compile exact query eligibility over indexed candidate domains instead of scanning all chunk metadata | development implemented; integration/validation deferred |
| [#1236](https://github.com/doublemover/PairOfCleats/issues/1236) | perf | [Perf] Derive metadata and churn from one qualified Git history traversal | source repair and regression authored; unvalidated |
| [#1237](https://github.com/doublemover/PairOfCleats/issues/1237) | perf | [Perf] Add exact score-bound pruning for broad-query JS BM25 top-k | conservative positive-domain WAND source 5d1a98632; numerical/runtime/performance proof open |
| [#1238](https://github.com/doublemover/PairOfCleats/issues/1238) | perf | [Perf] Reuse coverage-qualified discovery inventory in filesystem import indexing | partial actual discovery/preprocess/order/import raw directory reuse accf534a5, bounded private inventory and fresh identity admission; stale selected seeds cannot revive removed files; importResolution7; authored controls unvalidated, native Dir/large workload/memory/latency proof open |
| [#1239](https://github.com/doublemover/PairOfCleats/issues/1239) | perf | [Perf] Build one file inventory per shared-module ledger generation | development implemented; integration/validation deferred |
| [#1240](https://github.com/doublemover/PairOfCleats/issues/1240) | perf | [Perf] Reuse build-owned verified semantic source retention receipts | development implemented; integration/validation deferred |
| [#1241](https://github.com/doublemover/PairOfCleats/issues/1241) | perf | [Perf] Defer unused lexical candidate unions and deduplicate query-gram posting visits | development implemented; integration/validation deferred |
| [#1242](https://github.com/doublemover/PairOfCleats/issues/1242) | perf | [Perf] Reuse one verified artifact snapshot during fixture health evaluation | source authored; unvalidated |
| [#1243](https://github.com/doublemover/PairOfCleats/issues/1243) | perf | [Perf] Bound discovery enumeration before materializing the full candidate path list | source bounded discovery authored; SCM/native/performance proof open |
| [#1244](https://github.com/doublemover/PairOfCleats/issues/1244) | perf | [Perf] Choose cardinality-aware Set and bitmap filter intersections | development implemented; integration/validation deferred |
| [#1245](https://github.com/doublemover/PairOfCleats/issues/1245) | perf | [Perf] Share a run-scoped discovery snapshot across governance reports | development implemented; integration/validation deferred |
| [#1246](https://github.com/doublemover/PairOfCleats/issues/1246) | perf | [Perf] Skip physical-core subprocess probes when test jobs are explicit | development implemented; integration/validation deferred |
| [#1247](https://github.com/doublemover/PairOfCleats/issues/1247) | perf | [Perf] Reuse immutable dispatch member and accessor summaries across call sites | actual reference/accessor roles and transparent compiler assignment/class/field/adapter consumers8f7fd1cfc; compilerBindings20/cfgFlow23/callFlow25/valueSlice8; authored actual channels unvalidated; dynamic/destructuring completeness and summary performance remain open |
| [#1248](https://github.com/doublemover/PairOfCleats/issues/1248) | perf | [Perf] Index worker message peers and propagate changed port facts only | source repair and regression authored; unvalidated |
| [#1249](https://github.com/doublemover/PairOfCleats/issues/1249) | perf | [Perf] Reuse bounded declaration-alias closures across provider call-target joins | source repair and regression authored; unvalidated |
| [#1250](https://github.com/doublemover/PairOfCleats/issues/1250) | perf | [Perf] Amortize bundle-transform workers and return only requested results | source authored; unvalidated |
| [#1251](https://github.com/doublemover/PairOfCleats/issues/1251) | perf | [Perf] Prewarm query hot caches once per disk generation instead of rebuilding on misses | source repair and regression authored; unvalidated |
| [#1252](https://github.com/doublemover/PairOfCleats/issues/1252) | perf | [Perf] Fuse manifest integrity reads with artifact decoding during validation | source authored; unvalidated |
| [#1253](https://github.com/doublemover/PairOfCleats/issues/1253) | perf | [Perf] Project cold chunk identity fields without retaining full cold rows | development implemented; integration/validation deferred |
| [#1254](https://github.com/doublemover/PairOfCleats/issues/1254) | perf | [Perf] Stream benchmark logs once into independent report reducers | source authored; unvalidated |
| [#1255](https://github.com/doublemover/PairOfCleats/issues/1255) | perf | [Perf] Share risk witness prefixes and release consumed traversal states | source authored; unvalidated |
| [#1256](https://github.com/doublemover/PairOfCleats/issues/1256) | perf | [Perf] Prepare immutable risk edge metadata once rather than per traversal state | development implemented; integration/validation deferred |
| [#1257](https://github.com/doublemover/PairOfCleats/issues/1257) | other | Unify configuration guidance and retire the obsolete two-key hard-cut prescription | source task navigation authored; recipe/link qualification open |
| [#1258](https://github.com/doublemover/PairOfCleats/issues/1258) | other | Rewrite language onboarding and capability guidance against native-only and current inference owners | source config journeys authored; behavior qualification open |
| [#1259](https://github.com/doublemover/PairOfCleats/issues/1259) | other | Consolidate duplicated artifact and analysis prose contracts without losing stricter reader guarantees | source contract consolidation authored; compatibility proof open |
| [#1260](https://github.com/doublemover/PairOfCleats/issues/1260) | other | Reorganize user documentation around tasks and separate dated receipts from current guides | partial current/historical classification; full link/encoding audit open |
| [#1261](https://github.com/doublemover/PairOfCleats/issues/1261) | other | Rewrite setup as explicit checkout-to-target recipes with readiness and download boundaries | source contributor journeys authored; recipe proof open |
| [#1262](https://github.com/doublemover/PairOfCleats/issues/1262) | other | Add complete source-checkout onboarding for VS Code and native TUI instead of command-only guides | partial editor/native onboarding source; clean-checkout/host proof open |
| [#1263](https://github.com/doublemover/PairOfCleats/issues/1263) | other | Document a complete two-repository workspace search journey and current federation limits | source language capabilities guide authored; fine-grained registry proof open |
| [#1264](https://github.com/doublemover/PairOfCleats/issues/1264) | other | [Storage] Unify app-owned paths behind one explainable storage layout and ownership resolver | partial layout/adoption plus exact destination-probe6a68a3382 and actual directory inventory/configuration owners e0c4ff524; runtime/platform qualification open; actual Lua archive/source/staging lifetime6ded2e181 and lock native-close prerequisite ebdce2908 authored unvalidated; Dir/transfer original work now gates actual native close c834d3788, explicit false unconfirmed and exact self-predicate immutable; authored disposable/managed counters unvalidated |
| [#1265](https://github.com/doublemover/PairOfCleats/issues/1265) | other | [Storage] Migrate legacy owned data with resumable verified cutover and rollback | explicit owner migration retains actual transfer/Dir descriptors and original exclusions through e0c4ff524; tiny recovery/resume controls unvalidated; generic cache/repos migration prohibited; original lock work now gates native close ebdce2908; authored unvalidated; Dir/transfer original work now gates actual native close c834d3788, explicit false unconfirmed and exact self-predicate immutable; authored disposable/managed counters unvalidated |
| [#1266](https://github.com/doublemover/PairOfCleats/issues/1266) | other | [Storage] Add unified CLI inventory, diagnosis, configuration and safe cleanup planning | partial reviewed routing/category/probe policy ed1124024/f1fe47023/c2ac1af83; execution open |
| [#1267](https://github.com/doublemover/PairOfCleats/issues/1267) | other | [Storage] Coordinate lifecycle quotas and leases without deleting saved evidence or active assets | exact generic lock publication f04f3261c, runtime unwind/recording8946032c4 and independent replay/log teardownc7e0f7ccf, actual archive FD/nested recovery17da596aa; authored controls unvalidated; native/IPC/cross-process/Windows/resource proof open; actual Lua nested recovery6ded2e181 and original lock write/stat prerequisites ebdce2908; authored unvalidated; Dir/transfer original work now gates actual native close c834d3788, explicit false unconfirmed and exact self-predicate immutable; authored disposable/managed counters unvalidated |
| [#1268](https://github.com/doublemover/PairOfCleats/issues/1268) | other | [Storage] Route managed child-tool caches and scratch data into owned storage with explicit exceptions | partial managed child routing and actual archive/verifier/removal lifetime owners through 8cadfed8c; source controls unvalidated; runtime qualification open; Lua now consumes bounded shared archive owner6ded2e181, retaining original source/stage/temp/lock; authored unvalidated; Dir/transfer original work now gates actual native close c834d3788, explicit false unconfirmed and exact self-predicate immutable; authored disposable/managed counters unvalidated |
| [#1269](https://github.com/doublemover/PairOfCleats/issues/1269) | other | Refresh contributor test and benchmark recipes after source-owner moves and runner consolidation | source backend recipes authored; runtime qualification open |
| [#1270](https://github.com/doublemover/PairOfCleats/issues/1270) | other | Separate shipped backend recipes from evaluation-only recommendations and dependency labels | source workspace/service journeys authored; behavior qualification open |
| [#1271](https://github.com/doublemover/PairOfCleats/issues/1271) | other | Rewrite viewer documentation as two current workflows with scoped evidence instead of campaign handoffs | source self-contained viewer journey authored; modern renderer/host proof open |
| [#1272](https://github.com/doublemover/PairOfCleats/issues/1272) | other | [Setup] Keep help and checkout diagnosis available before bootstrap readiness | partial source authored; integration/qualification open |
| [#1273](https://github.com/doublemover/PairOfCleats/issues/1273) | other | [Viewer] Add a canonical local preview command with safe startup and recovery | partial source authored; integration/qualification open |
| [#1274](https://github.com/doublemover/PairOfCleats/issues/1274) | other | [Config] Explain and validate effective settings instead of only raw file shape | pending |
| [#1275](https://github.com/doublemover/PairOfCleats/issues/1275) | other | [Setup] Add a reviewable first-search plan with explicit capability choices | pending |
| [#1276](https://github.com/doublemover/PairOfCleats/issues/1276) | other | Summarize package patches once with real file/hunk counts and clear failures | source authored; unvalidated |
| [#1277](https://github.com/doublemover/PairOfCleats/issues/1277) | perf | [Perf] Add dependency-safe bounded concurrency to patch preparation and native bootstrap | development implemented; integration/validation deferred |
| [#1278](https://github.com/doublemover/PairOfCleats/issues/1278) | perf | [Perf] Push selective BM25 posting and length hydration into SQLite | selective SQLite facts source 5d1a98632; plans/parity/performance unvalidated |
| [#1279](https://github.com/doublemover/PairOfCleats/issues/1279) | perf | [Perf] Use indexed cold filter enumeration without whole-corpus metadata hydration | partial sealed SQLite fact pages 9a3c4595b; cold/warm controls authored, SQL/resource/latency proof open |
| [#1280](https://github.com/doublemover/PairOfCleats/issues/1280) | perf | [Perf] Qualify a blocked contiguous exact dense-scan kernel without per-row view allocation | source dense offset/cooperative scan authored; unvalidated |
| [#1281](https://github.com/doublemover/PairOfCleats/issues/1281) | perf | [Perf] Coalesce retrieval cache touches and avoid full cache serialization on every hit | source repair and regression authored; unvalidated |
| [#1282](https://github.com/doublemover/PairOfCleats/issues/1282) | other | [Setup] Provision and verify the selected modern bootstrap toolchain across platforms | actual Windows capability/apply-lock resource recovery363d77609 authored unvalidated; shipped allocation/installer/native acceptance remains blocked and separate; actual Lua archive and selected mode admission6ded2e181 authored unvalidated; no runtime readiness claim; Dir/transfer original work now gates actual native close c834d3788, explicit false unconfirmed and exact self-predicate immutable; authored disposable/managed counters unvalidated |
| [#1283](https://github.com/doublemover/PairOfCleats/issues/1283) | other | [Workspace] Guide users from two repository roots to a validated federated search | pending |
| [#1284](https://github.com/doublemover/PairOfCleats/issues/1284) | other | [TUI] Implement captured mouse focus, selection and scrolling instead of discarding events | source interaction authored; native qualification open |
| [#1285](https://github.com/doublemover/PairOfCleats/issues/1285) | other | [TUI] Add safe paste, cursor editing and schema-native controls to existing forms | source typed editing authored; native qualification open |
| [#1286](https://github.com/doublemover/PairOfCleats/issues/1286) | other | [TUI] Show truthful time-aware activity and measured progress for long-running work | partial canonical watch readiness 4465e6498 and terminal progress; actual host proof open |
| [#1287](https://github.com/doublemover/PairOfCleats/issues/1287) | other | [TUI] Make help fully reachable and unify searchable action discovery with actual bindings | source help ownership authored; native qualification open |
| [#1288](https://github.com/doublemover/PairOfCleats/issues/1288) | P1 | [P1] Build an installable VSIX instead of a renamed source ZIP | development implemented; validation deferred |
| [#1289](https://github.com/doublemover/PairOfCleats/issues/1289) | P1 | [P1] Package Sublime plugins at archive root with the canonical package identity | development implemented; validation deferred |
| [#1290](https://github.com/doublemover/PairOfCleats/issues/1290) | P2 | [P2] Own and reap every editor request across window close, reload and uninstall | development implemented; integration/validation deferred |
| [#1291](https://github.com/doublemover/PairOfCleats/issues/1291) | P2 | [P2] Make VS Code replay and stop actions target the exact saved workflow session | development implemented; validation deferred |
| [#1292](https://github.com/doublemover/PairOfCleats/issues/1292) | P2 | [P2] Bind inline editor intelligence to source, generation and current interaction | development implemented; integration/validation deferred |
| [#1293](https://github.com/doublemover/PairOfCleats/issues/1293) | other | [Enhancement] Resolve and explain editor settings for the selected repository | partial editor authority source; host qualification open |
| [#1294](https://github.com/doublemover/PairOfCleats/issues/1294) | other | [TUI] Prioritize the focused work pane with a height-aware compact layout | source compact layout authored; native qualification open |
| [#1295](https://github.com/doublemover/PairOfCleats/issues/1295) | other | [Viewer] Replace the settings wall with a scene-first, capability-aware control workspace | partial source authored; integration/qualification open |
| [#1296](https://github.com/doublemover/PairOfCleats/issues/1296) | other | [Viewer] Ship a striking Tron-inspired default with composable glass, light and motion presets | exact committed publication, source fallback, enhancement generation and returned construction ownership7e378d245; authored controls unvalidated; broader viewer/reentrant/native acceptance open; actual async normal maps now update existing glass materials203b55251; raster/host qualification open; original diagnostic/descriptor/ownership snapshots364b9ac4b preserve independent inspection failures through actual construction/resource/fallback; authored inert controls unvalidated; generic native-retry prerequisites remain separately open |
| [#1297](https://github.com/doublemover/PairOfCleats/issues/1297) | other | [Viewer] Replace hidden cap stacks with progressive detail and truthful coverage | partial source authored; integration/qualification open |
| [#1298](https://github.com/doublemover/PairOfCleats/issues/1298) | other | [Viewer] Make keyboard camera control focus-safe and expose an accessible navigation surface | source authored; unvalidated |
| [#1299](https://github.com/doublemover/PairOfCleats/issues/1299) | other | [Viewer] Add reduced-motion and idle-aware rendering with trustworthy frame telemetry | partial source authored; integration/qualification open |
| [#1300](https://github.com/doublemover/PairOfCleats/issues/1300) | other | [Viewer] Preserve a working evidence browser through module, WebGL and context-loss failures | partial source authored; integration/qualification open |
| [#1301](https://github.com/doublemover/PairOfCleats/issues/1301) | other | [Viewer] Fit and navigate the full scene with adaptive zoom and readable labels | pending |
| [#1302](https://github.com/doublemover/PairOfCleats/issues/1302) | other | [Viewer] Make directed pipes visually distinguishable and reconcile plumbing inspection with visible filters | partial source authored; integration/qualification open |
| [#1303](https://github.com/doublemover/PairOfCleats/issues/1303) | other | [Enhancement] Connect both editors to source-qualified definition and reference navigation | actual VSCode URI/file/root1c1e712cd and Sublime original deferred file/hit5e335196e binding; authored actual consumer negatives unvalidated; supported/remote editor integration open |
| [#1304](https://github.com/doublemover/PairOfCleats/issues/1304) | other | [Enhancement] Expose bounded semantic find, detail and trace workflows in both editors | partial canonical workflows plus exact VSCode/Sublime native target/request binding5e335196e; authored controls unvalidated; complete graph/federation/editor capabilities open |
| [#1305](https://github.com/doublemover/PairOfCleats/issues/1305) | other | [Enhancement] Add editor filter-only enumeration and generation-safe continuation | partial VSCode/Sublime continuation progress893a0ce67/fda82b27d binds private original array/window/epoch/context/session/membership through normalization/JSON storage; failed save retains prior evidence; actual host/service/source freshness qualification open |
| [#1306](https://github.com/doublemover/PairOfCleats/issues/1306) | other | [Enhancement] Make remote editor execution and API repository mapping explicit | partial service mapping source; topology qualification open |
| [#1307](https://github.com/doublemover/PairOfCleats/issues/1307) | other | [Enhancement] Turn editor context and risk output into reusable source-linked evidence | source context/risk review and export authored; unvalidated |
| [#1308](https://github.com/doublemover/PairOfCleats/issues/1308) | other | [Enhancement] Show actionable editor workflow progress and recoverable service readiness | partial structured progress/task source; producer/host qualification open |
| [#1309](https://github.com/doublemover/PairOfCleats/issues/1309) | other | [Viewer] Own and retire environment render targets when replacing fallback lighting | source authored; unvalidated |
| [#1310](https://github.com/doublemover/PairOfCleats/issues/1310) | other | Keep CLI log/status lines compact without changing the progress-bar look | progress source a3eeb9c32; terminal regressions unrun |
| [#1311](https://github.com/doublemover/PairOfCleats/issues/1311) | other | [Tooling] Execute dependency-aware managed provisioning instead of stopping at missing runtimes | Windows prerequisite/capability recovery363d77609 and actual official-response lifetime2b80ae1aa authored unvalidated; portable recipe and real provider qualification open; actual Lua shared archive/private nested lock recovery6ded2e181; authored unvalidated; Dir/transfer original work now gates actual native close c834d3788, explicit false unconfirmed and exact self-predicate immutable; authored disposable/managed counters unvalidated |
| [#1312](https://github.com/doublemover/PairOfCleats/issues/1312) | other | [Tooling] Add durable per-tool install receipts and verified update, repair and removal | strict managed/Go/file/Dir and shared official response owners through2b80ae1aa; original observers/falsey causes retained; authored actual controls unvalidated; archive/recipe/host acceptance open; actual Lua original archive/stage/lock recovery6ded2e181; no durable protocol qualification; Dir/transfer original work now gates actual native close c834d3788, explicit false unconfirmed and exact self-predicate immutable; authored disposable/managed counters unvalidated |
| [#1313](https://github.com/doublemover/PairOfCleats/issues/1313) | other | [Tooling] Provision structural engines and operational CLI prerequisites by selected feature | partial ownership source e835f6699; concrete recipes/runtime lifetime proof open |
| [#1314](https://github.com/doublemover/PairOfCleats/issues/1314) | other | [Diagnostics] Persist embedding child failures in run-scoped logs and advertise the actual evidence | run-scoped diagnostic mappings plus independent latest/attempt state and event sinks 78e1a77a3; authored actual publisher controls unvalidated; actual child failure acceptance open |
| [#1315](https://github.com/doublemover/PairOfCleats/issues/1315) | P1 | [P1] Serialize crash-log error writes with live appenders and preserve terminal error state | serialized append/terminal ownership source plus sink isolation 78e1a77a3; primary errors preserved; runtime/fault qualification deferred |
| [#1316](https://github.com/doublemover/PairOfCleats/issues/1316) | other | [Viewer] Fail map export and preview admission when requested output was not written | source authored; unvalidated |
| [#1317](https://github.com/doublemover/PairOfCleats/issues/1317) | other | [Viewer] Pin running preview sessions instead of rereading one shared mutable HTML file | partial source authored; integration/qualification open |
| [#1318](https://github.com/doublemover/PairOfCleats/issues/1318) | P2 | [P2] Bound embedding subprocess line forwarding and keep stdout/stderr framing separate | development implemented; integration/validation deferred |
| [#1319](https://github.com/doublemover/PairOfCleats/issues/1319) | other | [Build] Reuse sealed completed stages from compatible failed generations | pending |
| [#1320](https://github.com/doublemover/PairOfCleats/issues/1320) | perf | [Perf] Reuse freshness-qualified discovery and preprocessing across build retries | retry snapshot source a12d36d0c; fresh source admission authored, unvalidated |
| [#1321](https://github.com/doublemover/PairOfCleats/issues/1321) | other | [Build] Seal independently validated graph capability before optional backend work | pending |
| [#1322](https://github.com/doublemover/PairOfCleats/issues/1322) | other | [Build] Add reviewable resume and validate-only recovery plans for retained runs | pending |
| [#1323](https://github.com/doublemover/PairOfCleats/issues/1323) | P2 | [P2] Do not block embedding-disabled Stage2 recovery on inactive model execution requirements | development implemented; integration/validation deferred |
| [#1324](https://github.com/doublemover/PairOfCleats/issues/1324) | other | [Viewer] Open saved map artifacts without regenerating from the current index | partial source authored; integration/qualification open |
| [#1325](https://github.com/doublemover/PairOfCleats/issues/1325) | other | [Build] Preflight requested embedding assets and execution plan before expensive Stage2 work | pending |
| [#1326](https://github.com/doublemover/PairOfCleats/issues/1326) | P2 | [P2] Finalize CLI output before closing the display and preserve JSONL framing | development implemented; integration/validation deferred |
| [#1327](https://github.com/doublemover/PairOfCleats/issues/1327) | other | [Diagnostics] Compare durable build execution plans and actual work across attempts | pending |
| [#1328](https://github.com/doublemover/PairOfCleats/issues/1328) | P2 | [P2] Derive build completion summaries from the selected run result, not stale preprocess stats | development implemented; integration/validation deferred |
| [#1329](https://github.com/doublemover/PairOfCleats/issues/1329) | perf | [Perf] Move file-local JS/TS analysis off the coordinator through a bounded coarse worker contract | pending |
| [#1330](https://github.com/doublemover/PairOfCleats/issues/1330) | perf | [Perf] Release CPU admission while file tasks await nested I/O and reacquire only for compute | partial source integration; mixed wait boundaries and qualification open |
| [#1331](https://github.com/doublemover/PairOfCleats/issues/1331) | P2 | [P2] Enforce scheduler-adapter concurrency instead of exposing it as a nonbinding label | development implemented; integration/validation deferred |
| [#1332](https://github.com/doublemover/PairOfCleats/issues/1332) | P2 | [P2] Report observed token execution routes and separate waiting requests from busy workers | development implemented; integration/validation deferred |
| [#1333](https://github.com/doublemover/PairOfCleats/issues/1333) | P2 | [P2] Cancel preprocessing line reads and preserve unknown counts on IO failure | development implemented; validation deferred |
| [#1334](https://github.com/doublemover/PairOfCleats/issues/1334) | other | [CLI] Make the existing progress bars responsive to terminal width and useful measured detail | progress source a3eeb9c32; terminal regressions unrun |
| [#1335](https://github.com/doublemover/PairOfCleats/issues/1335) | P2 | [P2] Bind Tree-sitter subprocess fanout to the effective build resource envelope | development implemented; validation deferred |
| [#1336](https://github.com/doublemover/PairOfCleats/issues/1336) | perf | [Perf] Choose Tree-sitter warm-parser lanes from admitted parse cost rather than wave count alone | source authored; unvalidated |
| [#1337](https://github.com/doublemover/PairOfCleats/issues/1337) | P2 | [P2] Serialize Tree-sitter worker initialization and fence late pools after shutdown | development implemented; validation deferred |
| [#1338](https://github.com/doublemover/PairOfCleats/issues/1338) | P2 | [P2] Fail API-contract reports when declared call-site evidence cannot load | development implemented; integration/validation deferred |
| [#1339](https://github.com/doublemover/PairOfCleats/issues/1339) | P2 | [P2] Fail closed when an explicitly configured ONNX model path is missing | development implemented; integration/validation deferred |
| [#1340](https://github.com/doublemover/PairOfCleats/issues/1340) | P2 | [P2] Version text-vector cache rows instead of inferring encoding from possibly truncated blobs | implemented in batch 3; focused proof and front gate pass |
| [#1341](https://github.com/doublemover/PairOfCleats/issues/1341) | P1 | [P1] Validate the effective query embedding identity after provider fallback before ANN reuse | implemented; focused proof and front gate pass |
| [#1342](https://github.com/doublemover/PairOfCleats/issues/1342) | other | [Reliability] Give hard-pressure tokenizer admission a bounded no-progress recovery path | pending |
| [#1343](https://github.com/doublemover/PairOfCleats/issues/1343) | P2 | [P2] Reject Python AST admission during shutdown instead of stranding requests | development implemented; validation deferred |
| [#1344](https://github.com/doublemover/PairOfCleats/issues/1344) | P2 | [P2] Reject unknown index subcommands and invalid stages before admitting a full build | development implemented; integration/validation deferred |
| [#1345](https://github.com/doublemover/PairOfCleats/issues/1345) | P2 | [P2] Resolve workspace child startup settings per target instead of inheriting the launch directory | development implemented; integration/validation deferred |
| [#1346](https://github.com/doublemover/PairOfCleats/issues/1346) | P2 | [P2] Preserve explicit validation and embedding flags across background Stage2 handoff | development implemented; integration/validation deferred |
| [#1347](https://github.com/doublemover/PairOfCleats/issues/1347) | P2 | [P2] Do not forward the globally accepted -v version flag into mutating leaf commands | development implemented; integration/validation deferred |
| [#1348](https://github.com/doublemover/PairOfCleats/issues/1348) | other | [Indexing] Make cross-file fidelity budgets explicit and preserve durable omission coverage | source-qualified replay mappings plus own argument keys 80ad120e9, callFlow21; authored cold/warm controls unvalidated; full resume qualification open |
| [#1349](https://github.com/doublemover/PairOfCleats/issues/1349) | P2 | [P2] Give inline and daemon-prewarm embedding leases an explicit runtime teardown owner | deterministic embedding/reranker parent ownership plus original native-work tensor/session/tokenizer closure prerequisites60d6f49b0; authored consumers unvalidated; actual models/native/GC/runtime qualification open; original diagnostic/consumer ownership af8e871f1/7275e6658 preserves independent inspection failures |
| [#1350](https://github.com/doublemover/PairOfCleats/issues/1350) | P2 | [P2] Report unconfirmed LSP disposal instead of returning a successful pool drain | development implemented; integration/validation deferred |
| [#1351](https://github.com/doublemover/PairOfCleats/issues/1351) | P2 | [P2] Preserve manifest integrity errors during graph artifact admission | development implemented; integration/validation deferred |
| [#1352](https://github.com/doublemover/PairOfCleats/issues/1352) | P2 | [P2] Pin every search read to the request's selected per-mode generation | development implemented; integration/validation deferred |
| [#1353](https://github.com/doublemover/PairOfCleats/issues/1353) | P2 | [P2] Honor bare --no-fallback before selecting a user-scope tooling install | development implemented; integration/validation deferred |
| [#1354](https://github.com/doublemover/PairOfCleats/issues/1354) | P2 | [P2] Stage and verify complete ONNX model artifact sets before publishing a download target | development implemented; integration/validation deferred |
| [#1355](https://github.com/doublemover/PairOfCleats/issues/1355) | P2 | [P2] Resolve a reusable inline model identity before sealing caches and dense readiness | development implemented; integration/validation deferred |
| [#1356](https://github.com/doublemover/PairOfCleats/issues/1356) | P2 | [P2] Preserve upstream risk coverage when reporting zero flows and strict readiness | development implemented; integration/validation deferred |
| [#1357](https://github.com/doublemover/PairOfCleats/issues/1357) | P1 | [P1] Preserve complete artifacts when keepRaw fans out a single-use row iterator | implemented; focused proof and front gate pass |
| [#1358](https://github.com/doublemover/PairOfCleats/issues/1358) | perf | [Perf] Batch binary-columnar data and sidecar writes instead of issuing three writes per row | development implemented; integration/validation deferred |
| [#1359](https://github.com/doublemover/PairOfCleats/issues/1359) | perf | [Perf] Buffer generic JSON encoding and keep no-backpressure traversal synchronous | development implemented; integration/validation deferred |
| [#1360](https://github.com/doublemover/PairOfCleats/issues/1360) | perf | [Perf] Encode packed postings into bounded buffers without per-integer Buffer allocation | development implemented; integration/validation deferred |
| [#1361](https://github.com/doublemover/PairOfCleats/issues/1361) | P2 | [P2] Forward configured gzip options through JSONL batch writers | development implemented; validation deferred |
| [#1362](https://github.com/doublemover/PairOfCleats/issues/1362) | P2 | [P2] Reject unavailable relation evidence instead of returning false-empty filtered search | development implemented; integration/validation deferred |
| [#1363](https://github.com/doublemover/PairOfCleats/issues/1363) | perf | [Perf] Reuse bounded prepared artifact rows across projection, sizing and output passes | pending |
| [#1364](https://github.com/doublemover/PairOfCleats/issues/1364) | perf | [Perf] Make field-postings shards byte-bounded and stream the compatibility merge | partial bounded compatibility transport source 9c67f4711; physical range sharding open |
| [#1365](https://github.com/doublemover/PairOfCleats/issues/1365) | perf | [Perf] Share active artifact compression workers under the build CPU and byte budget | source repair and regression authored; unvalidated |
| [#1366](https://github.com/doublemover/PairOfCleats/issues/1366) | perf | [Perf] Plan one required sparse artifact representation before emitting compatibility copies | pending |
| [#1367](https://github.com/doublemover/PairOfCleats/issues/1367) | other | [Viewer] Fix world-depth occlusion and glass/path compositing instead of drawing overlays through files | partial source authored; integration/qualification open |

| [#1368](https://github.com/doublemover/PairOfCleats/issues/1368) | P2 | [P2] Derive JSONL block length from encoded bytes instead of trusting optional lineBytes | source repair and regression authored; unvalidated |
| [#1369](https://github.com/doublemover/PairOfCleats/issues/1369) | perf | [Perf] Reuse dependency-qualified artifact families during partial rebuilds | source repair and regression authored; unvalidated |
| [#1370](https://github.com/doublemover/PairOfCleats/issues/1370) | other | [Viewer] Keep semantic selection, highlight and source actions coherent outside drawn scope | source authored; unvalidated |
| [#1371](https://github.com/doublemover/PairOfCleats/issues/1371) | P2 | [P2] Serve the complete viewer module graph in FPS and LOD benchmark previews | source repair and regression authored; unvalidated |
| [#1372](https://github.com/doublemover/PairOfCleats/issues/1372) | P2 | [P2] Gate Three.js browser qualification on phase-local errors and a rendered scene | exact renderer generation and returned partial-construction owners7e378d245; authored actual inert constructor/async controls unvalidated; inaccessible allocations/post-install native work and host qualification open; returned normal textures and explicit-false disposal203b55251 authored unvalidated; host/GPU proof remains open; original diagnostic/descriptor/ownership snapshots364b9ac4b preserve independent inspection failures through actual construction/resource/fallback; authored inert controls unvalidated; generic native-retry prerequisites remain separately open |
| [#1373](https://github.com/doublemover/PairOfCleats/issues/1373) | P2 | [P2] Reconcile repo-map and canonical chunk identities before building map members | source repair and regression authored; unvalidated |
| [#1374](https://github.com/doublemover/PairOfCleats/issues/1374) | P2 | [P2] Keep indexed files and import edges when a file has no named map member | source repair and regression authored; unvalidated |
| [#1375](https://github.com/doublemover/PairOfCleats/issues/1375) | P2 | [P2] Preserve alias dataflow evidence through code-map normalization | source repair and regression authored; unvalidated |
| [#1376](https://github.com/doublemover/PairOfCleats/issues/1376) | P3 | [P3] Preserve opaque IDs when resolving connected-entity highlights | source repair and regression authored; unvalidated |
| [#1377](https://github.com/doublemover/PairOfCleats/issues/1377) | other | [Viewer] Compute height fog from actual instance and line world positions | source authored; unvalidated |
| [#1378](https://github.com/doublemover/PairOfCleats/issues/1378) | P2 | [P2] Resolve editor risk explain against the selected code generation instead of repo-local index-code | source repair and regression authored; unvalidated |
| [#1379](https://github.com/doublemover/PairOfCleats/issues/1379) | P2 | [P2] Discover validation modes from the explicit index root rather than the current generation | source repair and regression authored; unvalidated |
| [#1380](https://github.com/doublemover/PairOfCleats/issues/1380) | P2 | [P2] Resolve index stats from every published mode root instead of one latest build | source repair and regression authored; unvalidated |
| [#1381](https://github.com/doublemover/PairOfCleats/issues/1381) | other | [Viewer] Stream generation-pinned graph data through a worker-owned incremental scene pipeline | incremental snapshot page admission f83eecd26 preserves final byte guard/cursors; source materialization and actual host/resource qualification open |
| [#1382](https://github.com/doublemover/PairOfCleats/issues/1382) | perf | [Perf] Replace cubic map adjacency ordering with incremental candidate scores | source repair and regression authored; unvalidated |
| [#1383](https://github.com/doublemover/PairOfCleats/issues/1383) | P2 | [P2] Preserve setup's explicit repository target across index and artifact-restore children | source repair and regression authored; unvalidated |
| [#1384](https://github.com/doublemover/PairOfCleats/issues/1384) | P2 | [P2] Make index health honor selected modes and intentionally absent optional backends | source repair and regression authored; unvalidated |
| [#1385](https://github.com/doublemover/PairOfCleats/issues/1385) | P2 | [P2] Keep the TUI flow queue hard-bounded when no queued log can be evicted | source repair and regression authored; unvalidated |
| [#1386](https://github.com/doublemover/PairOfCleats/issues/1386) | P2 | [P2] Preserve task terminal events under TUI progress backpressure | source repair and regression authored; unvalidated |
| [#1387](https://github.com/doublemover/PairOfCleats/issues/1387) | perf | [Perf] Partition persistent embedding indexes by complete identity to preserve warm profiles | partial source integration; shared lifecycle/qualification still open |
| [#1388](https://github.com/doublemover/PairOfCleats/issues/1388) | perf | [Perf] Avoid duplicate quantized payloads across file and global chunk caches | partial source integration; shared lifecycle/qualification still open |
| [#1389](https://github.com/doublemover/PairOfCleats/issues/1389) | P2 | [P2] Measure native TUI event lag instead of displaying a constant zero | source repair and regression authored; unvalidated |
| [#1390](https://github.com/doublemover/PairOfCleats/issues/1390) | P2 | [P2] Make removed search-option repair hints produce valid equivalent requests | source repair and regression authored; unvalidated |
| [#1391](https://github.com/doublemover/PairOfCleats/issues/1391) | other | [Docs] Keep service diagnosis and recovery recipes bound to one explicit config and queue | source config/service recipe repairs authored; execution proof open |
| [#1392](https://github.com/doublemover/PairOfCleats/issues/1392) | other | [Docs] Validate authored command and config recipes against executable contracts | partial inert authored-recipe owner; behavioral/platform proof open |
| [#1393](https://github.com/doublemover/PairOfCleats/issues/1393) | P2 | [P2] Resolve queued TUI keys after modal transitions instead of executing stale shortcuts | source repair and regression authored; unvalidated |
| [#1394](https://github.com/doublemover/PairOfCleats/issues/1394) | perf | [Performance] Bound recorded-session seeks instead of replaying the entire prefix on the UI thread | source repair and regression authored; unvalidated |
| [#1395](https://github.com/doublemover/PairOfCleats/issues/1395) | other | [Docs] Document state-preserving source upgrades and required artifact rebuilds | source state-preserving upgrade journey authored; operational proof open |
| [#1396](https://github.com/doublemover/PairOfCleats/issues/1396) | perf | [Perf] Shard persistent tree-sitter chunks by digest instead of constant namespace prefix | source repair and regression authored; unvalidated |
| [#1397](https://github.com/doublemover/PairOfCleats/issues/1397) | P1 | [P1] Preserve pending subprocess cleanup before releasing the build cache-writer lock | exact tracked/writer/category fences plus original observer release guard 9b4306384; no flag or replacement callback overrides original closure; actual Windows/native stage acceptance open |
| [#1398](https://github.com/doublemover/PairOfCleats/issues/1398) | P2 | [P2] Preserve exclusion and quoted-phrase gates under --match any | source repair and regression authored; unvalidated |
| [#1399](https://github.com/doublemover/PairOfCleats/issues/1399) | P2 | [P2] Bind inlay type hints to their declaration role before assigning function returns | source repair and regression authored; unvalidated |
| [#1400](https://github.com/doublemover/PairOfCleats/issues/1400) | P2 | [P2] Resolve CI export sources after child builds publish their generations | source repair and regression authored; unvalidated |
| [#1401](https://github.com/doublemover/PairOfCleats/issues/1401) | P2 | [P2] Preserve all iteration labels when resolving compiler CFG continue targets | source repair and regression authored; unvalidated |
| [#1402](https://github.com/doublemover/PairOfCleats/issues/1402) | P1 | [P1] Stage and validate CI artifact restores before replacing live indexes | source repair and regression authored; unvalidated |
| [#1403](https://github.com/doublemover/PairOfCleats/issues/1403) | P2 | [P2] Do not kill reaching definitions for uninitialized var redeclarations | source repair and regression authored; unvalidated |
| [#1404](https://github.com/doublemover/PairOfCleats/issues/1404) | P2 | [P2] Evaluate object method computed keys in the enclosing compiler CFG | computed key conversion/captures plus actual CFG call ownership db581ab96; cfgFlow21/callFlow24/valueSlice7; authored retained controls unvalidated, complete coercion/runtime truth open |
| [#1405](https://github.com/doublemover/PairOfCleats/issues/1405) | P2 | [P2] Preserve false and zero values in metadata search predicates | source repair and regression authored; unvalidated |
| [#1406](https://github.com/doublemover/PairOfCleats/issues/1406) | P2 | [P2] Preserve repeated ignore rules instead of changing last-match-wins order | source repair and regression authored; unvalidated |
| [#1407](https://github.com/doublemover/PairOfCleats/issues/1407) | P2 | [P2] Keep ignored siblings excluded when expanding a nested include | source repair and regression authored; unvalidated |
| [#1408](https://github.com/doublemover/PairOfCleats/issues/1408) | P2 | [P2] Parse Git changed-file output with NUL framing before metadata invalidation | source repair and regression authored; unvalidated |
| [#1409](https://github.com/doublemover/PairOfCleats/issues/1409) | P2 | [P2] Respect exclusive source ends when assigning LSP symbols and diagnostics to chunks | shared scalar/range/container/URI admission and hierarchy allowance through c3f883443, lspBindings28/rq4; authored actual consumers unvalidated; name-only source signatures/live hosts open |
| [#1410](https://github.com/doublemover/PairOfCleats/issues/1410) | P2 | [P2] Preserve PDF.js end-of-line markers after their text items | source repair and regression authored; unvalidated |
| [#1411](https://github.com/doublemover/PairOfCleats/issues/1411) | P2 | [P2] Retain tabs and breaks between DOCX fallback text runs | source repair and regression authored; unvalidated |
| [#1412](https://github.com/doublemover/PairOfCleats/issues/1412) | perf | [Perf] Map document chunks to units without rescanning every page or paragraph | source repair and regression authored; unvalidated |
| [#1413](https://github.com/doublemover/PairOfCleats/issues/1413) | P2 | [P2] Preserve omitted architecture caps instead of silently skipping every rule check | source repair and regression authored; unvalidated |
| [#1414](https://github.com/doublemover/PairOfCleats/issues/1414) | P2 | [P2] Preserve significant whitespace and escapes in ignore-rule text | source repair and regression authored; unvalidated |
| [#1415](https://github.com/doublemover/PairOfCleats/issues/1415) | P2 | [P2] Populate literal phrase evidence in records index chunks | source repair and regression authored; unvalidated |
| [#1416](https://github.com/doublemover/PairOfCleats/issues/1416) | P2 | [P2] Preserve per-mode build identity when freezing mixed-generation snapshots | source repair and regression authored; unvalidated |
| [#1417](https://github.com/doublemover/PairOfCleats/issues/1417) | P2 | [P2] Encode the inlay request EOF using the negotiated LSP position units | source repair and regression authored; unvalidated |
| [#1418](https://github.com/doublemover/PairOfCleats/issues/1418) | P2 | [P2] Preserve DOCX source paragraphs and headings in the preferred Mammoth path | source repair and regression authored; unvalidated |
| [#1419](https://github.com/doublemover/PairOfCleats/issues/1419) | P2 | [P2] Enforce strict completeness for manifest-ineligible ranked federation members | source repair and regression authored; unvalidated |
| [#1420](https://github.com/doublemover/PairOfCleats/issues/1420) | P2 | [P2] Use protocol line boundaries for LSP source mapping instead of parser or LF-only indexes | original byte/range witnesses plus VSCode URI/file and Sublime deferred original file/hit binding5e335196e; authored controls unvalidated, actual hosts open |
| [#1421](https://github.com/doublemover/PairOfCleats/issues/1421) | P2 | [P2] Preserve ambiguous symbol candidates across graph lookup and traversal caps | source repair and regression authored; unvalidated |
| [#1422](https://github.com/doublemover/PairOfCleats/issues/1422) | P2 | [P2] Mark watchdog-killed test attempts as interrupted instead of passed | source repair and regression authored; unvalidated |
| [#1423](https://github.com/doublemover/PairOfCleats/issues/1423) | P2 | [P2] Reject malformed benchmark waivers instead of granting indefinite global exceptions | source repair and regression authored; unvalidated |
| [#1424](https://github.com/doublemover/PairOfCleats/issues/1424) | P2 | [P2] Preserve domain classification and structured evidence in MCP tool errors | source repair and regression authored; unvalidated |
| [#1425](https://github.com/doublemover/PairOfCleats/issues/1425) | P3 | [P3] Enforce semantic-find response bytes when no records survive filtering | source repair and regression authored; unvalidated |
| [#1426](https://github.com/doublemover/PairOfCleats/issues/1426) | P2 | [P2] Report mean function cyclomatic complexity instead of the module aggregate | source repair and regression authored; unvalidated |
| [#1427](https://github.com/doublemover/PairOfCleats/issues/1427) | P2 | [P2] Stop silently dropping complexity metadata for valid ESM imports and exports | source repair and regression authored; unvalidated |
| [#1428](https://github.com/doublemover/PairOfCleats/issues/1428) | P2 | [P2] Keep changed files without coverage observations visible in policy reports | source repair and regression authored; unvalidated |
| [#1429](https://github.com/doublemover/PairOfCleats/issues/1429) | P2 | [P2] Preserve configured LanceDB vector columns with an explicit queryable schema | source repair and regression authored; unvalidated |
| [#1430](https://github.com/doublemover/PairOfCleats/issues/1430) | perf | [Perf] Reuse verified operation-index reads within semantic-find pages | source repair and regression authored; unvalidated |
| [#1431](https://github.com/doublemover/PairOfCleats/issues/1431) | P2 | [P2] Convert indexed UTF-16 spans before slicing context excerpts from UTF-8 source | source repair and regression authored; unvalidated |
| [#1432](https://github.com/doublemover/PairOfCleats/issues/1432) | P2 | [P2] Enforce context-pack response bytes after JSON and SARIF rendering | source repair and regression authored; unvalidated |
| [#1433](https://github.com/doublemover/PairOfCleats/issues/1433) | P3 | [P3] Hydrate call sites only after risk-flow budget admission | source repair and regression authored; unvalidated |
| [#1434](https://github.com/doublemover/PairOfCleats/issues/1434) | P2 | [P2] Use C# declaration name fields instead of naming members after their return types | source repair and regression authored; unvalidated |
| [#1435](https://github.com/doublemover/PairOfCleats/issues/1435) | P2 | [P2] Include Dart function bodies and emit one chunk per declaration | source repair and regression authored; unvalidated |
| [#1436](https://github.com/doublemover/PairOfCleats/issues/1436) | P2 | [P2] Preserve Julia bang-suffixed names in native declaration chunks | source repair and regression authored; unvalidated |
| [#1437](https://github.com/doublemover/PairOfCleats/issues/1437) | P2 | [P2] Do not emit Go grouped type containers as duplicate first-type declarations | source repair and regression authored; unvalidated |
| [#1438](https://github.com/doublemover/PairOfCleats/issues/1438) | P2 | [P2] Preserve explicit equals-form ANN booleans through search option resolution | source repair and regression authored; unvalidated |
| [#1439](https://github.com/doublemover/PairOfCleats/issues/1439) | P2 | [P2] Resolve huge-repo profile intent from one accepted configuration namespace | source repair and regression authored; unvalidated |
| [#1440](https://github.com/doublemover/PairOfCleats/issues/1440) | P2 | [P2] Preserve selected records and extracted-prose hits in retrieval evaluation | source repair and regression authored; unvalidated |
| [#1441](https://github.com/doublemover/PairOfCleats/issues/1441) | P2 | [P2] Invalidate bakeoff resume when evaluation dataset contents change | source repair and regression authored; unvalidated |
| [#1442](https://github.com/doublemover/PairOfCleats/issues/1442) | P2 | [P2] Validate paired input contracts before saving offline EG2 quality receipts | source repair and regression authored; unvalidated |
| [#1443](https://github.com/doublemover/PairOfCleats/issues/1443) | P3 | [P3] Keep prototype-named document IDs from corrupting judged nDCG | source repair and regression authored; unvalidated |
| [#1444](https://github.com/doublemover/PairOfCleats/issues/1444) | P2 | [P2] Normalize AWS Inspector wire timestamps as seconds, not milliseconds | source repair and regression authored; unvalidated |
| [#1445](https://github.com/doublemover/PairOfCleats/issues/1445) | P2 | [P2] Preserve every affected package in AWS Inspector findings | source repair and regression authored; unvalidated |
| [#1446](https://github.com/doublemover/PairOfCleats/issues/1446) | P2 | [P2] Map AWS Inspector fixedInVersion into canonical remediation evidence | source repair and regression authored; unvalidated |
| [#1447](https://github.com/doublemover/PairOfCleats/issues/1447) | P2 | [P2] Fix Windows SQLite Unicode path prefetch leaving deleted chunks searchable | source repair and regression authored; unvalidated |
| [#1448](https://github.com/doublemover/PairOfCleats/issues/1448) | P2 | [P2] Keep unavailable risk-explain evidence distinct from a successful zero-flow report | source repair and regression authored; unvalidated |
| [#1449](https://github.com/doublemover/PairOfCleats/issues/1449) | P2 | [P2] Include canonical JSON sidecars in records incremental SQLite identity | source repair and regression authored; unvalidated |
| [#1450](https://github.com/doublemover/PairOfCleats/issues/1450) | P2 | [P2] Give inference-history hybrid search its own valid continuation contract | source repair and regression authored; unvalidated |
| [#1451](https://github.com/doublemover/PairOfCleats/issues/1451) | perf | [Perf] Reuse unchanged record bundles before tokenization and inline embedding | source repair and regression authored; unvalidated |
| [#1452](https://github.com/doublemover/PairOfCleats/issues/1452) | P2 | [P2] Preserve omitted-flow counts when risk explain applies its result caps | source repair and regression authored; unvalidated |
| [#1453](https://github.com/doublemover/PairOfCleats/issues/1453) | perf | [Perf] Reuse the task-turn lookup when reading history context and timelines | source repair and regression authored; unvalidated |
| [#1454](https://github.com/doublemover/PairOfCleats/issues/1454) | P3 | [P3] Avoid building unused risk-report formats and duplicate SARIF projections | source repair and regression authored; unvalidated |
| [#1455](https://github.com/doublemover/PairOfCleats/issues/1455) | P2 | [P2] Admit Swift init/deinit nodes and name subscripts by their declaration role | source repair and regression authored; unvalidated |
| [#1456](https://github.com/doublemover/PairOfCleats/issues/1456) | P2 | [P2] Resolve Swift declaration kinds from grammar tokens rather than an unmodified text prefix | source repair and regression authored; unvalidated |
| [#1457](https://github.com/doublemover/PairOfCleats/issues/1457) | P2 | [P2] Emit Kotlin enums and interfaces from their declaration nodes, not enum bodies | source repair and regression authored; unvalidated |
| [#1458](https://github.com/doublemover/PairOfCleats/issues/1458) | P2 | [P2] Preserve Kotlin secondary constructors without borrowing parameter names | source repair and regression authored; unvalidated |
| [#1459](https://github.com/doublemover/PairOfCleats/issues/1459) | P2 | [P2] Name native C functions from their declarators instead of typedef return types | native declarator naming plus bounded parenthesized prototype admission 59f20ecbd, sourceChunking9; authored registered controls unvalidated |
| [#1460](https://github.com/doublemover/PairOfCleats/issues/1460) | P2 | [P2] Do not emit C tagged-type uses as fresh structure declarations | source repair and regression authored; unvalidated |
| [#1461](https://github.com/doublemover/PairOfCleats/issues/1461) | P2 | [P2] Preserve Objective-C selectors and implementation owners in native chunks | source repair and regression authored; unvalidated |
| [#1462](https://github.com/doublemover/PairOfCleats/issues/1462) | P2 | [P2] Traverse parse5 template content instead of stopping at an empty childNodes array | source repair and regression authored; unvalidated |
| [#1463](https://github.com/doublemover/PairOfCleats/issues/1463) | P2 | [P2] Rebase embedded HTML chunk line numbers along with source offsets | source repair and regression authored; unvalidated |
| [#1464](https://github.com/doublemover/PairOfCleats/issues/1464) | P3 | [P3] Preserve lexicon filter statistics across Stage2 bundle replacement | source repair and regression authored; unvalidated |
| [#1465](https://github.com/doublemover/PairOfCleats/issues/1465) | P3 | [P3] Keep bundle patches equivalent to the payload used for their checksum | source repair and regression authored; unvalidated |
| [#1466](https://github.com/doublemover/PairOfCleats/issues/1466) | P2 | [P2] Include finalized risk metadata in incremental bundle reuse decisions | source repair and regression authored; unvalidated |
| [#1467](https://github.com/doublemover/PairOfCleats/issues/1467) | P2 | [P2] Emit Rust required-trait and foreign function declarations from function_signature_item | source repair and regression authored; unvalidated |
| [#1468](https://github.com/doublemover/PairOfCleats/issues/1468) | P2 | [P2] Distinguish native lexical scopes from type ownership before classifying functions as methods | source repair and regression authored; unvalidated |
| [#1469](https://github.com/doublemover/PairOfCleats/issues/1469) | P2 | [P2] Preserve Python local-class scopes instead of merging distinct methods and their flow facts | interleaved Python lexical scopes and header ownership 6a54a2de0, sourceChunking9 current; authored real transport/projection controls unvalidated |
| [#1470](https://github.com/doublemover/PairOfCleats/issues/1470) | P2 | [P2] Preserve declaration prefixes and wrappers in Python, Rust and C++ source coverage | declaration prefix/wrapper source mappings plus Python header ownership 6a54a2de0; authored controls unvalidated; remaining runtime/grammar acceptance open |
| [#1471](https://github.com/doublemover/PairOfCleats/issues/1471) | perf | [Perf] Reuse prepared Python chunks instead of rebuilding AST and heuristic conversions in dispatch | development implemented 3e25e851b; actual source/AST/array-bound Python preparation reaches dispatch once, preserving priority/null outcomes/current limits and sliced cache stripping; sourceChunking11; authored converter/adapter/interpreter/missing-runtime/segment controls unvalidated; no measured speedup or in-place AST mutation qualification |
| [#1472](https://github.com/doublemover/PairOfCleats/issues/1472) | P2 | [P2] Admit Java annotation declarations and compact record constructors in native chunks | source repair and regression authored; unvalidated |
| [#1473](https://github.com/doublemover/PairOfCleats/issues/1473) | P2 | [P2] Preserve C++ qualified and operator names instead of regex-truncating declarators | source repair and regression authored; unvalidated |
| [#1474](https://github.com/doublemover/PairOfCleats/issues/1474) | P2 | [P2] Capture C and C++ function prototypes from the grammar's declaration nodes | bounded parenthesized prototype and pointer-binding roles 59f20ecbd, sourceChunking9; authored registered controls unvalidated |
| [#1475](https://github.com/doublemover/PairOfCleats/issues/1475) | P2 | [P2] Pass C-family chunks through registry relations and doc-metadata adapters | source repair and regression authored; unvalidated |
| [#1476](https://github.com/doublemover/PairOfCleats/issues/1476) | P2 | [P2] Preserve assignment-style Lua functions beside native declarations | source repair and regression authored; unvalidated |
| [#1477](https://github.com/doublemover/PairOfCleats/issues/1477) | P2 | [P2] Exclude Lua declaration headers from call relations without removing real recursion | source repair and regression authored; unvalidated |
| [#1478](https://github.com/doublemover/PairOfCleats/issues/1478) | P2 | [P2] Extract Bash call summaries from command roles instead of line-start words | source repair and regression authored; unvalidated |
| [#1479](https://github.com/doublemover/PairOfCleats/issues/1479) | P2 | [P2] Preserve Ruby singleton receivers before name-keyed call attribution | source repair and regression authored; unvalidated |
| [#1480](https://github.com/doublemover/PairOfCleats/issues/1480) | P2 | [P2] Admit PHP enums without dropping their source and method ownership | source repair and regression authored; unvalidated |
| [#1481](https://github.com/doublemover/PairOfCleats/issues/1481) | P2 | [P2] Preserve Ruby and PHP callable metadata on successful native parsing | source repair and regression authored; unvalidated |
| [#1482](https://github.com/doublemover/PairOfCleats/issues/1482) | P2 | [P2] Exclude Ruby and bodyless PHP declaration headers from call evidence | existing Ruby/PHP repair retained; shared grammar policy4952fc1c6 advances sourceChunking10; authored declaration/fallback controls unvalidated |
| [#1483](https://github.com/doublemover/PairOfCleats/issues/1483) | P2 | [P2] Preserve complete quoted Bash source paths before import resolution | source repair and regression authored; unvalidated |
| [#1484](https://github.com/doublemover/PairOfCleats/issues/1484) | P2 | [P2] Scope managed heuristic calls to declarations instead of file-wide Cartesian pairs | partial retained occurrence/source and recursive/dynamic observations plus ECMAScript fallback body boundaries4952fc1c6/callFlow22; full upstream scope/proof open |
| [#1485](https://github.com/doublemover/PairOfCleats/issues/1485) | P2 | [P2] Preserve Jinja capture-set blocks when filters contain equals signs | source repair and regression authored; unvalidated |
| [#1486](https://github.com/doublemover/PairOfCleats/issues/1486) | P2 | [P2] Do not name Scala extension groups after type parameters or their first methods | source repair and regression authored; unvalidated |
| [#1487](https://github.com/doublemover/PairOfCleats/issues/1487) | P2 | [P2] Admit Scala package objects and givens without losing source or member ownership | source repair and regression authored; unvalidated |
| [#1488](https://github.com/doublemover/PairOfCleats/issues/1488) | P2 | [P2] Preserve literal template dependency identities through import normalization | literal template mappings plus registered R literal preservation c1b162f8c, importResolution6; authored controls unvalidated |
| [#1489](https://github.com/doublemover/PairOfCleats/issues/1489) | P2 | [P2] Retain CSS @scope containers when native parsing finds nested rules | source repair and regression authored; unvalidated |
| [#1490](https://github.com/doublemover/PairOfCleats/issues/1490) | P2 | [P2] Derive CSS selector names from syntax instead of quoted punctuation | source repair and regression authored; unvalidated |
| [#1491](https://github.com/doublemover/PairOfCleats/issues/1491) | P2 | [P2] Parse logical CMake commands before collecting literal imports | source repair and regression authored; unvalidated |
| [#1492](https://github.com/doublemover/PairOfCleats/issues/1492) | P2 | [P2] Keep Make recipes and assignments out of logical prerequisite imports | source repair and regression authored; unvalidated |
| [#1493](https://github.com/doublemover/PairOfCleats/issues/1493) | P2 | [P2] Preserve Starlark argument lexical roles when collecting build imports | source repair and regression authored; unvalidated |
| [#1494](https://github.com/doublemover/PairOfCleats/issues/1494) | P2 | [P2] Preserve Unicode Jinja and Django identifiers instead of publishing ASCII fragments | source repair and regression authored; unvalidated |
| [#1495](https://github.com/doublemover/PairOfCleats/issues/1495) | P2 | [P2] Resolve R function identities from assignment ASTs instead of keyword name fields | source repair and regression authored; unvalidated |
| [#1496](https://github.com/doublemover/PairOfCleats/issues/1496) | P2 | [P2] Retain native signatures and docs in shared heuristic adapter projections | source repair and regression authored; unvalidated |
| [#1497](https://github.com/doublemover/PairOfCleats/issues/1497) | P2 | [P2] Parse R library and require arguments without corrupting dependency specifiers | static R argument/literal identity and nested call extraction c1b162f8c, importResolution6; authored registered controls unvalidated |
| [#1498](https://github.com/doublemover/PairOfCleats/issues/1498) | P2 | [P2] Preserve SQL declaration identities when mixed statements select the fallback chunker | source repair and regression authored; unvalidated |
| [#1499](https://github.com/doublemover/PairOfCleats/issues/1499) | P2 | [P2] Make SQL statement splitting honor dialect-specific quoting and nested comments | source repair and regression authored; unvalidated |
| [#1500](https://github.com/doublemover/PairOfCleats/issues/1500) | P2 | [P2] Ignore SQL include directives inside literals and decode quoted include paths | source repair and regression authored; unvalidated |
| [#1501](https://github.com/doublemover/PairOfCleats/issues/1501) | P2 | [P2] Preserve XML root metadata and leading mixed content in indexed chunks | source repair and regression authored; unvalidated |
| [#1502](https://github.com/doublemover/PairOfCleats/issues/1502) | P2 | [P2] Keep YAML top-level chunks inside their original document boundaries | source repair and regression authored; unvalidated |
| [#1503](https://github.com/doublemover/PairOfCleats/issues/1503) | P2 | [P2] Preserve Starlark function bodies instead of heading-splitting nested calls and strings | source repair and regression authored; unvalidated |
| [#1504](https://github.com/doublemover/PairOfCleats/issues/1504) | other | [Research] Build anytime hybrid retrieval with certified frontiers and lossless continuation | partial opt-in complete-list RRF source 539282af3; public/native/semantic/spill qualification open |
| [#1505](https://github.com/doublemover/PairOfCleats/issues/1505) | other | Build revision-pinned change-obligation investigations with resumable evidence packets | partial revision-bound investigation source 9af3ae4f8; checker admission/transports/retention proof open |
| [#1506](https://github.com/doublemover/PairOfCleats/issues/1506) | other | Build reusable binding queries with file-local paths and dependency-confirmed resolution | partial closed lexical reference source fc27273ed; real extraction/public/compiler proof open |
| [#1507](https://github.com/doublemover/PairOfCleats/issues/1507) | other | Synthesize target-locked reference repair plans for rename, move and import changes | partial immutable lexical rename overlay source c28f56edb; apply/public/synthesis proof open |
| [#1508](https://github.com/doublemover/PairOfCleats/issues/1508) | other | Compose language-local analyses through build-qualified polyglot boundary summaries | partial data-only native manifest source d8ad69287; actual runtime/solver/public integration open |
| [#1509](https://github.com/doublemover/PairOfCleats/issues/1509) | other | Build mutation-version heap graphs with reusable demand-driven alias analysis | partial finite heap model source 464ee2f60; compiler/solver/public qualification open |
| [#1510](https://github.com/doublemover/PairOfCleats/issues/1510) | other | Consume compact analysis summaries with independent semantic checking | partial finite may-certificate checker source d765b86b8; compiler/capsule integration and proof open |
| [#1511](https://github.com/doublemover/PairOfCleats/issues/1511) | other | Build source-bound task lenses across features, API usage and build architecture | source 97836c69c pins exact retained source selections; internal rename/lens consumers authored; public workflow/domain/host qualification open |
| [#1512](https://github.com/doublemover/PairOfCleats/issues/1512) | other | Add a budgeted next-evidence controller with validated offline policy evolution | partial internal bounded next-evidence advisor a240bc279; production/public integration and qualification open |
| [#1513](https://github.com/doublemover/PairOfCleats/issues/1513) | other | [Research] Build an exact factorized evidence plane with adaptive physical operators | partial checked canonical occurrence bags 20b3687b3; adaptive active operators/public/native qualification open |
| [#1514](https://github.com/doublemover/PairOfCleats/issues/1514) | other | [Research] Add adaptive filtered-search sessions with reusable frontiers and exact rescue | partial internal exact rescue sessions 505301856; production/public integration and qualification open |
| [#1515](https://github.com/doublemover/PairOfCleats/issues/1515) | other | Overlay source with build-qualified compiler IR and bytecode evidence | partial internal supplied exact-point lineage 46feac4e3; production/public integration and qualification open |
| [#1516](https://github.com/doublemover/PairOfCleats/issues/1516) | other | [Research] Maintain semantic views with typed deltas and elastic incremental execution | partial internal signed-support adjacency deltas 896793e0c; production/public integration and qualification open |
| [#1517](https://github.com/doublemover/PairOfCleats/issues/1517) | other | [Research] Sustain vector freshness with churn-aware repair, layout and compaction | partial internal live incarnation registry/rescue 76ffeb8b1; production/public integration and qualification open |
| [#1518](https://github.com/doublemover/PairOfCleats/issues/1518) | other | [Research] Build span-complete sparse and token retrieval views with progressive refinement | partial internal exact-natural sparse token reference c60ca99de; production/public integration and qualification open |
| [#1519](https://github.com/doublemover/PairOfCleats/issues/1519) | other | Search historical change precedents with revision-qualified current applicability | partial internal retained historical applicability 26968ee76; production/public integration and qualification open |
| [#1520](https://github.com/doublemover/PairOfCleats/issues/1520) | other | Add language-qualified symbolic type and effect queries with compact explanations | partial internal correlated finite shapes and preimages 51f576ec6; production/public integration and qualification open |
| [#1521](https://github.com/doublemover/PairOfCleats/issues/1521) | other | Add bounded contextual equivalence queries with independently checked legality certificates | partial independently checked ground bag-sum legality with canonical consumer 20b3687b3; broader contextual/public qualification open |
| [#1522](https://github.com/doublemover/PairOfCleats/issues/1522) | other | Find cross-system implementation analogies with typed correspondence and transfer conditions | source 94337a432 pairs independently owned retained motifs under one lens budget; transfer conditions unknown; public/domain qualification open |
| [#1523](https://github.com/doublemover/PairOfCleats/issues/1523) | other | [Research] Plan evidence pipelines across calibrated compute, memory and storage resources | partial actual relations baseline/scheduler work receipts dd1327324; calibration/alternative selection/empirical qualification open |
| [#1524](https://github.com/doublemover/PairOfCleats/issues/1524) | other | Compare causal hypotheses and plan discriminating evidence without upgrading correlation to cause | pending |
| [#1525](https://github.com/doublemover/PairOfCleats/issues/1525) | other | Build a leakage-audited executable task and evidence fixture compiler | pending |
| [#1526](https://github.com/doublemover/PairOfCleats/issues/1526) | other | Build paired evidence interventions separating support, reliance and causal identification | pending |
| [#1527](https://github.com/doublemover/PairOfCleats/issues/1527) | other | Refine semantic traces with checked path feasibility and counterexample witnesses | pending |
| [#1528](https://github.com/doublemover/PairOfCleats/issues/1528) | other | Add cross-revision mutation and independent semantic/index oracle qualification | pending |
| [#1529](https://github.com/doublemover/PairOfCleats/issues/1529) | other | [Research] Build a provenance-qualified local retriever adaptation and distillation factory | pending |
| [#1530](https://github.com/doublemover/PairOfCleats/issues/1530) | other | Qualify adaptive retrieval and evidence policies with independent risk–coverage receipts | pending |
| [#1531](https://github.com/doublemover/PairOfCleats/issues/1531) | other | Reuse demand-sealed query views with support-complete reactivation and costed eviction | pending; new dependency-ordered research/feature scope |
| [#1532](https://github.com/doublemover/PairOfCleats/issues/1532) | other | Compile revision-aware answers from checked claims and retract stale conclusions | pending; new dependency-ordered research/feature scope |
| [#1533](https://github.com/doublemover/PairOfCleats/issues/1533) | other | Deliver consumer-acknowledged evidence delta packs across context resets | pending; new dependency-ordered research/feature scope |
| [#1534](https://github.com/doublemover/PairOfCleats/issues/1534) | other | Compile typed repository questions into composable evidence-bound queries | pending; new dependency-ordered research/feature scope |
| [#1535](https://github.com/doublemover/PairOfCleats/issues/1535) | other | Discover and compare API behavior protocols with object-qualified witnesses | pending; new dependency-ordered research/feature scope |
| [#1536](https://github.com/doublemover/PairOfCleats/issues/1536) | other | Explain source-linked runtime bottlenecks with execution-cost graphs and checked sensitivity | pending; new dependency-ordered research/feature scope |
| [#1537](https://github.com/doublemover/PairOfCleats/issues/1537) | other | Add source-grounded query feedback sessions with frozen-index vector adaptation | pending; new dependency-ordered research/feature scope |
| [#1538](https://github.com/doublemover/PairOfCleats/issues/1538) | other | Acquire retrieval judgments actively with bias-corrected fixed-pool evaluation | pending; new dependency-ordered research/feature scope |
| [#1539](https://github.com/doublemover/PairOfCleats/issues/1539) | other | Share selected build-world families without mixing truth, closure or ranked completion | pending; new dependency-ordered research/feature scope |
| [#1540](https://github.com/doublemover/PairOfCleats/issues/1540) | other | Intern occurrence-preserving syntax DAGs for pure summaries and lazy structural queries | pending; new dependency-ordered research/feature scope |

User steering after batch 3: discontinue ignored development drafts, apply completed
changes to real files, and frontload remaining implementation before further test
campaigns. The lead retains shared Git/publication responsibility; agents do not
wait for validation or coordinate with each other.

### 2026-10-22 source-only continuation

A fresh GitHub API inventory now contains 947 open reports, including 163 newly
filed reports #1368–#1530: two P1, 110 P2, seven P3, eleven Perf and 33 other.
The two new P1 owners and related P2 source repairs precede remaining performance
work. Every newly discovered report is listed above. No report is closed merely
because its implementation has been authored.

Completed source checkpoints add bounded candidate preparation and exact
eligibility (#1241/#1244/#1235), archive interval lookup and completion hydration
(#816/#799), selected tooling planning (#854), immutable risk preparation (#1256),
range-qualified VFS occurrence routing and shared governance inventories
(#834/#1245/#1239), and immutable source-retention receipts (#1240).
Bootstrap #1277 now has dependency/resource admission, isolated patch staging,
reviewed package-local native adapters, exclusive fallback/SQLite owners and
parallel isolated read-only probes. Native local adapters are limited to reviewed
graphs; unknown scripts retain serial admission and their own internal compiler
policy. Clean/cached execution, rollback/cancellation controls and resource/timing
qualification are still required. No measured bootstrap improvement is claimed.

P1 #1397 now preserves unconfirmed parser cleanup instead of degrading it into
success, scopes scheduler children to the build, validates structured termination
audits including already-in-flight owned cleanup, and retains the cache lease.
Only actual late close of the same spawned handle can reconcile missing-close
evidence; a failed tree cleanup remains pending. Authored regressions cover
failed/zero-error-unconfirmed receipts, repeated teardown, actual delayed close,
lock contention and successor-lease protection. They have not been executed.

All additions are real source/regression files. No tests, syntax checks, formatter,
front gate, native/bootstrap execution or measurements ran in this continuation.
The dependency installation remains stale after the lockfile-only VSIX dependency
change and setup-owner edits. The last qualified source remains d4dcba413; the
current tree has no full deep-suite or performance acceptance.

### Root continuation: contracts, maps and editor source generations

Unvalidated commits c40e5a7c6 through 1dd90a72b implement root-owned reports
#1424, #1385/#1386/#1389/#1393, #1413, #1390, #1448/#1452/#1454,
#1373/#1374/#1375/#1376 and #1378. Earlier source-only root commits
4995c8539/a5007d30f cover #1431/#1432/#1433/#1425 and #1426/#1427.
No issue is closed or newly qualified by these implementation mappings.

MCP reuses authoritative semantic error classification and projects bounded typed
evidence. Architecture preserves absent caps, continues violation detection beyond
the detail cap and refuses incomplete clean verdicts. Removed-option remedies retain
request intent. Risk payloads preserve unavailable/disabled evidence and pre-cap
matching populations; selected-format rendering shares its narrative projection.

The TUI flow owner has a hard frame bound, atomic chunk admission and explicit
lifecycle-loss reporting. Native ingress records real arrival/dequeue residence;
unknown telemetry remains unknown. Modal keys are interpreted after preceding
queued transitions. Rust/Node/ConPTY compilation and execution remain outstanding.

Map model 1.1/cache producer 3 joins repo-map metadata with canonical source
identities, preserves zero-member files via the canonical sharded/columnar file
inventory loader and retains all string alias evidence under the existing caps.
Ambiguous legacy declarations cannot select arbitrary overloads or acquire export
authority. Opaque colon/Unicode IDs survive connected highlighting and reset.
VS Code and Sublime resolve all risk seed kinds through context-pack provenance,
retain the selected code-generation source and refuse missing retained generations
without an automatic current-generation substitution. Real cache/index and editor
host acceptance are still required; authored fixtures are not passing evidence.

Language source checkpoint 6739dcf37 adds 27 report mappings #1476-#1503,
excluding #1484. It preserves syntax-owned call/declaration metadata, template/build
literal imports and SQL/XML/YAML document boundaries. Four grouped fixtures are
authored. Shared importResolution/sourceChunking/callFlow identities advance to
3/4/14 and native tree chunk identity to 5. #1484 retains an explicit integration
obligation for canonical occurrence persistence, bounded spill/backpressure and
interruption/resume; attribution fixes alone do not complete that report.

No tests, syntax checks, formatter, bootstrap, native commands or measurements ran.
The installation remains stale and d4dcba413 remains the last qualified source.

### Selected-mode and serving-work continuation

Source-only checkpoints 9537c6bcd/b798cec72/2b5b21b42/9e789c259 cover
#1379/#1380/#1383/#1384/#1408/#1416/#1422/#1423/#1439/#1440/#1441.
They capture explicit selected roots, preserve per-mode frozen provenance and
backend selection, retain NUL-framed Git paths, distinguish watchdog interruption
from exit success, reject malformed waivers, and bind evaluation/resume to dataset
content and independently judged mode cohorts. Eleven authored report mappings do
not qualify mixed-root native execution, actual watchdog-close-zero behavior or
full evaluation CLI output. The agent receipt retains those concrete obligations.

Map adjacency source 25fc5df2c (#1382) updates directed candidate-to-placed sums
once per edge and preserves the existing total-weight bonus and lexical ties.
Candidate selection is quadratic; the >300 lexical-only policy discontinuity is
removed. Authored reference/operation-count cases are unexecuted; no measured
browser or production latency improvement is claimed.

Semantic-find source 57d014ebb (#1430) batches at most 32 candidate refs and
shares request-local verified operation/node/query-index readers. Four reader
pairs, a 1-MiB retention admission budget and sixteen selector ranges bound reuse.
Every new page/request rehashes content, and cursor progress advances only for
processed candidates. Records remain incrementally hydrated. Authored real-reader
open/byte/disposal/corruption/continuation controls are not passing measurements.

### Replay responsiveness and qualification-source continuation

Source checkpoints f920ade5c/bc72d02c1 implement #1394 and #743. Recorded seeks
coalesce targets, skip identical positions and reduce at most 128 frames per tick
with a cooperative 4-ms admission budget. Every 256 frames can produce a derived
state checkpoint; eight checkpoints and an 8-MiB conservative allocation charge
bound retention. Checkpoints exclude full AppModel objects, the recording event
vector, transport handles, control outboxes and user view state. Immutable retained
inspection records use shared ownership with per-record copy-on-write. Missing
selected jobs stay explicitly unavailable, and detach restores the separate live
model. Mismatched chunk disposal also releases its retained byte charge.

Live ingress uses the production bounded-turn owner before due render/input work,
charges credits only for consumed frames and avoids the 20-ms idle wait while
native backlog or replay reconstruction is known. Authored maximum-recording,
reference-reducer, checkpoint/chunk-boundary, sustained nonempty-source, real test
renderer, quit-dispatch and finite-order controls are unexecuted. These constants
are bounds on admitted work, not measured p95 latency or hard preemption guarantees.
Rust compilation, existing frame parity, real ConPTY/live-channel behavior and
retained/peak allocation measurements remain required.

Coverage source dda9f30e9 (#1428) retains all changed inventory with explicit
unobserved/deleted/unsupported/excluded states, null unknown counts, observed-only
denominators and critical-surface completeness. Browser source 322d13b26
(#1371/#1372) serves the complete permitted local module graph and qualifies each
page/phase using errors, submitted scene identity and pixel variation. Authored
HTTP/MIME/module-byte, negative-page and desktop/narrow browser workflows have not
run. Depth/compositing #1367 and per-instance fog #1377 remain separate; no FPS,
hardware, browser, full-suite or performance qualification is inferred.

### Compact native presentation and remaining correctness integration

Native source 0a81ce30e (#733) replaces full retained-history frame signatures
with collection revisions and explicit compact view/session/workload keys. Owner
mutations cover replacement, append, eviction and replay restoration; render timing,
credits and idle clocks remain excluded. Source 08dae9799 (#736) filters identities
before viewport formatting and shares the selection marker sequence. Empty searches
avoid row-text construction; arbitrary nonempty searches still inspect eligible
text. Full-ring, same-count and viewport presentation controls are authored only.

The seventeen-report source integration in 3e0d1a36a/b7a00f991/4ef439bad/
1319ff499/5fafdc7f4 covers #1398/#1399/#1401/#1403/#1404/#1405/#1409/
#1417/#1419/#1420/#1421/#1429/#1438/#1450/#1464/#1465/#1466. It preserves
compiler execution roles and LSP protocol units/boundaries, query hard gates and
false/zero metadata, ambiguous symbol candidates, strict federation scope,
serialized bundle unset/legacy-read meaning, explicit typed LanceDB columns and
bounded history pagination that refuses lexical continuation reuse. Shared cfgFlow
and lspBindings identities advance to 15/14. Eleven new fixture IDs plus retained
native controls remain unexecuted. No native Arrow conversion, compiler-solver,
actual editor/LSP request, full cache roundtrip or performance result is claimed.
#1216 typed batching still needs native allocation/timing qualification; #1251/
#1281 cache-maintenance work remains in flight and is not counted completed.

Root work now addresses #1348 and the still-open #1484 persistence obligation.
Supported syntax occurrence preservation, resumable bounded production and durable
coverage across inference/publication/readers are separate from the completed
attribution source repair. No arbitrary cap increase substitutes for that work.

### Shared producer and occurrence handoff continuation

Source 249ab9700 (#1365, cumulative #1369 hooks) shares lazy build-scoped codec
CPU and byte admission across artifact families. Ordered outputs retain their
reservations through consumption; oversized lines use bounded frames, borrowed
writers leave pool teardown to the build owner, and failed retirement quarantines
new workers. Source f662a4ee4 also integrates #1412 coordinate lookup and #1451
qualified records reuse. These bounds are not total-process RSS or speed results.

Source 54a822d5d (#1230/#1231/#1247/#1248/#1249) reuses immutable provider/LSP
joins, bounds CFG construction, shares exact pending finalizer contexts and indexes
dispatch/worker peers. CFG, call-flow and worker identities advance to 16/16/7;
replay identity includes the same derived CFG byte bound used by construction.
Finalizer completion-route, dense-peer, actual LSP and allocation/timing parity
remain unexecuted proof obligations.

Sources 336bd5dc5/a2fd66232 repair the #1484 handoff: immutable syntax occurrences
carry canonical one-based UTF-16 coordinates, inference receives mutable derivative
details, and resolution reasons follow actual target status. Canonical call-site
rows retain typed syntax provenance; raw collection stays immutable. Shared
sourceChunking/callFlow and Tree-sitter versions were advanced with that change.
Spill/resume, durable completeness and full supported-language qualification are
still open. No tests, syntax checks, formatting or performance runs were performed
for these source checkpoints. The last qualified source remains d4dcba413.

### Explicit fidelity and bounded occurrence publication

Source c1665ab11 adds the strict, reviewed `indexing.crossFileFidelity` choice
(default bounded; comprehensive admits the collected supported candidates), shared
policy/signature identity, separate layer omission/parameter counters and bounded
affected-source samples. Resource scheduling and automatic quality do not choose
semantic admission. Stable file-round-robin propagation removes incidental input
order from the global quota. Canonical raw arrays remain intact. Warm replay
preserves the same omission receipt and complete output identity.

Canonical call-site publication now awaits bounded spill admission and the existing
32-reader merge/checkpoint owner, streaming into plain/sharded/compressed outputs.
Native occurrence coordinates/preview bytes remain source-owned; invalid syntax
facts fail publication rather than disappearing. Generation state, graph loading
and risk input coverage preserve upstream receipts. Architecture/impact expose
unknown/incomplete coverage; complete candidate admission does not establish clean
absence or complete program analysis. Call-flow/risk/call-site identities advance
with these semantics. Three new fixture IDs cover thresholds, summary-only global
exhaustion, reordering, raw/warm parity, spill formats, cancellation/retry and
conservative absence. No fixture has executed. #1348/#1484 remain open for full
semantic frontier resume, capability sealing, exact supported occurrence sets,
quota-failure recovery and runtime/memory/time acceptance. Generated config and
artifact-schema reports still require their existing refresh owners later.

Source c451201fe (#1232/#1236) targets language wakes/pressure refresh and shares
qualified Git metadata/churn history traversal. Sources fa830a213 and 3cc7bc308
(#1224/#1225/#1226/#1223) index field overlap, share immutable definition state
and CFG suffix routes, and solve call summaries through dirty dependencies. Shared
CFG/call-flow identities are now 17/18. Authored differential/fault/work-count
controls are unexecuted; no native/compiler parity or measured speed claim follows.
Formatting, bootstrap, generated refresh, affected checks and gates remain deferred
under the development-first instruction. The last qualified source is d4dcba413.

### Native presentation and cache ownership continuation

Source 670270735 (#739) uses immutable log IDs and a volatile 2-MiB/64-entry
width-layout cache. The initial forward word/grapheme scan retains row offsets
and a bounded tail, not all wrapped strings. Only visible rows become owned
text; unchanged cached redraws avoid formatting/segmentation, empty search avoids
formatting retained entries for an always-true predicate, and entry-based scroll
clamping/follow semantics remain explicit. Eviction, width changes, replay restore
and identity rollover invalidate the correct layouts. The retired production
wrappers remain test-only differential references; source searches found no other
production callers. Two new cache unit controls and two production viewport
controls are authored, not executed.

Source 72557e5c5 (#737) retains one accepted review presentation and one width
index per settings/workflow view. A bounded writer retains at most 256 KiB of
presentation text; borrowed projections preserve provenance omission of userConfig
and avoid full Value clones on redraw. Source/request/scope/discard mutations
clear presentation, while scroll and unrelated revisions reuse it. Canonical
Values and tokens retain all Save/Launch/Open/Export authority. Inspection indexes
borrowed result spans by record generation/revision and owns only visible body
lines, retaining the existing 8,192-line notice/clamp behavior. Presentation caches
remain outside persisted layouts and replay checkpoints. Five new pure/owner
controls remain unexecuted; Rust formatting/build/clippy, exact frame parity,
ConPTY, allocations and latency qualification are still required.

Sources f6b037bbf/5e557c071/d2bb70ee2 (#1453/#1396/#1387/#1388) reuse operation
turn lookups, migrate parser digest shards and isolate complete embedding profiles
with ordered immutable chunk references. Existing shard locks protect reference
publication and hydration; unreadable reference ownership blocks pruning. Legacy
profile reads do not mutate their inventories. Four new and three affected fixture
IDs remain unexecuted. Whole-app cache descriptors, relocation, profile quotas and
operator acceptance (#1264-#1267) remain separate open foundations.

Source 38f0cbd80 (#1251/#1281) uses stable timestamp retention and canonical-lock
metadata touches with exact payload identities and bounded journals; five authored
fixture IDs remain unrun. Source 5fecd62f2 is only the #1250 checksum/session
foundation: production-wide borrowing remains open pending #1330 CPU suspension/
reacquisition to avoid nested permit deadlocks. No measurements, source qualification
or full issue closure is implied by these source checkpoints. No tests, syntax
checks, formatter, bootstrap or gates ran during this continuation.


### HTTP, search evidence and shared compute continuation

Sources 0644d551a/d36875573 (#1200/#1255) reuse phase-local physical cache
summaries and immutable risk-witness prefixes. New source controls preserve
failed-deletion/orphan ordering, prior JSON lexical queue tie order, independent
emitted arrays and the existing admission bounds. They are authored, unexecuted;
physical I/O, full risk differential and CPU/heap measurements remain open.

Sources 0b5159ec8/0c9aafb01/68333c4c1 install the #1250 Stage1 transform session
and #1330 explicit compute suspension. Suspended tasks retain original byte,
memory and file reservations. Optional nested work reserves immediately or uses
its existing inline path; it cannot queue behind its own parent reservations.
Current-file cancellation, heap acknowledgement and real worker retirement remain
owned. #1330 is partial: mixed provider/subprocess and semantic callbacks retain
CPU conservatively until exact wait boundaries are qualified. Retained bytes are
estimates, not measured heap/RSS. The previous #1250 foundation-only note remains
historical; production borrowing now has source integration, not acceptance.

Source 5bda28673 (#1203) preloads durable, manifest-bound parse descriptors and
streams source identity checks with bounded readers instead of decoding whole
lexical bundles. Existing retention/GC owns descriptor lifetime. Lexical/semantic
reuse still requires its full authority; independently verified geometry may
survive a nonsemantic lexical miss. Source ed4488991 (#1218/#1219) shares token
planning and cancellable inline batches and fuses read-only vector channel
postprocessing. Native work and token leases retire before provider disposal;
outputs retain independent ownership and Float32 rounding. Actual provider batch
numerics, cancellation/resource lifetimes and allocation/latency remain unrun.

Source fae409849 (#790/#775) bounds both editor HTTP success/error streams at
20 MiB, owns cancellation/closure, distinguishes overflow and limits error text.
Credible headers are only early admission; actual bytes govern stream acceptance.
Search History selects stored evidence without CLI/API dispatch; explicit rerun
remains separate and appends new evidence. JS/Python boundary, cancellation,
authentication/error and offline-history controls are authored, unexecuted.

Source 7e0130a2e (#738) projects existing core backend/fidelity, empty-result
reasons and generation facts through a strict bounded diagnostic schema. CLI/API
editor results and saved history retain this projection, fallback is visible,
and old missing metadata is unknown. Native `d` opens read-only scroll/pan details;
empty results show the producer reason. Known diagnostic actions resolve only to
registered read-only commands after deliberate user selection. Receiving metadata
never runs a command. Generation identity is not worktree freshness. New and
affected editor, core, supervisor, Rust and ConPTY controls remain unexecuted.

Source b2f0ec178 (#1336) selects warm lanes only from matching, current measured
history of startup, child RSS and parse cost; bootstrap receipt bytes, parser,
runtime/CPU and policy qualify that history. Missing/mixed history preserves the
previous fallback and execution envelope. The authored policy/preparation control
has not run; no native observation or predicted gain is acceptance evidence.

All source checkpoints above are unvalidated. No test, syntax check, formatter,
bootstrap, gate or benchmark ran in this continuation. Required dependency setup,
generated refresh (including diagnostic/config/schema inventories), relevant
fail-before/after controls and the complete Windows qualification remain deferred.
The last qualified production/test source remains d4dcba413.


### Eight-owner implementation continuation, 2026-10-22

Eight 6.1 Sol/xhigh agents now own independent real-file spans: storage and
publication, vector identity, language semantics, storage layout, editor workflows,
native workflows, map workflows and developer experience. The lead integrates
shared schemas, semantic versions and CLI routes and owns Git publication.
No worktree, elevation, physical symlink creation or peer coordination is required.
Source checkpoint hashes below do not represent acceptance.

Source 08b6c949e (#735) indexes bounded scalar metadata once per loaded workspace
response and supports local page/response find, cancellable traversal and stable
original-page navigation. It fetches no additional server data. Source 6662ccc73
(#1303, partial) binds navigation to retained source bytes, UTF-16 positions,
semantic occurrences and exact recorded binding targets; ambiguous/unresolved
bindings remain explicit and legacy spelling search remains approximate. The
source-manifest lookup has a work budget and no continuation; mapping support,
explicit candidate selection and full published-producer/editor proof remain open.

Source 3b07f8733 (#1199) appends checksummed generation/sequence cache-index deltas
under the existing lock, preserves JSON authority and refuses corrupt frames.
Source be55a330a (#1207, partial) streams ordered SQLite shard windows and bounded
primary/patch/checksum input while retaining global IDs, transaction rollback and
manifest fallback. Retained memory admission is modeled, not measured RSS. Source
5ab158d3f (#1254) shares a captured-length UTF-8 benchmark log transport while
preserving independent reducer ordering and incomplete-input rejection.

Source 74104dc63 (#1204/#1222) coalesces bounded asynchronous byte verification
and retains immutable embedding coverage receipts bound to source, mapping,
identity, ranges and patch metadata. Mutable warm acquisitions still rehash.
Source 8a33d633c (#1209 partial/#1211) streams manifest-authorized binary ANN
inputs and SQLite old/new reconciliation with bounded windows. Mandatory JSONL
publication remains until consumer cutover; unproduced delta ranges fall back to
complete comparison, and optional ANN recovery retains backfill. Actual native
backend parity, crash/cancellation lifetimes and bytes/CPU/RSS/latency proof remain.

Sources b1f1a3062/3d046719d add read-only effective configuration and reviewed
first-search plans plus terminal-cell-aware progress, resize coalescing and owned
cleanup. Source f20903567 (#1272/#1276/#1282, partial) adds a dependency-free
checkout diagnosis/help/version front door, precise bootstrap identity mismatch
fields, patch file/hunk summaries and selected prerequisite provenance. Operational
commands keep bootstrap admission. Prerequisite provisioning and modern native
qualification are not established by metadata diagnosis.

Source b9548372e (#1145/#1146/#1197, partial) carries source/profile-pinned
provider output through an atomic semantic sink, retains typed LSP evidence and
combines compiler/provider results once. Shared compilerBindings11, lspBindings15
and nativeFlow2 invalidate reused derived meaning. Complete profile adoption,
producer qualification and published consumer workflows remain open.

Sources f4c77dd9b/101f3641f add explicit map resource ownership, per-output atomic
publication receipts (#1316), inert saved-map admission, a pinned local module
closure and immutable loopback preview sessions (#1273/#1317/#1324, partial).
Focus, visibility and reduced motion retire owned animation work; callback/CPU
telemetry does not claim GPU timing. Source-linked hierarchy and visible-pipe
coverage retain authoritative IDs. Generation selection, transactional refresh,
portable packaging, progressive GPU admission, glass/refraction capture, pipeline
workers and browser/native/hardware qualification remain open as applicable.

All regressions are authored and unexecuted. No tests, syntax checks, formatter,
bootstrap, native hosts, browser checks, benchmarks or gates ran in this
continuation. Dependency preparation, generated surfaces and final Windows
acceptance remain deferred. No new issue closure or measured speedup is claimed.
The last qualified production/test source remains d4dcba413.


### Priority-row source reconciliation

The prior table still listed 38 already-committed priority reports as pending.
Their source ownership is now reconciled without promoting them to acceptance.
Source 800e73d91 contains the #1402 P1 restore repair plus #1400/#1368/#1406/
#1407/#1414/#1410/#1411/#1418/#1415/#1444–#1447/#1449/#1442/#1443. CI restore
stages incoming generations before publication; ignore-rule ordering, encoded
JSONL lengths, document boundaries, records identity, Inspector package/time/
remediation projection, Unicode SQLite prefetch and paired EG2 qualification
have authored controls. Restore interruption/ENOSPC/rollback/active-reader and
all other runtime proof remain unexecuted.

Source a937ba7d0 contains #1434–#1437/#1455–#1463/#1467–#1470/#1472–#1475
declaration-role, lexical-scope, attached-source and registry-adapter repairs.
Later 6739dcf37 preserves syntax-owned call/literal/document boundaries; shared
semantic versions retain their committed invalidation lineage. The authored
declaration/scope, HTML source lines, Python local classes and C-family registry
fixtures have not run. This reconciliation fixes status drift; it does not
claim new tests, green runtime behavior or comprehensive closure.


### Storage, native and editor implementation release

Sources 53e3b1c18/86e3a2498 add fresh shared fixture/manifest read evidence and
provider declaration/JSONL/SCIP/parser qualification foundations. Required checksum
validation and finalization remain authoritative; cold checksum-only families and
diagnostic ordering remain intact. Transport/process/real language publication
proof and concrete parser migrations remain open.

Source b3dc51df1 (#1264–#1268, partial) separates pure storage descriptors,
bounded inventory, durable state and reviewed disposable cleanup. Compatibility
defaults remain until verified cutover; generic migration requires a real category
owner and complete quiescence/reference/permissions proof. The current reviewed
cleanup adapter owns producer-marked command probes only. Existing caches, saved
evidence and user files were not migrated or removed during implementation.

Source a9a0646d3 adds strict native command coverage/adapters, selective override
removal, typed grapheme editing/inert paste, exact rendered mouse identities,
contextual help, compact panes, activity/replay clocks and verified report actions.
Source cd6c41f08 adds editor User-scoped runtime/destination authority, structured
semantic evidence, source-qualified navigation, explicit service mappings, exact
task controls, generation-bound enumeration and reviewed canonical context export.
Both releases are unvalidated. MCP/indexer/backend ownership, storage-plan/native
continuation and actual editor/ConPTY/platform qualification remain partial.

Source 690d25ba9 (#1217) uses one supervised ANN child for serial jobs, never
retries a started job and preserves unconfirmed teardown/staging ownership.
Native/internal-thread/latency/RSS proof and overlap experiments remain open.
Source f328cc6c2 adds provisioning/runtime receipts, managed child routing, atomic
reviewed workspace/setup publication, canonical CLI/registry routes and an inert
authored-recipe contract owner. Tool update/repair/remove still require approved
versioned package publication/lease descriptors; executable recipe qualification
and generated surfaces are deferred.

Fresh GitHub reconciliation records 957 open reports (#584–#1540), including ten
new unprioritized research/features (#1531–#1540). The previous 947-report snapshot
is historical. Updated #729/#734/#742/#1302/#1367 bodies expand modern viewer
acceptance; earlier geometry/coalescing fixes do not satisfy those new spatial/GPU
boundaries. #1348 completeness-first retention and updated semantic/retrieval
research remain open. No issue was closed, and no new execution proof is claimed.


### Further source integration and identity lineage

Source 3cdb2f423 adds host-written final-receipt provider rows, explicit Python/
Ruby alternatives and an ephemeral source/profile/question/generation-bound
binding overlay. Ordinary queries never invoke refinement automatically. These
are partial unvalidated APIs; concrete installer recipes, real provider sessions,
public opt-in admission and published consumer qualification remain open. Changed
admission/joins advance compilerBindings12 and lspBindings16. Native task authority
already binds lspBindings; nativeFlow2 control-flow meaning is unchanged.

Source 6396a2ef6 (#1243) bounds ordered filesystem candidates, sorting and spilled
BFS frontier plus accepted stat admission. discoverySelection2 and incremental
signature14 retire capped-membership aliases. Existing Git/JJ command results
remain guarded materializations, not native streaming. Filtered discovery never
grants negative import authority. Correctness, faults, operation counts, resource
limits and timings remain unrun/unmeasured.

Source a8aab2a11 adds scoped resource sessions and a managed-child wrapper that
retain leases until exact settlement, plus strict embedding delta/reference
inventory. Real runtime caller adoption and shared cleanup coordination remain
open; these helpers confer no generic delete/migration authority. Source
c61285f48 (#1213/#1215, partial) copies verified unchanged HNSW/LanceDB generations
into private staging under exact native/embedding identity. Delta mutation, label
remaps, recall/tombstone/maintenance thresholds and native decoding proof remain.

Source 1110dc5f4 adds a scene-first map shell, capability-aware independent
appearance controls, usable-viewport camera fit and versioned durable preferences.
Preferences bind explicit selected-repository identity and local session authority
through shared state/lock/atomic owners; saved model roots grant no write authority.
The map guide now links the self-contained viewer workflow. Modern backend
cutover, spatial packets/picking, physical glass, progressive workers and actual
browser/GPU/resource measurements remain open. No test/format/build/gate/bootstrap
or native/browser execution ran for any source in this continuation.


### Documentation and final first-span source releases

Source 1e8ea827b (#1280) scans stored dense vector bytes with scalar offsets,
retains exact arithmetic/candidate domains and allows cooperative cancellation
without returning partial top-k. The independent reference and actual provider
cancellation control are authored, unrun; SIMD/wide-row/resource claims remain open.
Source a9ebbdeec preserves unchanged pipe geometry, numeric source identities and
static hover repaint; expanded modern spatial/backend acceptance remains open.

Source c1e66676f adds exact native free-space observation, an explicitly authorized
destination probe, incomplete/alias accounting admission and interrupted-stage
preservation. Space observation is not reservation or reclaimed-byte evidence.
Derived preprocess/snapshot.json is registered without granting absence/deletion
authority. No actual destination/cache/index operation was performed.

Source a5bc10b3d organizes current task journeys and preserves six dated
documentation snapshots with deprecation/replacement notices. Human contract
consolidation retains canonical schema/validator authority; generated outputs
remain unchanged pending refresh. Current setup/configuration/workspace/backend/
service/contributor/language/upgrade/viewer journeys replace competing instructions.
Full moved-anchor/link/encoding/recipe and operational qualification remains open.

A further source audit found legacy inactive-repo GC can delete saved or unknown
data. The storage owner is repairing this under #1267 before broadening category
cleanup: complete read-only protection, revalidation under exclusion, exact
producer-owned file removal and empty-only directory retirement. Existing real
caches are untouched. Unmarked files remain explicit protected negatives. The
repair is in progress; this receipt does not claim it has passed or shipped yet.

All source/checkpoint tests, syntax, formatting, generated refresh, bootstrap,
gates and native/browser/performance validation remain deferred by user direction.


### Ninth agent and data-loss/native ownership continuation

The user added one Astra/high agent exclusively for issues #1504 and above.
Eight Sol6.1/xhigh agents retain their lower-numbered spans; no other agent
implements the new research range. Dependency reading and narrow shared seams
flow through the lead without peer coordination or worktrees. The ninth owner
is implementing dependency-ordered source rather than treating research claims
as already-qualified behavior.

Source 29109ba19 repairs the newly found legacy repo-GC loss path: complete
registered producer/header/path evidence is required before planning and again
under existing exclusion. Saved/unknown/unmarked/unreadable/incomplete/pinned/
shared state protects the root. Exact generated-file removal and empty-only
directory retirement replace recursive whole-root removal, preserving late
ordinary files and swapped roots. The original unmarked fixture remains a
protected negative alongside a genuine producer-marked positive. New race/
error/evidence regressions remain unrun; no real cache or GC operation occurred.
This supersedes the earlier in-progress note with an unvalidated source repair.

Source 26f24450c adds native-owned bounded MCP transport/health/disposal, private
canonical semantic-page continuations, exact reviewed storage plans and scoped
workspace/indexer lifetimes through existing queue/worker/executor owners. The
trusted claim predicate runs under the claim lock and leaves foreign/custom-argv
jobs queued. Local cancellation does not publish global shutdown. Six new JS
fixtures plus Rust page/disposal controls are authored, not executed. Native
SQLite/LMDB exclusive child handoff and actual endpoint/ConPTY/platform/resource
qualification remain open. No semantic producer meaning changes are intended
from these transport/UI adapters.


### Bounded execution, exact navigation and ninth-owner source checkpoints

All sources in this continuation are UNVALIDATED. No tests, syntax checks,
formatting, bootstrap, native hosts, browser hosts or benchmarks were executed.
The inventory remains 957 open reports; source commits do not close issues or
replace the last qualified production/test source d4dcba413.

Source 81de36f0a retains editor cancellation settlement, bounded logs and explicit
semantic controls. Source c3aef12e1 adds canonical sourceRefs to bounded semantic
detail/find/trace responses from real artifact and SQLite owners. Exact original
byte hashes, retained paths and UTF16/byte units accompany only returned records.
Generated mappings require an actual adapter; metadata shares page bytes/work
and leaves record/cursor facts intact. Explain follows the same direct-mapping
refusal. Two parity/admission regression sources are authored, not run. Editor
host normalization and precise navigation qualification remain separate.

Source a12d36d0c (#1320/#1180/#1183) shares retry classification/line products only
after fresh discovery and exact source admission, adds ordered 8-chunk/128KiB
worker batches with bounded encoded output, and retains complete versioned
lexical checkpoints in the existing immutable bundle owner. Full token/phrase/
classification semantics and dependency identity remain bound; stale or malformed
products recompute. These paths reduce duplicate work in source, with no measured
speedup, memory result or new threshold acceptance claimed.

Source 595f40bc2 adds bounded explicit JSON/JSONC references, configured CMake/Make
snapshots, local GraphQL schema references, Protobuf descriptor/source evidence
and explicit Handlebars/Mustache registries through the canonical row writer,
sink and detail owners. Freshness/single-use admission advances compilerBindings13
and lspBindings17; nativeFlow2 is unchanged. These are partial host APIs, not
qualified automatic acquisition or complete public language integrations.

Source f2abe5dec selects only reviewed empty/missing category destinations using
immutable verified receipts and the existing locator lock. Source 7c38a7d14 binds
exclusive cache delegation to exact parent/child/root/command and authenticated
IPC closure. Reader recovery remains blocked while delegated ownership is live
or unknown. Real SQLite/LMDB service integration and fault execution remain open;
no user cache, cleanup, migration or actual delegated child was run.

Source e835f6699 adds immutable physical managed-install repair generations,
verified-sibling reuse, retained verifier/child settlement and bounded response-
body cleanup. Declared complete storage estimates reach actual package-child
admission; recipes with unknown estimates defer rather than invent a budget or
run cleanup. Concrete portable recipes, generic archive/Go acquisition boundaries,
full runtime lease adoption and operational proof remain partial. Source a3eeb9c32
repairs progress policy scope, narrow failure/count output and terminal-style
closure; fake-terminal regression sources remain unexecuted.

Source 5d1a98632 (#1278/#1237) hydrates only selected SQLite BM25 facts while
preserving global corpus statistics and adds conservative positive-domain WAND
with exhaustive fallback. Source e70a92166 (#1201, partial) selects already-
qualified ONNX outputs without retrying inference; an identity-bound graph pooling
prototype remains inactive. Actual query plans, numerical parity, native/model
lifecycle and before/after resource and latency evidence are outstanding.

Source 6fb738d53 adds progressive map residency, revision-bound spatial picking,
immutable paged snapshot transport and a compact graph worker. The compatibility
full model is still retained and the compact worker adds representation; wire
bounds are not measured heap bounds. Manifest-first rendering, eviction, modern
backend decisions and actual browser/GPU/performance proof remain open.
Source 261d36832 adds owned API startup/health, pre-ready transport cancellation,
canonical task progress and a scoped duplicate-suppression fence that preserves
foreign queue jobs. Real endpoint/terminal/platform lifetime proof remains open.

Astra exclusively owns #1504 and above. Source 539282af3 provides an opt-in exact
complete-list weighted-RRF frontier with explicit binary64 channel order, bounded
preparation and same-owner continuation. Source 9af3ae4f8 provides revision-bound
investigation/checklist and already-admitted support joins. Source fc27273ed
provides a closed lexical reference interpreter and canonical-record consumer;
c28f56edb forward-checks immutable lexical rename overlays against exact source
snapshots. These are staged internal slices: no public schema/transport, compiler
qualification, general semantic completeness, durable quota or benchmark claim
is implied. The full research issues and dependent integrations remain open.


### Actual native finalizers, quota admission and complete vector spooling

Source d8eb117a3 binds bounded installation/runtime observations and precise editor
navigation to canonical source evidence. Observed BOM removal and CRLF normalization
require exact original bytes and actual buffer content; dirty/arbitrary mappings
refuse navigation. Existing canonical navigation results can seed semantic requests
with their exact generation. Native first-use discovery and real editor/package/
remote-host acceptance remain open. The #1305-#1308 table mapping is corrected:
filter enumeration, service topology, context/risk evidence and progress/tasks,
respectively; source credit is retained without shifting issue ownership.

Source 35bf06bc1 reserves actual declared write destinations through shared locks,
BigInt free-space/accounting and exact settlement. Pending children retain their
reservations. Probe write/prune/cleanup authority now requires the complete known
producer object, preserving marker-only or extra retention/reference fields as
unknown protected data. The concrete managed quota API is admission.writes[];
caller adaptation from the initial scalar proposal is still in progress. No
quota, cache, package or migration operation was executed.

Sources 0f323afac/e2a2e3f9c connect actual canonical SQLite/LMDB database constructors,
publication checkpoint handles and finalizers to the existing lifecycle registry.
Early preparation failure closes registered handles. Primary write errors survive
close/cleanup failure; an unknown close emits no delegated settlement. Compaction
reserves a fresh sibling instead of deleting prior crash evidence. Direct CLI
terminal displays close in finalizers and library errors throw instead of exiting.
Delegated entry byte/argument digests, current effective cache root, explicit
contained generation and selected backend targets are rechecked before native
constructors; backend path overrides refuse this delegated route. Ordinary CLI
path behavior is retained. Native supervisor drain/catalog adoption, actual child
execution, cancellation/fault/terminal proof and Windows acceptance remain open.

Source 9c67f4711 (#1214/#1364 partial) coalesces semantic family parts under existing
bounds while syncing data/offsets before append acknowledgment; failed cleanup
retains disk credits and primary errors. Compatibility field shards stream contained
64KiB blocks with exact framing/hash evidence instead of readFile/string copies.
New physical term/range shard layout remains open. Source f1ac22fea honors explicit
Python selection, rejects implicit prerelease fallback and carries CC/CXX choices
child-locally; it does not install prerequisites or qualify real toolchains.

Source 4f267c9bd (#1208/#1221) replaces corpus vector arrays with ordinal files,
bit-plane presence/claim state and bounded immutable windows, preserving v1 ordered
generation hashing. Per-file sync ownership and bounded memo/reuse caches avoid a
second retained corpus. Verified complete cache-only routes avoid provider creation;
misses still require native qualification. Actual writers, sparse/zero/absence,
short-write/cancellation and digest controls are authored. Native/model teardown,
Windows disk faults, RSS and throughput evidence are unrun and unmeasured.

Source 90a6a7bd4 adds bounded map trigram search with exact fallback/continuation,
revision-owned actual cancellation, status ownership and an optional spatial packet
adapter. No default packet policy/backend is selected. Full compatibility input
retention and manifest-first demand/eviction adoption remain open alongside every
browser/GPU/resource/performance qualification. Sources d8ad69287/464ee2f60/
d765b86b8 add strict data-only native bridge observations, finite immutable heap
versions and independently checked finite may-set capsules. These are partial
internal research models; no native/compiler/default/public feature acceptance is
implied. Every regression in this continuation remains authored and unexecuted.

### Continued source integration through 51f576ec6 (2026-10-22)

This section records implementation, not acceptance. No tests, syntax/lint/format,
bootstrap, builds, native/GUI hosts, models, cache operations or benchmarks were
executed in this continuation. The explicit user deferral remains in effect. The
last qualified production/test source is still d4dcba4134f6103e3a59703d90fdbde5ca54d09e;
changed dependency/setup/schema inputs require fresh locked bootstrap before the
later qualification batch. Expected generated-surface drift is still pending the
source-owner refresh; no hand-edited generated report or fresh gate pass is claimed.

- **Canonical retained evidence:** d9aaaf150 introduces strict version1 retained
  graph-edge rows and graphRelations1. Source 8cc785f95 writes collected adjacency
  before display caps, with bounded exact-generation call-site/edge pages and a
  private dispatcher bridge. Source 54da0a7dc retains recursive/dynamic call
  observations and verifies existing retained invocation records, original source
  headers, spans and generation before exposing strict available/unavailable refs.
  callFlow19 invalidates old derived meaning. No second parse/store or implicit
  semantic enablement is introduced. Public dispatch, complete upstream fidelity,
  durable propagation resume, compressed/legacy pages and disk accounting remain
  open; the private bridge alone is not full consumer qualification.
- **Cold SQLite filtering:** 9a3c4595b adds private version1 build-owned fact tables,
  coverage seals and mutation invalidation. Full artifact/bundle/compaction owners
  rebuild facts before publication; incremental writers update retained facts.
  Eligible cold filter pages hydrate only selected metadata, preserve canonical
  Unicode/path/kind predicates, exact generation/filter cursors and output-trim
  advancement. Unsupported/unsealed inputs use full metadata fallback, explicitly
  loading chunks even for lazy FTS settings. SQL count/substring work may scan and
  sparse address arrays remain; no constant-memory or latency claim is made.
- **Runtime/install/storage:** 9b946c33a and 72ee40772 retain exact physical managed
  installations through structural, pooled/unpooled LSP, handshake, sync probe and
  JSONL owners; unknown shutdown retains authority. Complete descendant census and
  actual platforms remain separate. Dictionary readers/writers/migration now use
  shared real leases and closure owners (cc02f1de4); timeout/abort error contracts
  are preserved by 42b54dce4. Reservations count nested/per-device destinations,
  retain exact objects and permit recovery only from proven local death
  (a7583d4dc/3792fcde5). Sources ed1124024/f1fe47023/c2ac1af83 connect verified local
  routing, bounded category inspection and immutable machine-local probe policies
  to real callers. Zero is literal; disabling preserves bytes; unknown/pinned data
  remain protected. No actual user cache, policy apply, migration or security change
  was performed. Source c3afe95ea propagates selected env through shared roots.
- **Compiler/setup/config:** 72ee40772 admits exact Astro TypeScript frontmatter;
  sourceChunking6/compilerBindings15/lspBindings19 prevent stale replay. Source
  9a8d2732d connects bounded build-target-pinned Scala SemanticDB and exact generated
  Astro maps to existing writer/sink/detail owners; real services/compiler closure
  and broader language integrations remain partial. Source 464961124 adds actual
  bounded Windows C++20/header/link/COFF/PE capability owners and immutable reviewed
  prerequisites. Production installer apply stays blocked where official complete
  allocation evidence is unknown; no installer/toolchain action was run. Sources
  fda470a42/f906f385d/ec21488d9 bind declared allocation, authored effective recipes
  and selected normalized config provenance. Source 83f6629f4 repairs malformed
  research text and adds reusable local Markdown navigation/encoding audit source;
  the full documentation audit has not been executed.
- **Native/editor lifetimes:** 7aac04bbc connects actual guarded database commands
  to the supervisor reader-drain/catalog owner. Source 4465e6498 emits canonical
  typed watch admission/publication/degraded/teardown evidence without treating
  watcher readiness as search readiness. Sources 5766a206b/3b6649a09 preserve bounded
  completed-task observations, refuse replacement during unknown watch cleanup,
  and reverify original bytes and actual document state after asynchronous reveal.
  Source 21982d8e4 bounds native event transport, preserves primary terminal faults,
  requires actual Windows job accounting before settled cleanup, and pins listed
  saved-session objects. Host EOF/owned-family controls (43aa74339) are authored,
  not executed; ConPTY, actual descendant and editor-host proof remain open.
- **Map/resource sources:** manifest-first demand and page eviction now have actual
  source adoption (01500d014), with canonical scalar IDs across worker/layout/
  renderer/selection/history (2b22a5a35/9961b3406) and lazy tier/neighborhood pipe
  ownership (4f6f7a99f). Existing server preparation still materializes the admitted
  full model; no claim of end-to-end corpus streaming, new backend acceptance,
  measured browser/GPU memory or latency is made.
- **Embedding/evaluation/research:** bcc8e65fa gates private ONNX experiments on exact
  single-session qualification and real reverse settlement; no default pooling is
  activated. Source 6af774d1a provides independent original-FP32/stored-uint8 scalar
  oracles, separately qualified eligibility and saved-stage replay receipts, not
  live-search/model proof. Astra exclusively owns #1504+, with internal partial
  source slices through #1520: task lenses, next-evidence plans, occurrence factors,
  exact rescue/incarnations, supplied lineage, support deltas, natural sparse token
  bounds, revision-qualified history and finite correlated type queries. All keep
  explicit supplied-data/profile/coverage limits; public/default/native/compiler
  integration and full issue acceptance remain open.

Nine agents work independently in the shared real checkout: eight Sol6.1/xhigh
and one Astra/high. Root alone integrates exact released source snapshots and Git.
Hashes under ignored author-workspace `.tmp/tasks/` are historical bookkeeping,
not clean-checkout artifacts or passing test evidence. No new issue is closed by
this section, and no earlier green run is relabeled as current-source acceptance.

### Three-owner development checkpoint through 0500f370a (2026-10-22)

At the user's direction the active team is now the lead plus three Sol6.1/xhigh
agents: storage/setup, semantic/indexing and retrieval/editor/map. Earlier
nine-owner descriptions above are historical. Root integrates exact released real
files and owns Git; no peer coordination or worktrees are required.

**Execution:** source inspection and authored regressions only. No tests,
syntax/lint/format, bootstrap, builds, native hosts, real services, model runs or
benchmarks were executed. The last qualified production/test source remains
`d4dcba4134f6103e3a59703d90fdbde5ca54d09e`. Changed setup inputs require locked
bootstrap later. Generated-surface refresh and the complete Windows qualification
batch remain deferred. These commits do not close issues or prove speedups.

- **Public retained evidence:** 0c14a0dbe adds strict exact-build call-site/edge
  requests and bounded pages through CLI/API/MCP, canonical registrations and
  explicit retained-family coverage limits. It never falls back to CURRENT.
  Compiler capability inputs now participate in bootstrap freshness. Source
  10985f32d exposes opt-in provider evidence within the existing semantic detail
  budgets. Sources 4490f9c33/fdfed91e5 connect contained retained-source captures,
  source lenses and current work receipts; mutable propagation restarts its phase
  rather than claiming a durable completed prefix. lspBindings20 and callFlow20
  invalidate changed producer meaning. Source 330402344 reserves actual spill,
  merge/checkpoint and retained projection working sets before writes; failed
  cleanup conservatively keeps credits. Legacy supplied-graph quota coverage,
  fine-grained durable propagation resume and actual consumer qualification remain
  open. Existing global artifact-format identities are preserved.
- **Durable resource authority:** 83dabeaa0 protects exact resource leases across
  parent exit; dead PID recovery cannot erase an unknown settlement. Source
  673547ba1 pins all matching launch-authorized category ancestors so migrations
  cannot move active child profiles. c577405b5/1d4e1e1d7 require the exact resource,
  settled:true and pending:false receipt. These do not establish an arbitrary
  descendant census; lost owners remain conservatively protected.
- **Native/process ownership:** d9a1ac1fb/6ea5e2b1f repair supervisor transport and
  owned-service continuations. Source 4a17a5e83 binds service controls to the exact
  job object/scope, requires both execution settlement and actual protocol-resource
  closure, and retains unknown terminal/replaced owners within the bounded list.
  Rust UI selection/confirmation preserves opaque identity. Unsupported graph and
  policy adapters are explicit. Source 10ef70909 routes post-spawn error, stdin
  failure and throwing spawn callbacks through the existing termination owner,
  preserving the original failure and tracking until actual close. Regression
  fixtures are authored; real ConPTY, services and descendant checks are unrun.
- **Storage/setup integrity:** 955508d9f/07c2f5ad8 distinguish missing/offline
  inventory and preserve rollback, installation and protected BEAM evidence.
  Source 0930db5e8 checks dictionary bytes before conditional reuse, refuses an
  in-flight replacement, retains original migration intent and evaluates managed
  relative paths against the actual child cwd. Source 37413d958 unifies strict
  known managed metadata across synchronous/asynchronous inspectors, locator and
  removal admission; unknown retention/source fields stay protected and verifier
  cleanup requires exact settlement. No installation, cache migration or cleanup
  operation was performed.
- **Retrieval/editor/map consumers:** 0aed57100 captures immutable actual baseline
  and channel inputs before oracle awaits; 0500f370a retains the dense producer's
  real dot-product identity during replay. Source ae2069f17 separates candidate
  pool/output and admits a local reranker only with caller-pinned immutable
  model/tokenizer/license/runtime evidence. No default model or pooling is enabled.
  e71fda96f/b897441aa/d1b07208b preserve watch, cursor/hit/tree identities and bound
  initial editor enumeration before publication. c423d4720/8fd408e3e connect actual
  map request slots, spatial selection and cooperative pinned search cancellation.
  Server model materialization, actual editor/browser/GPU/model hosts, independent
  quality parity and measured resource/latency acceptance remain open.

Ignored `.tmp/tasks/` hashes are author-workspace staging bookkeeping, not
clean-checkout artifacts or passing evidence. Source changes after the last
qualified candidate require their own final-tree checks; earlier green results
are not combined into a current pass.

### Exact native settlement and three-owner integration through 5d441a305

This remains an **unvalidated source checkpoint**. No tests, syntax/lint/format,
bootstrap, native processes, builds, model/GUI hosts or benchmarks were run.
Formatting and the prescribed checks remain deferred by explicit user direction.
The last qualified production/test source is still d4dcba4134f6103e3a59703d90fdbde5ca54d09e.
The team remains the lead plus three independent Sol6.1/xhigh agents in this
checkout. No worktrees, elevation, security changes or physical symlinks are used.

- **Exact tracked close and native lifetime:** fac945c93 fixes a remaining #1397
  boundary: tracked termination no longer unregisters on exitCode, PID death or
  kill acknowledgement. The exact registered close alone removes the entry;
  async cleanup observes a bounded 500ms in parallel and sync cleanup preserves
  unknown close. Cache-release audit rows explicitly require closeObserved and
  tree-attempt errors remain failures. Existing actual delayed-close controls now
  pass through the tracking/cache barrier; separate same-PID/replacement and sync
  controls are authored. Source 2a886e872 supplies current callable types, scope,
  grace, capture/result/error contracts, a consumer sketch and links from the
  deprecated draft. None establishes arbitrary descendant quiescence.
- **Native consumers preserve that evidence:** a2b4f65f7 attempts remaining known
  shutdown owners after metrics/registry/transport failures. Source 6abc47128
  reserves the existing six service-control slots before asynchronous job admission.
  Source fc59bd7bf fixes API and framed clients that converted child rejection
  into closed results/map removal. Pending failures now retain exact ownership;
  MCP/semantic disposal requires closed:true plus pending:false. Combined errors
  preserve primary causes and the original delayed-close predicates. Source
  4d3de4fa5 prevents pending cleanup from enabling retries, artifact observations,
  terminal-job removal, new work or backend exclusion. Status/stop controls remain
  available; shutdown reports unknown cleanup as failed. Actual controller/client
  fixtures are authored with inert child observations, plus existing real-child
  controls; ConPTY/service/native job containment execution remains open.
- **Setup/storage owners:** 6c1827f86 applies one dictionary reader budget across
  common/language scopes and drains started reads after failure. Source 16d61ad7c
  carries lifecycle cancellation through contained inventories and pins Go receipt
  bytes before activation, preserving conflicting generations. Source 9906f7505
  connects guided setup/discovery to the shared asynchronous child owner, keeps
  cancellation/pending outcomes terminal, and preserves 130/143. Sources
  ce2256edf/e06849b12 preserve Lua selection authority, explicit fast-bootstrap
  targets and exact registered storage-owner diagnosis. Root budgets retain
  unscanned/unknown registrations; no cache or installer operation was performed.
  Legacy Lua acquisition/runtime qualification remains incomplete.
- **Coverage preservation in fast bootstrap:** fake npm-in-target execution was
  obsolete because the target is not authorized for package scripts. Its valid
  CLI JSON/stdout/stderr behavior remains in a disposable-target real CLI fixture.
  An actual tiny Node child streams 1200000 bytes plus an exact tail through the
  shared adapter while the parent counts bytes and retains only the suffix.
  Inert admission/cancellation/explicit-target controls remain alongside those
  assertions. These are authored replacements, not executed acceptance evidence.
- **Semantic consumers and meaning:** 20b3687b3 connects retained canonical edge
  witnesses to source motifs/task lenses and independently checked ground bag-sum
  alternatives; transfer conditions remain unknown. Source dd1327324 records
  actual relations work under unchanged scheduler/baseline admission without
  fabricated calibration. Source 045c302dd shares contained exact embedded-map,
  parent-byte/slice and source-route admission across compiler/LSP/cache. Source
  2644fa89c preserves inherited dispatch candidates per exact runtime key.
  compilerBindings17/lspBindings21/callFlow20 identify current derived meaning.
  Source 2a327b171 preserves operation/build cancellation through provider
  handoffs. Source 5d441a305 feeds retained lexical records into existing exact
  source lenses, retaining ambiguity and trusted upstream profile limits. No
  complete language resolver, semantic closure or active physical optimizer is
  claimed; fine-grained resume and legacy graph quota coverage remain open.
- **Retrieval qualification owners:** 416c55635 adds an explicit programmatic
  opt-in for independently counted eligible sets, bounded stored uint8 exhaustive
  scoring and capability-qualified ANN effort. There is no tuned default/public
  knob, original-FP32 exactness or native-work/recall guarantee. Sources
  56060a038/9c487a57a connect bounded feature-only shadow proposals and saved-pool
  allocation to actual primary/federated consumers without extra searches or
  authoritative routing. Missing cached pools stay incomplete. Independent
  primary-byte/call parity, held-out calibration, native/model correctness,
  disposal and measured cost/quality/resource acceptance remain unrun.

Current generated-surface freshness, locked dependency preparation and Windows
cohort acceptance still require their planned later batch. No new issue closure,
benchmark result or final-tree pass is claimed by this continuation.


### Writer exit fencing, source coordinates and evaluation consumers through 002afeb5c

This is an **unvalidated development checkpoint** on the existing branch and PR.
No tests, syntax/lint/format, bootstrap, native or child operations, builds,
GUI/model hosts or benchmarks were executed. The user explicitly deferred those
checks while the lead and three Sol6.1/xhigh agents implement independent real-file
spans. The last qualified production/test source remains
`d4dcba4134f6103e3a59703d90fdbde5ca54d09e`. Changed setup inputs still need a fresh
locked bootstrap. No new issue closure or measured speedup is claimed.

- **Required closeout and durable writer exclusion:** b9e21009b attempts remaining
  cleanup but blocks cache-lock release after any prior required heartbeat,
  build-state or runtime failure. Generic timeouts and combined failures preserve
  unknown settlement. Source 3f7aa30b3 closes the subsequent parent-exit hole:
  indexing, watch and embedding admission publish an internal settlement marker
  on the existing index lock before work. Exit/signal handlers and shared stale
  recovery cannot erase it based on age, PID death or forced stale cleanup.
  PID-only/force removal cannot unlink a settlement-marked lock; cache-writer
  capabilities require the exact durable identity. The benchmark now preserves
  live/unknown writers instead of deleting an old live lock. Process-only
  recovery stays covered. Actual fresh-process, delayed-close and exact-owner
  regressions are authored, not run. A lost resource owner remains blocked;
  arbitrary descendant proof and whole-cache/category lifetime adoption remain
  separate obligations.
- **Storage and setup:** 03fba2196 pins canonical prerequisite evidence and
  post-install rediscovery while preserving cancellation outcomes. Source
  a68971010 bounds contained Windows capability snapshots and COFF/PE inspection
  without executing a candidate binary. Source 4a3051db2 preserves original and
  frozen dictionary failures together with every pending cleanup/sibling owner;
  release requires all captured exact observers, with missing/throwing observers
  false. Source 002afeb5c coalesces actual reservation release and retains the
  exact coordinator handle for retry after unlink succeeded but lock release
  failed. Creation-side recovery and actual installation/platform qualification
  remain open. No user cache, installation or migration was touched.
- **Semantic source meaning and consumers:** fa06bf1de carries operation
  cancellation through published symbolic queries. Source 4bf4ab51d checks a
  finite identity-transfer upper-summary model over retained canonical relations;
  it does not prove source-language transfer or missing-world closure. Source
  69125583b checks selected retained provider/source/target spans at scalar
  boundaries during existing bounded source verification, including split UTF8
  reads. Source 9f70b9c61 rejects split-scalar producer coordinates and binds SCIP
  adapter2 to shared lspBindings22; compilerBindings17 and callFlow20 remain
  current. SemanticDB already independently rejected those endpoints, so its
  accepted span set and meaning are unchanged. External producer execution and
  public/runtime qualification remain open.
- **Actual map initialization:** 5517f2b1a makes the default snapshot generator
  cooperate and cancel while ingesting file/member/edge rows and directed summary
  work; failed initializations discard unpublished state. The synchronous path
  consumes the same steps. The full server/source model is still materialized;
  this change does not establish streaming memory, browser/GPU or latency proof.
- **Evaluation:** fa3c1d44c shares bounded paired repository-macro/task-micro
  comparisons across vector and fusion reports, retaining missing/failed/censored
  outcomes and null intervals without sufficient independent clusters. Source
  66b9f758b adds canonical source/task/run/generation/rubric-pinned saved traces,
  original UTF8 byte-span unions, independent observation stages, explicit used
  attribution and deterministic citation validity before support credit. Raw
  human/model labels stay separate and no model is called. Existing evaluation
  consumes optional saved traces through the same quality owner. Live source-
  qualified CLI/MCP/editor events, independent source-byte and label truth,
  representative task populations and empirical cost/quality proof remain open.

Authored fixture replacements preserve meaningful positive, negative and ordered
coverage obligations; none is a passing observation. Generated-surface refresh,
locked setup and the eventual affected/front-gate/Windows cohorts must run against
the resulting candidate. Ignored `.tmp/tasks/` hashes are historical staging
bookkeeping, not clean-checkout evidence or acceptance artifacts.


### Exact resource recovery and active native storage through a4f4f937f

All source, Python/editor code and authored regressions here are **UNVALIDATED**.
No tests, syntax/lint/format, bootstrap, child/native operations, builds, GUI/model
hosts or benchmarks ran. Formatting and execution remain deferred by the user's
development-first direction. The last qualified production/test source remains
`d4dcba4134f6103e3a59703d90fdbde5ca54d09e`; no new issue closure, measured speedup or
final Windows acceptance follows from publication.

- **Actual download and admission owners:** 9b4740e1b observes Node response native
  close independently of iterator completion, including successful byte EOF,
  delayed teardown and close errors. Timeout/failure retains the exact response
  session and stops automatic retry. Managed archive, Go index/archive and child
  storage consumers retain the matching transaction, reservations and outer lease.
  Failed admission after a reservation was sealed keeps its original coordinator
  and reservation rather than inferring success from a child that never started.
  Authored actual disposable streams and filesystem failure/recovery controls are
  unrun. No network, package installation or user-cache operation was performed.
- **Storage session error and partial admission:** b887fc9b1 preserves frozen,
  readonly and nested failures with exact causes and non-enumerable capabilities;
  combined original observers must all confirm. A callback's pending:false cannot
  override an independently pending original owner. Source 1777b7306 attempts every
  exact lease rollback and retains the partial session if a later admission or
  earlier removal fails. Authored frozen/contradictory/nested and real disposable
  rollback controls preserve both refusal and normal recovery positives.
- **Ordinary receipt integrity:** 01a1e5eb7 uses flushed private bytes and exclusive
  same-directory file-link publication, verifies known read-back identity and
  preserves conflicts. Writer, lifecycle verifier and category inventory share
  strict registered metadata admission. A version-shaped recipe is an observation,
  not immutable upstream proof. No filesystem link operation was executed while
  authoring; this does not introduce a symlink privilege requirement. Actual
  Windows/filesystem/installer qualification remains open.
- **Native selected storage:** b66a06e36 repairs the TUI/CLI discrepancy by using
  the existing verified locator reader/selection overlay. Preview and execution
  identity include locator path/status/hash even for a same-path selection change.
  Invalid selection grants no fallback cleanup authority. Private canonical plans,
  exact apply/exclusion checks and explicit environment precedence remain. Actual
  disposable selected-cache/list/cleanup/stale/invalid controls are authored only.
- **Graph disk accounting:** 5a05e0436 extends the existing account to supplied
  compact graphs, actual shards, offsets, metadata and CSR. Accounted shard
  promotion cannot silently allocate a second directory copy; non-accounted
  callers retain default behavior. Old bytes remain charged through new output
  close/promotion and exact retirement. Shared JSON encoding preserves typed-array
  meaning. Supplied display input is still pre-materialized; generic semantic
  metadata/index copy headroom, fine-grained resume, Windows disk/crash proof and
  heap/latency measurements remain separate.
- **Semantic candidates and retained selections:** bd1a529ba retains conditional,
  logical and mutable constructor aliases in actual dispatch and initializer
  consumers under shared descent/distinct-candidate bounds. compilerBindings18
  and cfgFlow18 retire changed meaning; lspBindings22/callFlow20 stay current.
  Source a4f4f937f owns the exact retained motif world/ref/role selection before
  asynchronous reads and charges metadata/page progress. Caller labels cannot
  retarget stored facts during await. Assignment-order, closure, strong-update,
  behavior-transfer and native differential proof remain unknown.
- **Retrieval, evaluation and editors:** a4af009e7 carries cancellation through
  actual Lance native partitions and row projection, awaits admitted native calls
  before release, checks original candidate membership and reuses bounded topK.
  No-predicate fallback still materializes a full native result; no native-work,
  recall or total-heap guarantee is claimed. Source 313d462d4 binds paired quality
  resampling and saved-trace ordering to fixed UTF16 code units and versions the
  changed policy/checkpoint identity. Sources 0a638469d/c70443bac share contained
  exact source reads and CR/LF/CRLF/BOM/scalar mapping in VS Code/Sublime; original
  byte witnesses remain distinct from live task/use attribution. Source 31c7a18d2
  rejects observed saved-map file changes and invalid UTF8, retaining typed IDs.
  These file signatures are observed stability, not an OS snapshot lock. Source
  models remain materialized; supported editor/browser/native hosts and independent
  cost/quality/source-label acceptance remain open.

Source inspection confirms cache-gc already rechecks index locks before and inside
its existing exclusion barrier. Durable writer locks strengthen that path; their
new actual GC/runtime qualification is still unrun. Generic cache/repos category
migration remains explicitly unsupported. An independent launch-context bridge
is in development; no parent directory is inferred as authorization. All ongoing
agent files remain outside these released commits until exact source handoff.


Saved-map continuation 9cf422fd6 now awaits the exact captured FileHandle close
before publication and retains its nonserializable reconciliation capability on
combined original parse/read/cancellation and close failures. Frozen/nested causes
and original pending observers survive; cancellation during close is still joined.
No path reopen, raw descriptor or substituted close method can settle that owner.
Those descriptor controls are authored, unrun and do not qualify native reliability.

### Source-only continuation: exact recovery and runtime admission

Source interval: after e9223fae4 through cddadde65. These fourteen granular
implementation commits and their authored regressions are **UNVALIDATED**.
The lead and three Sol 6.1/xhigh agents continue in the shared checkout. No tests,
syntax/lint/format, bootstrap, native/child operations, installation, model,
browser/GPU or performance qualification ran. The last qualified production/test
source remains d4dcba4134f6103e3a59703d90fdbde5ca54d09e. Publication and a hosted
policy check cannot replace affected checks or the Windows acceptance cohorts.

- **Refused admission:** d7f866028 retains the exact lease created by an
  admission that was subsequently rejected and could not roll itself back. A
  process-local brand lets the existing storage session adopt that last handle
  and attempt all original rollback owners. Serialized/copied metadata grants
  no recovery authority. Disposable filesystem refusal/recovery controls are
  authored, including normal admission and rollback positives.
- **Index category ownership:** 38258e900 adopts the actual canonical launch
  context in writer/watch/rebuild/compaction/artifact callers. Path-only lock
  imports remain lazy. Exact writer release precedes category release, and
  locator drift refuses admission. Only a WeakMap-branded metadata deadline
  observes its original removal promise; late unlink proves that metadata alone.
  Source ed620fcc5 admits runtime storage before resource initialization and
  retains it through every teardown step or initialization unwind and failed
  attempt recording. Frozen errors and independent unknown pending owners stay
  retained. Real runtime/category race and failure-receipt controls are authored.
  Generic cache/repos migration and external roots/ordinary readers remain open.
- **Native cleanup failures:** afa3b701d retains exact LanceDB table/connection
  close methods and failed retired entries, tries independent resources and
  preserves query/cancellation plus close failures. Sources c1bea8def/6779dbff3
  retain frozen and late reranker causes, exact asynchronous tensor/session/
  tokenizer/artifact disposal, parent dependencies and strict final storage
  confirmation. Sources 2d5a9bed4/16e53a2a6 repair mutation of frozen ONNX causes,
  capture exact release methods and retain qualification capacity until all
  reported owners settle. Deferred startup disposal preserves pending failures.
  Successful child releases are not repeated. Existing reverse-cleanup assertions
  remain; original error identity is checked as exact cause because mutating it
  was the defect. Direct and actual provider/adapter/scorer controls use inert
  native boundaries. Native rejected-release retry safety, actual handle state,
  real models, memory, recall and latency remain unqualified.
- **Executable identity:** 56befaf68 uses bounded contained descriptor reads and
  binds prerequisite verification to the same physical path, digest and size.
  Trust and cancellation apply to that physical selection. Inert probes over
  ordinary files cover alias retargeting, in-probe replacement and cancellation;
  no physical links or executables were launched. Pre/post checks do not establish
  OS-atomic launch of an independently mutable external executable.
- **Import and provider meaning:** 8a294daf4 follows the installed TypeScript
  implementation's exact-key/longest-prefix/declaration-order selection and
  nonempty star substitution. Existing config fingerprints change, and shared
  importResolution4 retires earlier semantic policy meaning. Source cddadde65
  balances source declaration delimiters before admitting direct parameter/return
  inlay roles; unsupported or ambiguous headers remain observations. Existing
  positive provider fixture positions now use actual insertion boundaries. Shared
  lspBindings23 retires changed projection meaning; compilerBindings18/cfgFlow18/
  callFlow20 stay current. Compiler-oracle/provider regressions are authored only.
- **Retained consumers:** 3ab871baf feeds canonical syntax to the existing inert
  lexical rename planner. Source 94337a432 compares two independently owned motif
  maps, retaining each world's roles, parallel witnesses, uncertainty and coverage
  under one paired response allowance. Source 97836c69c pins exact-source lens
  selections before asynchronous reads, rejects accessors and incomplete records,
  and bounds caller/retained metadata. No source-language closure, behavioral
  equivalence, live edit/apply authority or public qualification is inferred.

The complete 957-issue inventory remains open. These source repairs do not add
qualified completions or claim a current deep-suite pass. Fresh locked setup,
affected fail-before/after checks, formatting/front gate, generated freshness,
Windows native/terminal/runtime acceptance and applicable performance evidence
remain deferred. Author-workspace `.tmp/` release manifests are historical hash
bookkeeping; checked-in contracts, fixtures and this receipt remain the durable
handoff in a clean checkout.

### Managed runtime and source fidelity continuation

Source interval: after ad0cc3e15 through c1e9ae3fb, eleven further implementation
commits. All source and authored regressions remain **UNVALIDATED** under the same
execution deferral. No test, syntax/lint/format, setup, native/child, installation,
migration, physical link, model, browser/GPU or benchmark operation ran. These
commits do not replace the last qualified source or close any of the 957 reports.

- f8d6ac273 reuses the existing multi-root session for actual managed-installation
  retention. Refused admission and failed post-admission byte inspection keep every
  actual failed rollback owner; successful sibling removals are still attempted.
  Both original descriptor and installation identities stay pinned. A synthetically
  valid replacement receipt reusing its installation label cannot silently change
  the selected descriptor. Source 6414a0f2c brands only a real failed session
  metadata release against its exact session; copied fields and serialized errors
  confer no authority. These ordinary-file/receipt/exclusion controls are authored.
- 83eb530c8 repairs actual provider and LSP command ownership: frozen errors keep
  exact causes, native observer receivers and nonenumerable reconciliation handles.
  Direct child close, independent native settlement and exact lease removal remain
  separate requirements. Metadata callbacks retain errors for explicit retry.
  The shared synthetic command fixture was missing archive/source/ownership/
  lease-protocol/verifier fields now required by the authoritative receipt schema;
  the fixture is corrected without relaxing consumer admission. Original normal,
  delayed-close and timeout negatives remain, with composed errors checked through
  their exact original causes. No actual executable or LSP host ran.
- faf9c9f0b uses the session producer brand in actual detector, runtime and structural
  consumers to avoid waiting on their own failed metadata removal before retrying
  it. Unknown or forged native markers still block release. Physical executable
  path/size/digest are checked before and after transport; structural execution
  retains every started invocation through callback scope completion and prevents
  stale scope launches. Inert children plus real disposable category/unlink controls
  are authored; they do not establish arbitrary descendant containment or atomic
  launch identity of independently mutable external executables.
- 5fea91852 drains all configuration observations before operation-lock release,
  preserves frozen directory read/close and journal/recovery failures, and retains
  only actual failed metadata lock handles. Nested operation failures preserve all
  known handles and original observer receivers. Pending category/manifest owners
  cannot be flattened into ordinary blocked diagnostics. Tiny copy/interruption/
  resume/rollback and gated observation controls are authored; no user migration
  occurred, and generic cache/repos migration remains prohibited.
- c1e9ae3fb distinguishes Location/LocationLink required selections and verifies
  exact source container ownership before canonical LSP joins or hierarchy tokens.
  Invalid source enclosures remain partial evidence. Shared lspBindings24 retires
  changed meaning. Source aeedea4fd preserves custom-qualified and Unicode alias
  identity, bounds Python normalization and avoids repeated full-prefix scans;
  typeNormalization3 changes the existing semantic policy identity. Canonical
  provider and retained join controls are authored. importResolution4,
  compilerBindings18, cfgFlow18 and callFlow20 remain current.
- f83eecd26 replaces growing map-page prefix copies/serialization with per-candidate
  UTF8 JSON-array admission, preserving cursor envelopes and the final full-response
  byte guard. c16c615f0 replaces Python per-byte non-ASCII column tables with sparse
  scalar checkpoints. Independent original-envelope/Buffer geometry and operation
  controls are authored; no latency, total allocation, native parser or browser
  qualification is claimed. Source 79b1b4e31 maps Sublime cursors and ranges through
  original BOM/CR/LF/CRLF source rather than a host LF-only line table, retaining
  original UTF8 byte witnesses and scalar boundaries. Actual Sublime acceptance
  and live source/task/use attribution remain open.
- 0eee1e141 inspects checked retained upper-summary members through the existing
  exact-source lens and reads only the certificate/system copy actually checked.
  Abstract membership is not reachability or source-language truth; missing spans,
  unknown checks and mandatory overflow remain explicit. No producer version bump,
  feasible-path proof, live edit authority or public rollout is inferred.

The lead and three Sol 6.1/xhigh agents continue independent real-file spans.
Underlying and outer embedding cache retirement, reused installation verification
and further provider consumers remain ongoing; unreleased edits are not included
in this checkpoint. Generated surfaces, locked setup, affected checks, front gate
and Windows/native/model/resource qualification remain deferred. Earlier green
results retain their exact source and do not qualify this tree.

### Native cache and managed reconciliation continuation

Source interval: after 44e3921c5 through 77507752b, thirteen implementation
commits. All source and authored regressions remain **UNVALIDATED**. No test,
syntax/lint/format, bootstrap, native/child operation, installation, migration,
physical link, model, GC, browser/GPU or benchmark execution ran. The last
qualified production/test source remains d4dcba4134f6103e3a59703d90fdbde5ca54d09e;
none of these commits closes an issue or supplies current-tree acceptance.

- 12ccb3e73 retains exact retired ONNX cache entries, startup/resource owners and
  original failures through deliberate reconciliation. A resource capability can
  acknowledge cache closure only after accepted work and its queue drain, startup
  completion and zero live references. Background pruning/finalizer handling does
  not retry recorded native cleanup failures. Successful child closes stay closed.
  First references are pinned before pruning, including backwards-clock victims.
  Authored actual-provider and controlled finalizer boundaries are inert; native
  rejected-release retry safety and actual GC remain separate qualification.
- 7b23ccf42 applies the same explicit original-owner lifetime to the existing outer
  adapter and pipeline caches. Failed entries remain reachable through scoped
  capabilities; accepted startup/operations drain before a reference decrements
  once. Global shutdown joins independent outcomes without retrying a known failed
  close. Xenova loaded-byte verification retains its exact acquired pipeline and
  immutable primary/cleanup evidence. Actual warmup/query consumers propagate
  unconfirmed ownership instead of reporting ordinary unavailability. The new
  cache/provider/consumer controls are authored only. Prepared encoder/component
  partial acquisition remains a separate owner, and real model/native retry
  safety, descendant containment, memory and latency qualification remain open.
- e0539000e retains the original reused-installation verifier and exact metadata
  handle. da5a39605 requires explicit inner release confirmation before outer
  reservation/category release, preserving frozen action errors and nonenumerable
  child capabilities. 8cadfed8c extends actual session ownership to new archive
  publication, staged verification and removal. Original native/response observers
  independently govern resource settlement; own producer-branded metadata failure
  may retry. Changed or unreadable staging identity stays preserved. Frozen
  journal, cleanup, generation-retirement and selector-rollback failures retain
  their exact causes and evidence. 77507752b keeps the complete outer wrapper on
  every later failed reconciliation, so following only the latest error cannot
  lose the original outer reservation/session owner. Tiny ordinary-file fixtures
  and inert archive/verifier boundaries are authored, with strict normal and
  negative receipts; no installer, executable or user cleanup ran.
- c2547c7bc preserves failed lease-record write/fsync and descriptor-close evidence
  together, including frozen and falsey original failures. Unsealed or ambiguous
  publication grants neither a scoped lease nor metadata deletion/retry authority.
  4e6d6caad captures original storage closure functions and receivers before
  settlement callbacks, enforces observers with absent/false pending flags, and
  refuses callback replacement or contradictory receipts. Unreadable evidence
  remains unknown without masking the operation failure. Actual disposable lease
  descriptor/category fixtures retain protected evidence and healthy positives;
  they are unexecuted and do not qualify real native closure.
- 140d794e7 shares effective SQL dialect/string options with statement splitting,
  static include and flow consumers, preserving CR/LF/CRLF physical line ownership.
  It advances sourceChunking7/importResolution5. 6a54a2de0 attributes Python
  decorators/defaults/annotations/bases/metaclass observations to the surrounding
  lexical owner before entering the new declaration body, advancing sourceChunking8.
  59f20ecbd admits bounded parenthesized/attributed C/C++ prototype names while
  preserving pointer/reference/array binding negatives and complete declaration
  ranges, advancing sourceChunking9. c1b162f8c selects actual static R argument
  roles, decodes supported literal spellings and keeps their exact bytes through
  registered relations; nested call extraction retains existing budgets and
  importResolution6 retires changed meaning. Actual registered/native/CPython
  consumer regressions are authored only; grammar/interpreter/platform acceptance
  and complete source-language semantics remain separate.
- dd52e08b6 pins immutable structured LSP request parameters before transport awaits
  and uses the captured identity for coalescing. Hierarchy tokens bind their method
  family and publish atomically only after the complete raw/projection budget fits
  and the current/cancellation check still holds. lspBindings25 retires changed
  meaning; typeNormalization3/compilerBindings18/cfgFlow18/callFlow20 stay current.
  Original invalid-source/container/cursor negatives remain. No live provider ran.

The live census still contains 957 open reports. Three Sol 6.1/xhigh agents and the
lead continue independent real-file spans; root owns Git and integration. Ongoing
unreleased edits are excluded from this checkpoint. Source operation reductions
are distinct from measured improvements. Locked setup, generated freshness,
affected fail-before/after checks, format/front gate and final Windows cohorts
remain deferred. Author-workspace release hashes under `.tmp/` are historical
bookkeeping, not files promised in a clean checkout.

### Resource settlement and retained consumer continuation

Source interval: after 40f867945 through 7ebf32cb3, fifteen implementation
commits. All source and authored fixtures remain **UNVALIDATED**. No test,
syntax/lint/format, bootstrap, native/child operation, installation, migration,
physical link, model, browser/GPU, real GC or performance check ran. Source
inspection includes the installed TypeScript and pdf.js implementations; it is
not runtime qualification. The last qualified production/test source remains
d4dcba4134f6103e3a59703d90fdbde5ca54d09e. No new issue closure is claimed.

- 9b4306384 requires original cache-writer closure observations before lease
  assertion/invalidation/release, independently of absent/false advisory flags.
  Failure composition captures both original functions and receivers; replacing
  fields later cannot erase either owner. Unknown getters and missing/throwing
  observers remain unconfirmed. 0d6d09d5b preserves a registry worker failure on
  the existing file-lock release error when owned metadata cleanup also fails,
  including frozen and falsey causes. Borrowed leases stay caller-owned. These
  actual owner boundary controls use inert resources and are unexecuted.
- 78e1a77a3 attempts legacy/latest and attempt-owned state/events publishers
  independently. A failed convenience path cannot suppress the authoritative
  attempt copy; a failed attempt path cannot erase a surviving legacy copy.
  Serialized terminal precedence, existing atomic writers, redacted bounded events
  and warning deduplication remain. The actual tiny publisher fault fixture
  asserts both healthy copies, exact expected warnings and normal warning-free
  publication. No current process/crash/full-disk acceptance follows.
- 39d7775b4 normalizes falsey installer hooks, awaits progress callbacks, guards
  diagnostics/receipt getters and preserves actual secondary inspection errors.
  Primary and receipt-inspection native observers participate independently in
  verifier settlement. 1c522fa89 reuses that receipt owner for actual Go SDK
  verification, retaining original child/tree evidence, frozen primary/cleanup
  failures, exact private transaction/pointer identities and complete latest retry
  capabilities. Changed/unsealed evidence stays preserved. Existing cache recipe
  assertions remain, with cause-based failure checks. Tiny inert archive/native
  adapter/category controls do not qualify actual downloads, Go or descendants.
- beff98629 attempts every captured original source/output descriptor close and
  retains failed FileHandles on a branded process-local transfer capability.
  Even when both descriptors close, an independently pending read owner retains
  that capability. Migration reuses existing retained exclusions until those
  original owners and every exact metadata lock settle, attempting independent
  lock removals before reporting failure. Latest errors preserve full recovery;
  managed inspection propagates pending descriptor ownership. Actual tiny
  copy/close/exclusion/inspection/resume fixtures are authored, not executed.
  Generic cache/repos migration remains prohibited.
- 778078017 retains actual PDF destruction promises through the existing bounded
  wait instead of replacing an outstanding native operation with another call.
  Accepted late loading/page work stays owned. Current installed document proxies
  have no separate destroy method; loading-task transport ownership remains valid.
  Provided independent document disposers remain independent. Frozen page and
  cleanup failures retain exact causes; a pending extraction is not converted to
  an ordinary skip. Authored actual extractor/lifetime controls are inert. Current
  consumer propagation, actual pdf.js workers/platforms and native retry safety
  remain unqualified; successful extracted-text meaning does not change.
- fc05cd75f carries the actual model-component owner from acquisition to prepared
  encoder and downloader, closing independent tokenizer/model resources even when
  another cleanup fails. Partial acquisition preserves original pending startup.
  Prepared operations capture input/output tensor objects before later failure,
  deduplicate aliases, copy returned vectors and hold model/tokenizer parents while
  child cleanup or original native-work observations remain pending. Accepted queue
  and profiling work drain before closure. Direct Xenova plain cleanup failure now
  retains its real original pipeline owner; the first later dispose reports it
  before an explicit retry, without reloading. Falsey query/getter failures retain
  exact presence. Four inert boundary fixtures and existing downstream assertions
  are authored. Native internal tensor/allocator lifetime, retry safety, generic
  non-profile output tensors, real-model quality and memory/latency remain open.
- b115f4215 and 7ebf32cb3 retain exact scene/environment/renderer resources after
  group or lookup removal, attempt independent shutdown paths and preserve frozen
  or falsey conversion/cleanup/rollback values. Original scene and cache observers
  are captured independently with their own receivers; both must confirm. A stale
  scene cannot adopt current sibling controls/caches. Inert actual owner/shutdown
  controls are authored. Partial renderer construction, real Three/browser/WebGL
  behavior, GPU retry safety and resource/performance qualification remain open.
- 382e2c55a charges primary hierarchy facts and related call-site ranges against
  the same collector allowance and requires the caller's exact source enclosure.
  f6cde2bda shares scalar endpoint rejection with legacy enrichment. c3f883443
  preserves Location/Link and symbol URI/selection/container shapes before source
  signature parsing, removing arbitrary clamped line fallback. Name-only source
  signatures remain unsupported. rq4/lspBindings28 retire changed admission;
  actual controlled-client/collector regressions are authored, with no live server.
- 80ad120e9 preserves own argument-map keys such as __proto__/constructor through
  actual cold propagation and source-qualified warm replay, advancing callFlow21.
  dfd907d04 follows checker-qualified property/static/shorthand and literal bracket
  class aliases within existing bounds, preserving conservative order/escape
  reasons and dynamic-key negatives. compilerBindings19/cfgFlow19 retire changed
  meaning. Current sourceChunking9/importResolution6/typeNormalization3 remain.
  Canonical compiler CFG/dispatch and actual replay fixtures are authored only;
  no full source-language, native compiler or fine-grained resume acceptance follows.

The 957-report inventory remains open. The lead and three Sol 6.1/xhigh agents
continue independent real-file spans; ongoing unreleased work is excluded here.
Locked setup, generated inventories/freshness, affected fail-before/after checks,
format/front gate and final Windows cohorts remain deferred. Source operation
reductions and hosted policy status are not full-suite or latency evidence.

### Lexical consumer and directory ownership continuation

Source interval: after36f6f9c0c through e0c4ff524, seven implementation commits.
Every new source/fixture remains **UNVALIDATED**. Source inspection and exact
release hashes are bookkeeping, not runtime evidence. No tests, syntax/lint/format,
bootstrap, native/child/installer/migration operation, link creation, model,
browser/GPU, GC or benchmark ran. Last qualified production/test source remains
d4dcba4134f6103e3a59703d90fdbde5ca54d09e. No new issue closure is claimed.

- 4952fc1c6 routes CR/LF/CRLF/U2028/U2029 comment termination through actual
  TypeScript AST/heuristic/body/fallback and registered native JS signatures.
  CRLF uses one line allowance; other language defaults stay independent.
  sourceChunking10/callFlow22/local chunk7 retire changed meaning. Authored
  actual-consumer controls do not qualify general line indexes or all grammar.
- 194869e7c preserves quoted values before parser, source-preview, cache-key and
  payload normalization; syntax/namespace rewrites use existing literal masking.
  Parse keys use version4 JSON tuples. 54f5baae7 shares existing own-data helpers
  across dynamic parameter parser routes and actual completeness/merge/cache/
  enrichment/public MetaV2 consumers. Inherited values cannot supply evidence.
  Current lspBindings30/rq6 supersede29/rq5; typeNormalization3 stays unchanged.
  Authored actual cold/warm, language-matrix and public JSON controls are unrun.
- 6a68a3382 retains original destination-probe FileHandle destruction, exact
  created identity and category metadata through explicit recovery. Exclusive-open
  collisions stay untouched; failed round trips cannot become writable after
  cleanup. e0c4ff524 shares actual Dir read/close ownership across inventory,
  configuration and managed scans, drains admitted reads and preserves original
  native observers. Existing migration exclusions and managed outer recovery wait
  for original file then directory closure before exact stage/category removal.
  Actual disposable handle, frozen error, nested retry, metadata-fault and normal
  publication/resume regressions are authored only. Unknown observations and
  changed identity remain protected; generic cache/repos migration stays barred.
- 91f2ef74f prevents automatic operation retry around a retained PDF owner, even
  when the original page failure is retryable. Actual nested queue/shard controls
  and ordinary retry positives are authored. 888ffb132 retains falsey worker causes
  and exact worker/handler failures, captures original settlement functions and
  receivers before callbacks, and projects independent observations through
  best-effort aggregation. It grants no cleanup authority; original capabilities
  remain on exact causes. Callback success/mutation cannot erase pending evidence.

The three Sol6.1/xhigh agents continue independent real-file implementation while
the lead integrates and publishes. Unreleased edits are excluded. Locked setup,
generated inventories/freshness, fail-before/after checks, format/front gate and
Windows cohort acceptance remain deferred; source contracts do not establish
native retry safety, representative quality, measured speedup or a suite pass.

### Original closure, provider parsing and Windows recovery continuation

Source interval: after b3445b2a5 through ac9091018, twelve implementation commits.
The live census remains 957 open issues. All new source and authored regressions
are **UNVALIDATED**: no tests, syntax/lint/format, bootstrap, native/child/install/
compiler operation, network download, physical links, model, browser/GPU, GC or
performance campaign ran. Last qualified production/test source remains
d4dcba4134f6103e3a59703d90fdbde5ca54d09e. No new issue closure is claimed.

- a64c17e4d captures queue operational descriptors and nonenumerable original
  capabilities before error callbacks, preserving metadata alongside original
  causes and independent observers. cf31f27fc separates worker/release rejection
  from truthiness: exact undefined/null/false/zero/empty failures survive successful
  or failed lock release; fulfilled falsey work stays successful. Actual disposable
  lock/unlink and callback-mutation controls are authored. Generic publication's
  descriptor/identity lifetime remains a separate active repair owner.
- 8dd4d3e56 gives concurrent/reentrant/later registry close calls one original
  flight, retaining rejection and refusing implicit destruction retry. Default
  close/drain method/receiver identities are captured once; falsey hook rejections
  remain failures and independent hooks still run. Authored inert registry controls
  do not qualify unregister semantics, arbitrary worker adapters or descendants.
- e4ef1a1fd admits scheduler crash evidence before optional presentation, retaining
  local/durable/external sink independence. Throwing enabled/method getters and
  rejected callbacks are attributed to their own sink; warning rejection cannot
  escape. Actual tiny atomic publisher and healthy-receipt controls are authored.
  Abrupt exit, real Windows faults and never-settling callbacks remain unqualified.
- 0a2625667 captures generic Xenova output tensors/aliases, copies only vectors
  still sharing owned buffers and drains accepted output cleanup before pipeline
  closure. Private original encoder/lease bindings and immutable producer records
  delegate only owned cleanup; mixed unknown children retain original observers.
  Copied fields/causal membership cannot grant delegation. First actual observers
  are retained across replacement without caching earlier absence as settlement.
  Pending cleanup retires otherwise cancellation-shaped warm entries; ordinary
  admission cancellation retains warmth. Actual inert generic/prepared/cache
  controls remain unrun; native allocator/retry safety/model/GC proof is open.
- 363d77609 retains actual Windows capability resources and category metadata,
  then original prerequisite apply-lock ownership, across frozen/falsey failures
  and latest recovery. Genuine nested capability identity is private; matching
  property data cannot substitute for a producer. 2b80ae1aa reuses the existing
  bounded response owner for every approved official-release redirect. No next
  request starts while original body/native closure is unconfirmed. Original
  observations survive successful transport cleanup and false advisory flags;
  classification failures keep independent causes. Remapping uses own declared
  reason keys. Existing clangd source/digest/target/reuse assertions remain.
  Disposable evidence/lease/apply-lock and actual Readable controls are authored;
  no real installer/compiler/network acceptance follows. Shipped incomplete
  allocation still blocks prerequisite apply. Archive parser/writer lifetime gaps
  remain open; no arbitrary cleanup or new lease namespace was added.
- de40c0b14 shares quote-aware outer parameter ownership across Swift/Zig/Elixir/
  Ruby/Lua/C-like/Java routes and preserves generic arrows. 46d59d99f preserves Go
  raw struct-tag values and quoted generic brackets. b51df8499 selects complete
  Rust/CSharp root-token ownership with Unicode/qualified/escaped/repeated-pass
  negatives. 373cf39c2 projects DocumentSymbol trees iteratively while preserving
  preorder, exact range metadata and distinct sibling occurrences; active-array
  cycles are rejected. Current lspBindings33/rq8/typeNormalization4 retire changed
  meanings; sourceChunking10/importResolution6/compilerBindings19/cfgFlow19/
  callFlow22 remain. Actual parser/cache/document/public consumer controls are
  authored only. Full language/real-server/research integration and measured
  resource/performance qualification remain open.

- ac9091018 preserves actual renderer prepare/commit primary, candidate retirement
  and operation completion failures separately. Published candidates remain live
  despite later callback failure; every old-scene cleanup is attempted. Reveal
  reports observed committed truth and fences old source status/callback writes.
  Source fallback restores navigation/status before cleanup and uses its exact
  original source/scene/disposer/token to fence post-await writes, including a
  newer enhancement before asset acquisition. Returned superseded failures retain
  original pending resources. Actual inert transaction, resident commit, reveal
  and gated fallback controls are authored. Disposal requests cancellation only;
  full enhancement ownership, browser/Three/GPU retry safety and resources remain
  unqualified.

Three Sol6.1/xhigh agents continue independent real-file spans while the lead owns
integration, Git and publication. Unreleased editor/provider and generic lock edits are
excluded from this checkpoint. Locked setup, generated inventory/freshness,
fail-before/after proof, format/front gate and final Windows cohorts stay deferred.
Hosted policy success and source operation changes do not qualify the deep suite.

### Exact native use and source-admission continuation

Source interval: after6154c56ae through a168da42a, five implementation commits.
All source and authored assertions remain **UNVALIDATED**. No tests, syntax/lint/
format, bootstrap, native/database/IPC/child operations, compiler/source execution,
editor/browser/GPU/model, installation/migration, physical links, GC or performance
qualification ran. Last qualified production/test source remains
d4dcba4134f6103e3a59703d90fdbde5ca54d09e. No new issue closure is claimed.

- b15ad76bd requires original resource observation before automatic operation
  retry, independent of a false advisory marker or retryable label. Explicit
  non-retryable data errors retain identity; a throwing retry-policy getter keeps
  original and inspection failure observers separately. Authored actual queue
  controls retain ordinary retry after confirmed closure and PDF identity.
- a168da42a keeps canonical SQLite/LMDB command handle methods/receivers and
  original accepted use through actual closure. An outer callback return does
  not close a handle with admitted work still running; concurrent closes join one
  actual flight. Native unknown work observations block destruction; rejected
  close is retained without automatic retry. Late work/factories are refused
  before invocation. Frozen/falsey work, cleanup and settlement failures remain
  exact causes; original handles remain strongly retained on pending diagnostic
  evidence. Positive delegated settlement requires real owner confirmation.
  Existing actual SQLite content/close/authority assertions remain. The old
  mutable-primary failure expectation now requires the exact immutable causal
  chain, exact cleanup and unknown closure. Additional actual inert command-owner
  controls are authored, including unawaited accepted failure. No SQLite/LMDB,
  IPC/child, native retry or Windows resource qualification follows. Direct driver
  calls retain caller completion responsibility; no arbitrary method is instrumented.
- 0e62c1c55 rejects malformed complete semantic-token chains, overflowing delta
  positions, undeclared modifier bits and source/scalar violations through the
  existing stage diagnostic path. Half-open lookup and own-only class maps cannot
  transfer another token/prototype's class. Protocol null remains valid empty.
  Actual decoder/document consumer controls are authored. lspBindings34 retires
  changed admission; rq8 remains the signature-only cache policy.
- 1c1e712cd binds requested and actually opened VSCode URIs to the same verified
  local source. Closed or identical-text sibling/virtual targets cannot supply
  native locations. Selected canonical root joins per-request cache identity and
  URI/file binding is rechecked at publication. Existing byte/dirty/version/source
  guards remain. Actual direct and registered-provider controls are authored;
  supported editor and remote-host behavior remain unqualified.
- c0f1bc688 shares computed property-name conversion across data properties,
  methods/accessors and class keys. Conversion occurs once before initializer or
  function creation and retains existing catch/finally routes. CFG and immutable
  value slices retain the source key dependency plus explicit coercion frontier;
  cfgFlow20/valueSlice6 retire changed meaning. Actual CFG/order/reaching-definition/
  immutable row controls are authored. Full source-language/coercion/runtime
  precision remains open. sourceChunking10/importResolution6/typeNormalization4/
  compilerBindings19/callFlow22 remain current.

The lead and three Sol6.1/xhigh agents continue independent real-file spans.
Unreleased generic lock, enhancement and compiler/provider edits are excluded.
Locked setup, generated freshness, fail-before/after proof, format/front gate,
actual hosts and final Windows cohort reconciliation remain deferred. Source
contracts and hosted policy status are not suite, resource or latency acceptance.

### Enhancement generation and worker callback continuation

Source interval: afterfe5f1f9ae through6cb8cf1b7, two implementation commits.
Both remain **UNVALIDATED**. No tests, syntax/lint/format, bootstrap, native/child/
IPC, editor/browser/GPU/model, physical links or performance checks ran. Last
qualified production/test source remains d4dcba4134f6103e3a59703d90fdbde5ca54d09e.

- 595ce9632 captures simple worker terminate/kill/close methods and receivers at
  registry admission. Replacing their properties later cannot redirect cleanup.
  Best-effort async diagnostic rejections are consumed. Authored inert registry
  controls preserve the existing unregister policy; numeric-PID tree teardown and
  real descendant settlement are not qualified by this slice.
- 6cb8cf1b7 fences viewer module/environment and scene construction awaits by
  exact enhancement/source/document generation. The actual scene producer reports
  its installed scene/renderer/disposer synchronously, and cleanup retains that
  original method/receiver. Stale imports cannot mutate the current modules or
  retire a shared scene they never acquired; old construction failures cannot
  dispose a newer successful scene or replace its fallback/status. Page retirement
  stops later publication without claiming import cancellation. Actual inert
  scene and async generation controls are authored. Partial construction before
  shutdown-owner installation, reentrant callbacks and GPU/native closure remain
  separate active work.

The PR description is being rewritten around current behavior, historical evidence
and compact issue groups from this complete disposition table. Historical closing
references remain unchanged; later source and partial mappings gain no closing
keywords or acceptance claim. The live inventory remains 957 open reports, and
three Sol6.1/xhigh agents continue independent real-file implementation. Pending
lock/compiler/renderer edits remain outside this checkpoint.

### Lock publication, construction and comparison-evidence continuation

Source interval: after31f7beaed through c804b6d04, seven implementation commits.
All source and authored regressions remain **UNVALIDATED**. No tests, syntax/lint/
format, bootstrap, native/child/database/IPC/compiler, Python/editor/browser/GPU/
model, install/migration, physical links, GC or benchmark qualification ran. Last
qualified production/test source remains d4dcba4134f6103e3a59703d90fdbde5ca54d09e.

- f04f3261c captures actual generic lock descriptor write/stat/close and original
  receiver, marks close only after confirmed fulfillment and refuses post-open
  error reclassification into acquisition. Exact private/coalesced rollback waits
  for every original observer and sealed physical metadata before removal; it
  never replays a write. Existing local acquisition/stale/async/sync/force removal
  refuses pending publication. Successful release checks original physical/ID
  evidence. Falsey/frozen primary, close and message/getter/descriptor failures
  remain causal. Original diagnostic message is read once, readonly code retained,
  and explicit false close stays unconfirmed. Actual disposable descriptor and
  metadata controls are authored. Process-local lexical guarding is not durable
  cross-process/physical-alias/atomic compare-unlink proof. Changed timestamps at
  native close can conservatively block rollback; no evidence is silently adopted.
- 8946032c4 carries runtime cleanup and failure-recording presence independently
  from undefined/null/false/zero/empty rejections through actual receipt and outer
  finalizer. Frozen/raw originals remain exact causes; diagnostics add immutable
  context and preserve inspection failures. The existing category owner captures
  independent original methods/receivers, excludes only its own producer wrapper
  for that owner and retains sibling evidence. Actual receipt/disposable category,
  no-owner, original-observer replacement and sibling controls are authored. Fixture
  metadata disposal is not a production settlement receipt. Unknown native close,
  full teardown composition and IPC recovery remain separate qualification.
- 7e378d245 owns returned renderer/canvas/shadows/listeners during actual scene
  construction. Failed steps retire original acquired resources independently;
  pre-install original pending work gates native retirement. Installed cleanup
  delegates to original shutdown and reuses exact capabilities, preserving detached
  shadows and same-attempt fallback after successful closure. Actual inert native
  constructors and original observer/frozen/falsey/listener controls are authored.
  Inaccessible constructor allocations, post-install work, real hosts/native GPU
  quiescence/retry/resources/performance remain unqualified.
- 1d353d9e0 shares literal property-symbol anchoring for implicit accessors and
  retains wrapped assignment/update/delete roles. Deleted-property accessor calls
  disappear while receiver getters remain. callFlow23 retires changed meaning.
  e507fd723 keeps computed-name reads in their creation context without changing
  parameter/body/nested closure capture. valueSlice7 retires that persisted meaning.
  Actual checker and retained call/value partition controls are authored; language,
  dynamic/conditional/coercion and research completeness remain open.
- 5e335196e binds actual Sublime opened/deferred views to their original resolved
  file and captures hit fields before asynchronous loading. Equal-text siblings,
  scratch/renamed views and later hit mutation cannot supply native location
  authority or change another view's UI. Existing original bytes/ranges/dirty/
  operation guards remain. Actual consumer controls are authored only; supported
  Python/Sublime and remote topology acceptance remains separate.
- c804b6d04 adds the canonical benchmark comparison-input projection and shares
  the existing verdict version with its producer. Required run/count/diagnostics
  evidence must be explicit, coherent and supported; empty, unrelated, impossible,
  negative/nonfinite/noninteger/all-skipped reports fail admission. Missing/null
  legitimate timing endpoints remain null rather than becoming zero deltas.
  Informational mode warns; enforce fails. Existing plan/parity/delta assertions
  remain: smoke fixtures' old total10/failed11 and event-like diagnostic30 counts
  were impossible under actual repo-presence semantics. Consistent full-corpus
  total40 and complete class/passed/degradation counts preserve all original deltas.
  New direct/CLI/actual producer roundtrip controls are authored and unrun. A valid
  projection does not prove provenance, workload equivalence or measured gains.

The live inventory remains957. Its compact PR groups now map141 historical closing
references,554 additional source implementations,155 partial reports and107 pending
reports. Counts describe dispositions; no new closing keywords or issue acceptance
are claimed. The lead and three Sol6.1/xhigh agents continue independent real-file
spans. Unreleased archive/compiler/reranker edits are excluded. Locked setup,
generated freshness, fail-before/after proof, format/front gate and final Windows
cohorts remain deferred; hosted policy status is not suite qualification.

### Archive descriptors, native work and execution-owner continuation

Source interval: afterc3e974f61 through a148c790c, five implementation commits.
All new source/assertions remain **UNVALIDATED**. No tests, syntax/lint/format,
bootstrap, compiler/native/database/child/IPC, Python/editor/browser/GPU/model,
installer/download, physical links, GC or benchmarks ran. Last qualified
production/test source remains d4dcba4134f6103e3a59703d90fdbde5ca54d09e.

- db581ab96 attaches actual CFG execution owner to existing call-effect receipts
  and carries canonical ownership through the real compiler session. Computed
  method names/static initializers stay in creation context; defaults/bodies stay
  in invocation, module keys outside functions. Missing/conflicting/unknown owner
  evidence stays unattributed and incomplete with explicit coverage reason, never
  guessed from containing method spans. Supplied legacy summary fixtures retain
  their explicitly unqualified interval path. cfgFlow21/callFlow24 retire changed
  meaning; actual CFG/checker/retained call-flow controls are authored, unrun.
- 60d6f49b0 propagates original native-work receipts through actual local reranker
  scoring before tensor destruction. Rejected inference cannot release inputs,
  session, tokenizer, artifact or storage while its original observer is pending.
  First observer capture survives marker absence/false and later replacement.
  Successful native closes remain remembered across late child observations;
  explicit false is unconfirmed. Private failure-producer identity and actual
  storage-release call stage prevent copied diagnostic fields granting cleanup
  authority. Earlier falsey inference errors survive later cleanup-time abort.
  Actual inert adapter/scorer/resource controls are authored. Existing explicit
  failed-close retry remains unqualified for real native/model safety.
- c7e0f7ccf runs replay-verification clearing through the existing bounded teardown
  step so an exact falsey failure cannot skip logger closure or category retention.
  Best-effort async progress rejections are consumed through cleanup/parser/LSP
  reporting without becoming resource receipts. Actual inert teardown/category
  controls are authored; full multi-error/method-getter/native teardown remains open.
- 17da596aa owns actual Zip/Tar/Tar.gz source/output FileHandles, their captured
  methods/receivers, bounded range reads, partial writes and admitted entry-task
  drain. Yauzl reader closure acknowledges protocol only. Both formats publish
  temporary files after native close while preserving regular overwrite behavior.
  Original independent observations and genuine nested owners gate actual close,
  not merely later directory deletion. Only exact same-producer errors are excluded
  from self-observation. A private/coalesced archive capability explicitly retries
  original closes/owned directory removal without extraction/download/write replay.
  Managed/Go recover nested archives before category/staging gates; clangd and
  extensions retain original transaction cleanup, and clangd pointer cleanup checks
  original identity. Extension work stops on unsettled transactions before later
  downloads/manifest. Real tiny parser/FileHandle fault and actual inert-network
  consumer controls are authored. No filesystem/native acceptance, process-exit
  capability reconstruction, new clangd category namespace or atomic path removal
  is claimed; native verification and hostile mutation remain separate.
- a148c790c distinguishes Haskell character tokens, promotion ticks and identifier
  primes while finding arrow/context/forall separators outside literals/nesting.
  Existing protected whitespace preserves type spelling through actual parser,
  cache and document consumers. GHC/Haskell primary grammar references are linked
  in its contract. rq9/lspBindings35 retire old results; typeNormalization4 stays.
  Actual cold/distinct/warm controls are authored; normal source admission, HLS/
  GHC extensions/cradles, advanced grammar and tool qualification remain pending.

Current compact dispositions:141 historical references,554 later source mappings,
156 partial/qualification-dependent reports,106 pending. The Haskell parser slice
is partial groundwork for #1150, not completion of its source-admission request.
No new closing references or issue acceptance are claimed. Three Sol6.1/xhigh
agents continue independent source work; unreleased error-projection/compiler/Lua
edits are excluded. Locked setup, generated freshness, affected fail-before/after,
format/front gate and final Windows/runtime/performance acceptance remain deferred.

### Original failure observations, directory reuse and texture continuation

Source interval: after cc4c1556a through 203b55251, nine implementation commits.
All new source and authored assertions remain **UNVALIDATED**. No tests,
syntax/lint/format, bootstrap, compiler/native/database/child/IPC, installer,
browser/GPU/model, physical links or benchmarks ran. Last qualified production/
test source remains d4dcba4134f6103e3a59703d90fdbde5ca54d09e.

- af8e871f1 and7275e6658 capture original reranker diagnostic fields once, skip
  lazy stack inspection, retain exact falsey/frozen primaries and independent
  getter/descriptor failures, and use these observations in the actual outer
  consumer. Pending observer-only or unknown ownership blocks fallback; independent
  cancellation-flag inspection remains represented. Actual inert startup/scoring/
  cleanup/late-work/consumer controls are authored. No model/native/retry acceptance.
- 6ded2e181 moves Lua to the existing bounded Zip/Tar.gz archive owner and owned
  metadata/local-source descriptors. Original stage/temp identities, copy/cleanup
  observers and private actual publication locks remain through nested recovery.
  Local selected archives are never deletion targets. Frozen recovery evidence is
  retained without mutation; promoted generations remain protected. POSIX command
  mode is explicitly set/rechecked. AdmZip's actual VSIX/release/fixture consumers
  and transitive tar remain required; no dependency removal or #672 closure claim.
- ebdce2908 checks original independent write/stat/close work before actual generic
  lock descriptor close. Only the privately identified exact producer failure is
  excluded from its own close prerequisite; a public-capability lookalike remains
  independent. Actual FD counters/original observer replacement controls authored.
  Process-local/physical alias/cross-process/atomic unlink limits remain unchanged.
- b822d2462 applies existing complete output bounds to all eight source-linked
  report producers, including UTF-8 bytes, the final identity and expanded retained
  metadata. Canonical owned copies reject getters and oversized outputs, preserving
  error/time/cancellation contracts. Local adapter identities advance1→2; schema/
  hash domain/writer remain. Actual Proto/GraphQL expansion and boundary controls
  are authored; streaming/resume, tool/source/public integration remain open.
- ff017a664 resolves wrapped simple writes and delete operands as references.
  Receiver/key values and compound/update prior reads remain; selected deleted
  values do not flow into the Boolean result. Optional nullish routes skip keys
  and deletion failure. cfgFlow22/valueSlice8 retire changed retained meaning;
  callFlow24 remains. Actual CFG/retained-row controls are authored; heap/proxy/
  strictness/destructuring and full language/runtime qualification remain open.
- accf534a5 addresses #1238 through bounded private raw directory inventories,
  deliberately forwarded by actual mode/preprocess/ordering owners. Fresh original
  canonical/metadata checks admit reuse; uncovered/differently filtered directories
  retain the import scan. Changed final subtrees lose both positive and negative
  authority. Old selected records cannot resurrect a deleted file in private-array
  scans. Caps, ignored/link unknowns and standalone caller seed contracts remain.
  importResolution7 retires changed admission. Small real-filesystem controls and
  synthetic10,000-row/budget controls are authored only: not a10,000-file benchmark
  or measured speedup. Native Dir closure, retained heap, large workloads, actual
  import parity and adversarial filesystem mutation still require qualification.
- 749bc13f8 preserves ordinary Rust quoted const-expression text and finds outer
  where clauses with complete neighboring Unicode code points. Actual parser/
  cache/document cold/distinct/warm controls are authored. lspBindings36/rq10
  retire old meaning; typeNormalization4 remains. Raw strings/macros/comments,
  full Rust grammar and rust-analyzer/expansion integration remain outside scope.
- 203b55251 captures returned normal textures before callbacks, deduplicates sync
  completion and fences late sibling publication. Original work gates disposal;
  failed owners remain strongly reachable through existing inventory. Async accepted
  maps update existing glass materials. Explicit false sync/async disposal remains
  unconfirmed; original scene/cache observers stay distinct and immutable once
  captured. Actual inert loader/material/shutdown controls are authored. Browser/
  Three/GPU/native quiescence/retry/memory acceptance remains open, as does the
  separate map diagnostic getter/descriptor inspection repair.

Compact dispositions now map141 historical references,554 later source mappings,
161 partial/qualification-dependent reports and101 pending. Five newly partial
reports (#1164/#1173/#1177/#1188/#1238) describe explicit groundwork and limits,
not completed integrations. No new closing references or issue acceptance are
claimed. Three Sol6.1/xhigh agents continue independent real-file spans. Unreleased
storage/compiler/editor work is excluded. Locked setup, generated freshness,
affected fail-before/after, formatting/front gate and final Windows cohorts remain
deferred; hosted policy is not current-suite qualification.

### Prepared Python, original close prerequisites and retained join continuation

Source interval: after04c70e961 through fda82b27d, nine implementation commits.
All new source and authored regressions remain **UNVALIDATED**. No tests,
syntax/lint/format, bootstrap, Python/compiler/native/database/child/IPC, installers,
editor/browser/GPU/model, physical links or benchmarks ran. Last qualified source
remains d4dcba4134f6103e3a59703d90fdbde5ca54d09e.

- c834d3788 requires original independent work observations before actual Dir or
  transfer FileHandle close, including absent/false markers. Each transfer close
  failure is observed before the next native close; ordinary independent unmarked
  failures still allow both attempts. Explicit false remains unconfirmed. Exact
  privately produced self-errors have immutable owned predicates; lookalikes do
  not authorize close. Actual disposable/managed integration counters are authored.
  Unknown work, failed method capture and getter inspection remain protected;
  namespace/cross-process/hostile filesystem/native acceptance is still separate.
- bf5a375b7 retains local inferred literal/container ownership and exact own alias
  spelling. Generic arguments no longer become parameter/return/field types;
  supported outer optional/union alternatives retain their actual enclosure.
  Malformed/unsupported/over-budget syntax is preserved without fragments.
  typeNormalization5 retires changed persisted local metadata while shared
  canonical rules stay unchanged. Actual local/cross-file controls are authored;
  exhaustive grammar, scopes, narrowing and runtime qualification remain open.
- 893a0ce67 and fda82b27d reject VSCode/Sublime filter cursor cycles, all-overlap
  identified pages claiming more, and loaded membership beyond captured totals.
  Refusal preserves prior view/selection/cursor. Actual array/list receipts carry
  bounded private cursor digests through normalization. Sublime uses the existing
  original operation/window/epoch/context/session/generation/membership owner to
  retain progress through project JSON; failed save cannot replace prior evidence.
  Completion discards it and restart does not recreate old history. Direct and
  registered CLI/API/serialized-project controls are authored; current source,
  opaque producer authority, native hosts/services/performance remain unqualified.
- 3e25e851b addresses #1471 with actual invocation-owned Python preparation shared
  through context spread. Dispatch preserves AST/native/heuristic priority and
  observed null/empty outcomes without repeating the projection. Source changes
  refuse original AST/native ranges; independently supplied new AST still works.
  New options preparation has a new receipt; current chunk limits run afterward,
  and embedded slices strip full-file receipts. Existing metadata matching keeps
  the same prepared array. sourceChunking11 retires changed stale-context admission.
  Actual converter/count/adapter/metadata/limits/slice controls, separate actual
  interpreter preparation and existing unavailable-runtime controls are authored.
  No runtime execution or measured speedup is claimed; arbitrary legacy native
  arrays and in-place AST mutation are not newly qualified. #1363/#1366 were read
  only: bounded multi-family artifact fan-out and single sparse layout remain pending.
- 8f7fd1cfc shares the existing property-path owner's transparent-expression policy
  across assignment/dispatch/class/field and call/apply/bind consumers. Wrapped
  replacement targets, prototype patches and actual adapted arguments remain
  bounded may candidates; CFG/accessor/value role distinctions remain intact.
  compilerBindings20/cfgFlow23 retire changed binding/field candidates. Actual
  checker/retained/production-fixture controls are authored, not runtime proof.
- 4292ace2e traces retained LSP invocation ownership only through the value slot of
  erased wrappers, preserving type/receiver/argument/storage/comma exclusions and
  traversal bound. Original callTarget/callSite identity reaches the actual provider
  merge/summary join. lspBindings37 retires changed meaning; rq10 stays. Controlled
  retained provider controls are authored; actual server/language qualification open.
- 364b9ac4b snapshots original map diagnostic/owner fields once and skips stack
  before per-field descriptors. Actual resource/construction/fallback consumers
  retain exact falsey/frozen causes and independent inspection/scene/cache owners.
  Unknown original getters and ownership-chain overflow remain pending. Authored
  actual inert/proxy/lazy-stack controls do not establish generic native-retry
  prerequisites, hidden allocation, image/GPU quiescence, resource or host proof.
- 5e6de9946 qualifies provider summary joins by original call origin/source,
  partition context, real evidence kind/source/context and external endpoint
  context. Foreign external alias bridges cannot supply a source summary; canonical
  syntax declarations remain qualified compiler/provider boundaries. Existing
  directional limits and unknown remainder stay; coverage records rejected claims
  alongside valid supplementation. callFlow25 retires changed admission. Actual
  retained write/atomic merge/join negatives are authored and unrun.

Current dispositions:141 historical references,555 additional source mappings,
161 partial reports and100 pending. #1471 now has an unvalidated source
implementation; no issue closure or runtime/performance acceptance is claimed.
Three Sol6.1/xhigh agents continue independent real-file work. Unreleased storage
diagnostics, iteration CFG and map close-prerequisite edits are excluded. Locked
setup, generated freshness, affected fail-before/after, format/front gate and final
Windows qualification remain deferred.
