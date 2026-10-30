# Deep test audit, 2026-10-18

Status: historical execution receipt; unresolved work is owned by
[the active roadmap](../roadmap.md). The
[qualification matrix](../testing/qualification-matrix.md) defines useful platform
and performance evidence separately from this local run.

## Candidate and method

- Authorized branch: `codex/pr557-audit-repairs-20261012`.
- Base HEAD: `ab00d918d77fd45c086831e9759d7596ac18a16d`. Repairs are uncommitted.
- Host: Windows x64, Node `v26.8.1`, ABI 147. Native/patch verification passed via
  `node tools/setup/rebuild-native.js --verify`; locked bootstrap passed in the
  preceding maintenance batch.
- Listed discovery before execution. Used bounded, explicit cohorts, 30-second
  fixture limits, zero retries and `--native-status-redo=false`. Correctness cohorts
  used up to four jobs and one indexing thread; performance and focused repairs
  used one job. Parallel timings are diagnostic, not performance acceptance.
- Preserved original failures and timeout receipts. Later passes follow actual
  changes or an explicit environment correction. No deadline/baseline increases,
  native redo, readiness bypass, global trust grant or test quarantine was used.
- An inherited trusted-config variable named a missing file. Config-dependent
  commands cleared that invalid value only in their task shell. No user settings
  were rewritten. No active indexing job was restarted or user cache invalidated.

The six main cohorts are an exploratory baseline across an evolving working tree,
not a single immutable candidate. The preceding maintenance batch's 168 unique
passing fixtures are retained with their earlier provenance. Latest-observation
counts below combine those historical results and subsequent focused runs; they
must not be described as final-tree acceptance for all fixtures.

## Production repairs and preserved coverage

1. **Read-only path resolution:** split pure cache-root resolution from admission
   leases. Config dumps, runtime previews, missing-index status and output-path
   queries no longer create cache directories merely by resolving paths. Existing
   readers still acquire the admission lease before reading. Read-only and cache
   exclusion/admission regressions pass.
   A final cleanup-admission regression covers direct index-state reads. Its first
   selector needed correction to use the real per-mode override. That reader now
   acquires admission explicitly and propagates cleanup exclusion, including when
   no current-build pointer exists.
2. **Embedding identity and artifact authority:** query stub intent now uses the
   shared embedding-intent resolver, matching builder/config/environment intent.
   Synthesized vector manifests use the canonical format constant. Required
   manifest failures propagate; undeclared/raw JSON cannot bypass that authority.
   Native ANN, identity mismatch and vector-source regressions retain coverage.
3. **Missing modes and unsupported artifacts:** an absent directory returns no
   index state; an existing directory without a current identity remains rejected.
   API/MCP missing-index errors now retain their intended contract. Filter-only
   enumeration separately requires every requested mode, including extracted prose,
   so it cannot silently omit an unavailable mode. Its existing negative assertion
   and pagination/generation checks pass.
4. **Loader byte limits:** non-strict artifact loading reaches its existing
   fallback for infinite limits; strict Infinity rejection remains covered.
5. **Stable content hashes:** exclude only `extensions.runtimeAttemptId` from
   content identity. The writer binds that field to a random runtime invocation.
   A regression compares different attempts and still rejects changes to generated
   protocol metadata. The shard comparison continues to expose a separate semantic
   coverage generation-identity mismatch; it has not been suppressed.
6. **Windows trust identity:** native `realpath` resolves the filesystem's actual
   casing. Reproduction showed the same approved directory became untrusted after
   MCP normalized its casing. The new regression preserves exact identity and
   rejects parent/child/sibling, relative, malformed and absent grants. It and the
   Rust/tool-cache authority and MCP context cases pass. Symlink authority cases
   remain blocked by this host's file-symlink permission.

Test repairs use current producer contracts instead of weakening consumers:

- Canonical artifact/schema constants replace missing/stale fixture identities;
  strict old-format rejection remains a negative test. Legacy MessagePack buffer
  representation and legacy metadata *fields* remain covered inside current
  envelopes. Incremental fixtures use the manifest codec, current namespace and
  immutable snapshot writer, retaining missing-parent mapping diagnostics.
- Positive compiler/editor/runtime fixtures explicitly select their executable or
  fixture-owned trust. Untrusted compiler and runtime-option rejection remains
  covered. Native scheduler fixtures close their owned resources explicitly.
