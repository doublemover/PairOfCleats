# DEPRECATED: Semantic campaign and archive checkpoint

Canonical replacement: [active roadmap](../roadmap.md).
Reason: preserve completed implementation transcripts and revision-specific evidence while keeping the active inventory concise.
Archived: 2026-10-10, PR548, from local continuation commit 0ab096b2 plus its generated-documentation repair.
Historical local receipt paths are retained as provenance, not promised files in a clean checkout. This archive does not create a competing queue or claim current-head CI acceptance.

## Semantic indexing implementation (2026-10-10)

### Cloud continuation: durable first-stage replay

The isolated `codex/semantic-resume-campaign-20261010` continuation starts at
`7cbf516f`. R1 now has awaited, versioned per-file completion descriptors linking
immutable ordinary bundles and validated semantic cache objects. Source bytes,
repository namespace, parser/extractor and result-lane identities select replay;
worker counts, shards and output layout do not. Zero-chunk completions carry an
explicit count. The normal cache reader and ordered result application restore
the result; Stage2 never mutates or collects pinned first-stage bundle snapshots.
Compiler policy and physical layout are separated from semantic syntax cache
identity. Source/cache publication now syncs directory entries as well as data.

The new enrolled `storage/semantic/first-stage-completion` fixture covers unsaved
manifest recovery, generation relocation, zero chunks, changed source/extractor,
layout changes, corrupt-part isolation and Stage2 copy-on-write. Its bounded
Node26 run passed; broad qualification is deliberately deferred. R2/R3/R4 remain
partial: recovery accounting, stale/duplicate owners, incomplete/corrupt cache
repair, full interrupted multi-worker integration and control-store reconstruction
still need their remaining work. This is implementation progress, not full recovery
acceptance. The refined sequence-9 priority order remains authoritative: recovery,
JS/TS, Worker/WASM, retrieval, runtime, language adapters, estimator last.

Q2 now has bounded indexed `chunkUid`, `sourcePath` and `sourceUnitId` discovery
through the shared find contract, with primary/overlap ownership and zero-chunk
operations retained. Artifact operation index version 2 and SQLite indexed joins
produce the same paginated candidates in the new `storage/semantic/seed-discovery`
fixture. Canonical fact identities are unchanged; older physical operation indexes
require a rebuild. The shared CLI/MCP/HTTP context-pack builder now accepts `includeSemantic`. It
returns a separate hard-bounded 64 KiB semantic section with up to eight discovered
operations, ordered arguments/names/ownership, one bounded downstream witness,
retained-source excerpt and exact generation-pinned follow-up requests. Partial
semantic analysis cannot promote composite evidence to complete. Federated JSON
retains each repository/generation independently, bounded by the existing repo cap.
The focused seed-discovery fixture covers schema validation, the shared request
projection, missing-family behavior and corruption fail-closed behavior. Full public
surface integration, source-position interval lookup and richer seed prioritization
remain unqualified.

J1 occurrence coverage now distinguishes destructuring assignment targets from
declarations, compound reads/writes, import/export alias roles and type-only syntax.
Babel tagged-template substitutions and both dynamic-import inputs have ordered
argument rows; optional operands retain their flag, private names have one occurrence
per use, JSX names are indexed and static blocks own scopes. Both adapters identify
unsupported kinds and recovered parser codes in coverage. Adapter identities are
bumped rather than reusing incompatible cached IDs. The new enrolled JS/TS
`lang/semantic/occurrence-roles` fixture passes under Node26 with two batch layouts.
This does not certify complete flow semantics for every newly preserved syntax form.

Resume inventory is also restored before the existing global tree-sitter planner,
so validated completed files do not get reparsed there before ordinary cache replay.
The pass keeps compact locators only, validates sources/parts one file at a time,
and leaves missing/corrupt/changed files on the existing scheduler.

J5 CFG producer 5 preserves contiguous optional-chain guard regions, including
computed keys and argument side effects, while parentheses terminate the region.
Labeled break/continue now traverse enclosing finally blocks, and for-of/for-in
evaluate their source expression once rather than on every backedge. Iteration
values retain an explicit unknown origin instead of equating them with the whole
iterable. The bounded `lang/semantic/control-regions` fixture passes. Destructuring,
iterator protocol/cleanup, per-iteration capture and broader completion semantics
retain their stated frontiers.

B1/B2 now retain checker-authorized DataView construction/read/write and typed-array
set inputs, including offset, length and endianness expressions, plus modeled
read/write/copy/mutation relationships. WASM export and memory-growth requests have
explicit unknown result values linked to source consumers; growth is a may-mutation
with unresolved old-view epochs. Browser Worker response sends link to every
source-qualified main-side registration for the corresponding literal entry.
The model preserves uncertainty about instance identity, correlation, registration
order, actual delivery, conversion/traps and response transfer effects. Node workers,
MessagePorts, exact module artifacts and WASM module-body analysis remain open.
The extended bounded Worker and boundary/storage fixtures pass under Node26,
including shadowed platform-name counterexamples. No target module was executed.

