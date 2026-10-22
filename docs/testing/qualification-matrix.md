# Platform and performance qualification

Audited: 2026-10-22. Source contracts and workflow definitions describe required
behavior; a configured job is not evidence that the current candidate passed it.
Current execution evidence and unresolved failures belong to the
[deep test audit](../archived/deep-test-audit-2026-10-18.md) and the
[active roadmap](../roadmap.md).

The repair program targets Windows with Node 26.12.1. The recorded locked
bootstrap at source 8685a0dec verified 37 required packages and 33 language routes
without warnings or errors. That historical receipt does not qualify the changed
dependency inputs or current source; fresh locked bootstrap is still required.
Activation remains separate from runtime qualification. The last qualified
production/test source is d4dcba4134f6103e3a59703d90fdbde5ca54d09e. Later development
commits and authored regressions are unvalidated, with execution explicitly
deferred until the broad development pass is complete. The
[current issue receipt](../archived/github-issue-repairs-2026-10-21.md) records
the new snapshot, storage, embedding and lifecycle batches and their exact limits.
The last qualified batch added real native HNSW backup recovery and LanceDB payload
admission, controlled writer/rollback/cleanup faults, and UTF-8 stream boundaries.
The actual release contracts phase passes separately from full release acceptance.
At the user's request, new authority fixtures use ordinary filesystem controls
and injected link metadata without elevation or creating links. The existing
49-case physical-link cohort is optional capability qualification for this
program, not a completion prerequisite or a claimed pass. Historical Linux and
physical-link results below retain their original source and scope; no new Linux
execution is part of this program.

## Current implementation awaiting qualification

