# GitHub repair receipt — 2026-10-21

Starting source: `8685a0decb70fde42f32896f52825009c5970dda`. Branch:
`codex/pr557-audit-repairs-20261012`; integration PR [#572](https://github.com/doublemover/PairOfCleats/pull/572).

## Inventory and acceptance

The live open-issue inventory contains 784 issues, #584–#1367, including 700
new reports after #667. Title/body priority census: P0 0, P1 50, P2 338, P3 95,
P4 0, Perf 91, and unprioritized 210. There are no labels in this inventory.
Priority-marked performance reports remain in their priority cohort. Unprioritized
feature work is not silently elevated above reported correctness defects.

The [active roadmap](../roadmap.md) owns execution order. The
[previous issue receipt](github-issue-repairs-2026-10-20.md) retains the 77 earlier
implementation claims and their individual acceptance limits. Neither an issue
report nor a historical green run establishes acceptance for new source.

Windows-only execution and Node 26.12.1 remain in force. Do not launch WSL or
change machine security settings. No merge is authorized. Commits are published
in coherent batches after affected checks and the required front gate.

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

Detailed implementation/proof obligations are recorded in the historical
author-workspace handoffs under ignored
`.tmp/tasks/github-issue-repairs-20261021/`. These are bookkeeping receipts, not
clean-checkout artifacts or executable code drafts. Root integration, new fixture
lane membership, generated governance, affected checks and final qualification
remain outstanding. No issue is accepted solely because code was committed.

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
| [#595](https://github.com/doublemover/PairOfCleats/issues/595) | other | Preserve Python signatures with comparison and shift defaults when finding the parameter-list end | implemented previously; acceptance pending |
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
| [#627](https://github.com/doublemover/PairOfCleats/issues/627) | other | Parse Rust lifetimes and tuple returns without corrupting signature metadata | implemented previously; acceptance pending |
| [#628](https://github.com/doublemover/PairOfCleats/issues/628) | other | Preserve grouped Go parameters and channel directions in LSP signatures | implemented previously; acceptance pending |
| [#629](https://github.com/doublemover/PairOfCleats/issues/629) | other | Do not publish retained old ANN artifacts as ready under a new embedding identity | implemented previously; acceptance pending |
| [#630](https://github.com/doublemover/PairOfCleats/issues/630) | other | Complete the declared Linux/macOS deep and native release-target qualification | pending |
| [#631](https://github.com/doublemover/PairOfCleats/issues/631) | other | Resolve remaining real optional-tool installation and post-install verification blockers | pending |
| [#632](https://github.com/doublemover/PairOfCleats/issues/632) | other | Establish representative retrieval, edit-to-search and retained-memory evidence | pending |
| [#633](https://github.com/doublemover/PairOfCleats/issues/633) | other | TUI missing functionality: select repositories and safely edit validated configuration | implemented previously; acceptance pending |
| [#634](https://github.com/doublemover/PairOfCleats/issues/634) | other | TUI missing functionality: run real searches and navigate ranked results/source | implemented previously; acceptance pending |
| [#635](https://github.com/doublemover/PairOfCleats/issues/635) | other | TUI missing functionality: configure and operate index and embedding workflows | implemented previously; acceptance pending |
| [#636](https://github.com/doublemover/PairOfCleats/issues/636) | other | TUI missing functionality: expose doctor and supported tooling/provider setup | pending |
| [#637](https://github.com/doublemover/PairOfCleats/issues/637) | other | TUI missing functionality: control owned services and preview maintenance actions | pending |
| [#638](https://github.com/doublemover/PairOfCleats/issues/638) | other | TUI missing functionality: select jobs and inspect their results/artifacts | implemented previously; acceptance pending |
| [#639](https://github.com/doublemover/PairOfCleats/issues/639) | other | TUI missing functionality: open recorded sessions and explicitly distinguish passive/live attachment | pending |
| [#640](https://github.com/doublemover/PairOfCleats/issues/640) | other | TUI missing functionality: expose registered analysis/report workflows with command-surface parity | pending |
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
| [#658](https://github.com/doublemover/PairOfCleats/issues/658) | other | Translate Python AST UTF-8 columns before building JavaScript source ranges | implemented previously; acceptance pending |
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
| [#669](https://github.com/doublemover/PairOfCleats/issues/669) | P2 | [P2] Share effective filter facts so indexed prefilters cannot discard exact matches | pending |
| [#670](https://github.com/doublemover/PairOfCleats/issues/670) | other | Share search request value schemas so MCP advertises supported filters and backends | pending |
| [#671](https://github.com/doublemover/PairOfCleats/issues/671) | P1 | [P1] Retain batch ownership until sibling queue workers settle after a failure | implemented; focused proof and front gate pass |
| [#672](https://github.com/doublemover/PairOfCleats/issues/672) | other | Remove the superseded native tree-sitter-lua dependency after the scoped-grammar cutover | pending |
| [#673](https://github.com/doublemover/PairOfCleats/issues/673) | P1 | [P1] Read canonical search options in the release doc-contract gate | implemented in batch 3; focused proof and front gate pass |
| [#674](https://github.com/doublemover/PairOfCleats/issues/674) | other | Reconcile active HTTP contracts with shipped envelopes, streaming errors and auth policy | pending |
| [#675](https://github.com/doublemover/PairOfCleats/issues/675) | other | Make ANN and sparse provider types describe cancellation and FTS eligibility contracts | pending |
| [#676](https://github.com/doublemover/PairOfCleats/issues/676) | P2 | [P2] Let core build orchestration own SQLite instead of rebuilding all modes in MCP | pending |
| [#677](https://github.com/doublemover/PairOfCleats/issues/677) | other | Document and type subprocess termination evidence and retained cleanup ownership | pending |
| [#678](https://github.com/doublemover/PairOfCleats/issues/678) | P2 | [P2] Preserve Unicode scalar boundaries in TUI protocol chunks | pending |
| [#679](https://github.com/doublemover/PairOfCleats/issues/679) | P2 | [P2] Share an early HTTP request lifetime across semantic and runtime routes | pending |
| [#680](https://github.com/doublemover/PairOfCleats/issues/680) | P2 | [P2] Allocate complete piece-assembly UID remaps before rewriting forward relations | development implemented; validation deferred |
| [#681](https://github.com/doublemover/PairOfCleats/issues/681) | other | Remove four unconsumed dependency roots and orphan SWC/ripgrep install permissions | pending |
| [#682](https://github.com/doublemover/PairOfCleats/issues/682) | P2 | [P2] Share lexical signature/body boundaries so fallback chunks survive nested punctuation | pending |
| [#683](https://github.com/doublemover/PairOfCleats/issues/683) | other | Reject missing benchmark evidence in the rollout gate instead of reporting healthy zero deltas | pending |
| [#684](https://github.com/doublemover/PairOfCleats/issues/684) | P2 | [P2] Preserve symbol identity when context seed envelopes also carry a path | pending |
| [#685](https://github.com/doublemover/PairOfCleats/issues/685) | P2 | [P2] Calibrate ANN scores by metric before dense/hybrid blending | pending |
| [#686](https://github.com/doublemover/PairOfCleats/issues/686) | P1 | [P1] Honor pinned retention in create-time and explicit pointer snapshot pruning | fixed; focused Windows checks and front gate pass |
| [#687](https://github.com/doublemover/PairOfCleats/issues/687) | P2 | [P2] Preserve filter-search continuation in the workspace viewer projection | pending |
| [#688](https://github.com/doublemover/PairOfCleats/issues/688) | P2 | [P2] Keep snapshot GC dry runs from deleting stale staging directories | fixed; focused Windows checks and front gate pass |
| [#689](https://github.com/doublemover/PairOfCleats/issues/689) | P2 | [P2] Preserve omitted thresholds and missing measurements in benchmark guardrails | pending |
| [#690](https://github.com/doublemover/PairOfCleats/issues/690) | P1 | [P1] Protect the published watch generation from failed-attempt retention cleanup | development implemented; validation deferred |
| [#691](https://github.com/doublemover/PairOfCleats/issues/691) | P2 | [P2] Reject simulated and wrong-scope release reports at the readiness gate | pending |
| [#692](https://github.com/doublemover/PairOfCleats/issues/692) | P2 | [P2] Prevent overlapping eval judgments from counting one retrieval hit multiple times | pending |
| [#693](https://github.com/doublemover/PairOfCleats/issues/693) | P2 | [P2] Encode VS Code modified-since filters as integers for HTTP searches | pending |
| [#694](https://github.com/doublemover/PairOfCleats/issues/694) | P2 | [P2] Generate USR report schemas from runtime contracts and verify semantic parity | pending |
| [#695](https://github.com/doublemover/PairOfCleats/issues/695) | P2 | [P2] Fence ranked federated results to the manifest generation used for cohort admission | pending |
| [#696](https://github.com/doublemover/PairOfCleats/issues/696) | P2 | [P2] Preserve missing embedding channels instead of normalizing quantized zero sentinels into ANN matches | pending |
| [#697](https://github.com/doublemover/PairOfCleats/issues/697) | P2 | [P2] Reschedule retained watch changes after index-lock backoff expires | development implemented; validation deferred |
| [#698](https://github.com/doublemover/PairOfCleats/issues/698) | P2 | [P2] Keep index help requests from dispatching the default index build | pending |
| [#699](https://github.com/doublemover/PairOfCleats/issues/699) | P2 | [P2] Resolve workspace indexes from each mode's retained build root | pending |
| [#700](https://github.com/doublemover/PairOfCleats/issues/700) | P2 | [P2] Respect end-of-options in search help and argument preflight scanners | pending |
| [#701](https://github.com/doublemover/PairOfCleats/issues/701) | P2 | [P2] Forward the configured MCP input buffer limit into the SDK stdio transport | pending |
| [#702](https://github.com/doublemover/PairOfCleats/issues/702) | P2 | [P2] Preserve the selected search hit when continuation inserts earlier-mode results | pending |
| [#703](https://github.com/doublemover/PairOfCleats/issues/703) | P3 | [P3] Fill hydrated context-index ID lookups without rebuilding discarded name and file maps | pending |
| [#704](https://github.com/doublemover/PairOfCleats/issues/704) | P2 | [P2] Bind exported story source to the exact successful compile input | pending |
| [#705](https://github.com/doublemover/PairOfCleats/issues/705) | P2 | [P2] Dispose instanced mesh resources when rebuilding the map scene | pending |
| [#706](https://github.com/doublemover/PairOfCleats/issues/706) | P3 | [P3] Avoid retaining duplicate string adjacency when graph assembly already has admitted CSR | pending |
| [#707](https://github.com/doublemover/PairOfCleats/issues/707) | P2 | [P2] Share width-aware viewports for TUI settings and workflow review screens | pending |
| [#708](https://github.com/doublemover/PairOfCleats/issues/708) | P2 | [P2] Resolve VS Code diagnostics through the configured CLI, not scripts inside the target repository | pending |
| [#709](https://github.com/doublemover/PairOfCleats/issues/709) | P2 | [P2] Encode the root completion key before emitting Bash associative-array assignments | pending |
| [#710](https://github.com/doublemover/PairOfCleats/issues/710) | P2 | [P2] Preserve empty numeric environment overrides instead of disabling MCP resource bounds | pending |
| [#711](https://github.com/doublemover/PairOfCleats/issues/711) | P3 | [P3] Reuse generation-scoped graph node indexes across graph-reranking queries | pending |
| [#712](https://github.com/doublemover/PairOfCleats/issues/712) | P2 | [P2] Preserve ambiguity instead of positionally pairing duplicate logical chunk keys in index diffs | pending |
| [#713](https://github.com/doublemover/PairOfCleats/issues/713) | P2 | [P2] Compare model hits by stable corpus identity instead of generation-local document ordinals | pending |
| [#714](https://github.com/doublemover/PairOfCleats/issues/714) | P3 | [P3] Keep invalid settings drafts editable after canonical validation rejects them | pending |
| [#715](https://github.com/doublemover/PairOfCleats/issues/715) | P2 | [P2] Separate guided setup dependency installation from the indexed repository | pending |
| [#716](https://github.com/doublemover/PairOfCleats/issues/716) | P3 | [P3] Distinguish file identity from member identity in map selection edge summaries | pending |
| [#717](https://github.com/doublemover/PairOfCleats/issues/717) | P3 | [P3] Keep workspace relationship filters usable beyond the first projection page | pending |
| [#718](https://github.com/doublemover/PairOfCleats/issues/718) | P1 | [P1] Preserve UTF-8 across streamed JSONL artifact chunk boundaries | implemented in batch 3; focused proof and front gate pass |
| [#719](https://github.com/doublemover/PairOfCleats/issues/719) | P3 | [P3] Reconcile the retained selection inspector when rebuilding a workspace page | pending |
| [#720](https://github.com/doublemover/PairOfCleats/issues/720) | P3 | [P3] Avoid rebuilding the full extracted-comment join map for every search request | pending |
| [#721](https://github.com/doublemover/PairOfCleats/issues/721) | P2 | [P2] Share the qualified embedding model profile with prefetch and setup readiness | pending |
| [#722](https://github.com/doublemover/PairOfCleats/issues/722) | P2 | [P2] Classify TUI job and task states from structured status, not display text | pending |
| [#723](https://github.com/doublemover/PairOfCleats/issues/723) | P2 | [P2] Reconcile VS Code require-mode admission across operator and search workflows | pending |
| [#724](https://github.com/doublemover/PairOfCleats/issues/724) | P2 | [P2] Reconcile unfinished TUI tasks when their owning job terminates | pending |
| [#725](https://github.com/doublemover/PairOfCleats/issues/725) | P2 | [P2] Verify same-size source edits with preserved fine-grained mtimes before incremental reuse | development implemented; validation deferred |
| [#726](https://github.com/doublemover/PairOfCleats/issues/726) | other | [Enhancement] Reuse SCM change sets for impact and test-suggestion workflows | pending |
| [#727](https://github.com/doublemover/PairOfCleats/issues/727) | P3 | [P3] Merge federated top-N from ranked heads instead of cloning and sorting every candidate | pending |
| [#728](https://github.com/doublemover/PairOfCleats/issues/728) | P3 | [P3] Materialize only admitted workspace search rows and reuse accepted projection work | pending |
| [#729](https://github.com/doublemover/PairOfCleats/issues/729) | P3 | [P3] Keep unchanged stack pipe geometry across selection and visibility updates | pending |
| [#730](https://github.com/doublemover/PairOfCleats/issues/730) | P3 | [P3] Avoid repeatedly serializing unchanged oversized context packs during response budgeting | pending |
| [#731](https://github.com/doublemover/PairOfCleats/issues/731) | P2 | [P2] Let explicit test-discovery patterns admit non-JavaScript test files | pending |
| [#732](https://github.com/doublemover/PairOfCleats/issues/732) | P2 | [P2] Close compressed JSONL source streams when artifact iteration stops early | development implemented; validation deferred |
| [#733](https://github.com/doublemover/PairOfCleats/issues/733) | other | [Enhancement] Replace TUI full-model JSON frame signatures with revision-based invalidation | pending |
| [#734](https://github.com/doublemover/PairOfCleats/issues/734) | other | [Enhancement] Batch stack bases and member shapes across bounded spatial cells | pending |
| [#735](https://github.com/doublemover/PairOfCleats/issues/735) | other | [Enhancement] Find and navigate entities across the loaded workspace response | pending |
| [#736](https://github.com/doublemover/PairOfCleats/issues/736) | other | [Enhancement] Format only visible TUI job and task rows and reuse filtered identities | pending |
| [#737](https://github.com/doublemover/PairOfCleats/issues/737) | other | [Enhancement] Cache immutable TUI preview text and materialize only visible detail lines | pending |
| [#738](https://github.com/doublemover/PairOfCleats/issues/738) | other | [Enhancement] Preserve structured search diagnostics in editor and TUI results | pending |
| [#739](https://github.com/doublemover/PairOfCleats/issues/739) | other | [Enhancement] Bound TUI log-wrap materialization and reuse width-keyed layouts | pending |
| [#740](https://github.com/doublemover/PairOfCleats/issues/740) | P2 | [P2] Derive native Tree-sitter signature previews past nested parameter punctuation | pending |
| [#741](https://github.com/doublemover/PairOfCleats/issues/741) | P3 | [P3] Build AST token membership sets lazily instead of allocating them for phrase-only eligibility | pending |
| [#742](https://github.com/doublemover/PairOfCleats/issues/742) | P3 | [P3] Coalesce stack-view hover picking to the latest pointer per frame | pending |
| [#743](https://github.com/doublemover/PairOfCleats/issues/743) | other | [Enhancement] Give the TUI event drain an explicit fairness budget before input and rendering | pending |
| [#744](https://github.com/doublemover/PairOfCleats/issues/744) | P3 | [P3] Reconcile the documented core status overload and type its includeAll contract | pending |
| [#745](https://github.com/doublemover/PairOfCleats/issues/745) | P3 | [P3] Bound retained stability-history payloads before selecting the newest runs | pending |
| [#746](https://github.com/doublemover/PairOfCleats/issues/746) | P2 | [P2] Make VS Code Explain Search display the returned ranking explanation | pending |
| [#747](https://github.com/doublemover/PairOfCleats/issues/747) | P3 | [P3] Defer test-report schema compilation for metadata-only runner commands | pending |
| [#748](https://github.com/doublemover/PairOfCleats/issues/748) | P3 | [P3] Use count-aware graph neighbor iteration to avoid materializing capped fanout tails | pending |
| [#749](https://github.com/doublemover/PairOfCleats/issues/749) | P2 | [P2] Keep retrieval parity overlap bounded when hit keys repeat | pending |
| [#750](https://github.com/doublemover/PairOfCleats/issues/750) | P2 | [P2] Keep a successful empty SCM file list authoritative during discovery | pending |
| [#751](https://github.com/doublemover/PairOfCleats/issues/751) | P2 | [P2] Do not re-stamp stale SCM metadata as current after an unvalidated refresh | pending |
| [#752](https://github.com/doublemover/PairOfCleats/issues/752) | P2 | [P2] Preserve unknown benchmark measurements through run-diff averages and deltas | pending |
| [#753](https://github.com/doublemover/PairOfCleats/issues/753) | P2 | [P2] Invalidate SCM history metadata for files changed then reverted between heads | pending |
| [#754](https://github.com/doublemover/PairOfCleats/issues/754) | P2 | [P2] Include churn requirements in Git metadata prefetch cache identity | development implemented; validation deferred |
| [#755](https://github.com/doublemover/PairOfCleats/issues/755) | P3 | [P3] Reuse prepared relation-boost evidence across candidates sharing file relations | pending |
| [#756](https://github.com/doublemover/PairOfCleats/issues/756) | P3 | [P3] Retain predecessor links and defer suggest-tests witness paths until output selection | pending |
| [#757](https://github.com/doublemover/PairOfCleats/issues/757) | P2 | [P2] Keep unmeasured AST counts from satisfying deep-analysis and observation checks | pending |
| [#758](https://github.com/doublemover/PairOfCleats/issues/758) | P2 | [P2] Queue concurrent EG2 queries instead of skipping ANN and evicting the warm adapter | pending |
| [#759](https://github.com/doublemover/PairOfCleats/issues/759) | P2 | [P2] Bind delayed Sublime completions to the original buffer version and replacement range | pending |
| [#760](https://github.com/doublemover/PairOfCleats/issues/760) | P2 | [P2] Preserve source case for case-sensitive phrase eligibility | pending |
| [#761](https://github.com/doublemover/PairOfCleats/issues/761) | P2 | [P2] Cancel Sublime search option prompts without executing a search | pending |
| [#762](https://github.com/doublemover/PairOfCleats/issues/762) | P2 | [P2] Preserve Sublime search scope in history, repeat and hit-context reruns | pending |
| [#763](https://github.com/doublemover/PairOfCleats/issues/763) | P2 | [P2] Separate literal phrase tokens from normalized sparse scoring tokens | pending |
| [#764](https://github.com/doublemover/PairOfCleats/issues/764) | P2 | [P2] Preserve compare-profile semantics in throughput JSON and CSV exports | pending |
| [#765](https://github.com/doublemover/PairOfCleats/issues/765) | P2 | [P2] Recheck missing files after joining a Git metadata prefetch flight | pending |
| [#766](https://github.com/doublemover/PairOfCleats/issues/766) | P3 | [P3] Replace full-window scans in uncapped graph edge merging | pending |
| [#767](https://github.com/doublemover/PairOfCleats/issues/767) | P2 | [P2] Use immutable JJ commit identities for SCM metadata freshness | pending |
| [#768](https://github.com/doublemover/PairOfCleats/issues/768) | perf | [Perf] Evaluate exact-length embedding batches to reduce within-bucket padding | pending |
| [#769](https://github.com/doublemover/PairOfCleats/issues/769) | P2 | [P2] Preserve filename whitespace in SCM metadata snapshot keys | development implemented; validation deferred |
| [#770](https://github.com/doublemover/PairOfCleats/issues/770) | P2 | [P2] Apply throughput run filters before computing summaries and exported totals | pending |
| [#771](https://github.com/doublemover/PairOfCleats/issues/771) | P2 | [P2] Prevent superseded editor searches from taking over newer results | pending |
| [#772](https://github.com/doublemover/PairOfCleats/issues/772) | P3 | [P3] Map normalized search tokens back to original excerpt text for highlighting | pending |
| [#773](https://github.com/doublemover/PairOfCleats/issues/773) | P3 | [P3] Honor VS Code provider cancellation before spawning and while navigation runs | pending |
| [#774](https://github.com/doublemover/PairOfCleats/issues/774) | other | [Enhancement] Reuse per-leaf tokenization when building a cold query plan | pending |
| [#775](https://github.com/doublemover/PairOfCleats/issues/775) | other | [Enhancement] Reopen cached VS Code history results without rerunning search | pending |
| [#776](https://github.com/doublemover/PairOfCleats/issues/776) | P2 | [P2] Rank throughput regressions with one format-independent total ordering | pending |
| [#777](https://github.com/doublemover/PairOfCleats/issues/777) | P2 | [P2] Do not silently truncate deep graph witness paths at the internal 5,000-node guard | pending |
| [#778](https://github.com/doublemover/PairOfCleats/issues/778) | P2 | [P2] Reject nested directory links that escape snapshot freeze sources | fixed; ordinary filesystem and injected metadata controls pass |
| [#779](https://github.com/doublemover/PairOfCleats/issues/779) | perf | [Perf] Reuse unpadded ONNX token rows between count estimation and inference | pending |
| [#780](https://github.com/doublemover/PairOfCleats/issues/780) | P2 | [P2] Bind service progress monitoring to the claimed job's build identity | pending |
| [#781](https://github.com/doublemover/PairOfCleats/issues/781) | P2 | [P2] Emit schema-valid SARIF thread flow locations and empty-evidence results | pending |
| [#782](https://github.com/doublemover/PairOfCleats/issues/782) | P1 | [P1] Preserve committed WAL transactions when SQLite replacement rolls back | implemented; focused proof and front gate pass |
| [#783](https://github.com/doublemover/PairOfCleats/issues/783) | P2 | [P2] Percent-encode source filenames when exporting SARIF artifact URIs | pending |
| [#784](https://github.com/doublemover/PairOfCleats/issues/784) | other | [Enhancement] Reconcile priority-only service status with actual queue dispatch | pending |
| [#785](https://github.com/doublemover/PairOfCleats/issues/785) | P2 | [P2] Preserve absent context-expansion limits instead of converting defaults to hard zero caps | pending |
| [#786](https://github.com/doublemover/PairOfCleats/issues/786) | P2 | [P2] Preserve stronger risk states and distinct witnesses at converging call edges | pending |
| [#787](https://github.com/doublemover/PairOfCleats/issues/787) | P2 | [P2] Include the full taint set in risk propagation state identity | pending |
| [#788](https://github.com/doublemover/PairOfCleats/issues/788) | P3 | [P3] Reuse the shipped config schema across loads so validator caching can work | pending |
| [#789](https://github.com/doublemover/PairOfCleats/issues/789) | P2 | [P2] Preserve named core search options when callers add extra CLI arguments | pending |
| [#790](https://github.com/doublemover/PairOfCleats/issues/790) | other | [Enhancement] Bound editor HTTP response bodies before decoding and retaining diagnostics | pending |
| [#791](https://github.com/doublemover/PairOfCleats/issues/791) | P2 | [P2] Retry valid short reads in random-access JSONL offset and row readers | development implemented; validation deferred |
| [#792](https://github.com/doublemover/PairOfCleats/issues/792) | P2 | [P2] Report context-expansion omissions when per-hit and total limits stop candidate loops | pending |
| [#793](https://github.com/doublemover/PairOfCleats/issues/793) | P2 | [P2] Apply zero context-expansion candidate and reason caps before initial admission | pending |
| [#794](https://github.com/doublemover/PairOfCleats/issues/794) | P3 | [P3] Memoize immutable callsite sampling across risk propagation states | pending |
| [#795](https://github.com/doublemover/PairOfCleats/issues/795) | P2 | [P2] Do not mark packed MinHash corrupt after a valid short file read | development implemented; validation deferred |
| [#796](https://github.com/doublemover/PairOfCleats/issues/796) | P2 | [P2] Preserve end columns of multiline VS Code navigation ranges | pending |
| [#797](https://github.com/doublemover/PairOfCleats/issues/797) | P2 | [P2] Retry short VFS manifest reads before caching missing Tree-sitter rows | development implemented; validation deferred |
| [#798](https://github.com/doublemover/PairOfCleats/issues/798) | P3 | [P3] Document and type both MCP overload error envelopes for clients | pending |
| [#799](https://github.com/doublemover/PairOfCleats/issues/799) | perf | [Perf] Skip unused chunk metadata hydration for indexed completions | pending |
| [#800](https://github.com/doublemover/PairOfCleats/issues/800) | P2 | [P2] Preserve logical idempotency identity when retrying quarantined jobs | development implemented; validation deferred |
| [#801](https://github.com/doublemover/PairOfCleats/issues/801) | perf | [Perf] Make deferred queue claim duplicate checks linear instead of quadratic | pending |
| [#802](https://github.com/doublemover/PairOfCleats/issues/802) | P2 | [P2] Apply logger redaction before retaining crash-event metadata | development implemented; validation deferred |
| [#803](https://github.com/doublemover/PairOfCleats/issues/803) | other | Preserve existing routing metadata when importing normalized generic triage records | pending |
| [#804](https://github.com/doublemover/PairOfCleats/issues/804) | other | Do not use a vulnerability or package alone as a unique generic triage finding ID | pending |
| [#805](https://github.com/doublemover/PairOfCleats/issues/805) | other | Normalize AWS Inspector CVSS arrays and scoringVector instead of dropping all scores | pending |
| [#806](https://github.com/doublemover/PairOfCleats/issues/806) | P1 | [P1] Default hardlink freeze does not preserve immutable snapshot bytes | fixed; focused Windows checks and front gate pass |
| [#807](https://github.com/doublemover/PairOfCleats/issues/807) | P2 | [P2] Size automatic runtime policy from effective process resources, not host totals | pending |
| [#808](https://github.com/doublemover/PairOfCleats/issues/808) | P2 | [P2] Honor crash-log ring limits in default text logging mode | development implemented; validation deferred |
| [#809](https://github.com/doublemover/PairOfCleats/issues/809) | P3 | [P3] Capped text helper reports a valid short read as complete file content | pending |
| [#810](https://github.com/doublemover/PairOfCleats/issues/810) | other | Bound triage context-history reads and retain only the requested top candidates | pending |
| [#811](https://github.com/doublemover/PairOfCleats/issues/811) | P2 | [P2] Mark snapshot verification as skipped when --verify false | fixed; focused Windows checks and front gate pass |
| [#812](https://github.com/doublemover/PairOfCleats/issues/812) | P2 | [P2] Preserve nested activity origins when preparing history artifacts | pending |
| [#813](https://github.com/doublemover/PairOfCleats/issues/813) | P2 | [P2] Preserve case-sensitive type identities and literal contents during normalization | development implemented; validation deferred |
| [#814](https://github.com/doublemover/PairOfCleats/issues/814) | other | [Enhancement] Bound worker metric cardinality across worker generations | pending |
| [#815](https://github.com/doublemover/PairOfCleats/issues/815) | P2 | [P2] Keep adaptive scheduler reversal guards active across hold samples | pending |
| [#816](https://github.com/doublemover/PairOfCleats/issues/816) | perf | [Perf] Index archive span intersections instead of rescanning the source plan per fragment | pending |
| [#817](https://github.com/doublemover/PairOfCleats/issues/817) | P2 | [P2] Preserve Python Optional and Union nesting during type canonicalization | development implemented; validation deferred |
| [#818](https://github.com/doublemover/PairOfCleats/issues/818) | other | [Enhancement] Preserve source confidence and define the basis of propagated type scores | pending |
| [#819](https://github.com/doublemover/PairOfCleats/issues/819) | P2 | [P2] Verified snapshot counts checksum-less regular pieces without checking bytes | fixed; focused Windows checks and front gate pass |
| [#820](https://github.com/doublemover/PairOfCleats/issues/820) | P2 | [P2] Stop attributing parent-process pressure samples to individual workers | pending |
| [#821](https://github.com/doublemover/PairOfCleats/issues/821) | other | Keep triage JSON and Markdown artifacts coherent across concurrent updates and failed writes | pending |
| [#822](https://github.com/doublemover/PairOfCleats/issues/822) | P2 | [P2] Short SQLite control-header read can trigger false semantic repair | development implemented; validation deferred |
| [#823](https://github.com/doublemover/PairOfCleats/issues/823) | P2 | [P2] Retry short reads of verified runtime evidence and claim rows | development implemented; validation deferred |
| [#824](https://github.com/doublemover/PairOfCleats/issues/824) | other | [Enhancement] Select capped type candidates by evidence strength before display ordering | pending |
| [#825](https://github.com/doublemover/PairOfCleats/issues/825) | P3 | [P3] Avoid rescanning unchanged blocked scheduler backlogs on every enqueue | pending |
| [#826](https://github.com/doublemover/PairOfCleats/issues/826) | P2 | [P2] Defer CAS deletion when a present lease cannot be read | development implemented; validation deferred |
| [#827](https://github.com/doublemover/PairOfCleats/issues/827) | P3 | [P3] Account for replacement when concurrent filter scans admit the same cache key | pending |
| [#828](https://github.com/doublemover/PairOfCleats/issues/828) | P2 | [P2] Keep POSIX repository-path normalization case-sensitive | development implemented; validation deferred |
| [#829](https://github.com/doublemover/PairOfCleats/issues/829) | P2 | [P2] Include validation strictness in loaded-index cache and in-flight identity | pending |
| [#830](https://github.com/doublemover/PairOfCleats/issues/830) | P3 | [P3] MCP cache_gc reports invalid no-limit requests as successful tool calls | pending |
| [#831](https://github.com/doublemover/PairOfCleats/issues/831) | perf | [Perf] Replace repeated pending-window races with bounded capacity notifications | pending |
| [#832](https://github.com/doublemover/PairOfCleats/issues/832) | P1 | [P1] Reject traversal snapshot IDs before GC and pointer-prune recursive deletion | fixed; focused Windows checks and front gate pass |
| [#833](https://github.com/doublemover/PairOfCleats/issues/833) | P2 | [P2] Preserve replacement query-embedding flights when an evicted promise fails late | implemented in batch 3; focused proof and front gate pass |
| [#834](https://github.com/doublemover/PairOfCleats/issues/834) | perf | [Perf] Prepare each VFS document once before attaching its chunk targets | pending |
| [#835](https://github.com/doublemover/PairOfCleats/issues/835) | P1 | [P1] Diff prune can recursively delete outside diff cache via manifest entry ID | fixed; focused Windows checks and front gate pass |
| [#836](https://github.com/doublemover/PairOfCleats/issues/836) | P2 | [P2] Admit and expose supported API correlation headers for allowlisted browser clients | pending |
| [#837](https://github.com/doublemover/PairOfCleats/issues/837) | P2 | [P2] Preserve explicit sparse field weights when enabled fields have empty vocabularies | pending |
| [#838](https://github.com/doublemover/PairOfCleats/issues/838) | other | [Enhancement] Validate effective retrieval guardrails before issuing settings save previews | pending |
| [#839](https://github.com/doublemover/PairOfCleats/issues/839) | P2 | [P2] Sanitize server filesystem paths embedded in ordinary API error messages | pending |
| [#840](https://github.com/doublemover/PairOfCleats/issues/840) | P2 | [P2] Make rolling chargram hashes independent of substring position | pending |
| [#841](https://github.com/doublemover/PairOfCleats/issues/841) | P2 | [P2] Preserve qualified keyword call evidence consistently across lexicon filter projections | development implemented; validation deferred |
| [#842](https://github.com/doublemover/PairOfCleats/issues/842) | P2 | [P2] Record classifier's .txt content-sniff allowlist is unreachable | development implemented; validation deferred |
| [#843](https://github.com/doublemover/PairOfCleats/issues/843) | P3 | [P3] Intersect selective BM25 eligibility before traversing full common-term postings | pending |
| [#844](https://github.com/doublemover/PairOfCleats/issues/844) | P2 | [P2] Short reads can hide shell shebangs and record signals during build/watch | development implemented; validation deferred |
| [#845](https://github.com/doublemover/PairOfCleats/issues/845) | P2 | [P2] Keep unresolved context-envelope seeds compatible with the primary output contract | pending |
| [#846](https://github.com/doublemover/PairOfCleats/issues/846) | P2 | [P2] Short Markdown read silently drops authorized code correlations | development implemented; validation deferred |
| [#847](https://github.com/doublemover/PairOfCleats/issues/847) | other | [Enhancement] Let TUI settings remove one override without resetting the whole configuration | pending |
| [#848](https://github.com/doublemover/PairOfCleats/issues/848) | P2 | [P2] Apply the same dictionary case policy when indexing and querying | pending |
| [#849](https://github.com/doublemover/PairOfCleats/issues/849) | perf | [Perf] Reuse prepared build-time lexicon drop sets for files sharing language and policy | pending |
| [#850](https://github.com/doublemover/PairOfCleats/issues/850) | P3 | [P3] Validate BM25 parameter domains before silently dropping matching documents | pending |
| [#851](https://github.com/doublemover/PairOfCleats/issues/851) | P2 | [P2] Honor auto-install policy and detected languages before bootstrap ensures Pyright | pending |
| [#852](https://github.com/doublemover/PairOfCleats/issues/852) | P2 | [P2] Reuse selected dictionary readiness in bootstrap instead of forcing English | pending |
| [#853](https://github.com/doublemover/PairOfCleats/issues/853) | P1 | [P1] assemble-pieces --force can delete its own input directory | implemented; focused proof and front gate pass |
| [#854](https://github.com/doublemover/PairOfCleats/issues/854) | perf | [Perf] Avoid discarding tooling detection probes before the installer immediately repeats them | pending |
| [#855](https://github.com/doublemover/PairOfCleats/issues/855) | P2 | [P2] Align query code-dictionary selection and language scope with indexed tokenization | pending |
| [#856](https://github.com/doublemover/PairOfCleats/issues/856) | P2 | [P2] Key automatic repository-stat reuse by effective ignore policy | pending |
| [#857](https://github.com/doublemover/PairOfCleats/issues/857) | P1 | [P1] compact-pieces publishes shards before metadata and manifest transaction | implemented in batch 3; focused proof and front gate pass |
| [#858](https://github.com/doublemover/PairOfCleats/issues/858) | P1 | [P1] compact-pieces deletes its old shard backup when rollback fails | implemented in batch 3; focused proof and front gate pass |
| [#859](https://github.com/doublemover/PairOfCleats/issues/859) | P3 | [P3] Encode graph edge identities without delimiter collisions in valid file paths | pending |
| [#860](https://github.com/doublemover/PairOfCleats/issues/860) | P1 | [P1] Token-postings shard writer loses recovery backup across failed promotion | implemented in batch 3; focused proof and front gate pass |
| [#861](https://github.com/doublemover/PairOfCleats/issues/861) | perf | [Perf] Avoid re-sorting the entire dependency-lane ready queue for every component | pending |
| [#862](https://github.com/doublemover/PairOfCleats/issues/862) | P2 | [P2] Make dependency-lane SCC traversal stack-safe for admitted configured maps | pending |
| [#863](https://github.com/doublemover/PairOfCleats/issues/863) | P2 | [P2] Strict artifact manifest loader follows junction outside index root | development implemented; validation deferred |
| [#864](https://github.com/doublemover/PairOfCleats/issues/864) | other | [Enhancement] Reuse a page-scoped identity lookup for workspace selection | pending |
| [#865](https://github.com/doublemover/PairOfCleats/issues/865) | P3 | [P3] Watch record sniff treats configured zero-byte cap as 16 KiB | pending |
| [#866](https://github.com/doublemover/PairOfCleats/issues/866) | P2 | [P2] Short ZIP header read misclassifies valid inference-history export | pending |
| [#867](https://github.com/doublemover/PairOfCleats/issues/867) | P2 | [P2] Bound automatic repository-scan directory admission and pending stat work | pending |
| [#868](https://github.com/doublemover/PairOfCleats/issues/868) | P2 | [P2] Reject duplicate architecture rule IDs before attributing violations | pending |
| [#869](https://github.com/doublemover/PairOfCleats/issues/869) | P3 | [P3] Short log reads can make get-last-failure select a success log | pending |
| [#870](https://github.com/doublemover/PairOfCleats/issues/870) | P2 | [P2] SQLite dense-binary stream stops at first positive short read | implemented in batch 3; focused proof and front gate pass |
| [#871](https://github.com/doublemover/PairOfCleats/issues/871) | P2 | [P2] Valid per-file varint range fails on positive short read | development implemented; validation deferred |
| [#872](https://github.com/doublemover/PairOfCleats/issues/872) | P1 | [P1] Archive extraction helper deletes pre-existing destination on failure | implemented; focused proof and front gate pass |
| [#873](https://github.com/doublemover/PairOfCleats/issues/873) | P2 | [P2] Lua language-server update deletes working install before replacement succeeds | pending |
| [#874](https://github.com/doublemover/PairOfCleats/issues/874) | P1 | [P1] Preserve build-state batch order when retrying a failed detached patch | implemented; focused proof and front gate pass |
| [#875](https://github.com/doublemover/PairOfCleats/issues/875) | P2 | [P2] Make flushBuildState await already-detached in-flight writes | implemented in batch 3; focused proof and front gate pass |
| [#876](https://github.com/doublemover/PairOfCleats/issues/876) | P2 | [P2] Stop strict workspace scheduling after signal and spawn failures | development implemented; validation deferred |
| [#877](https://github.com/doublemover/PairOfCleats/issues/877) | P2 | [P2] Reject watch mode in finite workspace build fanout or implement workspace watch ownership | development implemented; validation deferred |
| [#878](https://github.com/doublemover/PairOfCleats/issues/878) | P2 | [P2] Normalize workspace boolean flags instead of forwarding accepted forms to child builds | development implemented; validation deferred |
| [#879](https://github.com/doublemover/PairOfCleats/issues/879) | P2 | [P2] Resolve historical roots for implicitly searched extracted-prose modes | pending |
| [#880](https://github.com/doublemover/PairOfCleats/issues/880) | P1 | [P1] Queue job ID traversal writes report outside queue root | development implemented; validation deferred |
| [#881](https://github.com/doublemover/PairOfCleats/issues/881) | P2 | [P2] Preserve config-dump preview semantics in workspace build instead of reporting builds | development implemented; validation deferred |
| [#882](https://github.com/doublemover/PairOfCleats/issues/882) | other | [Enhancement] Account for unstarted repositories in strict workspace build summaries | pending |
| [#883](https://github.com/doublemover/PairOfCleats/issues/883) | P3 | [P3] Reject explicit blank historical selectors instead of querying latest | pending |
| [#884](https://github.com/doublemover/PairOfCleats/issues/884) | P2 | [P2] Preserve disabled chargram token-length caps from configuration through index generation | development implemented; validation deferred |
| [#885](https://github.com/doublemover/PairOfCleats/issues/885) | P2 | [P2] Artifact publication record marks a failed validation wrapper as successful | development implemented; validation deferred |
| [#886](https://github.com/doublemover/PairOfCleats/issues/886) | P2 | [P2] Publication family validator accepts manifest entries with swapped artifact names | development implemented; validation deferred |
| [#887](https://github.com/doublemover/PairOfCleats/issues/887) | P2 | [P2] Mode-blind discovery/preprocessing can drop files allowed by by-mode caps | development implemented; validation deferred |
| [#888](https://github.com/doublemover/PairOfCleats/issues/888) | P2 | [P2] Federated enumeration appends continuation cursor after CLI option terminator | pending |
| [#889](https://github.com/doublemover/PairOfCleats/issues/889) | P1 | [P1] File replacement silently succeeds with missing temp and unrelated recent final | implemented; focused proof and front gate pass |
| [#890](https://github.com/doublemover/PairOfCleats/issues/890) | P2 | [P2] HNSW retained backup is randomized but recovery only reads fixed .bak | implemented in batch 3; focused proof and front gate pass |
| [#891](https://github.com/doublemover/PairOfCleats/issues/891) | P2 | [P2] Valid managed clangd binary is rejected after a positive short header read | pending |
| [#892](https://github.com/doublemover/PairOfCleats/issues/892) | P3 | [P3] Shared readFileRangeSync silently truncates a range after positive short read | pending |
| [#893](https://github.com/doublemover/PairOfCleats/issues/893) | P2 | [P2] Packed token-postings short read triggers unbounded whole-file fallback | development implemented; validation deferred |
| [#894](https://github.com/doublemover/PairOfCleats/issues/894) | P2 | [P2] Archive extractor follows pre-existing destination junction outside extraction root | implemented; focused proof and front gate pass |
| [#895](https://github.com/doublemover/PairOfCleats/issues/895) | P2 | [P2] Bound build-state patch-stage trimming when every cached root is active | implemented in batch 3; focused proof and front gate pass |
| [#896](https://github.com/doublemover/PairOfCleats/issues/896) | P1 | [P1] Oversized build state is treated as empty and overwritten by the next patch | implemented; focused proof and front gate pass |
| [#897](https://github.com/doublemover/PairOfCleats/issues/897) | P2 | [P2] Failed checkpoint-index write can leave published index pointing to deleted sidecar | implemented in batch 3; focused proof and front gate pass |
| [#898](https://github.com/doublemover/PairOfCleats/issues/898) | P3 | [P3] Checkpoint mode sanitization aliases distinct keys to one sidecar file | pending |
| [#899](https://github.com/doublemover/PairOfCleats/issues/899) | P3 | [P3] Top-K reducer ignores an explicit zero final limit | pending |
| [#900](https://github.com/doublemover/PairOfCleats/issues/900) | P3 | [P3] Bitmap union drops valid entries when the first slot is null | pending |
| [#901](https://github.com/doublemover/PairOfCleats/issues/901) | P3 | [P3] Query-plan disk reload reverses LRU age and evicts the newest restored plan | pending |
| [#902](https://github.com/doublemover/PairOfCleats/issues/902) | P2 | [P2] Boundary-marked filename chargrams prune valid substring matches | pending |
| [#903](https://github.com/doublemover/PairOfCleats/issues/903) | P2 | [P2] Regex filename prefilter requires one alternation branch and drops valid matches | pending |
| [#904](https://github.com/doublemover/PairOfCleats/issues/904) | P2 | [P2] Quoted file and author filters split one value into unrelated OR matchers | pending |
| [#905](https://github.com/doublemover/PairOfCleats/issues/905) | P2 | [P2] Git line-author helper ignores requested commit and blames current checkout | development implemented; validation deferred |
| [#906](https://github.com/doublemover/PairOfCleats/issues/906) | P2 | [P2] Unpinned Git blame cache returns stale authors after a same-process commit | development implemented; validation deferred |
| [#907](https://github.com/doublemover/PairOfCleats/issues/907) | P2 | [P2] Incremental SQLite update can retain old ANN rows when vector extension is unavailable | implemented in batch 3; focused proof and front gate pass |
| [#908](https://github.com/doublemover/PairOfCleats/issues/908) | P2 | [P2] SQLite incremental planner accepts a valid bundle for the wrong manifest file | implemented in batch 3; focused proof and front gate pass |
| [#909](https://github.com/doublemover/PairOfCleats/issues/909) | P2 | [P2] Resolve inherited tsconfig baseUrl relative to its defining config | pending |
| [#910](https://github.com/doublemover/PairOfCleats/issues/910) | P2 | [P2] Resolve package tsconfig extends from its config entry, not Node main | pending |
| [#911](https://github.com/doublemover/PairOfCleats/issues/911) | P2 | [P2] Match TypeScript path-mapping specificity instead of shortest resolved filename | pending |
| [#912](https://github.com/doublemover/PairOfCleats/issues/912) | P2 | [P2] Honor array-valued tsconfig extends when resolving import aliases | pending |
| [#913](https://github.com/doublemover/PairOfCleats/issues/913) | P2 | [P2] Null expiresAt invalidates every positive import-resolution spec cache entry | pending |
| [#914](https://github.com/doublemover/PairOfCleats/issues/914) | P2 | [P2] Do not resolve case-mismatched explicit imports on case-sensitive repositories | pending |
| [#915](https://github.com/doublemover/PairOfCleats/issues/915) | P3 | [P3] Result-bundle synthetic missing-file key collides with a valid filename | pending |
| [#916](https://github.com/doublemover/PairOfCleats/issues/916) | P3 | [P3] Body-summary helper serves cached pre-edit source text in one process | pending |
| [#917](https://github.com/doublemover/PairOfCleats/issues/917) | P3 | [P3] Context cleaner drops meaningful lines written without ASCII letters or digits | pending |
| [#918](https://github.com/doublemover/PairOfCleats/issues/918) | P2 | [P2] Reject out-of-root artifact piece paths before manifest and publication | development implemented; validation deferred |
| [#919](https://github.com/doublemover/PairOfCleats/issues/919) | P2 | [P2] Preserve distinct case-sensitive files during Windows incremental bundle writeback | pending |
| [#920](https://github.com/doublemover/PairOfCleats/issues/920) | P2 | [P2] Do not publish a stale filter index after current-generation build failure | development implemented; validation deferred |
| [#921](https://github.com/doublemover/PairOfCleats/issues/921) | P2 | [P2] Include non-source file metadata in incremental file_meta cache identity | development implemented; validation deferred |
| [#922](https://github.com/doublemover/PairOfCleats/issues/922) | P2 | [P2] Resolve inherited TypeScript emit directories relative to the declaring tsconfig | pending |
| [#923](https://github.com/doublemover/PairOfCleats/issues/923) | P2 | [P2] Do not suppress ordinary missing test imports as fixture references | pending |
| [#924](https://github.com/doublemover/PairOfCleats/issues/924) | P2 | [P2] Do not suppress missing TypeScript build-script imports without an emit counterpart | pending |
| [#925](https://github.com/doublemover/PairOfCleats/issues/925) | P3 | [P3] Report missing SQLite database paths instead of claiming better-sqlite3 is absent | pending |
| [#926](https://github.com/doublemover/PairOfCleats/issues/926) | P3 | [P3] Keep composite dedupe keys distinct in the SQLite multi-row inserter | pending |
| [#927](https://github.com/doublemover/PairOfCleats/issues/927) | P2 | [P2] Prevent later SQLite mode builds from replacing a configured shared DB | implemented in batch 3; focused proof and front gate pass |
| [#928](https://github.com/doublemover/PairOfCleats/issues/928) | P2 | [P2] Preserve Node package #imports instead of dropping them during normalization | pending |
| [#929](https://github.com/doublemover/PairOfCleats/issues/929) | P2 | [P2] Do not declare junction-backed import targets absent in the filesystem existence index | pending |
| [#930](https://github.com/doublemover/PairOfCleats/issues/930) | P3 | [P3] Ignore Razor @using directives inside multiline Razor comments | pending |
| [#931](https://github.com/doublemover/PairOfCleats/issues/931) | P3 | [P3] Exclude imports inside Nix block comments | pending |
| [#932](https://github.com/doublemover/PairOfCleats/issues/932) | P3 | [P3] Exclude block-commented imports in Dart, Groovy, and Scala collectors | pending |
| [#933](https://github.com/doublemover/PairOfCleats/issues/933) | P3 | [P3] Do not downgrade future ordering-ledger versions during state merge | pending |
| [#934](https://github.com/doublemover/PairOfCleats/issues/934) | P2 | [P2] Preserve forced final checkpoint flush during an in-flight periodic write | implemented in batch 3; focused proof and front gate pass |
| [#935](https://github.com/doublemover/PairOfCleats/issues/935) | P2 | [P2] Propagate cancellation during embedding job enqueue instead of finalizing as done | development implemented; validation deferred |
| [#936](https://github.com/doublemover/PairOfCleats/issues/936) | P2 | [P2] Preserve all search metrics under concurrent query sessions | pending |
| [#937](https://github.com/doublemover/PairOfCleats/issues/937) | P3 | [P3] Warn when a forced SQLite backend is ignored for records-only search | pending |
| [#938](https://github.com/doublemover/PairOfCleats/issues/938) | P3 | [P3] Retain query-cache entries from concurrent search sessions | pending |
| [#939](https://github.com/doublemover/PairOfCleats/issues/939) | P3 | [P3] Keep distinct score-buffer schemas from colliding in the reuse pool | pending |
| [#940](https://github.com/doublemover/PairOfCleats/issues/940) | P3 | [P3] Preserve JSONL callback order in SQLite small-source fast paths | pending |
| [#941](https://github.com/doublemover/PairOfCleats/issues/941) | P3 | [P3] Normalize sorted token posting rows in the default truncate path | pending |
| [#942](https://github.com/doublemover/PairOfCleats/issues/942) | P3 | [P3] Do not report a sparsity-cache hit when the profile entry is missing | pending |
| [#943](https://github.com/doublemover/PairOfCleats/issues/943) | P3 | [P3] Keep Tree-sitter scheduler artifact paths unique across grammar keys | pending |
| [#944](https://github.com/doublemover/PairOfCleats/issues/944) | P2 | [P2] Reject duplicate virtual paths while merging scheduler result indexes | development implemented; validation deferred |
| [#945](https://github.com/doublemover/PairOfCleats/issues/945) | P1 | [P1] Do not detach source embeddings while quantizing dense-vector channels | implemented; focused proof and front gate pass |
| [#946](https://github.com/doublemover/PairOfCleats/issues/946) | P2 | [P2] Deduplicate shared ArrayBuffers in quantize-worker transfer lists | pending |
| [#947](https://github.com/doublemover/PairOfCleats/issues/947) | P2 | [P2] Preserve distinct repo-map entries whose fields contain :: | development implemented; validation deferred |
| [#948](https://github.com/doublemover/PairOfCleats/issues/948) | P3 | [P3] Keep exported sequence-ledger counters live after transitions | pending |
| [#949](https://github.com/doublemover/PairOfCleats/issues/949) | P3 | [P3] Avoid shard-subset ID collisions for distinct external shard keys | pending |
| [#950](https://github.com/doublemover/PairOfCleats/issues/950) | P2 | [P2] Reject malformed --meta-json instead of silently removing the search constraint | pending |
| [#951](https://github.com/doublemover/PairOfCleats/issues/951) | P2 | [P2] Drain sibling search modes before disposing request-owned backends on failure | pending |
| [#952](https://github.com/doublemover/PairOfCleats/issues/952) | P2 | [P2] Preserve __proto__ symbol lookups in persisted context indexes | pending |
| [#953](https://github.com/doublemover/PairOfCleats/issues/953) | P3 | [P3] Invalidate case-insensitive file-relation lookup after store mutation | pending |
| [#954](https://github.com/doublemover/PairOfCleats/issues/954) | P2 | [P2] Keep context-expansion cache writes out of frozen snapshots | pending |
| [#955](https://github.com/doublemover/PairOfCleats/issues/955) | P2 | [P2] Do not cool down healthy ANN providers when a search is cancelled | pending |
| [#956](https://github.com/doublemover/PairOfCleats/issues/956) | P3 | [P3] Do not satisfy vector-only retrieval with MinHash fallback hits | pending |
| [#957](https://github.com/doublemover/PairOfCleats/issues/957) | P2 | [P2] Reject malformed positional FTS weights instead of shifting field meanings | pending |
| [#958](https://github.com/doublemover/PairOfCleats/issues/958) | P2 | [P2] Return no LanceDB hits for an explicitly empty candidate set | implemented in batch 3; focused proof and front gate pass |
| [#959](https://github.com/doublemover/PairOfCleats/issues/959) | P2 | [P2] Preserve filtered recall beyond Tantivy's fixed global overfetch window | pending |
| [#960](https://github.com/doublemover/PairOfCleats/issues/960) | P2 | [P2] Return no SQLite-vector hits for an explicitly empty candidate set | implemented in batch 3; focused proof and front gate pass |
| [#961](https://github.com/doublemover/PairOfCleats/issues/961) | P1 | [P1] Revalidate vector-extension trust when cached load policy changes | implemented; focused proof and front gate pass |
| [#962](https://github.com/doublemover/PairOfCleats/issues/962) | P1 | [P1] Verify extension integrity in the default non-loading verification path | implemented; focused proof and front gate pass |
| [#963](https://github.com/doublemover/PairOfCleats/issues/963) | P3 | [P3] Use process CPU fallback for Windows pipeline checkpoints | pending |
| [#964](https://github.com/doublemover/PairOfCleats/issues/964) | P2 | [P2] Do not interpret Windows' unsupported load average as idle CPU in adaptive scheduling | pending |
| [#965](https://github.com/doublemover/PairOfCleats/issues/965) | P3 | [P3] Preserve special channel names in runtime telemetry snapshots | pending |
| [#966](https://github.com/doublemover/PairOfCleats/issues/966) | P3 | [P3] Give concurrent startup calibration probes unique temporary files | pending |
| [#967](https://github.com/doublemover/PairOfCleats/issues/967) | P2 | [P2] Bind scheduler autotune recommendations to the current resource envelope | pending |
| [#968](https://github.com/doublemover/PairOfCleats/issues/968) | P2 | [P2] Keep concurrent indexing runtimes' log identity and destination isolated | development implemented; validation deferred |
| [#969](https://github.com/doublemover/PairOfCleats/issues/969) | P2 | [P2] Rescan learned auto-profile features after nested repository changes | pending |
| [#970](https://github.com/doublemover/PairOfCleats/issues/970) | P2 | [P2] Do not classify truncated directory-only repo samples as high-confidence tiny | pending |
| [#971](https://github.com/doublemover/PairOfCleats/issues/971) | P2 | [P2] Enforce bootstrap readiness before the standalone Stage-3 embeddings entry | implemented in batch 3; focused proof and front gate pass |
| [#972](https://github.com/doublemover/PairOfCleats/issues/972) | P3 | [P3] Avoid test-file weight penalties for production names containing “test” | pending |
| [#973](https://github.com/doublemover/PairOfCleats/issues/973) | P3 | [P3] Encode callsite identity fields without colon-boundary collisions | pending |
| [#974](https://github.com/doublemover/PairOfCleats/issues/974) | P3 | [P3] Headline frequency counts mis-rank inherited Object keys such as `constructor` | pending |
| [#975](https://github.com/doublemover/PairOfCleats/issues/975) | P2 | [P2] TOML chunker drops top-level keys before the first table header | development implemented; validation deferred |
| [#976](https://github.com/doublemover/PairOfCleats/issues/976) | P3 | [P3] Segment rebasing mutates the source chunk metadata and compounds on reuse | pending |
| [#977](https://github.com/doublemover/PairOfCleats/issues/977) | P3 | [P3] Registry lock domain can escape the cache lock directory | pending |
| [#978](https://github.com/doublemover/PairOfCleats/issues/978) | P3 | [P3] Relative import candidate generation misses `index.*` inside dotted directory names | pending |
| [#979](https://github.com/doublemover/PairOfCleats/issues/979) | P2 | [P2] Heading-based chunkers omit document content before the first heading | development implemented; validation deferred |
| [#980](https://github.com/doublemover/PairOfCleats/issues/980) | P2 | [P2] Synonym expansion inserts inherited functions into token sequences | development implemented; validation deferred |
| [#981](https://github.com/doublemover/PairOfCleats/issues/981) | P3 | [P3] Exposed mutable SCM runtime config can change without its freshness signature | pending |
| [#982](https://github.com/doublemover/PairOfCleats/issues/982) | P1 | [P1] Spill merge resumes checkpointed outputs from a different input run set | implemented; focused proof and front gate pass |
| [#983](https://github.com/doublemover/PairOfCleats/issues/983) | P2 | [P2] GitHub Actions YAML chunking omits workflow-level configuration before the first job | development implemented; validation deferred |
| [#984](https://github.com/doublemover/PairOfCleats/issues/984) | P2 | [P2] SQLite validation treats any zero-state marker file as proof no DB is required | development implemented; validation deferred |
| [#985](https://github.com/doublemover/PairOfCleats/issues/985) | P2 | [P2] Borrowed registry lock accepts any release-shaped object without ownership check | pending |
| [#986](https://github.com/doublemover/PairOfCleats/issues/986) | P2 | [P2] Strict ordering-ledger validation silently substitutes another build stage | development implemented; validation deferred |
| [#987](https://github.com/doublemover/PairOfCleats/issues/987) | P3 | [P3] Diff event totals lose or corrupt counts for inherited-key event kinds | pending |
| [#988](https://github.com/doublemover/PairOfCleats/issues/988) | P3 | [P3] Field-postings builder silently drops a __proto__ field | pending |
| [#989](https://github.com/doublemover/PairOfCleats/issues/989) | P2 | [P2] Chunk externalDocs misclassifies Node and Python standard-library imports as packages | development implemented; validation deferred |
| [#990](https://github.com/doublemover/PairOfCleats/issues/990) | P2 | [P2] Omitted relation-inference limits silently truncate every signal to zero | development implemented; validation deferred |
| [#991](https://github.com/doublemover/PairOfCleats/issues/991) | P2 | [P2] Concurrent VFS manifest appends duplicate spilled rows | development implemented; validation deferred |
| [#992](https://github.com/doublemover/PairOfCleats/issues/992) | P2 | [P2] Custom risk semantics treat null and boolean argument indices as real positions | pending |
| [#993](https://github.com/doublemover/PairOfCleats/issues/993) | P2 | [P2] CDC byte-size limits are enforced as UTF-16 code units | development implemented; validation deferred |
| [#994](https://github.com/doublemover/PairOfCleats/issues/994) | P3 | [P3] Performance profile crashes on inherited-key language IDs | pending |
| [#995](https://github.com/doublemover/PairOfCleats/issues/995) | P2 | [P2] Perf-profile cost estimator triple-counts an observed file's duration | pending |
| [#996](https://github.com/doublemover/PairOfCleats/issues/996) | P2 | [P2] Legacy string file-text cache bypasses freshness checks and can index stale text | development implemented; validation deferred |
| [#997](https://github.com/doublemover/PairOfCleats/issues/997) | P3 | [P3] Piece-assembly TF normalizer skips validation for single-entry lists | pending |
| [#998](https://github.com/doublemover/PairOfCleats/issues/998) | P3 | [P3] Stage checkpoint summary corrupts inherited-key stage names | pending |
| [#999](https://github.com/doublemover/PairOfCleats/issues/999) | P2 | [P2] Stage1 finalizer rejects valid sparse commit cursors | development implemented; validation deferred |
| [#1000](https://github.com/doublemover/PairOfCleats/issues/1000) | P3 | [P3] Overlapping language spans multiply per-file feature duration | pending |
| [#1001](https://github.com/doublemover/PairOfCleats/issues/1001) | P2 | [P2] PDF extraction timeout and page errors leave pdf.js loading work undisposed | pending |
| [#1002](https://github.com/doublemover/PairOfCleats/issues/1002) | P2 | [P2] Tree-sitter wave order drops additional groups in the same bucket and wave | pending |
| [#1003](https://github.com/doublemover/PairOfCleats/issues/1003) | P2 | [P2] Proto and GraphQL chunkers omit source preambles before first definition | development implemented; validation deferred |
| [#1004](https://github.com/doublemover/PairOfCleats/issues/1004) | P3 | [P3] Ingest summary counters corrupt inherited-key kinds and languages | pending |
| [#1005](https://github.com/doublemover/PairOfCleats/issues/1005) | P2 | [P2] SPDX boilerplate tag swallows all following header lines | development implemented; validation deferred |
| [#1006](https://github.com/doublemover/PairOfCleats/issues/1006) | P2 | [P2] Embedding batch validator accepts non-finite vector elements | implemented in batch 3; focused proof and front gate pass |
| [#1007](https://github.com/doublemover/PairOfCleats/issues/1007) | P2 | [P2] Strict chunk-meta validation can hide primary loader failure behind stale JSON fallback | development implemented; validation deferred |
| [#1008](https://github.com/doublemover/PairOfCleats/issues/1008) | P2 | [P2] Stage1 watchdog drops recorded SCM process-queue wait from lifecycle durations | development implemented; validation deferred |
| [#1009](https://github.com/doublemover/PairOfCleats/issues/1009) | P3 | [P3] Lifecycle duration helper treats null timestamp sentinels as epoch zero | development implemented; validation deferred |
| [#1010](https://github.com/doublemover/PairOfCleats/issues/1010) | P3 | [P3] Phrase-postings builder emits undersized grams after an empty token | pending |
| [#1011](https://github.com/doublemover/PairOfCleats/issues/1011) | P2 | [P2] Shared chargram set exceeds per-chunk cap across fields | development implemented; validation deferred |
| [#1012](https://github.com/doublemover/PairOfCleats/issues/1012) | P2 | [P2] Dense-vector builder zeroes float-only chunks in a mixed representation batch | pending |
| [#1013](https://github.com/doublemover/PairOfCleats/issues/1013) | P2 | [P2] Shared line-index cache reuses offsets for different text with equal line count | development implemented; validation deferred |
| [#1014](https://github.com/doublemover/PairOfCleats/issues/1014) | P3 | [P3] Scan-profile count maps silently discard reserved category keys | pending |
| [#1015](https://github.com/doublemover/PairOfCleats/issues/1015) | P3 | [P3] Feature-metrics recorder drops inherited-name language and setting buckets | pending |
| [#1016](https://github.com/doublemover/PairOfCleats/issues/1016) | P3 | [P3] NUMA worker assignment telemetry stays empty when crash logging is disabled | pending |
| [#1017](https://github.com/doublemover/PairOfCleats/issues/1017) | P2 | [P2] DOCX ZIP fallback can inflate past the document size policy without a bound | pending |
| [#1018](https://github.com/doublemover/PairOfCleats/issues/1018) | P2 | [P2] Lexicon filter keeps qualified keyword calls but drops their details and ranges | development implemented; validation deferred |
| [#1019](https://github.com/doublemover/PairOfCleats/issues/1019) | P2 | [P2] Strict JSON chunker rejects valid nested empty objects and arrays | development implemented; validation deferred |
| [#1020](https://github.com/doublemover/PairOfCleats/issues/1020) | P3 | [P3] Embeddings cache index loses reserved entry keys and file paths | pending |
| [#1021](https://github.com/doublemover/PairOfCleats/issues/1021) | P3 | [P3] Tree-sitter batching skips language metadata for a single entry | pending |
| [#1022](https://github.com/doublemover/PairOfCleats/issues/1022) | P2 | [P2] LanceDB rebuild deletes prior index before validating or publishing replacement | implemented in batch 3; focused proof and front gate pass |
| [#1023](https://github.com/doublemover/PairOfCleats/issues/1023) | P2 | [P2] Postings validation accepts fractional document IDs | development implemented; validation deferred |
| [#1024](https://github.com/doublemover/PairOfCleats/issues/1024) | P2 | [P2] SQLite metaV2 parity check falsely flags equivalent reordered JSON objects | development implemented; validation deferred |
| [#1025](https://github.com/doublemover/PairOfCleats/issues/1025) | P2 | [P2] Float16 text-vector cache rounds boundary embedding values to zero | implemented in batch 3; focused proof and front gate pass |
| [#1026](https://github.com/doublemover/PairOfCleats/issues/1026) | P3 | [P3] Risk artifact validator misses positive call-site count when flows reference none | pending |
| [#1027](https://github.com/doublemover/PairOfCleats/issues/1027) | P3 | [P3] Import reason lookup accepts inherited object names as registered reasons | pending |
| [#1028](https://github.com/doublemover/PairOfCleats/issues/1028) | P2 | [P2] Prose dispatch bypasses Markdown heading chunker for .markdown files | development implemented; validation deferred |
| [#1029](https://github.com/doublemover/PairOfCleats/issues/1029) | P3 | [P3] MetaV2 declared types silently omit a __proto__ parameter | pending |
| [#1030](https://github.com/doublemover/PairOfCleats/issues/1030) | P2 | [P2] Large docs search fast scan mistakes nested fields for page metadata | pending |
| [#1031](https://github.com/doublemover/PairOfCleats/issues/1031) | P3 | [P3] Adaptive scheduler accepts invalid persisted bucket counts as one | pending |
| [#1032](https://github.com/doublemover/PairOfCleats/issues/1032) | P2 | [P2] Root-level .markdown files are excluded from both indexing modes | development implemented; validation deferred |
| [#1033](https://github.com/doublemover/PairOfCleats/issues/1033) | P2 | [P2] Worker-pool lifecycle loses cleanup handle when destroy rejects | pending |
| [#1034](https://github.com/doublemover/PairOfCleats/issues/1034) | P2 | [P2] Token-classification budget is spent before confirming Tree-sitter can run | development implemented; validation deferred |
| [#1035](https://github.com/doublemover/PairOfCleats/issues/1035) | P2 | [P2] Process-pool destroy rejection leaves aggregate memory capacity reserved | pending |
| [#1036](https://github.com/doublemover/PairOfCleats/issues/1036) | P2 | [P2] Risk sanitizer after a sink suppresses earlier same-line taint flow | pending |
| [#1037](https://github.com/doublemover/PairOfCleats/issues/1037) | P2 | [P2] Risk assignment parser drops taint when RHS contains comparison text | pending |
| [#1038](https://github.com/doublemover/PairOfCleats/issues/1038) | P2 | [P2] Risk sink flow uses tainted variables outside the matched sink call | pending |
| [#1039](https://github.com/doublemover/PairOfCleats/issues/1039) | P1 | [P1] SQLite dense update treats unreadable vector artifact as empty and deletes existing vectors | implemented; focused proof and front gate pass |
| [#1040](https://github.com/doublemover/PairOfCleats/issues/1040) | P1 | [P1] SQLite dense ANN table rebuild skips unchanged base vectors | implemented; focused proof and front gate pass |
| [#1041](https://github.com/doublemover/PairOfCleats/issues/1041) | P2 | [P2] SQLite dense update drops old ANN table before replacement can be validated | implemented in batch 3; focused proof and front gate pass |
| [#1042](https://github.com/doublemover/PairOfCleats/issues/1042) | P3 | [P3] Stage1 stall top-N selection ignores tie-break order at the cutoff | pending |
| [#1043](https://github.com/doublemover/PairOfCleats/issues/1043) | P3 | [P3] Stage1 stall snapshot defaults null idle duration to zero | pending |
| [#1044](https://github.com/doublemover/PairOfCleats/issues/1044) | P2 | [P2] Identity reconciliation misses chunk-meta rows absent from chunk_uid_map | development implemented; validation deferred |
| [#1045](https://github.com/doublemover/PairOfCleats/issues/1045) | P2 | [P2] Byte-limited chunking splits UTF-16 surrogate pairs into replacement characters | development implemented; validation deferred |
| [#1046](https://github.com/doublemover/PairOfCleats/issues/1046) | P2 | [P2] Partial chunk-role override silently removes the other default size cap | development implemented; validation deferred |
| [#1047](https://github.com/doublemover/PairOfCleats/issues/1047) | P2 | [P2] Postings reservation release is not idempotent and undercounts other work | pending |
| [#1048](https://github.com/doublemover/PairOfCleats/issues/1048) | P2 | [P2] Postings queue grants capacity to an already-aborted caller | pending |
| [#1049](https://github.com/doublemover/PairOfCleats/issues/1049) | P2 | [P2] Dart package import with unknown current package name resolves unrelated local file | pending |
| [#1050](https://github.com/doublemover/PairOfCleats/issues/1050) | P1 | [P1] Piece assembler remaps forward chunk references before UID collisions are known | development implemented; validation deferred |
| [#1051](https://github.com/doublemover/PairOfCleats/issues/1051) | P2 | [P2] Piece assembler keeps only the first input's risk-interprocedural stats | development implemented; validation deferred |
| [#1052](https://github.com/doublemover/PairOfCleats/issues/1052) | P2 | [P2] Chunk relation diff collapses distinct structured targets | development implemented; validation deferred |
| [#1053](https://github.com/doublemover/PairOfCleats/issues/1053) | P2 | [P2] Heuristic and template chunkers omit text before the first heading/block | development implemented; validation deferred |
| [#1054](https://github.com/doublemover/PairOfCleats/issues/1054) | P2 | [P2] Scheduler crash-forensics persistence failures are silently swallowed | development implemented; validation deferred |
| [#1055](https://github.com/doublemover/PairOfCleats/issues/1055) | P2 | [P2] Local type inference propagates from future assignments but misses multi-hop aliases | pending |
| [#1056](https://github.com/doublemover/PairOfCleats/issues/1056) | P2 | [P2] Artifact report can attribute published status to an unrelated latest build | pending |
| [#1057](https://github.com/doublemover/PairOfCleats/issues/1057) | P2 | [P2] Import graph replay limit selects filesystem-order subset before sorting | pending |
| [#1058](https://github.com/doublemover/PairOfCleats/issues/1058) | P2 | [P2] Cross-file cache fingerprint ignores input import relations that it later overwrites | development implemented; validation deferred |
| [#1059](https://github.com/doublemover/PairOfCleats/issues/1059) | P2 | [P2] Non-symbolic tooling cache can reuse stale results after tooling configuration changes | development implemented; validation deferred |
| [#1060](https://github.com/doublemover/PairOfCleats/issues/1060) | P1 | [P1] Incremental embedding mapping can assign an unknown file another file's vector | implemented; focused proof and front gate pass |
| [#1061](https://github.com/doublemover/PairOfCleats/issues/1061) | P2 | [P2] Worker-count environment override bypasses FD concurrency cap | pending |
| [#1062](https://github.com/doublemover/PairOfCleats/issues/1062) | P2 | [P2] Field-based phrase postings apply per-chunk cap separately to each field | development implemented; validation deferred |
| [#1063](https://github.com/doublemover/PairOfCleats/issues/1063) | P2 | [P2] Exported shard-state merge drops token identity and risk artifacts | development implemented; validation deferred |
| [#1064](https://github.com/doublemover/PairOfCleats/issues/1064) | P1 | [P1] SQLite compaction drops minhash hash-identity metadata | implemented; focused proof and front gate pass |
| [#1065](https://github.com/doublemover/PairOfCleats/issues/1065) | P2 | [P2] Git metadata batch parsers trim significant filename whitespace | development implemented; validation deferred |
| [#1066](https://github.com/doublemover/PairOfCleats/issues/1066) | P2 | [P2] Graph-relation edge cap counts duplicate links before deduplication | development implemented; validation deferred |
| [#1067](https://github.com/doublemover/PairOfCleats/issues/1067) | P2 | [P2] Crash-retention bundle advertises 32 MiB budget but never enforces it | development implemented; validation deferred |
| [#1068](https://github.com/doublemover/PairOfCleats/issues/1068) | P2 | [P2] Cross-file global call budget does not bound call summaries | pending |
| [#1069](https://github.com/doublemover/PairOfCleats/issues/1069) | P2 | [P2] Zero blocked-expansion cap emits every blocked edge in partial risk flows | pending |
| [#1070](https://github.com/doublemover/PairOfCleats/issues/1070) | P2 | [P2] Risk traversal discards alternate same-depth paths before maxPathsPerPair | pending |
| [#1071](https://github.com/doublemover/PairOfCleats/issues/1071) | P2 | [P2] Embeddings shard rotation uses stale indexed size despite actual append offset | implemented in batch 3; focused proof and front gate pass |
| [#1072](https://github.com/doublemover/PairOfCleats/issues/1072) | P1 | [P1] Import cache keeps unchecked unresolved edges when stale-edge budget is exhausted | development implemented; validation deferred |
| [#1073](https://github.com/doublemover/PairOfCleats/issues/1073) | P1 | [P1] Build runtime can leak worker pools when final receipt refresh fails | pending |
| [#1074](https://github.com/doublemover/PairOfCleats/issues/1074) | P1 | [P1] Stage1 timeout cleanup kills unowned tracked subprocesses globally | development implemented; validation deferred |
| [#1075](https://github.com/doublemover/PairOfCleats/issues/1075) | P2 | [P2] Stage1 setup errors bypass perf logger and scheduler cleanup | pending |
| [#1076](https://github.com/doublemover/PairOfCleats/issues/1076) | P3 | [P3] Empty Stage1 modality leaves external abort listener attached | pending |
| [#1077](https://github.com/doublemover/PairOfCleats/issues/1077) | P2 | [P2] Import cache file-set invalidation trims significant path whitespace | development implemented; validation deferred |
| [#1078](https://github.com/doublemover/PairOfCleats/issues/1078) | P2 | [P2] Embeddings cache file lookup collapses leading/trailing-space filenames | implemented in batch 3; focused proof and front gate pass |
| [#1079](https://github.com/doublemover/PairOfCleats/issues/1079) | P2 | [P2] One LanceDB variant write failure skips remaining variants | implemented in batch 3; focused proof and front gate pass |
| [#1080](https://github.com/doublemover/PairOfCleats/issues/1080) | P2 | [P2] Include control-flow minimum filters in query-cache identity | pending |
| [#1081](https://github.com/doublemover/PairOfCleats/issues/1081) | P2 | [P2] Artifact cleanup reports success when removals fail | development implemented; validation deferred |
| [#1082](https://github.com/doublemover/PairOfCleats/issues/1082) | P2 | [P2] Symbol and call-site artifact writers rewrite path identity whitespace | development implemented; validation deferred |
| [#1083](https://github.com/doublemover/PairOfCleats/issues/1083) | P2 | [P2] Include query match policy in search cache key | pending |
| [#1084](https://github.com/doublemover/PairOfCleats/issues/1084) | P2 | [P2] LMDB chunk hydration skips file-level metadata when file and ext exist | pending |
| [#1085](https://github.com/doublemover/PairOfCleats/issues/1085) | P2 | [P2] Non-strict artifact validation skips JSON artifacts listed in a manifest | development implemented; validation deferred |
| [#1086](https://github.com/doublemover/PairOfCleats/issues/1086) | P2 | [P2] Bind dense-vector metadata path to the manifested binary payload | pending |
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
| [#1097](https://github.com/doublemover/PairOfCleats/issues/1097) | P2 | [P2] Strict dense loaders hide malformed manifested vector artifacts | pending |
| [#1098](https://github.com/doublemover/PairOfCleats/issues/1098) | P1 | [P1] `index stats --verify` exits successfully on artifact checksum mismatch | implemented in batch 3; focused proof and front gate pass |
| [#1099](https://github.com/doublemover/PairOfCleats/issues/1099) | P2 | [P2] `index stats --verify` rejects valid vector-only indexes | pending |
| [#1100](https://github.com/doublemover/PairOfCleats/issues/1100) | P2 | [P2] Index stats reports only the largest chunk-meta shard as total rows | pending |
| [#1101](https://github.com/doublemover/PairOfCleats/issues/1101) | P3 | [P3] `index stats` totalBytes omits file metadata and several artifact families | pending |
| [#1102](https://github.com/doublemover/PairOfCleats/issues/1102) | P2 | [P2] Canceled worker tokenization is retried on the main thread and can return success | pending |
| [#1103](https://github.com/doublemover/PairOfCleats/issues/1103) | P2 | [P2] `index stats --verify` accepts metadata-only required artifact families | pending |
| [#1104](https://github.com/doublemover/PairOfCleats/issues/1104) | P1 | [P1] Stage-3 marks embeddings ready before final manifest publication and validation | implemented; focused proof and front gate pass |
| [#1105](https://github.com/doublemover/PairOfCleats/issues/1105) | P2 | [P2] Managed relation adapters let generic options override scoped parser selection | development implemented; validation deferred |
| [#1106](https://github.com/doublemover/PairOfCleats/issues/1106) | P1 | [P1] Preserve other mode generations when recovering an unreadable current pointer | development implemented; validation deferred |
| [#1107](https://github.com/doublemover/PairOfCleats/issues/1107) | P1 | [P1] Do not route searches to marker-only unpromoted builds during mode-root fallback | development implemented; validation deferred |
| [#1108](https://github.com/doublemover/PairOfCleats/issues/1108) | P1 | [P1] Do not delete incremental SQLite WAL after an unchecked or failed checkpoint | implemented; focused proof and front gate pass |
| [#1109](https://github.com/doublemover/PairOfCleats/issues/1109) | P1 | [P1] Default all-mode SQLite tool ignores mixed published mode roots | development implemented; validation deferred |
| [#1110](https://github.com/doublemover/PairOfCleats/issues/1110) | P2 | [P2] Strict index validation ignores SHA-256 checksums on packed postings metadata | development implemented; validation deferred |
| [#1111](https://github.com/doublemover/PairOfCleats/issues/1111) | P2 | [P2] Strict validation accepts empty or wrong-type declared LanceDB payloads | implemented in batch 3; focused proof and front gate pass |
| [#1112](https://github.com/doublemover/PairOfCleats/issues/1112) | P2 | [P2] Bind publication records to the mode and build root being promoted | pending |
| [#1113](https://github.com/doublemover/PairOfCleats/issues/1113) | P2 | [P2] LanceDB cache eviction can close a table during an in-flight ANN query | implemented in batch 3; focused proof and front gate pass |
| [#1114](https://github.com/doublemover/PairOfCleats/issues/1114) | P1 | [P1] Preserve LanceDB recall for large candidate filters | implemented; focused proof and front gate pass |
| [#1115](https://github.com/doublemover/PairOfCleats/issues/1115) | P2 | [P2] Coalesce concurrent LanceDB table opens to avoid untracked native handles | implemented in batch 3; focused proof and front gate pass |
| [#1116](https://github.com/doublemover/PairOfCleats/issues/1116) | P3 | [P3] Clearing LanceDB cache during connect leaks the late connection | pending |
| [#1117](https://github.com/doublemover/PairOfCleats/issues/1117) | P2 | [P2] VFS collector cleanup can delete another collector's live spill files | development implemented; validation deferred |
| [#1118](https://github.com/doublemover/PairOfCleats/issues/1118) | P2 | [P2] Reject unknown publication statuses and absent validation evidence | development implemented; validation deferred |
| [#1119](https://github.com/doublemover/PairOfCleats/issues/1119) | other | Add original-vector and stored-vector retrieval oracle adapters | pending |
| [#1120](https://github.com/doublemover/PairOfCleats/issues/1120) | other | Add a reproducible fusion and candidate-depth sweep to existing reports | pending |
| [#1121](https://github.com/doublemover/PairOfCleats/issues/1121) | other | Separate rerank pool from final output and prototype bounded local rerankers | pending |
| [#1122](https://github.com/doublemover/PairOfCleats/issues/1122) | other | Add count-aware exact-versus-ANN planning with conservative fallback | pending |
| [#1123](https://github.com/doublemover/PairOfCleats/issues/1123) | other | Shadow query-class routing and per-repository candidate allocation | pending |
| [#1124](https://github.com/doublemover/PairOfCleats/issues/1124) | other | Add explicit edit-safe and exploration context-pack policies | pending |
| [#1125](https://github.com/doublemover/PairOfCleats/issues/1125) | other | Enforce tokenizer-aware rendered context budgets alongside byte limits | pending |
| [#1126](https://github.com/doublemover/PairOfCleats/issues/1126) | other | Prototype deterministic coverage-aware evidence-set selection | pending |
| [#1127](https://github.com/doublemover/PairOfCleats/issues/1127) | other | Add state-conditioned missing-evidence requests without persistent agent memory | pending |
| [#1128](https://github.com/doublemover/PairOfCleats/issues/1128) | other | Add dependency-aware context rendering order independent of rank | pending |
| [#1129](https://github.com/doublemover/PairOfCleats/issues/1129) | other | Validate restored evidence against source and dependency state | pending |
| [#1130](https://github.com/doublemover/PairOfCleats/issues/1130) | other | Expose context selection provenance and bounded next-evidence annotations | pending |
| [#1131](https://github.com/doublemover/PairOfCleats/issues/1131) | other | Add retrieval-to-use span telemetry and atomic citation evaluation | pending |
| [#1132](https://github.com/doublemover/PairOfCleats/issues/1132) | other | Prototype per-summary dependency manifests and deletion-safe SCC reuse | pending |
| [#1133](https://github.com/doublemover/PairOfCleats/issues/1133) | other | Prototype demand-directed refinement through existing semantic frontiers | pending |
| [#1134](https://github.com/doublemover/PairOfCleats/issues/1134) | other | Add feature-conformance adapters for existing call-target producers | pending |
| [#1135](https://github.com/doublemover/PairOfCleats/issues/1135) | other | Specify distinct path semantics and validate bounded trace witnesses | pending |
| [#1136](https://github.com/doublemover/PairOfCleats/issues/1136) | other | Join risk candidates to source-pinned semantic value-flow evidence | pending |
| [#1137](https://github.com/doublemover/PairOfCleats/issues/1137) | other | Add call-slice and recorded-coverage evidence tiers to test suggestions | pending |
| [#1138](https://github.com/doublemover/PairOfCleats/issues/1138) | other | Explain source freshness, analysis freshness and completion independently | pending |
| [#1139](https://github.com/doublemover/PairOfCleats/issues/1139) | other | Prototype exact compressed finite-string witness handles | pending |
| [#1140](https://github.com/doublemover/PairOfCleats/issues/1140) | other | Add offline semantic-index coverage analysis and SQLite plan experiments | pending |
| [#1141](https://github.com/doublemover/PairOfCleats/issues/1141) | other | Shadow cost-aware scheduler choices using existing trace and admission owners | pending |
| [#1142](https://github.com/doublemover/PairOfCleats/issues/1142) | other | Prototype versioned vector quantization with original-vector reranking | pending |
| [#1143](https://github.com/doublemover/PairOfCleats/issues/1143) | other | Add bounded cross-generation declaration correspondence without changing immutable source identity | pending |
| [#1144](https://github.com/doublemover/PairOfCleats/issues/1144) | other | Add paired repository-cluster quality comparisons to existing evaluation reports | pending |
| [#1145](https://github.com/doublemover/PairOfCleats/issues/1145) | other | Route validated provider semantic facts through one canonical durable sink | pending |
| [#1146](https://github.com/doublemover/PairOfCleats/issues/1146) | other | Bind provider tool profiles to observed executable and project identities | pending |
| [#1147](https://github.com/doublemover/PairOfCleats/issues/1147) | other | Publish provider and consumer declarations with a conformance SDK | pending |
| [#1148](https://github.com/doublemover/PairOfCleats/issues/1148) | other | Add a bounded JSONL provider adapter and source-pinned report importer | pending |
| [#1149](https://github.com/doublemover/PairOfCleats/issues/1149) | other | Prototype explicit request-local semantic enrichment without generation mutation | pending |
| [#1150](https://github.com/doublemover/PairOfCleats/issues/1150) | other | Complete source admission for provider-only Elixir, Haskell and Zig routes | pending |
| [#1151](https://github.com/doublemover/PairOfCleats/issues/1151) | other | Prototype snapshot-consistent structured Python types through Pyright TSP | pending |
| [#1152](https://github.com/doublemover/PairOfCleats/issues/1152) | other | Prototype Go package and type facts through a bounded native adapter | pending |
| [#1153](https://github.com/doublemover/PairOfCleats/issues/1153) | other | Add differential parser qualification for consumer-visible AST migrations | pending |
| [#1154](https://github.com/doublemover/PairOfCleats/issues/1154) | other | Adopt TypeScript 7 native LSP as a first-class operational JS/TS provider | pending |
| [#1155](https://github.com/doublemover/PairOfCleats/issues/1155) | other | Migrate structured TypeScript semantics to the TS7.1 API with snapshot and disposal safety | pending |
| [#1156](https://github.com/doublemover/PairOfCleats/issues/1156) | other | Upgrade Babel parsing to Babel 8 with consumer-compatible JS/TS extraction | pending |
| [#1157](https://github.com/doublemover/PairOfCleats/issues/1157) | other | Add explicit alternative Python LSP profiles for BasedPyright, ty and Pyrefly | pending |
| [#1158](https://github.com/doublemover/PairOfCleats/issues/1158) | other | Wire Ruby LSP as a selectable semantic provider beyond installation detection | pending |
| [#1159](https://github.com/doublemover/PairOfCleats/issues/1159) | other | Add a qualified Prism syntax adapter for Ruby with exact source mapping | pending |
| [#1160](https://github.com/doublemover/PairOfCleats/issues/1160) | other | Complete PHP semantic adapter consumption and classify licensed alternatives | pending |
| [#1161](https://github.com/doublemover/PairOfCleats/issues/1161) | other | Admit C++ and Objective-C semantic sources with translation-unit build variants | pending |
| [#1162](https://github.com/doublemover/PairOfCleats/issues/1162) | other | Integrate structured Clang AST and preprocessing facts into semantic consumers | pending |
| [#1163](https://github.com/doublemover/PairOfCleats/issues/1163) | other | Add explicit CUDA source admission and host/device semantic variants | pending |
| [#1164](https://github.com/doublemover/PairOfCleats/issues/1164) | other | Consume rust-analyzer structured symbols, expansion maps and type evidence | pending |
| [#1165](https://github.com/doublemover/PairOfCleats/issues/1165) | other | Integrate Swift compiler index-store relations and SourceKit build context | pending |
| [#1166](https://github.com/doublemover/PairOfCleats/issues/1166) | other | Add a toolchain-aligned SwiftParser syntax adapter with consumer parity | pending |
| [#1167](https://github.com/doublemover/PairOfCleats/issues/1167) | other | Modernize the patched Tree-sitter runtime and pinned upstream grammar build channel | pending |
| [#1168](https://github.com/doublemover/PairOfCleats/issues/1168) | other | Integrate official Kotlin LSP as a first-class opt-in JVM provider | pending |
| [#1169](https://github.com/doublemover/PairOfCleats/issues/1169) | other | Add a Kotlin Analysis API producer for structured JVM symbols and bindings | pending |
| [#1170](https://github.com/doublemover/PairOfCleats/issues/1170) | other | Extend Java JDT integration with project-qualified structured bindings | pending |
| [#1171](https://github.com/doublemover/PairOfCleats/issues/1171) | other | Integrate official standalone Roslyn LSP alongside csharp-ls | pending |
| [#1172](https://github.com/doublemover/PairOfCleats/issues/1172) | other | Add Roslyn compiler fact production with C# and Visual Basic source admission | pending |
| [#1173](https://github.com/doublemover/PairOfCleats/issues/1173) | other | Integrate Scala Metals and import source-pinned SemanticDB facts | pending |
| [#1174](https://github.com/doublemover/PairOfCleats/issues/1174) | other | Add project-qualified Dart analyzer facts beside the Analysis Server route | pending |
| [#1175](https://github.com/doublemover/PairOfCleats/issues/1175) | other | Integrate bounded Groovy compiler facts and an explicit Groovy LSP profile | pending |
| [#1176](https://github.com/doublemover/PairOfCleats/issues/1176) | other | Admit F# sources and integrate FsAutoComplete with compiler-service facts | pending |
| [#1177](https://github.com/doublemover/PairOfCleats/issues/1177) | other | Integrate Bash and Perl navigation profiles with source-pinned diagnostics | pending |
| [#1178](https://github.com/doublemover/PairOfCleats/issues/1178) | perf | [Perf] Remove synchronous per-candidate realpath stalls from index discovery | pending |
| [#1179](https://github.com/doublemover/PairOfCleats/issues/1179) | other | Add PowerShell AST admission and a bounded PSES provider | pending |
| [#1180](https://github.com/doublemover/PairOfCleats/issues/1180) | perf | [Perf] Batch bounded chunk tokenization tasks instead of one awaited worker round trip per chunk | pending |
| [#1181](https://github.com/doublemover/PairOfCleats/issues/1181) | other | Add Erlang source admission and ELP definition/reference integration | pending |
| [#1182](https://github.com/doublemover/PairOfCleats/issues/1182) | perf | [Perf] Compute MinHash once per distinct token and share lexical frequency work | pending |
| [#1183](https://github.com/doublemover/PairOfCleats/issues/1183) | perf | [Perf] Reuse complete validated lexical products during enrichment-only incremental refresh | pending |
| [#1184](https://github.com/doublemover/PairOfCleats/issues/1184) | other | Add OCaml syntax and Dune-aware OCaml-LSP semantic integration | pending |
| [#1185](https://github.com/doublemover/PairOfCleats/issues/1185) | perf | [Perf] Index file structural-match intervals once for chunk enrichment and cached replay | pending |
| [#1186](https://github.com/doublemover/PairOfCleats/issues/1186) | other | Integrate project-qualified R and Julia language-server facts | pending |
| [#1187](https://github.com/doublemover/PairOfCleats/issues/1187) | perf | [Perf] Amortize cross-file symbol-cache expiry instead of scanning 20k entries on every overflow | pending |
| [#1188](https://github.com/doublemover/PairOfCleats/issues/1188) | other | Add offline schema-qualified SQL binding and PostgreSQL tooling | pending |
| [#1189](https://github.com/doublemover/PairOfCleats/issues/1189) | other | Implement offline schema and reference facts for structured configuration | pending |
| [#1190](https://github.com/doublemover/PairOfCleats/issues/1190) | other | Integrate Vue, Svelte and Astro framework semantic source maps | pending |
| [#1191](https://github.com/doublemover/PairOfCleats/issues/1191) | other | Link GraphQL schemas and Protobuf descriptors into queryable evidence | pending |
| [#1192](https://github.com/doublemover/PairOfCleats/issues/1192) | other | Add HCL/Terraform admission and offline terraform-ls schema integration | pending |
| [#1193](https://github.com/doublemover/PairOfCleats/issues/1193) | other | Add a static-first Nix language profile with explicit evaluation boundaries | pending |
| [#1194](https://github.com/doublemover/PairOfCleats/issues/1194) | other | Ingest configured build-graph snapshots for CMake, Bazel and Make | pending |
| [#1195](https://github.com/doublemover/PairOfCleats/issues/1195) | other | Add source-linked web/template reference adapters without template execution | pending |
| [#1196](https://github.com/doublemover/PairOfCleats/issues/1196) | other | Bridge existing SCIP ingest into source-pinned semantic facts and define LSIF compatibility | pending |
| [#1197](https://github.com/doublemover/PairOfCleats/issues/1197) | other | Acquire and project structured LSP observations through shared semantic consumers | pending |
| [#1198](https://github.com/doublemover/PairOfCleats/issues/1198) | perf | [Perf] Batch persistent embedding-cache writes and coalesce hit touches | pending |
| [#1199](https://github.com/doublemover/PairOfCleats/issues/1199) | perf | [Perf] Replace per-file full embedding-cache index snapshots with bounded delta checkpoints | pending |
| [#1200](https://github.com/doublemover/PairOfCleats/issues/1200) | perf | [Perf] Build embedding-cache shard summaries once for pruning and compaction | pending |
| [#1201](https://github.com/doublemover/PairOfCleats/issues/1201) | perf | [Perf] Qualify fused ONNX pooling and selective output fetches | pending |
| [#1202](https://github.com/doublemover/PairOfCleats/issues/1202) | perf | [Perf] Qualify model-specific ONNX execution profiles under a shared CPU budget | pending |
| [#1203](https://github.com/doublemover/PairOfCleats/issues/1203) | perf | [Perf] Read parse checkpoints without decoding full incremental bundles twice | pending |
| [#1204](https://github.com/doublemover/PairOfCleats/issues/1204) | perf | [Perf] Avoid redundant synchronous full-model hashing through verified artifact leases | pending |
| [#1205](https://github.com/doublemover/PairOfCleats/issues/1205) | perf | [Perf] Build semantic compiler-session identity indexes instead of repeated inventory scans | pending |
| [#1206](https://github.com/doublemover/PairOfCleats/issues/1206) | perf | [Perf] Remove full-clear vocabulary-cache cliffs in SQLite bundle ingestion | pending |
| [#1207](https://github.com/doublemover/PairOfCleats/issues/1207) | perf | [Perf] Pipeline SQLite bundle decoding with ordered byte-bounded ingestion | pending |
| [#1208](https://github.com/doublemover/PairOfCleats/issues/1208) | perf | [Perf] Spool Stage-3 vector channels instead of retaining the full corpus | pending |
| [#1209](https://github.com/doublemover/PairOfCleats/issues/1209) | perf | [Perf] Use canonical binary vector streams for ANN handoff and avoid mandatory dual serialization | pending |
| [#1210](https://github.com/doublemover/PairOfCleats/issues/1210) | perf | [Perf] Keep no-yield postings iterations synchronous instead of allocating a promise per item | pending |
| [#1211](https://github.com/doublemover/PairOfCleats/issues/1211) | perf | [Perf] Stream SQLite dense-vector reconciliation instead of materializing both generations | pending |
| [#1212](https://github.com/doublemover/PairOfCleats/issues/1212) | perf | [Perf] Encode semantic rows once per admitted batch for sizing, hashing and writing | pending |
| [#1213](https://github.com/doublemover/PairOfCleats/issues/1213) | perf | [Perf] Reuse compatible HNSW generations with measured delta and rebuild thresholds | pending |
| [#1214](https://github.com/doublemover/PairOfCleats/issues/1214) | perf | [Perf] Coalesce semantic family parts without weakening durable completion boundaries | pending |
| [#1215](https://github.com/doublemover/PairOfCleats/issues/1215) | perf | [Perf] Add generation-safe LanceDB delta writes and bounded maintenance | pending |
| [#1216](https://github.com/doublemover/PairOfCleats/issues/1216) | perf | [Perf] Ingest LanceDB vectors through bounded typed columnar batches | pending |
| [#1217](https://github.com/doublemover/PairOfCleats/issues/1217) | perf | [Perf] Amortize isolated ANN startup and overlap bounded backend stages | pending |
| [#1218](https://github.com/doublemover/PairOfCleats/issues/1218) | perf | [Perf] Share token-aware deduplicated batching with inline embedding attachment | pending |
| [#1219](https://github.com/doublemover/PairOfCleats/issues/1219) | perf | [Perf] Fuse vector postprocessing without repeated normalized-channel copies | pending |
| [#1220](https://github.com/doublemover/PairOfCleats/issues/1220) | perf | [Perf] Preserve partial embedding reuse when one chunk changes the file fingerprint | pending |
| [#1221](https://github.com/doublemover/PairOfCleats/issues/1221) | perf | [Perf] Add a validated cache-only Stage-3 path that avoids loading ONNX | pending |
| [#1222](https://github.com/doublemover/PairOfCleats/issues/1222) | perf | [Perf] Skip unchanged embedding bundle hydration using verified coverage digests | pending |
| [#1223](https://github.com/doublemover/PairOfCleats/issues/1223) | perf | [Perf] Solve compiler call summaries with dirty dependencies instead of full SCC rescans | pending |
| [#1224](https://github.com/doublemover/PairOfCleats/issues/1224) | perf | [Perf] Avoid full reaching-definition Map/Set snapshots at every CFG block | pending |
| [#1225](https://github.com/doublemover/PairOfCleats/issues/1225) | perf | [Perf] Share CFG effect and exception reachability instead of traversing suffixes per call | pending |
| [#1226](https://github.com/doublemover/PairOfCleats/issues/1226) | perf | [Perf] Index field-path overlap candidates instead of comparing every path pair | pending |
| [#1227](https://github.com/doublemover/PairOfCleats/issues/1227) | perf | [Perf] Avoid idle compression-worker startup for gzip sharded artifacts | pending |
| [#1228](https://github.com/doublemover/PairOfCleats/issues/1228) | perf | [Perf] Make process-pool startup demand-driven and dispatch ready children independently | pending |
| [#1229](https://github.com/doublemover/PairOfCleats/issues/1229) | perf | [Perf] Replace full pressure-telemetry cache sorts on each overflowing file | pending |
| [#1230](https://github.com/doublemover/PairOfCleats/issues/1230) | perf | [Perf] Index LSP semantic source and declaration joins and reuse the inventory digest | pending |
| [#1231](https://github.com/doublemover/PairOfCleats/issues/1231) | perf | [Perf] Bound and share finally CFG expansion without merging abrupt completion routes | pending |
| [#1232](https://github.com/doublemover/PairOfCleats/issues/1232) | perf | [Perf] Eliminate cross-language throttle wake storms and duplicate pressure sampling | pending |
| [#1233](https://github.com/doublemover/PairOfCleats/issues/1233) | perf | [Perf] Reuse parser-owned classification spans instead of reparsing every eligible chunk | pending |
| [#1234](https://github.com/doublemover/PairOfCleats/issues/1234) | perf | [Perf] Propagate sealed semantic piece checksums into publication manifests | pending |
| [#1235](https://github.com/doublemover/PairOfCleats/issues/1235) | perf | [Perf] Compile exact query eligibility over indexed candidate domains instead of scanning all chunk metadata | pending |
| [#1236](https://github.com/doublemover/PairOfCleats/issues/1236) | perf | [Perf] Derive metadata and churn from one qualified Git history traversal | pending |
| [#1237](https://github.com/doublemover/PairOfCleats/issues/1237) | perf | [Perf] Add exact score-bound pruning for broad-query JS BM25 top-k | pending |
| [#1238](https://github.com/doublemover/PairOfCleats/issues/1238) | perf | [Perf] Reuse coverage-qualified discovery inventory in filesystem import indexing | pending |
| [#1239](https://github.com/doublemover/PairOfCleats/issues/1239) | perf | [Perf] Build one file inventory per shared-module ledger generation | pending |
| [#1240](https://github.com/doublemover/PairOfCleats/issues/1240) | perf | [Perf] Reuse build-owned verified semantic source retention receipts | pending |
| [#1241](https://github.com/doublemover/PairOfCleats/issues/1241) | perf | [Perf] Defer unused lexical candidate unions and deduplicate query-gram posting visits | pending |
| [#1242](https://github.com/doublemover/PairOfCleats/issues/1242) | perf | [Perf] Reuse one verified artifact snapshot during fixture health evaluation | pending |
| [#1243](https://github.com/doublemover/PairOfCleats/issues/1243) | perf | [Perf] Bound discovery enumeration before materializing the full candidate path list | pending |
| [#1244](https://github.com/doublemover/PairOfCleats/issues/1244) | perf | [Perf] Choose cardinality-aware Set and bitmap filter intersections | pending |
| [#1245](https://github.com/doublemover/PairOfCleats/issues/1245) | perf | [Perf] Share a run-scoped discovery snapshot across governance reports | pending |
| [#1246](https://github.com/doublemover/PairOfCleats/issues/1246) | perf | [Perf] Skip physical-core subprocess probes when test jobs are explicit | pending |
| [#1247](https://github.com/doublemover/PairOfCleats/issues/1247) | perf | [Perf] Reuse immutable dispatch member and accessor summaries across call sites | pending |
| [#1248](https://github.com/doublemover/PairOfCleats/issues/1248) | perf | [Perf] Index worker message peers and propagate changed port facts only | pending |
| [#1249](https://github.com/doublemover/PairOfCleats/issues/1249) | perf | [Perf] Reuse bounded declaration-alias closures across provider call-target joins | pending |
| [#1250](https://github.com/doublemover/PairOfCleats/issues/1250) | perf | [Perf] Amortize bundle-transform workers and return only requested results | pending |
| [#1251](https://github.com/doublemover/PairOfCleats/issues/1251) | perf | [Perf] Prewarm query hot caches once per disk generation instead of rebuilding on misses | pending |
| [#1252](https://github.com/doublemover/PairOfCleats/issues/1252) | perf | [Perf] Fuse manifest integrity reads with artifact decoding during validation | pending |
| [#1253](https://github.com/doublemover/PairOfCleats/issues/1253) | perf | [Perf] Project cold chunk identity fields without retaining full cold rows | pending |
| [#1254](https://github.com/doublemover/PairOfCleats/issues/1254) | perf | [Perf] Stream benchmark logs once into independent report reducers | pending |
| [#1255](https://github.com/doublemover/PairOfCleats/issues/1255) | perf | [Perf] Share risk witness prefixes and release consumed traversal states | pending |
| [#1256](https://github.com/doublemover/PairOfCleats/issues/1256) | perf | [Perf] Prepare immutable risk edge metadata once rather than per traversal state | pending |
| [#1257](https://github.com/doublemover/PairOfCleats/issues/1257) | other | Unify configuration guidance and retire the obsolete two-key hard-cut prescription | pending |
| [#1258](https://github.com/doublemover/PairOfCleats/issues/1258) | other | Rewrite language onboarding and capability guidance against native-only and current inference owners | pending |
| [#1259](https://github.com/doublemover/PairOfCleats/issues/1259) | other | Consolidate duplicated artifact and analysis prose contracts without losing stricter reader guarantees | pending |
| [#1260](https://github.com/doublemover/PairOfCleats/issues/1260) | other | Reorganize user documentation around tasks and separate dated receipts from current guides | pending |
| [#1261](https://github.com/doublemover/PairOfCleats/issues/1261) | other | Rewrite setup as explicit checkout-to-target recipes with readiness and download boundaries | pending |
| [#1262](https://github.com/doublemover/PairOfCleats/issues/1262) | other | Add complete source-checkout onboarding for VS Code and native TUI instead of command-only guides | pending |
| [#1263](https://github.com/doublemover/PairOfCleats/issues/1263) | other | Document a complete two-repository workspace search journey and current federation limits | pending |
| [#1264](https://github.com/doublemover/PairOfCleats/issues/1264) | other | [Storage] Unify app-owned paths behind one explainable storage layout and ownership resolver | pending |
| [#1265](https://github.com/doublemover/PairOfCleats/issues/1265) | other | [Storage] Migrate legacy owned data with resumable verified cutover and rollback | pending |
| [#1266](https://github.com/doublemover/PairOfCleats/issues/1266) | other | [Storage] Add unified CLI inventory, diagnosis, configuration and safe cleanup planning | pending |
| [#1267](https://github.com/doublemover/PairOfCleats/issues/1267) | other | [Storage] Coordinate lifecycle quotas and leases without deleting saved evidence or active assets | pending |
| [#1268](https://github.com/doublemover/PairOfCleats/issues/1268) | other | [Storage] Route managed child-tool caches and scratch data into owned storage with explicit exceptions | pending |
| [#1269](https://github.com/doublemover/PairOfCleats/issues/1269) | other | Refresh contributor test and benchmark recipes after source-owner moves and runner consolidation | pending |
| [#1270](https://github.com/doublemover/PairOfCleats/issues/1270) | other | Separate shipped backend recipes from evaluation-only recommendations and dependency labels | pending |
| [#1271](https://github.com/doublemover/PairOfCleats/issues/1271) | other | Rewrite viewer documentation as two current workflows with scoped evidence instead of campaign handoffs | pending |
| [#1272](https://github.com/doublemover/PairOfCleats/issues/1272) | other | [Setup] Keep help and checkout diagnosis available before bootstrap readiness | pending |
| [#1273](https://github.com/doublemover/PairOfCleats/issues/1273) | other | [Viewer] Add a canonical local preview command with safe startup and recovery | pending |
| [#1274](https://github.com/doublemover/PairOfCleats/issues/1274) | other | [Config] Explain and validate effective settings instead of only raw file shape | pending |
| [#1275](https://github.com/doublemover/PairOfCleats/issues/1275) | other | [Setup] Add a reviewable first-search plan with explicit capability choices | pending |
| [#1276](https://github.com/doublemover/PairOfCleats/issues/1276) | other | Summarize package patches once with real file/hunk counts and clear failures | pending |
| [#1277](https://github.com/doublemover/PairOfCleats/issues/1277) | perf | [Perf] Add dependency-safe bounded concurrency to patch preparation and native bootstrap | pending |
| [#1278](https://github.com/doublemover/PairOfCleats/issues/1278) | perf | [Perf] Push selective BM25 posting and length hydration into SQLite | pending |
| [#1279](https://github.com/doublemover/PairOfCleats/issues/1279) | perf | [Perf] Use indexed cold filter enumeration without whole-corpus metadata hydration | pending |
| [#1280](https://github.com/doublemover/PairOfCleats/issues/1280) | perf | [Perf] Qualify a blocked contiguous exact dense-scan kernel without per-row view allocation | pending |
| [#1281](https://github.com/doublemover/PairOfCleats/issues/1281) | perf | [Perf] Coalesce retrieval cache touches and avoid full cache serialization on every hit | pending |
| [#1282](https://github.com/doublemover/PairOfCleats/issues/1282) | other | [Setup] Provision and verify the selected modern bootstrap toolchain across platforms | pending |
| [#1283](https://github.com/doublemover/PairOfCleats/issues/1283) | other | [Workspace] Guide users from two repository roots to a validated federated search | pending |
| [#1284](https://github.com/doublemover/PairOfCleats/issues/1284) | other | [TUI] Implement captured mouse focus, selection and scrolling instead of discarding events | pending |
| [#1285](https://github.com/doublemover/PairOfCleats/issues/1285) | other | [TUI] Add safe paste, cursor editing and schema-native controls to existing forms | pending |
| [#1286](https://github.com/doublemover/PairOfCleats/issues/1286) | other | [TUI] Show truthful time-aware activity and measured progress for long-running work | pending |
| [#1287](https://github.com/doublemover/PairOfCleats/issues/1287) | other | [TUI] Make help fully reachable and unify searchable action discovery with actual bindings | pending |
| [#1288](https://github.com/doublemover/PairOfCleats/issues/1288) | P1 | [P1] Build an installable VSIX instead of a renamed source ZIP | development implemented; validation deferred |
| [#1289](https://github.com/doublemover/PairOfCleats/issues/1289) | P1 | [P1] Package Sublime plugins at archive root with the canonical package identity | development implemented; validation deferred |
| [#1290](https://github.com/doublemover/PairOfCleats/issues/1290) | P2 | [P2] Own and reap every editor request across window close, reload and uninstall | pending |
| [#1291](https://github.com/doublemover/PairOfCleats/issues/1291) | P2 | [P2] Make VS Code replay and stop actions target the exact saved workflow session | pending |
| [#1292](https://github.com/doublemover/PairOfCleats/issues/1292) | P2 | [P2] Bind inline editor intelligence to source, generation and current interaction | pending |
| [#1293](https://github.com/doublemover/PairOfCleats/issues/1293) | other | [Enhancement] Resolve and explain editor settings for the selected repository | pending |
| [#1294](https://github.com/doublemover/PairOfCleats/issues/1294) | other | [TUI] Prioritize the focused work pane with a height-aware compact layout | pending |
| [#1295](https://github.com/doublemover/PairOfCleats/issues/1295) | other | [Viewer] Replace the settings wall with a scene-first, capability-aware control workspace | pending |
| [#1296](https://github.com/doublemover/PairOfCleats/issues/1296) | other | [Viewer] Ship a striking Tron-inspired default with composable glass, light and motion presets | pending |
| [#1297](https://github.com/doublemover/PairOfCleats/issues/1297) | other | [Viewer] Replace hidden cap stacks with progressive detail and truthful coverage | pending |
| [#1298](https://github.com/doublemover/PairOfCleats/issues/1298) | other | [Viewer] Make keyboard camera control focus-safe and expose an accessible navigation surface | pending |
| [#1299](https://github.com/doublemover/PairOfCleats/issues/1299) | other | [Viewer] Add reduced-motion and idle-aware rendering with trustworthy frame telemetry | pending |
| [#1300](https://github.com/doublemover/PairOfCleats/issues/1300) | other | [Viewer] Preserve a working evidence browser through module, WebGL and context-loss failures | pending |
| [#1301](https://github.com/doublemover/PairOfCleats/issues/1301) | other | [Viewer] Fit and navigate the full scene with adaptive zoom and readable labels | pending |
| [#1302](https://github.com/doublemover/PairOfCleats/issues/1302) | other | [Viewer] Make directed pipes visually distinguishable and reconcile plumbing inspection with visible filters | pending |
| [#1303](https://github.com/doublemover/PairOfCleats/issues/1303) | other | [Enhancement] Connect both editors to source-qualified definition and reference navigation | pending |
| [#1304](https://github.com/doublemover/PairOfCleats/issues/1304) | other | [Enhancement] Expose bounded semantic find, detail and trace workflows in both editors | pending |
| [#1305](https://github.com/doublemover/PairOfCleats/issues/1305) | other | [Enhancement] Add editor filter-only enumeration and generation-safe continuation | pending |
| [#1306](https://github.com/doublemover/PairOfCleats/issues/1306) | other | [Enhancement] Make remote editor execution and API repository mapping explicit | pending |
| [#1307](https://github.com/doublemover/PairOfCleats/issues/1307) | other | [Enhancement] Turn editor context and risk output into reusable source-linked evidence | pending |
| [#1308](https://github.com/doublemover/PairOfCleats/issues/1308) | other | [Enhancement] Show actionable editor workflow progress and recoverable service readiness | pending |
| [#1309](https://github.com/doublemover/PairOfCleats/issues/1309) | other | [Viewer] Own and retire environment render targets when replacing fallback lighting | pending |
| [#1310](https://github.com/doublemover/PairOfCleats/issues/1310) | other | Keep CLI log/status lines compact without changing the progress-bar look | pending |
| [#1311](https://github.com/doublemover/PairOfCleats/issues/1311) | other | [Tooling] Execute dependency-aware managed provisioning instead of stopping at missing runtimes | pending |
| [#1312](https://github.com/doublemover/PairOfCleats/issues/1312) | other | [Tooling] Add durable per-tool install receipts and verified update, repair and removal | pending |
| [#1313](https://github.com/doublemover/PairOfCleats/issues/1313) | other | [Tooling] Provision structural engines and operational CLI prerequisites by selected feature | pending |
| [#1314](https://github.com/doublemover/PairOfCleats/issues/1314) | other | [Diagnostics] Persist embedding child failures in run-scoped logs and advertise the actual evidence | development implemented; validation deferred |
| [#1315](https://github.com/doublemover/PairOfCleats/issues/1315) | P1 | [P1] Serialize crash-log error writes with live appenders and preserve terminal error state | development implemented; validation deferred |
| [#1316](https://github.com/doublemover/PairOfCleats/issues/1316) | other | [Viewer] Fail map export and preview admission when requested output was not written | pending |
| [#1317](https://github.com/doublemover/PairOfCleats/issues/1317) | other | [Viewer] Pin running preview sessions instead of rereading one shared mutable HTML file | pending |
| [#1318](https://github.com/doublemover/PairOfCleats/issues/1318) | P2 | [P2] Bound embedding subprocess line forwarding and keep stdout/stderr framing separate | pending |
| [#1319](https://github.com/doublemover/PairOfCleats/issues/1319) | other | [Build] Reuse sealed completed stages from compatible failed generations | pending |
| [#1320](https://github.com/doublemover/PairOfCleats/issues/1320) | perf | [Perf] Reuse freshness-qualified discovery and preprocessing across build retries | pending |
| [#1321](https://github.com/doublemover/PairOfCleats/issues/1321) | other | [Build] Seal independently validated graph capability before optional backend work | pending |
| [#1322](https://github.com/doublemover/PairOfCleats/issues/1322) | other | [Build] Add reviewable resume and validate-only recovery plans for retained runs | pending |
| [#1323](https://github.com/doublemover/PairOfCleats/issues/1323) | P2 | [P2] Do not block embedding-disabled Stage2 recovery on inactive model execution requirements | pending |
| [#1324](https://github.com/doublemover/PairOfCleats/issues/1324) | other | [Viewer] Open saved map artifacts without regenerating from the current index | pending |
| [#1325](https://github.com/doublemover/PairOfCleats/issues/1325) | other | [Build] Preflight requested embedding assets and execution plan before expensive Stage2 work | pending |
| [#1326](https://github.com/doublemover/PairOfCleats/issues/1326) | P2 | [P2] Finalize CLI output before closing the display and preserve JSONL framing | pending |
| [#1327](https://github.com/doublemover/PairOfCleats/issues/1327) | other | [Diagnostics] Compare durable build execution plans and actual work across attempts | pending |
| [#1328](https://github.com/doublemover/PairOfCleats/issues/1328) | P2 | [P2] Derive build completion summaries from the selected run result, not stale preprocess stats | pending |
| [#1329](https://github.com/doublemover/PairOfCleats/issues/1329) | perf | [Perf] Move file-local JS/TS analysis off the coordinator through a bounded coarse worker contract | pending |
| [#1330](https://github.com/doublemover/PairOfCleats/issues/1330) | perf | [Perf] Release CPU admission while file tasks await nested I/O and reacquire only for compute | pending |
| [#1331](https://github.com/doublemover/PairOfCleats/issues/1331) | P2 | [P2] Enforce scheduler-adapter concurrency instead of exposing it as a nonbinding label | pending |
| [#1332](https://github.com/doublemover/PairOfCleats/issues/1332) | P2 | [P2] Report observed token execution routes and separate waiting requests from busy workers | pending |
| [#1333](https://github.com/doublemover/PairOfCleats/issues/1333) | P2 | [P2] Cancel preprocessing line reads and preserve unknown counts on IO failure | development implemented; validation deferred |
| [#1334](https://github.com/doublemover/PairOfCleats/issues/1334) | other | [CLI] Make the existing progress bars responsive to terminal width and useful measured detail | pending |
| [#1335](https://github.com/doublemover/PairOfCleats/issues/1335) | P2 | [P2] Bind Tree-sitter subprocess fanout to the effective build resource envelope | pending |
| [#1336](https://github.com/doublemover/PairOfCleats/issues/1336) | perf | [Perf] Choose Tree-sitter warm-parser lanes from admitted parse cost rather than wave count alone | pending |
| [#1337](https://github.com/doublemover/PairOfCleats/issues/1337) | P2 | [P2] Serialize Tree-sitter worker initialization and fence late pools after shutdown | pending |
| [#1338](https://github.com/doublemover/PairOfCleats/issues/1338) | P2 | [P2] Fail API-contract reports when declared call-site evidence cannot load | pending |
| [#1339](https://github.com/doublemover/PairOfCleats/issues/1339) | P2 | [P2] Fail closed when an explicitly configured ONNX model path is missing | pending |
| [#1340](https://github.com/doublemover/PairOfCleats/issues/1340) | P2 | [P2] Version text-vector cache rows instead of inferring encoding from possibly truncated blobs | implemented in batch 3; focused proof and front gate pass |
| [#1341](https://github.com/doublemover/PairOfCleats/issues/1341) | P1 | [P1] Validate the effective query embedding identity after provider fallback before ANN reuse | implemented; focused proof and front gate pass |
| [#1342](https://github.com/doublemover/PairOfCleats/issues/1342) | other | [Reliability] Give hard-pressure tokenizer admission a bounded no-progress recovery path | pending |
| [#1343](https://github.com/doublemover/PairOfCleats/issues/1343) | P2 | [P2] Reject Python AST admission during shutdown instead of stranding requests | pending |
| [#1344](https://github.com/doublemover/PairOfCleats/issues/1344) | P2 | [P2] Reject unknown index subcommands and invalid stages before admitting a full build | pending |
| [#1345](https://github.com/doublemover/PairOfCleats/issues/1345) | P2 | [P2] Resolve workspace child startup settings per target instead of inheriting the launch directory | pending |
| [#1346](https://github.com/doublemover/PairOfCleats/issues/1346) | P2 | [P2] Preserve explicit validation and embedding flags across background Stage2 handoff | pending |
| [#1347](https://github.com/doublemover/PairOfCleats/issues/1347) | P2 | [P2] Do not forward the globally accepted -v version flag into mutating leaf commands | pending |
| [#1348](https://github.com/doublemover/PairOfCleats/issues/1348) | other | [Indexing] Make cross-file fidelity budgets explicit and preserve durable omission coverage | pending |
| [#1349](https://github.com/doublemover/PairOfCleats/issues/1349) | P2 | [P2] Give inline and daemon-prewarm embedding leases an explicit runtime teardown owner | pending |
| [#1350](https://github.com/doublemover/PairOfCleats/issues/1350) | P2 | [P2] Report unconfirmed LSP disposal instead of returning a successful pool drain | pending |
| [#1351](https://github.com/doublemover/PairOfCleats/issues/1351) | P2 | [P2] Preserve manifest integrity errors during graph artifact admission | pending |
| [#1352](https://github.com/doublemover/PairOfCleats/issues/1352) | P2 | [P2] Pin every search read to the request's selected per-mode generation | pending |
| [#1353](https://github.com/doublemover/PairOfCleats/issues/1353) | P2 | [P2] Honor bare --no-fallback before selecting a user-scope tooling install | pending |
| [#1354](https://github.com/doublemover/PairOfCleats/issues/1354) | P2 | [P2] Stage and verify complete ONNX model artifact sets before publishing a download target | pending |
| [#1355](https://github.com/doublemover/PairOfCleats/issues/1355) | P2 | [P2] Resolve a reusable inline model identity before sealing caches and dense readiness | pending |
| [#1356](https://github.com/doublemover/PairOfCleats/issues/1356) | P2 | [P2] Preserve upstream risk coverage when reporting zero flows and strict readiness | pending |
| [#1357](https://github.com/doublemover/PairOfCleats/issues/1357) | P1 | [P1] Preserve complete artifacts when keepRaw fans out a single-use row iterator | implemented; focused proof and front gate pass |
| [#1358](https://github.com/doublemover/PairOfCleats/issues/1358) | perf | [Perf] Batch binary-columnar data and sidecar writes instead of issuing three writes per row | pending |
| [#1359](https://github.com/doublemover/PairOfCleats/issues/1359) | perf | [Perf] Buffer generic JSON encoding and keep no-backpressure traversal synchronous | pending |
| [#1360](https://github.com/doublemover/PairOfCleats/issues/1360) | perf | [Perf] Encode packed postings into bounded buffers without per-integer Buffer allocation | pending |
| [#1361](https://github.com/doublemover/PairOfCleats/issues/1361) | P2 | [P2] Forward configured gzip options through JSONL batch writers | development implemented; validation deferred |
| [#1362](https://github.com/doublemover/PairOfCleats/issues/1362) | P2 | [P2] Reject unavailable relation evidence instead of returning false-empty filtered search | pending |
| [#1363](https://github.com/doublemover/PairOfCleats/issues/1363) | perf | [Perf] Reuse bounded prepared artifact rows across projection, sizing and output passes | pending |
| [#1364](https://github.com/doublemover/PairOfCleats/issues/1364) | perf | [Perf] Make field-postings shards byte-bounded and stream the compatibility merge | pending |
| [#1365](https://github.com/doublemover/PairOfCleats/issues/1365) | perf | [Perf] Share active artifact compression workers under the build CPU and byte budget | pending |
| [#1366](https://github.com/doublemover/PairOfCleats/issues/1366) | perf | [Perf] Plan one required sparse artifact representation before emitting compatibility copies | pending |
| [#1367](https://github.com/doublemover/PairOfCleats/issues/1367) | other | [Viewer] Fix world-depth occlusion and glass/path compositing instead of drawing overlays through files | pending |

User steering after batch 3: discontinue ignored development drafts, apply completed
changes to real files, and frontload remaining implementation before further test
campaigns. The lead retains shared Git/publication responsibility; agents do not
wait for validation or coordinate with each other.