The second implementation round adds checker-authorized browser MessageChannel
endpoint pairing through const aliases. Opposite-port sends retain one-to-many
message consumers and response candidates; unrelated constructors never pair.
All payload/options inputs and clone requests are preserved, with start/close,
transfer, runtime instance and delivery uncertainty explicit. The bounded Worker
fixture passes with forward/reverse and separate-channel counterexamples.

CFG producer 6 evaluates parameter defaults only on the undefined-input branch,
in declaration order, retaining the existing rest/pattern/frontier limits. Explicit
throw payloads now reach the catch binding value rather than disappearing at the
handler boundary; failures inside catch route outward through finally. The focused
control-region and compiler-flow fixtures pass, including an actual payload edge.

Source-path/identity discovery also accepts a nonempty half-open UTF-16 range.
It filters the indexed source bucket under the existing work and cursor limits,
including overlapping enclosing operations, without an unbounded fact scan. The
focused artifact/SQLite fixture passes boundary, absent-range and invalid-range
cases. This is bounded interval filtering, not a new interval-tree index.

Structural fingerprint projection 2 hashes bounded, verified retained literal text,
so equal-shaped `1 + 2`, `1 + 3` and `0x1 + 2` are distinct without claiming numeric
or behavioral equivalence. Missing/oversized source projections remain incomplete;
integrity failures propagate. SQLite public queries use retained excerpts only after
matching their partition inventory to the artifact generation. The tiny literal
fingerprint fixture passes; binding/type/effect constraints remain separate.

Compiler binding producer 3 retains callable-union signature alternatives instead
of collapsing them to one checker-selected signature. Unmapped alternatives remain
partial and cannot authorize unique parameter mapping or callee-summary reuse.
Tagged-template substitutions preserve source operand ordinals separately from
runtime parameter offsets; the implicit template object remains an explicit unknown.
CFG producer 7 retains tag exceptions and call-effect routes, and call-flow producer
4 preserves the unmodeled cooked/raw template channel. The focused compiler-invocation
fixture passes; full production compiler and cross-file qualification is deferred.

Recovery copy reservations now remain charged until owned staging cleanup finishes,
and a cache object promoted before a directory-sync failure keeps its byte charge.
Completion replacement reserves the full coexisting temporary descriptor, while an
identical descriptor is reused without new credit. Replacement/failure reservations
are deliberately conservative until reopen reconciles actual bytes, avoiding double
credits from duplicate writers. The focused recovery fixture covers rejection before
replacement and cleanup after partial cache copy.

Derived replay and deferred task policy identities now include the same producer
versions used by compiler, flow, Worker, boundary and LSP partition writers.
Analysis-affecting path/language overrides also invalidate derived replay; resource
budgets and physical layout leave syntax extraction intact. Context-free deferred
coverage no longer bypasses analysis invalidation merely because it lacks a compiler
context. Syntax and known structural ownership remain independently reusable.
The focused analysis-version identity fixture covers these invalidation boundaries.

The first hosted run of this continuation stopped at a stale workflow contract
requiring Node 24 despite `.nvmrc`, package engines and CI already selecting Node 26.
The bounded repair updates that major-version assertion without changing the exact
patch pin or weakening workflow/cache-key consistency checks. Full CI remains a
separate gate; this repair is qualified by the focused workflow contract only.

### Sparse resumed sequence ownership (2026-10-10)

The next R4 recovery slice compacts the existing sequence ledger by actual expected
IDs, preserving the dense hot path while removing numeric-span allocation and gap
scans. Journal replay, batch draining, cancellation and lease reclamation use the
same sparse identity set; backpressure windows count admitted ordinals rather than
the size of numeric holes. Lease-attempt exhaustion fails before an old identity
can wrap and become current again. The new sparse-resume fixture uses three IDs
spanning 2^48 without allocating or iterating through that range. Six focused
Stage1 ledger/replay/backpressure/duplicate/retry fixtures pass through the normal
test runner after a complete verified cloud bootstrap under Node 26.11.1.

### Class-definition flow (2026-10-10)

The next J5 slice retains runtime heritage, computed member keys and static
field/block initialization in class declarations and expressions, including
exception routes through enclosing catch/finally. Computed keys run before static
initialization; instance field initializers and method bodies are not evaluated at
class definition time. Ambient, declared and abstract-only members are erased.
Class storage/private/self-binding and decorator effects remain explicit unresolved
frontiers. The shared CFG producer version is 8, invalidating old derived replay
without changing syntax identity. Class-order, existing control-region, persisted
reaching-definition and producer-invalidation fixtures pass after verified cloud
bootstrap (four focused checks; no broad semantic qualification claimed).

### Generated semantic contract documentation (2026-10-10)

