# Platform and performance qualification

Audited: 2026-10-18. Source contracts and workflow definitions describe required
behavior; a configured job is not evidence that the current candidate passed it.
Current execution evidence and unresolved failures belong to the
[deep test audit](../archived/deep-test-audit-2026-10-18.md) and the
[active roadmap](../roadmap.md).

## What exists

| Surface | Checked-in qualification | What it establishes |
| --- | --- | --- |
| Contributor gate | `.github/workflows/ci.yml`: Ubuntu front gate, then `ci-lite` on Ubuntu, Windows and macOS; Node 26.10.0 | Selected portable behavior and required native bootstrap activation. It is not every discovered test. |
| Windows authority | `windows-authority` job: exact PR head, real file-symlink capability probe, explicit 44-case inventory, one job, 30-second limits, zero retries/native redo | Strict Windows path/link authority and artifact-boundary qualification. A configured job is not a passing receipt; all cases must pass with logs and source/dependency identity. |
| Windows subprocess ownership | Three existing real lifecycle fixtures before the broad Windows CI suite; one job/thread, 30-second limits, zero retries/native redo | Direct termination, already-exited parent/orphan fallback and synchronous timeout cleanup; raw discovery outcomes and attempts remain available. Configured coverage is not a passing hosted result. |
| Semantic read ownership | Real trace/index reads, cancellation after opening, later errors, overlapping requests, same-size data/offset edits and cursor continuation | One common verified index owner per page plus three local probes preserves the four-pair bound. Every following page/request revalidates bytes and every scope closes before settling. Full 115-record/136-edge content equivalence is separate from timing. |
| Physical file identity | Exact device/inode identities, real hard links, overlapping roots, wide-ID collisions, retained disk charges and descriptor/path matching | Real NTFS IDs above Number precision must stay distinct. Portable controls supplement actual same-file fail-before/pass-after proofs; safe byte limits and public stat types remain unchanged. |
| Simulated provider fixtures | Explicit fixture command/trust, owned caches through setup and teardown, fresh/stale admission, actual child-start/cancellation/reaping witnesses | Shared author caches and cancellation before the intended operation starts cannot establish a lifecycle pass. SourceKit retains its original two-second bound and five-second workload. Doctor distinguishes missing commands from inconclusive probes; real initialization failures retain string error codes, including numeric zero. |
| Rust TUI | CI on Ubuntu: Rust 1.88.0 fmt/check/test/clippy | Rust build, unit behavior and lint on that target. JavaScript source-string checks do not replace compilation. |
| Extended correctness | `.github/workflows/ci-long.yml`: Ubuntu, manually dispatched or release tags | Ordered long lane. It does not run on every PR. |
| Extended/performance | `.github/workflows/nightly.yml`: manual dispatch, three OS targets; `run-suite.js --mode nightly` adds storage, perf, soak, benchmark and script-coverage work | Extended campaign when actually invoked. The workflow currently has no nightly schedule. |
| Release | `.github/workflows/release.yml`, [release matrix](../guides/release-matrix.md) | Target-specific packaging, native TUI build/install and shipped-surface verification. Only receipts for the candidate establish acceptance. |
| Performance checks | `tests/perf/`, shared-module import/command budgets, benchmark harnesses and SLO tools | Mixed evidence: correctness contracts, structural coupling budgets, small latency checks and larger workload experiments. The `perf` label alone does not identify measured performance. |

`tools/ci/run-suite.js` currently supplies a 600-second runner deadline. That
extended campaign setting does not override this audit's 30-second fixture limit.
The cheap front gate, a broad discovered selection, and release qualification
must be reported separately. Ordered lanes and physical discovery differ; list
the intended selection before interpreting its result.

## Useful required coverage

Keep one supported Node major and the three supported OS families. Do not add an
OS × language × provider × backend cross-product to routine PR work.

1. **Every candidate:** bootstrap/native activation, front gate, changed-area
   regressions, discovery completeness and format rejection. Keep helper tests
   discoverable and retain newly split assertions in the corresponding ordered
   lane. No retries or native-status redo count as acceptance for this audit.