- Async import parity normalizes measured stage elapsed times only, after checking
  finite nonnegative values; counters and graph data remain compared. Path checks
  use the existing identity/platform rules. Stage expectations follow the current
  scheduler owner. No semantic producer version was changed by these repairs.
- Fifteen Node wrappers use the existing test subprocess helper instead of adding
  exceptions to the residual raw-spawn policy. The migrated semantic authority
  fixture still times out and is listed below. The standalone TypeScript scaling
  harness is bounded diagnostic evidence, not a production throughput benchmark.
- Two archive tests previously raced over fixed `dist` names. They now share a
  bounded directory lock, snapshot the four prior archive/manifest files and restore
  them. Both pass concurrently. This is fixture isolation, not release acceptance.
- Split CLI suites preserve every missing-value flag and workflow rejection/help
  case in smaller fixtures; parent coverage remains. Added ordered-lane membership
  for split cases where the parent was ordered and for rediscovered helper tests.
  Ownership mappings record the retained parents and partitions.
- Discovery no longer excludes executable `tests/helpers/*.test.js` or loses
  directly assigned `ci-long` tests through alias expansion. Nine helper tests and
  three direct long-lane assignments are discoverable. Real fixture source inputs
  remain excluded. A new regression protects the inventory boundary.

## Legacy removal proof

The initial static pass examined 5,200 tracked JavaScript/CommonJS/ESM files. AST imports,
literal dynamic imports/requires, subprocess/URL/text references, exported symbols,
ordered manifests and Git history were used together. Lack of an import alone is
not proof of obsolescence. Only these two private test helpers were removed:

| Removed file | Proof and replacement owner |
| --- | --- |
| `tests/helpers/lane-resolution.js` | No import or path/text consumer; its exported `resolveCurrentTestLane` had no consumer. The runner's lane assignment and ordered manifests own actual selection. Git blob `723e81cc1399e986d8c9decdab80e39fb370a7ef`, last change `d38738d1a`. Discovery/lane regressions preserve that behavior. |
| `tests/helpers/path-policy.js` | Unused eight-line re-export; no consumer references this helper path. Basename hits refer to other real path-policy owners. Existing tests import `src/shared/file-paths.js` directly; its path-handling regressions pass. Git blob `53c09e3a0c6a21d965986259769bf4e2ef651868`. |

No test was removed. All nine production zero-import candidates are used as worker,
subprocess or browser entrypoints and remain. Two semantic helper subprocess
entrypoints remain. The duplicate Windows command implementation is a packaged
editor mirror with parity coverage; tiny duplicate editor executables are deliberate
fixture inputs. The single parser error is a Flow-language fixture, not broken
application JavaScript. Dynamic resolution and external consumers limit static
analysis; this audit does not claim every unobserved branch is dead.

Shared-module review inventories now account for the previously omitted active
owners. Their original review dates are retained and the October 18 inventory-only
reconciliation is explicit. This is not behavioral qualification of every owner.
The structural import budget remains failing; its baseline was not increased.

## Platform and performance qualification

Rust 1.88.0 passes `cargo fmt --check`, `check --locked --offline`, all eight
unit tests, and `clippy --locked --offline -- -D warnings` on Windows. A new Rust
viewport boundary test complements the updated JavaScript source contract.
Cargo was initially absent from PATH; an explicit task-local PATH selects the
installed pinned toolchain. TUI build/manifest verification, native frame capture
and headless smoke then pass within the 30-second fixture limit.

The three native lifetime fixtures require POSIX PTY/termios/fcntl. Their Windows
skip now states that ConPTY qualification is pending. Windows child reaping,
terminal restoration and native UI lifetime are not thereby qualified. Linux and
macOS were not available to this task; their configured jobs are not current proof.

Of 105 `perf/` cases, 104 have passing latest observations after seven fixture
corrections. Most check correctness/resource caps rather than measured speed.
The SQLite warm-query check now requires actual source hits before collecting
20 samples across two queries. That stronger assertion **fails for `answer`**.
An earlier run measured p95 165.4 ms against the unchanged Windows 7,500 ms
ceiling, but did not require hits for both queries. That timing is retained as
historical diagnostic output and **does not qualify useful retrieval latency**.
Keep the new assertion; investigate extraction/query eligibility before accepting
the measurement. VFS cache-entry/byte plateaus do not establish retained-heap
bounds. The shared-module performance fixture is a
separate failing coupling budget: direct/transitive growth, not a failed latency
measurement. Do not raise its limits as a substitute for dependency review.