The next hosted gate exposed stale generated contract-drift output and eleven
semantic artifacts omitted from the artifact registry. Their canonical schemas
are now documented and the generated report is refreshed. Earlier author-workspace
receipt paths are explicitly historical local evidence, not files promised in a
clean checkout; no receipts were fabricated and the path-integrity audit remains
unchanged. The isolated cloud checkout completed `npm run bootstrap:ci` with
required-native verification and recorded readiness before the focused tests above.

### Required bootstrap readiness (2026-10-10)

Normal CLI/TUI, legacy build/search, API/MCP/indexer entry points, the test/CI
runners and direct benchmark executables now gate dependency-heavy imports on
verified bootstrap readiness. An absent/incomplete/stale setup prints a prominent
`BOOTSTRAP REQUIRED` diagnostic with `npm run bootstrap` and the lockfile-pinned
`npm run bootstrap:ci` alternative, then exits before workload admission. This
includes linked CLI entry points and does not install anything automatically.

The existing patch and required-native verification paths produce an atomic
receipt only after successful verification. Current setup/lock/patch hashes,
Node/ABI/platform identity and bounded dependency artifact metadata are checked
on launch, followed by the existing real SQLite query and tree-sitter activation
probes. A marker alone is insufficient; no full setup or native rebuild runs on
ordinary invocation. CI cache restoration explicitly re-verifies readiness.
The dependency-free readiness fixture exercises missing, incomplete, changed,
unusable and prepared states plus normal/test/bench entry admission, without
starting an index or benchmark. Existing patch/native and workflow contracts
remain focused checks; broader runtime/platform qualification is deferred.

The recovery continuation adds corruption-local cache repair, successful empty/disabled
lane replay, and first-admitted duplicate-result ownership during awaited application.
Reopening charges retained builds, incremental caches, pending/corrupt parts and the
frontier store before new semantic credits; overlapping paths/hard links are counted
once. New immutable ordinary snapshots reserve encoding space before writing.
The cap is deliberately conservative, including retained ordinary build artifacts;
there is no implicit cache deletion to satisfy it. Full concurrent transient-byte
accounting remains open. The ordered appender now validates the existing ledger's
owner and attempt token before admitting a worker result; stale retry owners are
ignored without replacing the active result. The lightweight fixtures
also exercise a higher-cap retry and sparse, out-of-order duplicate application.

Status: **in progress; compiler/value evidence, offline runtime import and durable
binding lifecycle integration** on `codex/semantic-indexing-20261010`, descended
from PR547 head `5d33a0a2c3d9e336bc64d85926a4afd0fef57118`. Astra MEDIUM leads
shared integration with the same two approved GPT-6.1 Sol MEDIUM helpers. No new
helpers, merges, captures, corpus restart or benchmark campaign. The current human-authorized
publication span includes a normal push of this implementation branch; no PR retarget or merge.

Compiler-readiness checkpoint (2026-10-10, following aa3cb888): shared preflight and
Program callbacks now preserve per-occurrence import/require modes, conditional
exports and development conditions, type-reference modes, referenced-project options
and original-container/VFS authority. The complete context-qualified source closure,
including configuration SourceFiles, is hash pinned and admitted before Program/checker
construction. Unknown automatic cost defers; explicit work reserves the configured
ceiling. Compatible completed receipts supply elapsed time and process-wide high-water
RSS with headroom, subject to scheduler tokens and byte caps. These are conservative
admission decisions, not hard memory or synchronous-call timeout guarantees.

Finite Node26 readiness checks pass: enrolled resolution construction (333ms), admission
construction (189ms), tiny eager build, combined NodeNext/Bundler referenced-project
and embedded-source build, over-budget durable deferral with no completed tasks, and
published measurement/positive-negative sealed-probe checks. Initial checks found an
unset scheduler-cap interpretation and omitted referenced-config SourceFile; both were
corrected before passing. A temporary budget assertion used the wrong reason spelling
and was corrected; the production decision was already correct. No broad qualification,
crash campaign, native-worker diagnosis or benchmark was run. The operating guide and
generated inventories are refreshed. Further flow and production qualification remain
parked after this bounded publication checkpoint.

Repair qualification after `8ad892e4` (2026-10-10): the existing two helpers and
lead ran bounded Node26 selections with 30-second test limits, zero retries and
`--native-status-redo=false`. Fixes reconnect field writes/reads to the heap-flow
ledger (flow producer 4), recognize checker-owned Node web-global timer declarations
(boundary producer 2), revalidate leases before publication, normalize Windows probe
result paths, and make deferred coverage partitions source-qualified and replay-safe.
The runner now exposes the explicit native-redo switch; default behavior is unchanged.