| Owner | Authored source and regressions | Required proof still outstanding |
| --- | --- | --- |
| Subprocess/native job ownership | Exact tracked-child close, original cache-writer closure functions before lease invalidation, retained API/MCP/semantic resources, pending-job retry/exclusion fences, original queue-handler/best-effort resource observations and coalesced lifecycle close flights, original simple worker methods and consumed async diagnostic rejections | Run real delayed-close and scoped barrier controls, authored client/controller negatives, Windows job containment and ConPTY; direct-child evidence does not qualify arbitrary descendants |
| Native database commands | Exact delegated entry/root/target admission; original database close methods and admitted-use drain, frozen/falsey failure ownership; subprocess input/error settlement and exact owned-service controls | Real canonical child operations, cancellation/fault/restart, supervisor drain, terminal lifetime and descendant settlement |
| Storage and provisioning | Actual Lua original archive/stage/temp/lock nested recovery and generic lock original write/stat prerequisites before native close; actual Zip/Tar/Tar.gz descriptor/entry drain and installer nested recovery, exact generic lock descriptor publication/sealed rollback, falsey runtime unwind/recording presence and independent replay/logger teardown, original pre-settlement observers, failed lease sealing/close evidence, actual transfer/directory descriptors and migration exclusions, exact destination-probe recovery, Go SDK/Windows prerequisite transaction identity, original response cleanup before official redirect admission, managed publication/removal and complete outer retry chains, producer-branded metadata retry and physical executable identity | Actual caller/cleanup/failure-receipt races, native observer and exact metadata retry, destination accounting, Windows permission owner, portable recipes and runtime lifetime; executable launch remains non-atomic |
| Semantic/editor navigation | Rust ordinary quoted const text/outer Unicode clause boundaries, wrapped writes/delete references and complete local-adapter2 source-linked report bounds; Haskell promoted/quoted type input consumers, Original Sublime deferred file/hit binding, VSCode opened-document file/URI binding and exact selected-root cache identity, scalar-checked coordinates and complete semantic-token chains, SCIP adapter2/lspBindings36/rq10, immutable requests/shared range budgets, source/container roles, typeNormalization4, SQL/R importResolution7, Python/C/ECMAScript sourceChunking10, quoted type/cache, paired parameter enclosures, Go tags, iterative symbol projection and own parameter admission, own argument keys/accessor reference roles/CFG execution ownership/callFlow24 and class aliases/computed property conversion/creation-context captures under compilerBindings19/cfgFlow22/valueSlice8 | Compiler/provider/grammar oracles, original query/cursor/schema negatives, cold/warm parity, actual editor/provider hosts, packages and remote topologies; name-only legacy locations remain unsupported source signatures |
| Index/retrieval execution | Required closeout and durable writer-exit fences; bounded token batches, complete lexical reuse, coalesced parts, selective BM25 facts and sealed cold SQLite filter pages | Independent numerical/content parity, original cursors/negatives, spill/merge quota faults, generic copy headroom and durable resume before resource/latency measurements |
| Embedding execution | Original reranker diagnostic/descriptor/consumer cancellation observations and pending fallback refusal; ordinal vector spool, cache-only admission, qualified output selection, exact ONNX/outer/prepared/generic output component and tensor retirement, accepted-work/reference/profiling drain, frozen warmup/query/downloader cleanup and LanceDB/local-reranker capabilities with original native-work tensor/session/tokenizer prerequisites | Real native/model correctness, rejected-disposal retry safety, actual GC/native child ownership and generic output memory, disk/cancellation faults, exact generation parity, peak RSS and end-to-end latency |
| Document extraction | Captured PDF destruction flights through bounded waits, accepted late loading/page work, current loading-task transport ownership, frozen page/cleanup causes and explicit queue/shard retry refusal | Actual pdf.js workers, full current-consumer propagation, native retry safety, Windows process/resource bounds, extraction quality and memory acceptance |
| Map presentation | Returned normal-texture ownership, async glass material assignment and explicit-false disposal admission; manifest-first transport/eviction, exact failed scene/environment/renderer resources after detachment, independent original observers, committed transaction truth, enhancement-generation/partial-construction ownership and stale fallback/source fences, cooperative search, incremental page-byte admission and optional spatial packets | Independent whole-envelope byte/cursor parity, actual browser/GPU correctness and release retry safety, admission/eviction faults, full server streaming limits, resource measurements and reviewed backend/default choice |
| Discovery/import reuse (#1238) | Actual discovery/preprocess/ordering forwards bounded private raw directory inventories; fresh original identity checks, delta scans, changed-subtree unknown results and stale selected-file refusal; importResolution7 | Run authored actual small-filesystem, mutation/read/abort/cap and synthetic10,000-row/budget controls; native Dir closure, real100/10,000-file workloads, retained heap, import parity and end-to-end latency remain unqualified |
| Rollout evidence (#683) | Current benchmark verdict/input contract, coherent counts and diagnostic parity, exact unavailable timing deltas, existing smoke/parity/delta assertions and actual report-producer roundtrip | Run authored direct/CLI/producer controls and full gate; input validation does not establish report provenance, paired workload equivalence or measured performance |
| Research consumers | Checked occurrence bags/finite models, retained lexical rename, paired owned motifs, immutable exact-source lens selection, saved work/task-span/paired-quality reports and bounded retrieval slices | Public/producer integration, independent domain/source oracles, behavioral transfer, complete world/closure admission and representative empirical qualification |

Resource bounds, import-count budgets and latency assertions establish different
properties. Preserve their existing thresholds. Performance qualification compares
equal retained facts/results, includes preparation/invalidation, keeps raw cold
and warm samples, and runs measured cases serially. No new speedup follows from
source changes, helper-only controls or smaller displayed pages.

## What exists

| Surface | Checked-in qualification | What it establishes |
| --- | --- | --- |
| Parser state and interrupted native workers (#630 partial) | Real Perl AST/chunk/cache controls, tracked C allocations and serialization, exact native patch round trips, ten fresh worker cases, strict ordinary-error negatives and seven original crash fixtures | Source b99c6c507 passes the same 76 selected checks and complete front gates on Windows/Linux. CDB with matching Node/binding/OS symbols attributes a separate `0xC0000409` fatal exit to throwing into a terminating worker environment; the patched binding retains normal error contracts and native tree ownership. Perl state, literal delimiter and allocation repairs retire old chunk meaning with producer 3. Clean Linux locked bootstrap and verification report no warnings/errors, 37 required packages and 33 activated routes. These bounded operations supplement activation; they do not establish a current full-deep pass, representative memory/latency or macOS/privileged-Windows acceptance. |
| MinHash family and stored identity (#662) | Supported-runtime 2,100-pair calibration, independent BigInt parity, coordinate/collision/ranker controls; actual workers, records, JSON/packed/stream, native SQLite/LMDB and piece assembly | Source cfc5cbf9a reduces aggregate calibration RMSE from 0.3401 to 0.0297 under the same 0.065 bound. Versioned family identity, incremental signature 12 and SQLite schema 16 reject missing/old hashes instead of mixing data. Lazy rows, one character read per code unit, filters and sampled coordinates remain covered. Windows and Linux pass the same 221 unique affected/contract cases and full front gates. This is empirical sketch qualification, separate from representative retrieval quality, real models and complete platform/deep acceptance. |
| Artifact enqueuer removal | Complete repository references, AST binding/export/declaration hashes and nineteen retained publication/cleanup/metadata cases on Windows/Linux | The private duplicate enqueuer has no callers; live cleanup text and all thirteen public exports remain unchanged. Direct local import count falls from 28 to 3. Actual writer, failure, transaction and immutable-generation assertions remain. Import budgets pass at unchanged thresholds; counts do not establish a latency gain or repair MinHash arithmetic (#662). |
| JS/TS export authority (#666) | Real parser/alias/scope controls; two native query/traversal/worker/cache cases; four actual indexed public-CLI cases and existing artifact/replay contracts on corrected Windows/Linux source | Explicit status/names survive symbol publication independently of kind. Inline/listed/aliased/named and anonymous default APIs remain visible; internal declarations, class methods and wrapper shadows do not become module exports. Unknown legacy/recovered identity warns and fails strict validation even with zero details. Native cache producer 2, incremental signature 11 and module-export producer 2 retire old meaning. This qualifies the exercised parser/artifact/API forms, separately from full language semantic precision and final deep/platform execution. |
| Zero relation-boost configuration (#663) | Real config/schema loading, CLI normalization and direct pipeline/scorer paths; existing relation/explanation/guardrail controls on Windows/Linux | Per-call, per-usage and maximum-cap zero preserve declared ranking and explanation semantics. Negative/nonfinite inputs consistently use existing positive defaults; wrong runtime types cannot coerce into zero. Disabled and default-positive behavior, hit membership and positive list lengths remain unchanged. A controlled sparse provider isolates scoring; persisted retrieval and representative workloads retain separate qualifications. |
| API warning detection and detail caps (#665) | Unit cap/count/schema controls and three independently bounded real-index public-CLI cases on Windows/Linux | A detected arity violation still exits 2 with zero retained details; clean zero-cap input succeeds without false truncation. JSON omission counts and Markdown detection/retention/omission summaries remain truthful, including legacy unknown counts. Symbol/call caps, strict warning errors and original queries/assertions remain; this does not establish export identity (#666). |
| Hit-list comparison metrics (#664) | Shifted/gapped/identical/reversed/null controls, real model-report CLI over controlled sparse indexes and actual parity CLI with an explicit response adapter | Spearman ranks are assigned within the distinct shared subset; overlap/missing membership stays separate. Actual consumers fail before repair with -127/-129 and an average of -128, then pass with 1/-1/null and average 0. Existing real-search parity and report-layout fixtures remain. Windows/Linux exact-source checks qualify comparison arithmetic and threshold plumbing, separately from neural model quality or representative workloads. |
| Dense-vector binary publication (#667) | Five real-file-handle cases plus existing ANN publication and three SQLite/embedding cases; exact-source Windows/Linux execution | Partial writes complete every suffix across physical chunks before fsync/promotion. Zero progress fails promptly; write errors preserve the previous destination, close handles and remove temporary files. Exact bytes, row order, metadata and the production loader remain asserted. Fault injection demonstrates the original low-level corruption; it does not claim observed user-disk corruption or qualify optional sqlite-vec. |
| PHPactor delivery, startup and native platform admission (#631 partial) | Immutable publisher PHAR/digest, real HTTP timeout/retry controls, redirect/checksum/size/DNS negatives, runtime byte/identity admission and Windows unsupported-platform admission | Actual Linux PHP 8.3.6 executes the approved server, acknowledges shutdown and exits cleanly; the reusable owner retains its exact upstream INFO line while rejecting duplicate/unclassified output. Current bytes are verified before version execution. Native Windows's mandatory POSIX limitation has its own guard owner; portable delivery remains tested. CI selects PHP 8.4.26 and requires Linux/macOS startup receipts; execution at that target remains separate from local evidence. No requirements bypass or automatic redirect approval supplies readiness. |
| Native repository search (#634) | Canonical schema-derived composer, real supervisor/CLI queries, ranked four-mode results, cursor/source/editor authority and thirteen separately bounded Windows ConPTY cases | Actual keys exercise real tiny-index search, pagination, empty/error recovery, cancellation, replaced queries, changed scope, confirmed inert editor launch, incompatible modes, truncated capture, narrow rendering, global interrupt and a controlled late handshake. The latter fails before the availability-transition repair and then initializes the already open form. Query/editor children exit, terminals restore and final jobs settle. Actual file-symlink authority has a separate 49-owner Windows cohort requiring a capable launch; Linux file-link controls have separate receipts. Source 208395791 additionally exercises an actual Linux memory query after native validation; additional Linux variants and macOS native execution remain separate. |
| Native job selection and inspection (#638) | Exact job/task identity, scoped logs, bounded results, opaque artifact inventories, descriptor identity/content checks and actual native open/copy/export/cancel workflows | All retained cases rerun at source 208395791 within 52 Windows and 34 portable Linux native cases, with 60 Rust tests and both complete front gates. Five action cases exercise confirmed trusted editor launch, clipboard path input, exact-byte export/no overwrite, stale/missing files, untrusted commands and child reaping through actual keys/supervisors. Explicit fixture launchers qualify the application handoff, separately from desktop services. Staging mutation fails before the integrity repair and passes afterward; disposal joins opened reads and old cleanup cannot delete a reused job instance. Actual Linux file-link rejection passes; capable-Windows links and macOS execution remain pending. |
| Native index workflows (#635) | Thirteen forms from canonical command/option owners; eighteen actual keyboard/supervisor/CLI cases on Windows and Linux, full default-stage producer contracts and retained settings/search/inspection coverage | Source 208395791 passes 234 unique Windows and 219 unique Linux selected cases; 216 IDs are common. One snapshot contract is deliberately executed in both core and gate, counted once. Preview/discard/confirmation, stale source edits hidden by overlays, reserved job identity, early failure ordering, real build/watch cancellation, all snapshot commands, positive source search, missing models/providers and process/publication separation are exercised. Full-build snapshots retain SQLite/HNSW/LanceDB, nested/empty directories and verified bytes. Stats honors declared SHA-1/XXH64 and unknown sizes while retaining corruption negatives. The sparse stage control has explicit optional-artifact/LMDB advisories; it does not qualify embeddings or LMDB. Real-model, full deep, macOS and release acceptance remain separate. |
| ConPTY transport and disposal | Installed bridge over real pipes, a deterministic queued-FIN failure on the preserved original worker, ten independent fresh-process cases per platform, patch reverse/reapply identity proof and two-operation bootstrap probe | The patch drains late output after reader detach, closes its listening endpoint and captures console children before closing the console. Each fresh case observes two natural real PTYs plus owned cancellation; no forced parent exit or retry counts as success. Unexpected transport/initialization errors remain failures. Windows ConPTY and Linux PTY executions remain separate; these bounded lifecycles do not qualify every runtime or workload. The Node 26.8.1 RealmCppGC access violation retains its separate debugger attribution and current Node runtime policy. |
| LSP child disposal | Real stalled-initialize Linux control, delayed exit delivery from actual owned children, concurrent cleanup/restart and bounded unobserved-exit negative | Awaited cleanup joins child-handle exit observation, not successful signal delivery. A late old exit releases only its own tracking and preserves replacement requests; an unobserved exit remains tracked and reports failed termination. Windows/Linux focused evidence is separate from full platform/deep qualification. |
| Synchronous Windows timeout cleanup | Both production sync owners, real detached descendants, explicit single-process authority and canonical LSP version-timeout control | A reaped parent no longer prevents the existing native lineage owner from finding surviving descendants. Both detached-child cases fail before repair; afterward cleanup completes before the 25-second self-limit, with original timeout classification and deadlines. Native leaf helpers cannot recursively enter cleanup. POSIX group controls and unchanged import budgets remain required. |
| Selected .NET and real LSP runtime (#631 partial) | Pinned csharp-ls 0.28.0, isolated CI SDK 10.0.113/runtime 10.0.13, architecture/host root verification, fresh-process Go/C#/PHPactor startup owner and twelve explicit simulated negative/positive cases | Actual Windows C# startup selects the reported physical SDK, acknowledges shutdown, exits zero naturally and reaps its server. Bounded INFO diagnostics are retained separately from unexpected warnings/errors. Three-platform workflow execution remains pending for this owner; simulated commands never qualify installed tools, and startup does not establish project semantics or latency. |
| Baseline prerequisite diagnostics | Fresh healthy owner plus four `smoke/baseline-negative/*` cases: missing/restored, corrupt, incomplete and legacy/removed | All original 23 helper assertions, nine actual child invocations, 16 filesystem operations and index inputs are retained. Each new wrapper retains a five-second child cap and 20-second aggregate ceiling under a 30-second outer limit, with serial CI/nightly ownership. The standalone nine-child aggregate remains available and is separately checked. These are presence/schema diagnostics, separate from usable-index/retrieval or production latency qualification; the original hosted stall remains unattributed. |
| Ruby cache and probe context (#631 partial) | Exact selected-cache Ruby launcher environment, simulated Node commands with explicit fixture trust, memory/persistent environment negatives and raw-secret absence | Cache launchers search their actual installed gem root while preserving explicit user homes/searches and RubyGems defaults. Probe schema 2/tcp3 binds effective environment plus Node/ABI/platform by digest; old context-free entries are not readiness evidence. LSP producer 13 retires old replay meaning. Actual Windows Solargraph 0.61.0 retains install warnings and fails fresh 4000-ms version checks with direct Ruby, both gem-search controls and isolated RubyGems 4.0.23. A longer diagnostic response or fixture pass does not qualify it. Explicit cache-install -i authority remains required; the environment-only diagnostic scope violation was quarantined and its prior SDK resolution verified. |
| SQLite cancellation lifecycle | Explicit serial CI/nightly owner for the unchanged real cancellation fixture, with preparation/database/pool/start/abort/disposal phase timing | Row/event-loop/commit/pre-start aborts, worker cancellation after actual start, exactly-once native close, no late worker work, staging cleanup and prior-publication bytes remain asserted. The original three-second start witness and 30-second outer limit remain, with zero retries/native redo. Local serial success does not attribute the prior hosted concurrent failure. |
| Go SDK and gopls (#631 partial) | Declared gopls v0.24.0/Go >=1.27.0 build minimum, explicit SDK/root preservation and three-platform CI selection of Go 1.27.3 plus actual initialize/shutdown | Windows real Go 1.26.4 fails the original build; an explicitly selected, checksum-verified Go 1.27.3 builds the real server and completes its canonical startup/disposal. Inert SDK/command regressions test authority and planning separately. CI records the selected SDK and real binary/startup evidence; new hosted execution remains pending. Workspace semantics, older-tool compatibility and latency remain separate qualification. |
| Native TUI settings (#633) | Schema-derived fields/canonical config CLI, supervisor transaction and active-child scope controls, Rust keyboard/state cases, and four independently bounded `tui/native-settings-conpty/*` cases | Actual Windows keyboard → supervisor → result execution covers invalid edits, cancelled previews, saved effective values, stale concurrent writes, confirmed byte-preserving reset and workspace/repository switching. Private values stay out of events, telemetry, terminal capture and snapshots. The 47-owner hosted Windows authority cohort passes at `77a6f0df7`, including settings file/backup/lease symlinks. The local token remains incapable; Linux/macOS native PTY execution requires separate owners/receipts, and these ConPTY cases are Windows-only qualification outside ci-lite. |
| Provider detection (#631 partial) | Application-owned Node detection with fresh/stale cache and untrusted-child controls, canonical provider-usage policy, retained failure diagnostics and actual Pyright initialize/shutdown | Windows Pyright 1.1.414 advertises real capabilities and shuts down through the canonical client. Its recognized transport-usage probe remains nonzero and explicitly labelled; version/help detection alone is not protocol qualification. Missing PATH fallbacks cannot erase an installed executable's failure. Other platforms/tools and precision/compatibility remain separate acceptance. |
| XML content and real clocks | Deterministic `lang/contracts/xml-lexical-boundaries` plus serial `perf/parsers/xml-cold-budget`, enforced in CI/nightly plans | Every lexical/range/cap/expiry assertion remains. Default parser/chunker/collector, registry and adapter positives run with unchanged 30 ms production scan/owner limits, cold/warm samples, source/runtime identities and fallback diagnostics. Clock-injected content checks alone do not establish elapsed-time acceptance. |
| Boolean complement retrieval | Real SQLite and memory/legacy/fielded/fallback pipeline comparisons; three fresh-index CLI backend cases with cold/warm queries | Full AST eligibility includes rows outside the positive lexical seed. Structured filters cannot globalize a branch-local NOT; mode/allowlist/row hydration bounds, strict query negatives and local/federated cache invalidation remain enforced. This is sparse correctness, separate from latency or real-model acceptance. |
| Windows pending-delete locks | `shared/locks/windows-delete-pending`, file-lock contract, queue cleanup and the early Windows ownership cohort | Actual native FileDispositionInfo reproduces EPERM until its old handle closes. The holder calls kernel32 directly without runtime C# compilation; its unchanged five-second startup bound includes phase/exit diagnostics. Acquisition uses its existing deadline without stale-owner reclamation; persistent denial, zero-wait, other permissions and cancellation retain failure contracts. Hosted kernel attribution and fresh CI results remain distinct from this native regression. |
| Script-coverage retirement | [Immutable delegation mapping](../archived/script-coverage-retirement-2026-10-20.json), harness parity and actual nightly selection plan | Retired wrappers map to retained fixture inputs/assertions and bounded process cases. Scheduled test sets are disjoint; missing canonical owners and revived aliases fail. Distinct explicit CLI selector/repository checks remain. Declared optional/destructive applicability is separate from a passing execution. |
| TUI viewports | Rust rendered-frame cases in wide and stacked layouts, existing capture/model and native lifetime owners | Filtered job/task offsets affect visible rows and clamp after refinement. Logs retain the newest wrapped lines, pause anchors matching entries and resume returns to tail. UTF-8, wide/combining characters and joined emoji wrap without invalid byte slicing. |
| TUI compiler selection | `tui/cargo-invocation-policy` plus actual default build/capture execution | Root-level wrappers select the exact canonical Rust pin and pass `--locked`; explicit fixture commands remain separately selected. Windows release ConPTY checks record the executed binary hash, terminal restoration, job states and descendant reaping. Other release targets require their own execution. |
| Global TUI interrupt | Rust 1.88 key-event cases for every overlay/job state, plus `tui/native-interrupt-lifetime` through the existing native terminal owners | Repeated Ctrl+C preserves one global shutdown; plain `c` keeps its overlay scope. The native case witnesses an open search overlay, graceful EOF, terminal restoration, final job states and descendant reaping. Windows ConPTY and Linux PTY receipts remain separate; the helper does not qualify macOS. |
| Native ANN generation | CI/nightly `Serial ANN generation`: real HNSW/Lance publication, failed rebuild and LMDB variant cases, one job/thread, 30 seconds per fixture, zero retries/native redo | Full embedding identity and exact vector/chunk generation bind current native admission. Missing/partial/disabled/empty output and interrupted promotion cannot relabel old bytes. Actual SQLite/artifact vector parity and lexical fallbacks supplement native checks; real-model quality and optional sqlite-vec remain separate. |
| VS Code external Node | `tooling/vscode/external-node-runtime`, existing editor/runtime/package contracts | Embedded Node 18/22/24 controls select an actual supported external runtime. User-only selection, fixed version probes, unsupported/error/warning rejection and workspace trust apply to JS CLI and script operators. Plain executable CLI behavior remains separate. |
| Sublime API authentication | `tooling/sublime/api-authentication`, real API service plus controlled HTTP origins and existing editor behavior | User Settings approve the exact origin; user/process tokens reach search, health and status. Project/caller overrides, other origins, invalid values and credential-bearing redirects cannot forward credentials. Real indexed search succeeds and wrong-token rejection remains authoritative. |
| Sublime minimum runtime | `tooling/sublime/minimum-runtime-compatibility`, existing behavior/package/compile contracts; separate actual Python 3.3 receipt | Contained watch paths work without commonpath; Windows stop uses Python 3.3-compatible bounded calls and handles missing/nonzero/timed-out helpers without losing force escalation. Controlled API fixtures supplement actual owned-child termination. The headless editor harness does not claim a GUI session. |
| Code-map cache authority | `tooling/reports/map-selected-index-identity`, existing map/cache contracts and isolation | Real stage1 indexes retain distinct default/explicit roots and warm models, canonical aliases share authority, in-place manifest generations invalidate even with retained build IDs, and corrupt warm manifests fail before cache admission. |
| VFS semantic origin | `tooling/vfs/hash-origin-authority`, `token-origin-authority`, routing/token matrix and path-map roundtrip | Equal-text whole/embedded origins retain separate targets, diagnostics and real imported types with hash mode on/off. Hash routes include source identity; ambiguous content-only token lookup fails closed. Signature 10, compiler-binding 10 and LSP-binding 12 prevent old derived reuse. |
| Python/HTML registry extraction | Three real-worker Python registry/default/range cases, HTML registry metadata, and `indexing/contracts/python-html-registry` | Correct AST relation handoff, combined positional defaults, locale-independent UTF-8 transport and validated UTF-16 ranges. HTML summary enrichment is independent of filtered relations. A real index verifies published metadata; signature version 9 invalidates prior bundles. |
| Bootstrap prerequisites | `tooling/install/bootstrap-preflight`, original readiness/native/patch checks, separate fresh locked install | Dependency-free runtime/Git/Python/build-tool discovery stops installation on missing prerequisites and never records readiness alone. Ordinary and directory-alias entry points must execute the same CLI checks; preflight and entry-detection sources participate in readiness identity. Fresh Windows x64 Node 26.10.0 bootstrap verifies 37 required packages/33 routes separately from full runtime/deep qualification. |
| TypeScript compiler admission | `tooling/typescript-compiler-compatibility`, loader parity, resolver/preflight and existing provider/semantic cases | Doctor and execution share stable >=5.7.2 and full host/preflight capability admission, preserve sealed source receipts and reject incompatible selected compilers without fallback. Official oldest/current tiny-provider execution is separately recorded; missing optional tooling is distinct. |
| GNU Global ingestion | Original ingest/containment/output-preservation cases plus `tooling/ingest/gtags/protocol` and `command-contract` | Captured native cxref rows retain only their filename column, decode encoded paths once and preserve reference roles. Explicit fixture commands verify argv ownership and rejection before publication; task receipts separately exercise real GNU Global 6.6.14 indexing and CLI ingestion. |
| LSIF ingestion | Existing ingest/missing-input/containment checks plus `tooling/ingest/lsif/protocol` | Actual CLI follows result-to-range item direction, preserves definition/reference properties, shared results, document/project shard authority, native/virtual file URIs and invalid-input error counts. Concrete locations deduplicate per role. Cross-dump moniker resolution is outside the flat occurrence artifact. |
| MCP build cancellation | `services/mcp/index-build-cancellation`, native `storage/sqlite/build/cancellation`, incremental handle lifecycle and transport settlement controls | Direct, legacy and SDK build dispatch forward the request signal; optional restore is asynchronous and cancellable. SQLite cooperates at phase/batch/worker and pre-commit boundaries, rolls back actual writes, closes native handles/workers and preserves prior output on abort. Successful direct/transport builds remain covered. |
| FTS query eligibility | `retrieval/backend/fts-lazy-query-eligibility`, actual SQLite and core pipeline, default/configured caps, cold/warm metadata and large ID allowlists | Boolean exclusions and exact literal phrases apply before the SQL limit. Only eligible rows hydrate; healthy FTS cannot hide behind sparse fallback. Existing cap and phrase-evidence authority remain. |
| Federated mode and cache authority | Real `retrieval/federation/prose-enumeration-mode-scope` and `relative-cache-freshness`, plus existing federation contract matrices | Each enumeration task uses its exact eligible mode, preserving ordinary prose expansion and compatibility rejection. CLI/structured relative filters share one effective cutoff with cache identity; static entries expire before touch. Clock passage alone does not change the indexed generation. |
| Risk response contracts | Five bounded `context-pack/risk-truncation-contract/*` cases; full CLI/API/MCP output validation and strict/unknown-cap negatives | Excerpt and partial-flow count/byte/token caps retain useful bounded evidence. Canonical producer/schema inventory must agree; API error status is not changed by cap admission. |
| Risk comparison evidence | `analysis/risk-delta-surface-parity` with actual indexed refs, corrupt/missing/schema/I/O controls and zero-flow/genuine-removal positives | Unknown evidence fails comparison. Only undeclared families backed by valid zero-emission stats are empty; missing declared pieces stay failures. |
| Owner privacy reprojection | `integrations/inference-history/privacy-roundtrip`, owner controls and structural planner | Real import → redact → plan → clear restores only permitted provenance/message fields, preserves artifact policy identity, updates discovery and generation, and rolls back corrupt/mismatched retained sources. Active redactions retain no locators or source hashes. |
| Test-suggestion node bounds | `graph/suggest-tests-node-budget` and existing fidelity/contract matrix | Zero/one/exact caps bound seeds and neighbors before admission; omissions report truncation, partial graph or explicit heuristic fidelity. Exact exhaustion without omission stays complete. Actual CLI uses a nonempty import graph. |
| Context graph selection | Nine independently bounded `context-pack/graph-selection/*` cases and existing store/CSR/symbol/filter cases | Eight call/usage/import combinations plus unspecified defaults retain positive selected edges across assembly/CLI/API/MCP. Empty selection has distinct cache authority and no graph reads; excluded declared artifacts contain invalid JSON so accidental cold reads fail. Unknown filters retain asserted warnings. |
| Directed graph traversal | `graph/directed-traversal`, CSR/store/witness fixtures | In/out/both preserve recorded call/usage/import endpoints and real call-site IDs, including reciprocals, self-loops and mixed symbol witnesses. Node order records the walk; JSON/Markdown edges retain source direction. |
| CSR risk guidance | `context-pack/risk-guidance-csr`, risk assembly and suggest-tests contracts | Normal persisted-CSR preparation preserves direct callers and graph-only test witnesses/fidelity/caps across CLI/API/MCP, without duplicating adjacency into stripped metadata. Supported partial indexes retain raw-graph fallback. |
| Semantic response omission | `graph/context-pack-response-budget`, real attachment helper and semantic seed discovery | Partial/unavailable sections validate before budgeting; omission reconciles inclusion/state/warnings, preserves primary evidence and remains incomplete. Stale inclusion, missing metadata, wrong state and false completeness fail the contract. |
| Contributor gate | `.github/workflows/ci.yml`: Ubuntu front gate, then `ci-lite` on Ubuntu, Windows and macOS; Node 26.12.1 | Selected portable behavior and required native bootstrap activation. It is not every discovered test. |
| Portable API contracts | Explicit serial eight-case CI cohort: router, core, repo authorization, streaming success/failure, search matrix, federated validation and filter-only enumeration; nightly selects every discovered API case | The invocation-plan test resolves exact IDs and requires every ordered API fixture to have an owner. Each case uses one job/thread, 30 seconds, zero retries/native redo. New-candidate hosted execution remains pending. |
| Serial runtime budgets | TOML/Jinja corpora under real 30 ms parser limits; summary code/prose/SQLite assertions with a 20-second build bound; real one-CPU/memory-token compiler admission, measurements and publication under its unchanged 20-second controller | Execute separately from concurrent correctness lanes. Every serial case has one exact broad-lane exclusion and replacement owner, with a 30-second outer limit and zero retries. Raw samples, prior hosted cancellation and source identity remain distinct; no limit is raised. |
| Windows authority | windows-authority job: exact PR head, real file-symlink capability probe, explicit 49-case inventory, one job, 30-second limits, zero retries/native redo | Strict Windows path/link authority and artifact-boundary qualification, including preflight/map directory aliases and native search/artifact actions. Alias checks supplement file-symlink authority. At 208395791 the local real file-link probe gets EPERM before execution, so this cohort remains blocked. A configured job, Linux file links or the older hosted 47-case pass does not qualify the two added authority owners. |
| Windows subprocess ownership | Five real ownership fixtures before the broad Windows CI suite; one job/thread, 30-second limits, zero retries/native redo | Direct termination, orphan child/grandchild isolation, pending-delete admission and synchronous timeout cleanup. Toolhelp uses the absolute System32 helper on supported 64-bit Node 26 targets, independently of PATH; layout/failure checks reject incomplete rows and release resources under its unchanged two-second limit. A shared fixed launcher separates engine-ready from stdin payload parsing; actual parser/execution/native negatives retain nonzero status and publish no rows. Local controls do not reproduce the hosted cold pre-phase stall or establish its cause. |
| Semantic read ownership | Real trace/index reads, cancellation after opening, later errors, overlapping requests, same-size edits with unchanged timestamps and cursor continuation | Large pieces retain per-64-KiB digests from full verification and check copied decode blocks; metadata equality alone is insufficient. Scratch reads stay at 64 KiB and close releases digest/snapshot state. One common reader plus three probes preserves the four-pair bound. Full 115-record/136-edge content equivalence is separate from timing. |
| Watch publication cancellation | Six watch phase controls plus actual pointer staging, rename-retry and post-commit cancellation | Before-commit cancellation preserves the prior generation and drains staged writes; after-commit cancellation preserves published success. Focused evidence is separate from a final candidate's platform/deep campaign. |
| LSP response authority | Equal-byte distinct origins, pinned-generation persisted positive/negative hits, dependency-only build changes, unscoped-call isolation and real signature callbacks | `rq2` binds document/container/segment, language/encoding and build identity; prior ambiguous entries are not admitted. Producer 12 retains the initial version-11 parsing repairs and invalidates conflated VFS origins. Simulated protocol fixtures do not qualify installed real servers. |
| Physical file identity | Exact device/inode identities, real hard links, overlapping roots, wide-ID collisions, retained disk charges and descriptor/path matching | Real NTFS IDs above Number precision must stay distinct. Portable controls supplement actual same-file fail-before/pass-after proofs; safe byte limits and public stat types remain unchanged. |
| Descriptor-fixture fidelity | Descriptor-zero excerpt/close assertions, requested BigInt identities and ordinary numeric stats | Stat adapters must forward options. A malformed Number-valued fixture must not force the authority owner to coerce exact identities. A real inherited-descriptor control supplements the fixture; Windows stdin invalidation is not inferred from a close call. |
| Append-writer lifecycle | Immediate/concurrent close, accepted UTF-8 bytes and order, descriptor reuse, synchronization before close, bounded queued batches and ignored late writes | Closing must drain accepted records. An I/O operation-count bound and a controlled disk-delay experiment are separate from ordinary elapsed-time qualification. |
| Simulated provider fixtures | Explicit fixture command/trust, owned caches through setup and teardown, fresh/stale admission, actual child-start/cancellation/reaping witnesses | Shared author caches and cancellation before the intended operation starts cannot establish a lifecycle pass. SourceKit retains its original two-second bound and five-second workload. Doctor distinguishes missing commands from inconclusive probes; real initialization failures retain string error codes, including numeric zero. |
| Rust TUI | Pinned Rust 1.88.0 Windows/Linux fmt/build/test/clippy with warnings denied; actual Linux PTY quit/interrupt/supervisor-error/terminal-error controls | Windows source 702a8e250 and Linux fixture correction ceea4b802 pass all 55 Rust tests. Windows passes 29 native cases; Linux passes seven actual inspector workflows and four lifetime cases, plus eleven other affected checks. The POSIX-only receipt fix preserves every terminal-control byte and the original restoration assertion. Both full front gates pass; exact source/binary hashes and original failures are retained. These debug/source receipts do not qualify all native workflow keys, release artifacts, installation/wrappers or macOS. |
| Extended correctness | `.github/workflows/ci-long.yml`: Ubuntu, manually dispatched or release tags | Ordered long lane required for release at the exact candidate SHA. It is not a required PR check. Missing or unsuccessful CI/CI Long evidence fails release readiness. |
| Extended/performance | `.github/workflows/nightly.yml`: manual dispatch, three OS targets; `run-suite.js --mode nightly` adds storage, perf, soak, benchmark and script-coverage work | Extended campaign when actually invoked. The workflow currently has no nightly schedule. |
| Release | `.github/workflows/release.yml`, [release matrix](../guides/release-matrix.md) | Target-specific packaging, native TUI build/install and shipped-surface verification. Only receipts for the candidate establish acceptance. |
| Performance checks | `tests/perf/`, shared-module import/command budgets, benchmark harnesses and SLO tools | Mixed evidence: correctness contracts, structural coupling budgets, small latency checks and larger workload experiments. The `perf` label alone does not identify measured performance. |

`tools/ci/run-suite.js` supplies a 600-second runner deadline and explicitly sets
zero retries and no native-status redo for both CI and nightly test lanes. That
extended campaign setting does not override this audit's 30-second fixture limit.
The cheap front gate, a broad discovered selection, and release qualification
must be reported separately. Ordered lanes and physical discovery differ; list
the intended selection before interpreting its result.

Candidate 22 at `ffde426be` completes Windows acceptance: 2982 required
first-attempt passes across 48 cohorts, 17 explicit exclusions out of 2999
discovered cases, zero failures/timeouts/native crashes/retries/unexpected skips.
All 16 serial supplementary checks, 51 native/TUI cases and 101 serial performance
fixtures pass. The slowest required case is 24.094 seconds. All 65 original
failure entries, including 27 timeouts, have current coverage mappings in the
[durable Windows receipt](../archived/windows-deep-repairs-2026-10-18.md).
All seven PR checks pass. Five ordinary CI jobs use a synthetic merge whose
entire Git tree equals the frozen head; strict authority checks out that head
explicitly and passes all 44 real file-symlink cases. Broad CI contains 975 cases:
Windows passes 972 with three declared exclusions; Ubuntu/macOS pass 974 with one
optional exclusion each. All are first attempts. Windows map-cache isolation takes
39.669 seconds under the broad CI deadline, versus 17.171 seconds in its local
strict run. The broad timing is not a 30-second pass. These counts do not qualify
Linux/macOS full deep execution or release-wide readiness.

## Useful required coverage

Keep one supported Node major and the three supported OS families. Do not add an
OS × language × provider × backend cross-product to routine PR work.

1. **Every candidate:** bootstrap/native activation, front gate, changed-area
   regressions, discovery completeness and format rejection. Keep helper tests
   discoverable and retain newly split assertions in the corresponding ordered
   lane. No retries or native-status redo count as acceptance for this audit.
2. **Each supported OS:** CLI/API/MCP entrypoints; subprocess quoting,
   cancellation and descendant reaping; exact path/file identity; atomic
   publication/recovery; cache admission; editor install/uninstall. Candidate 22
   passes all Windows-applicable cases. Its hosted strict authority job proves
   real file-symlink capability at the exact head/tree: 44 first-attempt passes,
   no skips, retries or late successes. Three separate strict Windows subprocess
   owners pass. No machine security policy changed. Ubuntu/macOS bounded CI passes
   are distinct from their still-unexecuted full deep campaigns.
3. **Native Node backends:** prepared SQLite, LMDB, HNSW, LanceDB and parser
   activation plus bounded real build/query/disposal routes. Clean verification
   reports 37 packages/33 routes on Node 26.10.0, Windows x64, ABI 147, without
   warning/error lines. Activation alone is not full runtime qualification. The
   original Node 26.8.1 worker-teardown access violation has matching-symbol CDB
   attribution and an upstream ASAN fail-before/pass-after regression. Ten explicit
   fresh compiler/embedded-source controls pass after the repair, and every
   original crashing route passes again in candidate 22 with normal production
   settings. The local reduced VM control did not crash the old runtime; it is
   not represented as a local deterministic fail-before proof. Stub vectors do
   not qualify real models. CPU-token ownership, process-available memory, strict
   BigInt file identity, append-close draining and host-owned compiler caches
   retain demonstrated regressions and complete semantic content comparisons.
   Earlier candidate failures, retries and inconclusive controls remain in the
   Windows receipt; none supplies acceptance for the frozen candidate.
4. **TUI:** Rust fmt/check/test/clippy and package/wrapper checks per supported
   release target. Source 208395791 passes 52 serial Windows native cases and 34
   Linux PTY cases, plus twelve separate PTY/patch cases on each platform and
   sixty Rust tests. Actual quit, supervisor failure, terminal transport failure,
   owned cancellation, restoration and descendant reaping retain their assertions.
   The earlier 51-case candidate-22 receipt remains revision-specific; native
   release-target and macOS qualification remain separate. Provider/MCP/cache
   fixtures retain explicit trust, fresh cache authority and actual child-start
   witnesses. Developer caches now use `.tmp/dev/`; logs remain historical.
5. **Provider or model claims:** separately qualify the exact installed tool,
   trusted workspace, model revision/digest and backend that the claim needs.
   Real C/ELF authority fixtures need their supported native toolchain route.
   Simulated LSP fixtures establish protocol behavior, not installed-tool or
   cross-platform language precision.

The post-acceptance setup-log audit finds two managed-Go path defects. Relative
`GOPATH`/`GOCACHE` defaults are rejected immediately; a reused relative `GOROOT`
then makes compiler/assembler paths disappear after a working-directory change.
Defaults, SDK cache resolution and SDK launch paths now resolve absolutely while
explicit user caches remain active. Same-executable real-Go controls fail before
and pass after each repair; 22 affected installer/provider fixtures pass for each
batch. The existing SDK fixture retains its original 54 assertions and adds nine
path/ownership assertions. It joins regular CI (976 cases); discovery stays 2999.
The complete Windows deep run above still identifies its original frozen source.
macOS optional-tool preparation remains unqualified: PHP is missing and
Pyright/C#/Ruby post-install probes/layout checks fail. The Go installer report
on `632dd7f40` also remains failed at the demonstrated relative-assembler error;
the subsequent SDK repair needs its own hosted result. Optional Pyright setup
emits npm's unreviewed `fsevents` lifecycle-policy warning. These are not asserted
negative fixture warnings or clean setup receipts. No script approval, weakened
readiness rejection or machine security change supplies acceptance.

## Performance evidence to use

The completed Windows deep campaign explicitly excludes these 17 whole cases. Their
original assertions remain in place; an unsupported or disabled case is not a
passing observation. Required dependency absence is not an additional exclusion.

| Cases | Separate qualification and Windows coverage owner |
| --- | --- |
| `cli/general/signal-cleanup` | POSIX parent signals; Windows native ownership: `tui/native-quit-lifetime`. |
| `shared/kill-tree.posix` | POSIX process groups; Windows: `shared/kill-tree.windows`. |
| `indexing/embeddings/build/cli-signal-failure` | POSIX signal injection/promotion; Windows exit failure and cancellation: `indexing/embeddings/build/process-outcome`. |
| `services/mcp/sdk-descendant-grace` | POSIX SIGTERM-resistant escalation; Windows SDK child ownership: `services/mcp/sdk-cancel-progress`. |
| `shared/subprocess/tracked-leak-fails-process` | POSIX invalid-signal leak injection; Windows: `shared/subprocess/tracked-shutdown-cleanup`. The leak diagnostic itself remains POSIX-qualified. |
| `indexing/semantic/native-deferred-production`, `indexing/semantic/native-task-authority` | Linux ELF positives; Windows unsupported-platform and portable authority: `indexing/semantic/native-toolchain-platform`. |
| `runner/harness/redo-target`, `runner/harness/skip-target`, `runner/harness/timeout-target`, `runner/harness/timeout-pass-signal-target` | Four helper-only children; their parent contract matrix and timeout/tree-cleanup fixtures execute them. |
| `storage/sqlite/ann/sqlite-extension`, `tooling/script-coverage/storage/sqlite-ann-extension-test` | Two optional sqlite-vec positives, outside this acceptance target. |
| `tooling/script-coverage/tools/shell-scripts` | Bash/jq helper qualification under a capable shell, separately scoped. |
| `perf/bench/scenarios/matrix` | Opt-in repository workload scenarios; bounded default harness: `perf/bench/run`. Scenario-specific workload acceptance remains separate. |
| `smoke/tantivy`, `tooling/script-coverage/storage/tantivy-smoke-test` | Optional Tantivy positive qualification. The wrapper invokes the same smoke fixture with no additional inputs or assertions. Both retain status 77 when disabled. Candidate 07 omitted the wrapper from its exclusion inventory; that unexpected skip remains recorded. |

Three excluded script wrappers execute and return declared status 77; the other
14 excluded cases are not directly scheduled. Every required case and every
portable/platform replacement owner passes. The four harness-only children remain
covered through their parent fixtures. Optional sqlite-vec/Tantivy and Bash/jq
positives remain unqualified, with no replacement claim.

Run bounded checks on one idle representative CPU host first. Use a second OS
only for a changed platform-sensitive path or a release claim. Record candidate
and dirty-worktree identity, OS/architecture, Node/ABI, backend/provider, corpus
revision, cache state, concurrency and actual executed query/build counts.
Record effective CPU queue and native worker limits too: configuration and
auto-policy can outrank the runner's `PAIROFCLEATS_THREADS` environment hint.

Use these layers independently:

- **Correctness and deterministic resource bounds:** scheduler fairness,
  cancellation, writer pressure, cache caps and vector-result provenance. Most
  `perf` fixtures belong here. They can run in ordinary correctness lanes.
- **Small measured regressions:** isolated SQLite query latency, cold/warm graph
  operations, command startup and bounded memory retention. Preserve the raw
  samples and existing thresholds. Parallel audit timings are diagnostic only.
- **Representative workload acceptance:** fixed repositories and queries,
  observed extraction quality and retrieval relevance, cold/warm indexing,
  incremental edit-to-search latency, p50/p95, peak RSS and retained heap after
  repeated operations. Real embeddings require verified model assets and an
  observed provider. This is separately scoped work; small fixtures do not prove
  production capacity or relevance.

Do not increase a baseline merely because it fails. The shared-module budget is
primarily an import-count/coupling gate, not a latency measurement. Review its
reported dependency growth separately from measured startup. A warm/cold speed
ordering assertion needs an isolated run and enough retained observations before
it can support a performance claim.

For a bounded local cohort, list first and then execute with explicit limits:

```text
node tests/run.js --lane all --match /^perf\// --list
node tests/run.js --lane all --match /^perf\// --jobs 1 --pairofcleats-threads 1 --timeout-ms 30000 --retries 0 --native-status-redo=false --report-file .tmp/tasks/perf-report.json --timings-file .tmp/tasks/perf-timings.json
```

The October 18 audit uses that deadline and records failures/timeouts without
relaxation. Author-workspace `.testLogs` and `temp/` receipts are historical local
evidence; clean checkouts are not expected to contain them. Keep broad correctness
and native teardown qualification current before expanding expensive benchmark or
release campaigns.

The SQLite latency fixture requires source hits before accepting a sample.
The original missing `answer` hit is repaired without changing either query.
Candidate 22 retrieves the expected indexed source for both `greet` and `answer`
before collecting 20 chronological warm samples. p95 is 170.7213 ms against the
unchanged 7500 ms Windows threshold. Raw samples and complete source identity
remain in the Windows receipt; the former empty-hit timing is diagnostic history.
All 101 serial performance fixtures and the 16-case serial supplement pass.