2. **Each supported OS:** CLI/API/MCP entrypoints; subprocess argument quoting,
   cancellation and descendant reaping; path identity/case handling; atomic
   publication and recovery; cache admission/cleanup; editor package/install.
   File-symlink authority tests need a runner with that capability. The October
   18 task-local elevated Windows launch created a real file symlink. Candidate
   08 passes all 44 capable-token cases with zero skips; ordinary medium-token
   runs still return EPERM. The elevated launch did not alter system security
   settings. At `39703b3a3`, the strict hosted Windows job passes all 44 at the
   audit deadline, preserving capability, commit/tree, Node/native readiness and
   every result/log. All attempts are one, with zero skips or native crashes.
   Its guard is in regular `ci-lite`; omission, skips, retries, late success and
   missing capability fail qualification. Subsequent repairs require a new run.
3. **Native Node backends:** prepared SQLite, LMDB, HNSW, LanceDB and parser
   activation plus a bounded real build/query/teardown route on each shipped
   platform. Stub vectors exercise deterministic ANN integration, not real model
   execution. The captured Windows worker-teardown crash is attributed to Node
   26.8.1 and its original routes pass on the clean 26.10.0 candidate; full
   Windows-suite acceptance still requires the remaining cohorts. Do not replace
   native lifecycle coverage with a backend switch or retry.
   A real one-CPU TypeScript publication regression additionally covers scheduler
   ownership: compiler work must acquire its own reservation without a parent
   retaining the sole CPU token. Local before/after failure/pass evidence is in
   the Windows receipt. The fixture uses the 512 MiB product default, asserts
   persisted CPU/memory totals and maxima of one, and keeps adaptive admission
   and real compiler/binding positives. macOS then exposes false global-byte
   pressure: raw free pages discard the process API's reclaimable availability.
   The shared memory owner is repaired while preserving zero-pressure and all
   hard budget bounds. Retained `d481d8980` macOS telemetry proves 3.33 GB process
   availability versus 0.85 GB raw free and admission of the unchanged 512 MiB
   request, first attempt in 15.8 seconds. Windows compiler and macOS YAML retries
   remain visible; a green job is not zero-retry acceptance. The CPU fixture now
   isolates two real compiler modules, preserves all 17 assertions and adds five
   execution/cross-source checks. The old owner still fails at 22.8 seconds; the
   repaired fixture passes in 10.2 seconds. All default SSR input bytes remain
   unchanged. Their retained full coverage records a 30.4-second timeout. Bounded
   common-probe reuse passes both in 26.9/26.2 seconds, with complete same-root
   record/edge equivalence. Six integrity/service checks and six SQLite/report
   checks pass. Candidate 15 then records SSR incremental timing out at 30.355 s;
   it closes with 46 required passes, including 44 verified exact-head hosted
   authority cases, and four fail-fast omissions. Profiling identifies repeated
   compiler dependency probes. Host-owned TypeScript caches and context-bounded
   preflight deduplication pass the full SSR pair in 27.392/26.820 s, preserving
   all input bytes and complete graph fields. Fresh-host package changes and
   sealed unknown/changed probes remain checked. Final-source acceptance still
   requires every cohort. Candidate 16 closes with 1250 required passes, one
   SourceKit abort failure, 60 fail-fast omissions and 1670 unobserved cases.
   Profiling proves a shared-cache sweep delays cancellation before package
   resolution starts. Owned fixture caches/commands and actual child witnesses
   now retain the original two-second bound, passing fresh/stale cases in
   782/705 ms; all 15 SourceKit checks pass. Candidate 17 then stops after 212
   required passes on a stale Doctor handshake fixture. Explicit commands and
   controlled negative cases expose a numeric diagnostic-code producer bug;
   its original string assertion fails before repair and passes afterward,
   including RPC zero. Candidate 18 then exposes a cold-probe fixture reading
   shared author state. Its owned cache now proves real persistence and
   invalidation across memory resets; all six related checks pass. Map-cache
   isolation passes locally in 18.3 s under the original 30-second bound.
   Candidate 19 then records 2980 required passes and one retained-disk accounting
   failure across complete first-pass diagnostics. Real NTFS IDs collide after
   Number conversion, reproducing an extra 53-byte receipt charge and a wrong
   descriptor/path admission. Exact integer identities repair both owners;
   same-physical-input and portable regressions pass. All six hosted jobs and
   44 strict file-symlink cases pass on candidate 19, but the repaired source
   still needs every final-source cohort and its own authority receipt.
   The SQLite
   helper uses the identical builder through its narrow owner: its import graph
   falls from 2293 to 753 files, retaining all three fixture modes and deadlines.
   At `2dfab0536`, CPU checks pass first attempt on Windows/macOS in 14.9/11.9 s;
   a Windows report setup retry remains recorded pending the new helper's hosted
   qualification. Windows cleanup passes first attempts
   in both strict and broad lanes, but its earlier orphan failure is unattributed.