Focused query/storage, call-summary/flow/boundary, phase drain, cancellation, expired
lease/restart and publication recovery checks pass. CLI/MCP/HTTP detail, find, explain
and trace are exercised; these public-service fixtures disable workers to isolate
query contracts. NodeNext/Bundler/project-option/VFS resolver constructions pass.
The worker-enabled embedded cold/warm mapping fixture passes (13.9s). The compiler
cold/warm fixture passes with workers disabled and an explicit bounded 2 GiB fixture
allowance (19.2s); its default 512 MiB allowance correctly deferred warm work after a
process-wide high-water receipt. Warm assertions now compare actual bindings and
call targets rather than require redundant task completion.

**Pre-bootstrap native investigation.** Normal worker-enabled compiler builds intermittently
produce raw `3221225477 / 0xC0000005`. A ProcDump capture with the matching official
Node26.8.1 PDB shows `C0000374` heap corruption in V8 free-list/page release during
worker-isolate disposal. This identifies the failing native operation, not the
origin of the corruption. Ready workers also fail; isolated import/startup and pool
teardown probes pass. Serial termination and optional-native-module isolation do not
reliably prevent the failure. No worker mitigation or runtime/hardware/ABI blame is
claimed. A final normal worker-enabled compiler cold/warm run passed in 20.3s
(historical local receipt `.testLogs/run-1791636659811-fsz05n`); that isolated pass and the embedded pass do
not close the preceding intermittent failures. Repository bootstrap, apply-patches,
native repair/verify and `npm run verify` were not run in this repair span. The local
Node26 SQLite provision is not evidence that those prerequisites completed; native
attribution remains provisional pending their validation.
Receipts, matching symbols, dump and analysis are retained under
`temp/semantic-indexing/native-repair-*` and the original `.testLogs` attempt paths.
Historical local qualification inventory: `temp/semantic-indexing/repair-qualification.json`.
No full CI, broad benchmark, automatic capture or feature expansion was run. Five
additional storage cases and broad release checks remain unrun. This is a bounded
repair handoff with a native blocker, not completed frozen-spec acceptance.

Setup and rerun checkpoint after `49b42e7f` (2026-10-10): the lead completed
`npm run bootstrap` under Node26.8.1/npm11.19.0, including dependency install,
repository patches and native rebuilds. Explicit patch confirmation, native repair
and native verification then passed; all required native packages are loadable.
The optional sharp package was absent and skipped. Bootstrap aligned the installed
Piscina from 5.1.4 to the already-declared/locked stable 5.3.2; the manifest and lock
required no Piscina version change. Dependency alignment is not attribution of the
prior heap corruption to a particular package.

The user authorized review and approval of npm's install-script warning. All 48
listed package instances were reviewed and covered by 47 unique version-pinned
`allowScripts` entries. `npm install-scripts ls --json` now returns no pending
approvals; future package versions are not blanket approved.

The 11 enrolled setup/rerun checks all passed, with no failures, timeouts, skips or
retries, using jobs1, 30-second per-test limits and `--native-status-redo=false`.
Normal worker-enabled compiler cold/warm bindings passed in 20.5s and embedded
source mapping passed in 14.8s. Admission, lifecycle, publication recovery, compiler
flow, boundary flow, phase drain, Perl native reset, native scheduler and the
CLI/MCP/HTTP semantic trace service checks passed. Query/phase fixture worker
isolation remains as documented above. Original failure receipts and dump remain
preserved. The earlier native failure did not recur in these requested reruns;
its exact corruption origin remains unidentified. No further crash diagnosis,
full CI, `npm run verify` or benchmark campaign was run after setup.

Historical local setup receipt: `temp/semantic-indexing/setup-qualification.json`; exact rerun
historical local results: `temp/semantic-indexing/setup-rerun-results.json`; runner receipts:
historical local `.testLogs/run-1791637522302-3st86l`. Lead-only continuation; the existing helpers
remain held. This is a bounded setup/repair checkpoint, not frozen-spec completion.

Implemented with focused evidence:

- Source-owned JS/TS structure, exact UTF-16 coordinates, retained immutable source,
  ordered operands and separate chunk ownership. Inference views do not delete
  canonical facts. Portable per-file syntax cache sidecars and all three SQLite
  ingestion routes preserve canonical records.
- The existing grouped TypeScript Program/checker now emits immutable context-bound
  bindings, alias chains, external declarations, constructors and per-occurrence
  argument-to-parameter edges before heuristic resolution. Source hashes must match;
  one document node index replaces repeated target scans. Legacy type inference
  can remain disabled. Unresolved compiler bindings are not upgraded by name matching.
- A conservative value slice records immutable definitions, reads, lexical captures
  and structured packing. Checker-matched default-library models distinguish
  typed-array view/copy relationships and message dispatch/transfer requests.
  Local CFG and mutable reaching definitions are now retained; field-sensitive
  effects, dynamic realms and observed delivery remain explicitly incomplete.