Real model/provider execution, representative-corpus relevance, retained heap,
multi-OS native teardown and complete release acceptance remain unqualified.
The matrix recommends a small mandatory OS/native lifecycle surface, isolated
measured regression checks, and separately scoped representative workload work.

## Remaining failures and execution evidence

The renewed Windows native process failures are new evidence reopening the former
non-reproduced case. Independent build/query routes returned `0xC0000005`; several
logs end around worker-pool destruction. This identifies an observation boundary,
not a proven faulting module or stack. Other native routes pass; they do not erase
the failures. No retry/backend substitution is used as closure.

FTS explain still yields no hit for a fixture term that direct SQLite MATCH can
find. A task-local cold run disabled query caching and still showed zero eligible
sparse candidates, so a cache hit alone does not explain it. Preserve the failing
test and investigate AST eligibility/provider routing. Semantic precision, provider
preflight, API as-of/runtime/risk contracts and aggregate timeouts below remain
unresolved. Assertion failures are observations, not automatic proof of a stale
test. Aggregate script-coverage wrappers need useful bounded ownership, not larger
deadlines or duplicate broad campaigns.

Raw `.testLogs` and `temp/tasks/deep-test-audit-20261018/` files are historical
author-workspace receipts. They are ignored, not promised in a clean checkout.
The tables retain report/log provenance so local observations can be traced;
rerun the selected fixtures to establish acceptance elsewhere.

<!-- audit-evidence:start -->

### Inventory and cohort receipts

Final discovery: **2732 fixtures**. Latest observations: **2656 passed, 65 failed (including watchdog timeouts), 11 skipped**. All discovered IDs have an observation; the skip rows below are not executed coverage. 97 IDs with earlier failures subsequently pass. This combines evolving-tree cohorts and the preceding 168-fixture maintenance batch; it is not final-tree acceptance.

| Report in task receipt directory | Passed | Failed (timeouts) | Skipped | Historical log directory |
| --- | ---: | ---: | ---: | --- |
| foundation-report.json | 360 | 19 (2) | 2 | run-1792330389601-ut050l |
| discovery-identity-report.json | 12 | 2 (0) | 0 | run-1792330885425-b45yz8 |
| data-report.json | 393 | 26 (3) | 1 | run-1792330607063-s6lqi0 |
| repairs-one-report.json | 27 | 4 (0) | 0 | run-1792331244463-lfriho |
| tooling-report.json | 486 | 52 (13) | 1 | run-1792330967471-698p3x |
| repairs-two-report.json | 17 | 4 (0) | 0 | run-1792331685085-0m501v |
| indexing-report.json | 833 | 33 (4) | 0 | run-1792331463489-x9k34w |
| other-report.json | 205 | 23 (7) | 4 | run-1792331617651-ya7mdg |
| repairs-three-report.json | 25 | 5 (0) | 0 | run-1792332183625-gqe04u |
| perf-report.json | 98 | 7 (0) | 0 | run-1792332380219-89kq2b |
| perf-repaired-report.json | 8 | 1 (0) | 0 | run-1792332813080-zk3x3i |
| archive-isolation-report.json | 2 | 0 (0) | 0 | run-1792332998115-n50tx0 |
| repairs-four-report.json | 16 | 3 (0) | 0 | run-1792333006634-82fhfh |
| repairs-five-report.json | 5 | 2 (0) | 0 | run-1792333442082-i4zqao |
| wrapper-migration-report.json | 12 | 2 (1) | 0 | run-1792333567621-lnfy11 |
| repairs-six-report.json | 2 | 2 (0) | 0 | run-1792333654941-s2ba7j |
| platform-report.json | 5 | 0 (0) | 3 | run-1792333686185-xp780o |
| final-repairs-report.json | 11 | 2 (0) | 0 | run-1792333783352-yiibzw |
| fixture-final-report.json | 1 | 1 (0) | 0 | run-1792333868457-mug93b |
| trust-identity-report.json | 4 | 0 (0) | 0 | run-1792333912134-podmey |
| front-gate-report.json | 39 | 0 (0) | 0 | run-1792334209948-zu7201 |
| state-admission-red-report.json | 0 | 1 (0) | 0 | run-1792334271255-rugkls |
| state-admission-final-report.json | 7 | 1 (0) | 0 | run-1792334298697-pauvlx |
| state-admission-corrected-report.json | 1 | 0 (0) | 0 | run-1792334341456-xor02e |
| final-governance-report.json | 6 | 0 (0) | 0 | run-1792334424273-7r26i1 |
| sqlite-qualified-report.json | 0 | 1 (0) | 0 | run-1792334445825-sczyeo |
| final-policy-report.json | 2 | 0 (0) | 0 | run-1792334511966-kecxd2 |

