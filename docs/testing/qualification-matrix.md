# Platform and performance qualification

Audited: 2026-10-20. Source contracts and workflow definitions describe required
behavior; a configured job is not evidence that the current candidate passed it.
Current execution evidence and unresolved failures belong to the
[deep test audit](../archived/deep-test-audit-2026-10-18.md) and the
[active roadmap](../roadmap.md).

## What exists

| Surface | Checked-in qualification | What it establishes |
| --- | --- | --- |
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
| Contributor gate | `.github/workflows/ci.yml`: Ubuntu front gate, then `ci-lite` on Ubuntu, Windows and macOS; Node 26.10.0 | Selected portable behavior and required native bootstrap activation. It is not every discovered test. |
| Portable API contracts | Explicit serial eight-case CI cohort: router, core, repo authorization, streaming success/failure, search matrix, federated validation and filter-only enumeration; nightly selects every discovered API case | The invocation-plan test resolves exact IDs and requires every ordered API fixture to have an owner. Each case uses one job/thread, 30 seconds, zero retries/native redo. New-candidate hosted execution remains pending. |
| Serial runtime budgets | TOML/Jinja corpora under real 30 ms parser limits; summary code/prose/SQLite assertions with a 20-second build bound; real one-CPU/memory-token compiler admission, measurements and publication under its unchanged 20-second controller | Execute separately from concurrent correctness lanes. Every serial case has one exact broad-lane exclusion and replacement owner, with a 30-second outer limit and zero retries. Raw samples, prior hosted cancellation and source identity remain distinct; no limit is raised. |
| Windows authority | `windows-authority` job: exact PR head, real file-symlink capability probe, explicit 46-case inventory, one job, 30-second limits, zero retries/native redo | Strict Windows path/link authority and artifact-boundary qualification, including preflight/map directory aliases. Alias checks supplement file-symlink authority. A configured job is not a passing receipt; all cases must pass with logs and source/dependency identity. |
| Windows subprocess ownership | Native snapshot plus three existing real lifecycle fixtures before the broad Windows CI suite; one job/thread, 30-second limits, zero retries/native redo | Direct termination, orphan child/grandchild isolation and synchronous timeout cleanup. Toolhelp uses native System32 on supported 64-bit Node 26 targets, independently of PATH; layout/failure checks reject incomplete rows and release resources under its unchanged two-second limit. The speculative SysWOW64 probe has no supported runtime owner. Configured coverage is not a passing hosted result. |
| Semantic read ownership | Real trace/index reads, cancellation after opening, later errors, overlapping requests, same-size edits with unchanged timestamps and cursor continuation | Large pieces retain per-64-KiB digests from full verification and check copied decode blocks; metadata equality alone is insufficient. Scratch reads stay at 64 KiB and close releases digest/snapshot state. One common reader plus three probes preserves the four-pair bound. Full 115-record/136-edge content equivalence is separate from timing. |
| Watch publication cancellation | Six watch phase controls plus actual pointer staging, rename-retry and post-commit cancellation | Before-commit cancellation preserves the prior generation and drains staged writes; after-commit cancellation preserves published success. Focused evidence is separate from a final candidate's platform/deep campaign. |
| LSP response authority | Equal-byte distinct origins, pinned-generation persisted positive/negative hits, dependency-only build changes, unscoped-call isolation and real signature callbacks | `rq2` binds document/container/segment, language/encoding and build identity; prior ambiguous entries are not admitted. Producer 12 retains the initial version-11 parsing repairs and invalidates conflated VFS origins. Simulated protocol fixtures do not qualify installed real servers. |
| Physical file identity | Exact device/inode identities, real hard links, overlapping roots, wide-ID collisions, retained disk charges and descriptor/path matching | Real NTFS IDs above Number precision must stay distinct. Portable controls supplement actual same-file fail-before/pass-after proofs; safe byte limits and public stat types remain unchanged. |
| Descriptor-fixture fidelity | Descriptor-zero excerpt/close assertions, requested BigInt identities and ordinary numeric stats | Stat adapters must forward options. A malformed Number-valued fixture must not force the authority owner to coerce exact identities. A real inherited-descriptor control supplements the fixture; Windows stdin invalidation is not inferred from a close call. |
| Append-writer lifecycle | Immediate/concurrent close, accepted UTF-8 bytes and order, descriptor reuse, synchronization before close, bounded queued batches and ignored late writes | Closing must drain accepted records. An I/O operation-count bound and a controlled disk-delay experiment are separate from ordinary elapsed-time qualification. |
| Simulated provider fixtures | Explicit fixture command/trust, owned caches through setup and teardown, fresh/stale admission, actual child-start/cancellation/reaping witnesses | Shared author caches and cancellation before the intended operation starts cannot establish a lifecycle pass. SourceKit retains its original two-second bound and five-second workload. Doctor distinguishes missing commands from inconclusive probes; real initialization failures retain string error codes, including numeric zero. |
| Rust TUI | CI on Ubuntu: Rust 1.88.0 fmt/check/test/clippy | Rust build, unit behavior and lint on that target. JavaScript source-string checks do not replace compilation. |
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
   release target. Candidate 22 passes all 51 serial native/TUI cases. The real
   node-pty ConPTY quit, supervisor-error and terminal-error cases take
   4.230/3.764/4.302 seconds, asserting status, descendant reaping, terminal
   restoration and final job states. Linux POSIX lifetime execution and native
   release-target qualification remain separate. Portable provider/MCP/cache
   fixtures retain explicit trust, fresh cache authority and actual child-start
   witnesses. Developer caches now use `temp/dev/`; logs remain historical.
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
node tests/run.js --lane all --match /^perf\// --jobs 1 --pairofcleats-threads 1 --timeout-ms 30000 --retries 0 --native-status-redo=false --report-file temp/tasks/perf-report.json --timings-file temp/tasks/perf-timings.json
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