- Sorted JSONL/offset query indexes and generation-pinned detail provide bounded
  record, argument, name and ownership hydration with artifact/SQLite parity.
  Artifact/SQLite trace parity and public CLI/MCP/HTTP integration pass focused checks.
  Query coverage retains partition provenance and separates extraction, analysis
  and response limits. See the [operating guide](../guides/semantic-index.md).
- Explicit saved Inspector CPU-profile and versioned code-log interchange adapters
  publish immutable standalone runtime families with content-addressed raw inputs.
  Capture/runtime/build/workload identities, missing mappings and code lifetimes
  stay separate. Import never executes or attaches; arbitrary V8 text logs and
  independent runtime-to-source overlays are not yet supported.
- Source-pinned binding task descriptors use a dedicated transactional control DB,
  exact task leases and the existing relations scheduler. Manual/absent-control
  paths stay deferred; completion receipts are acknowledged after whole-generation
  promotion. Production fresh/warm builds and crash-recovery integration pass focused checks.
  Cached old-generation task descriptors cannot be silently relocated.

Current follow-on slice adds local CFG/reaching definitions and merge values, guarded
optional/nullish/switch paths, exceptional/finally routes and per-call return channels.
The virtual compiler host resolves retained repository imports to existing Program
SourceFiles, so renamed imports reach actual library declarations. Unsupported
heap/context/async effects remain partial. Targeted LSP locations and exact embedded
source/cache/ownership transport now persist evidence sidecars. Runtime family lookup
and bounded observation queries are exposed through CLI/MCP/HTTP (MCP schema 1.4.4).
Local/cross-file deferred descriptors survive control-store reopen.

Focused Node26 receipts: CFG 2.50s (`run-1791627361546-6m1mp9`), virtual imports
0.315s (`run-1791628134948-kuy2zh`), deferred lifecycle 1.87s
(`run-1791627719531-dh7z7i`), LSP 1.80s (`run-1791628089207-hgbpj2`), runtime
query/public/storage checks passed (`run-1791627901223-zhoakn`,
`run-1791628031363-6703ap`, `run-1791627695885-q29r54`). Production compiler
fresh/warm passes 12.823s and embedded fresh/warm passes 9.600s with fixture worker
pools explicitly disabled. These checks do not establish default-worker stability.

Native exit 3221225477 / 0xC0000005 recurred on both attempts in
`run-1791627691446-9vx75b` and embedded run `run-1791627866233-p1fldx`.
Parent-owned durable failure receipts now preserve exact runtime/executable, redacted
arguments, PID/times, raw status, output and last observed phase; focused receipt
fixture passes (`run-1791627501203-cee281`). The last observed marker was worker-pool
teardown; the cause remains unknown. A passing retry is not resolution.

The next integrated slice adds conservative allocation/field candidates with shared
const-alias identities, explicit getter/dynamic/depth frontiers, and finally return
suppression. Published local/cross-file task descriptors now reconstruct after control
DB loss; zero attempts perform no execution (three focused checks pass in
`run-1791628873221-bzv3md`). Saved-capture comparison and immutable derived-claim lookup pass 3/3 focused checks
(`run-1791629091229-6tjn5e`), with old lookup/MCP/recovery regressions 4/4 passing
(`run-1791628890722-cxk5te`). MCP is now 1.4.5. Comparisons require matching saved
identities and only describe source-location sample counts; no causal/rate or timing
equivalence claim is made. Literal source-resolved Worker entry/message-consumer links pass the actual Program
fixture (2.234s, `run-1791628938583-zqui9n`) and worker-disabled production publication
plus paginated artifact/SQLite trace parity (10.032s, temporary receipt
historical local `temp/semantic-indexing/compiler-worker-production-validation-2/receipt.json`). Fake
platform names, dynamic entry URLs and direct shared/transferred payload counterexamples
remain explicit. The first production assertion failed by inspecting only one bounded
page; the corrected fixture drains opaque continuations and compares canonical evidence.
No default-worker retry was used. Final flow check passes 0.907s
(`run-1791628974873-ggpejl`). Final review corrected receiver boundary realm
direction; its explicit assertion passes 2.56s (`run-1791629291540-wfnu34`).
The revised CFG pass uses analysis version 2, preserving schema1 and invalidating
only its derived partition identity.

Artifact surface **0.1.0**, SQLite **15**, semantic schemas **1** remain the exact
cutover. The reader audit covers artifact/state/pointer/cache/bundle/SQLite paths,
metadata-only probes, worker propagation and public format diagnostics. SQLite
compaction preserves semantic tables in bounded batches; shared semantic-mode
compaction rejects explicitly pending safe multi-mode remapping. Full rebuilds use
a fresh current-format namespace without migration or deleting originals.