Rows overlap. Do not sum them as unique coverage. Raw failure logs use the runner's test-ID filename within the listed log directory. `prior-accepted-ids.txt` records the earlier maintenance selection. `audit-summary.json` records per-ID provenance and latest status.

### Unresolved observations

| Fixture ID | Status | Observation | Source report |
| --- | --- | --- | --- |
| cli/general/signal-cleanup | skipped | POSIX parent-signal cleanup; Windows TerminateProcess requires native acceptance. | foundation-report.json |
| indexing/embeddings/stub-fastpath-cache-contract-matrix | failed | Native process failure 0xC0000005; faulting component unproven | indexing-report.json |
| indexing/extracted-prose/document-extraction-cache-policy-key | timeout | 30-second watchdog (timed_out_with_failure) | indexing-report.json |
| indexing/map/code-map-contract-matrix | failed | Native process failure 0xC0000005; faulting component unproven | indexing-report.json |
| indexing/ordering/ordered-completion-tracker | timeout | 30-second watchdog (timed_out_after_pass) | indexing-report.json |
| indexing/semantic/compiler-bindings | failed | Native process failure 0xC0000005; faulting component unproven | indexing-report.json |
| indexing/semantic/embedded-cache | failed | AssertionError [ERR_ASSERTION]: refresh compiler/provider binding inventory before requesting unresolved positions | indexing-report.json |
| indexing/semantic/embedded-source | failed | Native process failure 0xC0000005; faulting component unproven | indexing-report.json |
| indexing/semantic/native-deferred-production | failed | Error: Native provider command is unavailable. | indexing-report.json |
| indexing/semantic/native-task-authority | failed | Error: Native provider command is unavailable. | indexing-report.json |
| indexing/semantic/ordered-aggregate-flow | failed | AssertionError [ERR_ASSERTION]: fully drained compiler trace backend parity | indexing-report.json |
| indexing/semantic/ordered-snapshot-flow | timeout | 30-second watchdog (timed_out_with_failure) | indexing-report.json |
| indexing/semantic/production-slice | failed | AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: | indexing-report.json |
| indexing/semantic/rest-call-context | failed | AssertionError [ERR_ASSERTION]: fully drained compiler trace backend parity | indexing-report.json |
| indexing/semantic/ssr-snapshot-witness | timeout | 30-second watchdog (timed_out_with_failure) | indexing-report.json |
| indexing/shards/shard-merge | failed | semantic_coverage.json generation.baseBuildId differs; no generic semantic-field suppression | repairs-six-report.json |
| lang/contracts/managed-heuristic-adapters | failed | AssertionError [ERR_ASSERTION]: groovy should not be marked as import-collector downgrade | other-report.json |
| perf/sqlite-p95-latency | failed | AssertionError [ERR_ASSERTION]: latency sample for answer must retrieve the indexed source | sqlite-qualified-report.json |
| retrieval/output/explain-includes-routing-and-fts-match | failed | Expected FTS prose hit absent; cold diagnostic also has zero eligible sparse candidates | repairs-four-report.json |
| runner/harness/redo-target | skipped | redo target is helper-only | other-report.json |
| runner/harness/skip-target | skipped | skip target requested | other-report.json |
| runner/harness/timeout-pass-signal-target | skipped | timeout pass-signal target is helper-only | other-report.json |
| runner/harness/timeout-target | skipped | timeout target is helper-only | other-report.json |
| security/editor-tui-authority | failed | EPERM creating a file symlink; authority assertions remain unqualified | foundation-report.json |
| security/repository-authority | failed | EPERM creating a file symlink; authority assertions remain unqualified | foundation-report.json |
| services/advanced-surface-goldens | timeout | 30-second watchdog (timed_out_with_failure) | other-report.json |
| services/api-search-asof | failed | AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: | other-report.json |
| services/api/risk-pack-metrics | failed | AssertionError [ERR_ASSERTION]: expected synthetic pack to exercise capped metrics | other-report.json |
| services/api/runtime-claims | failed | TypeError: Invalid runtime claims claimsService: data/request/claimGeneration must be string | other-report.json |
| services/api/semantic-detail | timeout | 30-second watchdog (timed_out_with_failure) | other-report.json |
| services/api/semantic-trace | timeout | 30-second watchdog (timed_out_with_failure) | other-report.json |
| services/api/trust-boundary-matrix | timeout | 30-second watchdog (timed_out_with_failure) | other-report.json |
| services/core-observability | failed | Native process failure 0xC0000005; faulting component unproven | other-report.json |
| services/indexer/quarantine-cli | timeout | 30-second watchdog (timed_out_after_pass) | other-report.json |
| services/mcp/robustness | timeout | 30-second watchdog (timed_out_with_failure) | other-report.json |
| services/mcp/tool-search-defaults-and-filters | timeout | 30-second watchdog (timed_out_with_failure) | other-report.json |
| shared/kill-tree.posix | skipped | posix kill-tree test skipped on windows | foundation-report.json |
| shared/subprocess/quoting | failed | Exit 1; inspect preserved first-attempt log | foundation-report.json |
| storage/semantic/runtime-opened-byte-integrity | failed | AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: | data-report.json |
| storage/semantic/runtime-source-reference-authority | timeout | 30-second watchdog (timed_out_with_failure) | wrapper-migration-report.json |
| storage/sqlite/ann/sqlite-extension | skipped | sqlite-vec extension missing; skipping test. (C:\Users\sneak\AppData\Local\PairOfCleats\extensions\sqlite-vec\win32-x64\vec0.dll) | data-report.json |
| storage/sqlite/incremental/bundle-partial-chunk-fallback | timeout | 30-second watchdog (timed_out_with_failure) | data-report.json |
| storage/sqlite/index-state-fail-closed | timeout | 30-second watchdog (timed_out_with_failure) | data-report.json |
| tooling/doctor/generic-preset-matrix | failed | AssertionError [ERR_ASSERTION]: expected command check for lsp-rust-analyzer | tooling-report.json |
| tooling/doctor/zls-zig-compatibility | failed | AssertionError [ERR_ASSERTION]: expected zls-zig compatibility check | tooling-report.json |
| tooling/eval/risk-pack-quality | failed | AssertionError [ERR_ASSERTION]: expected risk-pack eval gates to pass: file:///C:/Users/sneak/Development/PairOfCleats/src/contracts/index-format.js:24 | tooling-report.json |
| tooling/fixtures/fixture-eval | timeout | 30-second watchdog (timed_out_with_failure) | tooling-report.json |
| tooling/fixtures/fixture-parity | timeout | 30-second watchdog (timed_out_with_failure) | tooling-report.json |
| tooling/install/tooling-missing-requirement-exitcode | timeout | 30-second watchdog (timed_out_with_failure) | tooling-report.json |
| tooling/install/uninstall | skipped | excluded tag: destructive | tooling-report.json |
| tooling/lsp/configured-provider-gopls-preset-profile | failed | AssertionError [ERR_ASSERTION]: expected configured gopls preset provider to enrich target | tooling-report.json |
| tooling/lsp/configured-provider-gopls-profile | failed | AssertionError [ERR_ASSERTION]: expected configured gopls provider to enrich target | tooling-report.json |
| tooling/lsp/configured-provider-lua-broken-layout-preflight | failed | AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: | tooling-report.json |
| tooling/lsp/dedicated-providers-abrupt-failure-cleanup | failed | Error [AbortError]: This operation was aborted | tooling-report.json |
| tooling/lsp/dedicated-providers-multifile-session-reuse | timeout | 30-second watchdog (timed_out_with_failure) | tooling-report.json |
| tooling/lsp/go-workspace-managed-go-resolution | failed | AssertionError [ERR_ASSERTION]: expected managed local go shim to satisfy workspace preflight | tooling-report.json |
| tooling/lsp/provider-quarantine-recovery | failed | AssertionError [ERR_ASSERTION]: expected explicit quarantine warning during cooldown | tooling-report.json |
| tooling/release/verify-surface-mcp-smoke-runtime | failed | Exit 1; inspect preserved first-attempt log | tooling-report.json |
| tooling/reports/summary/report | failed | Native process failure 0xC0000005; faulting component unproven | tooling-report.json |
| tooling/script-coverage/core | failed | Error: No extension binary found in C:\Users\sneak\Development\PairOfCleats\.testCache\download-extensions\zip-slip\.tmp\download-xes4Xz\source.zip | tooling-report.json |
| tooling/script-coverage/embeddings | timeout | 30-second watchdog (timed_out_after_pass) | tooling-report.json |
| tooling/script-coverage/fixtures | failed | Error: ERR_INDEX_FORMAT_UNSUPPORTED: Cannot read semantic operation index at C:\Users\sneak\Development\PairOfCleats\.testCache\fixture-sample\cache\repos\sample-df2c7efb3d78\builds\20261010T140948Z_e2486884_4c358b9_c3481d5d\index | tooling-report.json |
| tooling/script-coverage/indexing | timeout | 30-second watchdog (timed_out_after_pass) | tooling-report.json |
| tooling/script-coverage/language | timeout | 30-second watchdog (timed_out_after_pass) | tooling-report.json |
| tooling/script-coverage/search | timeout | 30-second watchdog (timed_out_after_pass) | tooling-report.json |
| tooling/script-coverage/services | timeout | 30-second watchdog (timed_out_after_pass) | tooling-report.json |
| tooling/script-coverage/storage | timeout | 30-second watchdog (timed_out_after_pass) | tooling-report.json |
| tooling/script-coverage/tools | timeout | 30-second watchdog (timed_out_with_failure) | tooling-report.json |
| tooling/shared-module-performance | failed | Existing direct/transitive import-count budgets exceeded; baseline preserved | perf-repaired-report.json |
| tooling/testing/search-debug-capture | timeout | 30-second watchdog (timed_out_after_pass) | tooling-report.json |
| tooling/triage/context-pack | failed | Native process failure 0xC0000005; faulting component unproven | tooling-report.json |
| tooling/type-inference/tooling-diagnostic-retention | failed | AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value: | tooling-report.json |
| tooling/typescript-root-aliases | timeout | 30-second watchdog (timed_out_with_failure) | tooling-report.json |
| tui/native-quit-lifetime | skipped | native TUI lifetime fixture requires POSIX PTY/termios; Windows ConPTY qualification remains pending | platform-report.json |
| tui/native-supervisor-error-lifetime | skipped | native TUI lifetime fixture requires POSIX PTY/termios; Windows ConPTY qualification remains pending | platform-report.json |
| tui/native-terminal-error-lifetime | skipped | native TUI lifetime fixture requires POSIX PTY/termios; Windows ConPTY qualification remains pending | platform-report.json |