4. **TUI:** Rust fmt/check/test/clippy and package/wrapper checks for supported
   release targets. Linux uses its POSIX PTY fixture; Windows uses the existing
   node-pty ConPTY capture owner with actual console-mode observations. Focused
   Windows quit, supervisor-error and broken-output checks pass with descendant
   reaping and terminal restoration; see the
   [Windows repair receipt](../archived/windows-deep-repairs-2026-10-18.md).
   Linux execution and final-candidate acceptance remain separate. Windows
   TypeScript VFS aliases now retain root spelling while canonicalizing lookups;
   bounded root/preflight/import/compiler-binding checks pass. MCP queue,
   cancellation, duplicate-ID, progress, timeout and isolated-cache search-filter
   checks pass as separate Windows fixtures. These focused results still require
   final-candidate cohort execution. The repo-self eval now requires every
   original query to retrieve its expected source; its fenced Markdown host
   prose and extracted-prose cases pass on a disposable source corpus. The
   default index excludes `tools/`, so that specific fixture explicitly
   unignores only the copied tool source. This does not qualify a full-repository
   index. The explicit original-failure follow-up cohort found a nested test
   cache under `sample`; default discovery and report fixture copies now exclude
   `.testCache`/`.testLogs`, with positive source discovery retained. The four
   affected report cases pass after that repair. Incremental SSR witnesses now
   retain request-local query-index read deduplication, the full output digest
   and between-request tamper rejection. Both exceed 30 seconds in candidate
   07. Scoped JSONL readers pass both at 26.0 / 25.5 seconds on frozen candidate
   08. That campaign stops with 539 passes and one semantic-detail timeout;
   the API format checks now have three bounded cases retaining both real builds
   and every original surface assertion. Final-candidate qualification remains
   serial for native lifecycle and performance.
   Candidate 09 then stops with 277 required passes and one format-fidelity
   timeout. The metadata-only repair retains all 16 assertions and exact
   56-code/9-prose row and file-map parity; it needs a new frozen-source campaign.
   Script coverage retains every action in explicit discovered process cases;
   its first complete cohort passed 211 cases, timed out once and reported two
   optional/helper exclusions. The repaired tokenization comparisons and
   corrected nightly dispatch still require final-candidate qualification.
   Disposable contributor caches
   now use `temp/dev/`; receipt paths remain under `.testLogs/`.
5. **Provider or model claims:** separately qualify the exact installed tool,
   trusted workspace, model revision/digest and backend that the claim needs.
   Real C/ELF authority fixtures need their supported native toolchain route.
   Simulated LSP fixtures establish protocol behavior, not installed-tool or
   cross-platform language precision.

## Performance evidence to use

The next Windows deep campaign explicitly excludes these 17 whole cases. Their
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

The five later-discovered opt-outs use status 77. The campaign selects required
cases explicitly, records actual partial optional omissions, and keeps a
capable-token cohort for real file-symlink assertions.

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
evidence; clean checkouts are not expected to contain them. Restore broad
correctness and the native teardown qualification before expanding expensive
benchmark or release campaigns.

The SQLite latency fixture now requires source hits before accepting a sample.
This exposed an empty result for `answer`; the earlier fast timing remains
diagnostic history. Exported-value extraction is repaired and a focused serial
run now retrieves both original queries before passing the unchanged latency
threshold. Candidate 14 repeats both original queries over 20 serial warm
samples: p95 226.124 ms, unchanged Windows threshold 7500 ms. It is a partial
candidate; the subsequent memory-owner repair still needs a full frozen-source
campaign and a new serial measurement.