Node 26 focused receipts this span: compiler/alias/shadowing/parameter/capture/value
witness passes 8.29s (historical local `.testLogs/run-1791625377755-qpzgph`); stale frontier cache
rejection passes 1.11s (historical local `.testLogs/run-1791625486576-jaeghz`); cutover gate passes
1.55s (historical local `.testLogs/run-1791625373735-wpze63`); semantic compaction parity passes
2.05s (historical local `.testLogs/run-1791625477486-0dwxnt`); public format/detail errors pass 23.9s
(historical local `.testLogs/run-1791624572615-fzhb4w`). The stricter production completion assertion
caught Windows path-case acknowledgment failure (`run-1791625737698-qt3i26`);
the corrected fresh/warm fixture passes 13.0s (`run-1791625932165-z9oiju`). A native access
violation (3221225477) recurred once in `run-1791624392362-it00uc`, then the runner
retry passed; the native fault remains undiagnosed. Final trace public surfaces pass 12.0s (`run-1791626223683-8ojsre`), and
indexed artifact/SQLite trace parity passes 5.48s (`run-1791626204277-az8do3`); runtime import
passes 4/4 (`run-1791624970201-cy7yks`), canonical import CLI passes
(`run-1791625972821-or578j`), and binding lifecycle/recovery passes 3/3
(`run-1791625965364-lckhod`). Prior MCP snapshots were intentionally updated to schema
1.4.3; both checks pass (`run-1791626136790-3xvdov`). Repository formatting and the
command surface audit pass. Broad suites remain unrun.

Code-first continuation after `7812f84a` (2026-10-10, **implemented but unqualified**):

- Cross-file return dependencies now use bounded monotone SCC summaries over existing
  local-flow records. Each call retains its own result value; trace state balances
  invocation and compiler-context crossings. Spread positions, iteration/work limits,
  unknown effects, exceptional contracts and incomplete local flow remain frontiers.
- Derived operation lookup has uncompressed sorted artifact/offset indexes and SQLite
  expression indexes, with exact syntax selectors and indexed target-candidate lookup.
  Bounded ordered structural comparisons and evidence explanations keep candidate
  similarity separate from binding identity or behavioral equivalence.
- Ordered language/path policy overrides, source-pinned target selectors, separated
  policy identities and shared semantic writer-byte admission are wired through extraction,
  compiler/LSP and deferred-work planning. Scheduling does not trim syntax facts.
- Plan/enqueue/manual-drain coordinator code uses the dedicated control store and the
  normal whole-generation build publisher. **Drain is blocked for existing source-only
  tasks:** their immutable descriptors do not seal complete compiler/config/module
  resolution dependencies. Do not execute or supersede those tasks as exact completion.
  The future verified drain route may rediscover/reparse source; targeted parse reuse
  is not implemented.
- Find, explain and enrichment schemas, services and standalone surface wrappers exist.
  Public catalog/router/command registration is deliberately pending parity qualification.
  Existing advertised semantic detail/trace surfaces are unchanged.

This span is code-first: `npm run format` passed; Node26 syntax checks passed for all
60 changed/new JavaScript files; schema and integration imports passed; `git diff
--check` passed. All four unrelated workflow file hashes were preserved. New
`indexing/semantic/call-summary-context` assertions and extended
`storage/semantic/trace-parity` discovery assertions are written but **not run**.
No production rebuild, native-crash investigation, broad fixture campaign, benchmark,
MCP/API qualification or full frozen-spec acceptance is claimed. Prior crash receipts
above remain unresolved. Qualification must precede advertising the new operations.

Continuation after `731249ad` (2026-10-10, **implemented; qualification deferred**):

| Area | Current code | Unverified or missing |
| --- | --- | --- |
| Deferred compiler authority | Immutable task target sets now include a bounded resolver/config/library/package probe inventory, all ordinary source-root hashes, negative lookups and loaded compiler-module receipt. The dependency hash participates in task/policy identities, lease readiness, plan/enqueue/drain admission, prepublication and recovery checks. The existing Program uses a closed host; unrecorded or changed probes and VFS roots reject rather than yield completion. | Only a small compiler construction sanity ran. End-to-end drain, restart, stale dependency, grouped project and race qualification remains. Embedded/VFS preflight is deliberately unavailable and leaves a deferred task. Unhandled resolver probes stop execution; no claim of general resolver coverage. |
| Compiler reuse | Configuration helpers are shared with the existing provider. Preflight uses TypeScript preprocessing/resolver APIs, never a second Program. One recorded inventory is shared across policy groups; conflicting observations reject. Package models use sealed reads. | Preflight currently loads the compiler and walks dependency text even for deferred bindings. Avoiding that startup through valid cached authority, cooperative admission/cost calibration, broader virtual-source support and resource integration remain. |
| Execution boundaries | Checker/library/package-qualified callback and Promise continuation, child-process/IPC, and WASM/native-entry models supplement the existing Worker/storage path. Source-backed model evidence retains dynamic entry, activation, scheduling, delivery and memory uncertainty. | New boundary fixture is written but unrun. No observed process execution, delivery, callback activation or WASM/native implementation claim. General interprocedural heap/effect/exception/context summaries and target-dependent paths remain incomplete. |
| Agent follow-up loop | Explain projects bounded exact source pins and immutable task suggestions with strict plan/enqueue requests; suggestions never invoke execution. The explicit enrichment service revalidates authority. | SQLite explain lacks the portable source/frontier iterator and reports unavailable. Find/explain/enrichment wrappers remain unadvertised until artifact/SQLite and public-surface parity passes. Trace-to-explain remains an explicit client follow-up. |
| Runtime evidence | Exact adapter inventory distinguishes saved Inspector CPU profiles from the versioned saved code-log interchange. Parser projection version 2 adds feedback/IC/map/type, inline-frame and deopt facets with capture-scoped code/map lifetime checks and explicit incomplete joins. | No arbitrary native V8 text parser, automatic capture/attachment, cross-artifact lifetime resolver, secondary inline/map lookup, complete source-map/inlining joins or independent runtime overlay. Fixture qualification is deferred. |
| Operation discovery | Indexed syntax/target candidates, ordered fingerprints and SCC return-dependency summaries from the prior span remain implemented. Analysis policies and input hashes invalidate derived partitions. | Rich effect/type/shape constraints, complete field/context sensitivity, operation-summary/vector projections and their independent model/projection cache qualification remain. Similarity is never behavioral proof. |