These are the latest observed symptoms, not automatic root-cause classifications. Test-only harness targets intentionally skip direct execution; their parent runner tests cover their behavior. The destructive uninstall fixture remains excluded. POSIX skips, optional sqlite-vec unavailability and Windows symlink failures remain explicit gaps.

### Final bounded checks

`npm run format` passed after the repairs. `npm run test:refresh-governance` passed: zero missing IDs, duplicates, manifest mismatches or timing overruns. It regenerated reports from existing historical timing sources without manufacturing new lane timing evidence. The TypeScript finite-language diagnostic harness completed all eight fixed cases; its single samples do not establish production throughput.

| Front-gate check | Result |
| --- | --- |
| config:budget | passed |
| env:check | passed |
| generated freshness | FAILED (exit 1) |
| generated freshness | passed |
| command surface | passed |
| workflow contract | passed |
| gate lane | passed |
| diff whitespace | passed |

The initial freshness failure was a stale documentation assertion requiring the shared-module initiative to remain closed. It now requires the reopened status and concrete failing fixture; freshness then passes. All 39 gate fixtures pass. After the final direct-state admission change, affected format/identity contracts, API/MCP errors, filter enumeration and cache exclusion pass; the corrected explicit-path regression also passes. Shared-ledger/cycle/review, taxonomy, documentation and residual subprocess policies pass against the resulting sources. The final latency correctness assertion deliberately remains failing.

No push, merge or hosted final-head acceptance is claimed. The preceding GitHub inventory is in the maintenance receipt; local dirty-worktree results are distinct.

<!-- audit-evidence:end -->