Validation for this publication span is limited to syntax/schema/import/lint and one small
compiler-construction sanity. Initial sanity failures exposed undefined TypeScript option
serialization and missing library-package probes; both were corrected before the final
sanity pass (52 compiler source files / 358 sealed probes). Repository formatting,
23 Node26 syntax checks, strict schema/integration imports, scoped lint and whitespace
checks passed; all four unrelated workflow hashes remained unchanged. The new boundary
fixture is enrolled in the integration lane (list-only; the initial unit/default preview
selected none). TypeScript provider cache version is 2.3.0. Correctness fixtures,
public parity, deferred drain/crash qualification, broad tests and benchmarks remain
**unrun**. Earlier passing receipts above belong to their stated revisions and do not
qualify the changed compiler host. The default-worker native access violation remains
unresolved and was not investigated or retried here.

Core integration after f7775576 (2026-10-10, **implemented; qualification pending**):

- Compiler preflight and execution now share exact VFS document selection, container-relative
  module resolution, retained embedded source/container hashes and project-reference inputs.
  The existing grouped Program receives project references. Source context and compiler
  provider version **2.4.0** invalidate prior provider output; unsealed probes still reject.
  Older task authority descriptors without the new VFS inventory cannot drain; rebuild
  from source to create current descriptors. No task conversion or relaxed authority fallback.
- Binding, local-flow and cross-file tasks are frozen before execution. One scheduler-admitted
  compiler pass leases every selected phase, verifies actual per-source output before receipts,
  and rolls back unpublished descriptor selection on cancellation/incomplete output. Manual
  drain supports exact selected localFlow/crossFileFlow tasks through normal fresh-generation
  promotion, with source/input/policy lineage. Recovery additionally requires actual phase
  coverage for every acknowledged source. Targeted parse reuse remains unimplemented.
- Flow now includes checker-owned field paths, weak field versions, explicit throw-to-catch
  payload routes and bounded recursive effect/exception summaries. Caller-owned modeled
  effects retain source evidence. Aliases/accessors, implicit exceptions, constant effects,
  parameter-field widening and async/constructor/spread contracts remain explicit partial
  frontiers; these are may-dependencies, not unique runtime producers or proven delivery.
- Artifact and pinned read-only SQLite find/trace/explain share source/frontier hydration
  and receipt-aware coverage. Completed work suppresses only matching deferred markers;
  real partial analysis remains partial. CLI/MCP/HTTP find/explain/enrichment registrations
  are now wired and explicitly experimental/pending qualification (MCP **1.4.6**).
  SQLite selection currently requires generation/index-sqlite/index-code.db; custom/shared
  mutable database layouts are unavailable. Enrichment defaults to plan; explicit task IDs
  are required for enqueue/drain. No runtime capture is launched.

Sanity evidence: Node26 small eager builds published phase receipts for an ordinary source,
retained Vue script and referenced TypeScript project. An explicit manual drain of selected
local/cross-file phases published a distinct generation with both lineage receipts. These
are construction/build sanity checks, not the acceptance fixture campaign. Initial sanity
failures found unsupported config chunks without retained VFS text, a missing explicit
manual task selector and Windows repository-path casing; these were corrected. The first
HTML probe did not establish embedded extraction, so a Vue script was used for that check.
The final field/exception construction first exposed an undefined per-owner coverage
set; after correction it published all three phase receipts. Repository format, Node26
syntax checks and scoped lint for 39 JavaScript files, shared imports and all four
unrelated workflow hash checks passed.
The new phase-drain production fixture is enrolled in integration (list-only); new/expanded
flow, coverage and parity fixtures remain **unrun**. No benchmark, native-worker rerun,
full correctness campaign or race/crash qualification occurred.

Remaining core work and acceptance:

- **Astra core owner:** refine complete project/resolver authority for additional TS resolution
  modes and enforce measured pre-production resource admission without weakening closed-host
  rejection. Preserve exact virtual mappings and independent phase coverage. Remaining flow
  work includes robust heap/accessor/unknown effects, implicit exception/finally behavior and
  richer recursive context contracts. Do not label current may summaries complete SSA.
- **Qualification owner, staffing still requires approval:** run enrolled phase-drain,
  call-summary, compiler-flow, boundary and artifact/SQLite query fixtures with repository
  previews and the 30-second per-test rule. Add dependency mutation/negative probe,
  stale completion, lease loss, publisher race, restart and failure-injection receipts.
  Establish real CLI/MCP/HTTP and SQLite parity before removing experimental labels.
  The earlier native access violation remains unresolved and is not part of this pass.
- **Deferred extensions:** runtime native/source-map/inlining joins, richer operation/vector
  projections, giant-file partitioning and independent overlays. Syntax-walk fusion,
  cached preflight startup avoidance and broader LSP/provider coverage remain separate
  implementation work. None is disguised as a verification-only item.

The full frozen specification is **not complete**. This branch is reviewable implementation
work with explicit remaining frontiers, not release readiness. The ignored temporary task
tracker retains coherent package ownership, dependencies and acceptance instructions.

## Archive retrieval and CPU qualification - 2026-10-09

Completed work and original receipts: [October 9 checkpoint](../archived/archive-retrieval-checkpoint-2026-10-09.md),
[CPU trial](../guides/eg2-representative-cpu-trial-20261009.md) and [current archive policy/gates](../guides/archive-pipeline-integration-20261009.md).
The old corpus job stays stopped; authorized cleanup removed legacy derived vectors,
preserving original DATs/source units. Old throughput/ETA applies to the old policy.
Frozen diagnostic v3 plan: 422,794 inputs / 135,924,462 tokens; 24 large-source checks pass.

Remaining ordered gates:

1. Bounded source-plan reuse and seven no-model checks passed. SCIP definition/reference
   classification is corrected with independent role flags and focused mask/count tests.
2. One current Kingfisher CPU benchmark passed in 8m23s with real dictionaries and valid
   persisted 384-dimensional vectors. Declared natural-sentence sparse-only queries had
   zero target recall under documented implicit AND; semantic retrieval remains unmeasured.
   [Exact verification and limits](../guides/kingfisher-cpu-verification-20261009.md).
3. Fresh archive import/reopen/original guards passed: 87,973 records, zero gaps and
   1,675,434 effective words. Exact current plan: 422,836 inputs / 135,932,568 tokens.
   Current-policy native qualification passed admission, finite normalized vectors and durable replay; semantic source recall@10=1, anchor recall@10=0.875 under the unit-citation contract.
   Measured 270.8 useful tokens/s; approximate full-token extrapolation 139.4h is uncertain.
   First bounded slice persisted 100 units / 555 vectors; read-only reopen passed after a reporting-heartbeat failure. Ranking/citation selection limits product quality; CPU only.
4. [Acceleration and selective-embedding experiment](../guides/archive-selective-embedding-20261009.md): native inference is 95.4% of wall; source/input/anchor ranking misses are diagnosed. Statement/copy fixes pass. A bounded 297-input /49,997-token held-out slice completed; expanded lexical + selected fusion anchor recall@10 is 0.667 versus lexical 0.583, cheap graph adds no gain. Existing guarded context recovers the secondary wrong-span anchor; primary candidate-ranking miss remains. Full corpus remains stopped at 100 units /555 vectors; selector is not activated.
5. Qualify numerical/relevance/kernel dispatch before graph promotion. W8 is not promoted.
   Search scaling, output-copy/statement reuse and parent-death lifetime retain the detailed
   acceptance gates in the linked checkpoint; alternative engines remain research.

No GPU, arbitrary installs or unrelated measurements are implied. PR547 publication is
approved; merge remains unapproved. Hosted results apply to exact heads.

## Viewer replacement after embedding qualification - 2026-10-09

The owner requests new visuals, interactions and renderer implementation. Keep this
behind the current Swift/archive embedding setup. Compare fresh Three.js with custom
WebGL2 on representative measured cases before backend selection. Address actual
semantic shapes/stacking, selective directed edges, semantic zoom, scalable graph tiles,
and the supplied truncation/aggregate/shape and geometry/fog/disposal findings.
[Deferred viewer queue](../guides/viewer-replacement-queue-20261009.md) preserves the source
plan and acceptance boundary. Defuddle remains optional future offline HTML cleanup;
no dependency or network fallback is added now.
