# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-18
Last reconciled: 2026-10-19
Canonical for: initiative status, execution order, and remaining work

## Repository maintenance audit, October 18

Work continues on `codex/pr557-audit-repairs-20261012` from audited base
`ab00d918d`; the archive retains the original upstream reconciliation.

The October 19 live inventory has zero open issues, repair PR
[#572](https://github.com/doublemover/PairOfCleats/pull/572) against `main`, and
11 new Dependabot PRs (#573–#583). Dependency-upgrade review remains separate.
Candidate 20 at `a4c92cbed` closes incomplete: 940 required passes, 2042 pending,
no local failure, timeout or native crash. All six hosted jobs succeed, but the
Windows summary fixture retries an internal deadline failure. That is not clean
acceptance. Exact NTFS identity repairs retain byte caps, hard links and public
types. The append writer now drains accepted records before close and batches
queued bytes without changing per-call UTF-8 encoding. Fail-before/pass-after
controls retain every summary input and trace event under the original limits.
CI now explicitly disables retries/native redo. All 13 affected checks pass;
the new candidate still requires every cohort and fresh hosted qualification.
Earlier intermittent timings remain unattributed. The Windows receipt preserves
all partial results, raw failures and the separate 16-case serial supplement.

Runtime/setup guidance now requires Node 26.10.0 or newer within 26.x, with the
26.10.0 CI pin and locked bootstrap. The new floor follows a captured Node
26.8.1 worker-teardown use-after-free. Superseded runtime and completed roadmap
details are preserved in
the [runtime archive](archived/node-runtime-policy-2026-10-05.md) and
[pre-maintenance roadmap](archived/roadmap-pre-maintenance-2026-10-18.md).
The live npm audit reports zero known vulnerabilities; it is separate from
hosted source-security scanning and release qualification.

The preceding maintenance batch's local acceptance and scope are recorded in the
[maintenance receipt](archived/repository-maintenance-audit-2026-10-18.md).
The 50 recent-change regressions and 78 unique governance cases have passing
acceptance. The stale taxonomy fixture and its original fail-fast result remain
recorded; the repaired case and all previously unexecuted cases pass. The final
front gate passes all 39 cases and every preceding required check. These runs
and final documentation/release-metadata checks cover 168 distinct fixtures;
the standalone workflow contract also passes. These results precede the deeper
test-audit repairs below and do not qualify their final working tree.

## Deep test audit, October 18

The [deep audit receipt](archived/deep-test-audit-2026-10-18.md) records bounded
execution across physical discovery, preserved failures, repairs and removal proof.
The [qualification matrix](testing/qualification-matrix.md) separates the existing
CI/release surfaces from useful required platform and performance evidence.
The suite is **not green**. Its latest-observation inventory combines exploratory
cohorts and focused repairs; it is not an immutable final-candidate suite pass.

Delivered: pure read-only path resolution with reader admission retained; matching
embedding intent; strict vector-source manifest authority; missing-index versus
unsupported-format errors; complete filter enumeration; stable hashes excluding
only invocation identity; and native Windows trust-path canonicalization.
Fixture identities/codecs and subprocess/resource ownership are repaired.
Nine helper tests and three direct long-lane assignments were restored to discovery.
CLI partitions retain meaningful assertions. Only two demonstrably unused private
test helpers were removed; no test or production entrypoint was deleted.

In the original audit, 104 of 105 performance fixtures had passing latest
observations. The strengthened SQLite latency check then failed because
`answer` returned no source hit; its earlier fast timing was not useful
acceptance. The separate import/coupling budget also failed. Rust 1.88.0
fmt/check/eight unit tests/clippy and Windows TUI build/frame/headless checks pass.
The POSIX lifetime fixture cannot qualify Windows ConPTY behavior.

The subsequent [Windows repair receipt](archived/windows-deep-repairs-2026-10-18.md)
records passing focused fixes for exported-value extraction, lazy FTS eligibility,
API fixture authority and coupling budgets. The strengthened SQLite latency case
now retrieves both original queries and passes its unchanged threshold. Real
Windows ConPTY quit/failure/restoration/reaping checks pass after repairing a
node-pty natural-exit leak and native supervisor exit-status propagation. Setup
verification passes with a bounded PTY disposal probe. A matching-symbol CDB
dump from the original compiler fixture identifies a freed-Realm write during
Node worker teardown, matching the upstream fix in Node 26.10.0. The pin,
engine floor, locked bootstrap and a VM worker lifecycle probe now reflect that
fix. The final bootstrap had no warning or error lines; ten separate fresh
compiler/embedded-source runs and every other original crash route pass with
normal production settings. The original reporting wrapper now has bounded
mode/cache partitions. A privileged task-local Windows launch now passes real
file-symlink authority checks without changing system policy. The safe uninstall
fixture passes against marked disposable roots. Semantic trace pagination,
SSR cold, extraction-cache policy, API trust startup and
ordered-completion lifetime cases have bounded passing repairs documented in
the receipt. The TypeScript Windows VFS casing defect and diagnostic-rendering
timeout are repaired with versioned compiler/provider meaning. MCP robustness
is five bounded server cases, and search default/type/risk assertions now use
the same cache authority with the risk-bearing source pair isolated. The API
trace fixture passes; semantic-detail needs bounded cases. Incremental SSR forward-witness and
parity most recently both pass in 26.1 seconds with scoped JSONL handles;
candidate 07's preceding timeouts remain recorded. The identical
115-record/136-edge witness digest and fresh-request tamper rejection remain.
The API trace case has little timing margin. Seven dedicated LSP multifile providers now have
bounded cases with explicit trusted fixture commands and no skips. Remaining
explicit final Windows cohorts keep
the whole suite open. The original fixture-parity watchdog is fixed by passing
its built repository into the equivalence check. Split fixture-eval cases now
fail on missed expectations; the repo-self showcase revealed and closed a
Markdown fenced-code bug that dropped host prose, plus an extracted-prose eval
mode omission. Its ten original queries pass against a disposable corpus of
the named production sources. Per-file signature version 8 rejects old bundles.
An explicit 83-fixture original-failure selection exposed a nested task-created
cache under `sample`; default indexing and report fixture copying now exclude
test caches, with a source-only ignore regression. The affected report cases
pass individually. The cohort's Linux-only ELF fixtures are excluded from
Windows qualification, while the serial compiler/API follow-up passes. The
first 214 script cases produced 211 passes, one timeout and two documented
optional/helper exclusions. The tokenization timeout is now three bounded
comparisons with every assertion and ordered-lane assignment retained. Two
exact npm checks replace partial-command coverage claims, yielding 218 cases.
Nightly dispatch now uses those discovered cases. Stage-4 publication and
latest SQLite search retain each mode's pinned generation. Independent CLI
cases retain explicit index prerequisites. Final cohorts remain pending.
The first ordinary campaign exposed a risk-parity aggregate timeout and stale
fixture-health admission after forced termination. Four bounded parity cases
and cold/warm/manifest/data tamper regressions now pass; missing positive risk
evidence fails explicitly. Their ordered CI membership is retained.
Disposable test caches, coverage
and benchmark scratch now share `temp/dev/`; old caches were reversibly archived
with a relocation manifest. `.testLogs` retains original receipts. See the
[workspace layout](guides/setup.md#contributor-workspace-files). The preceding
repair tree passed the front gate and fresh native/patch verification; a final
rerun and complete Windows cohort remain required for the newer source.
Candidates 05–10 are historical partial campaigns in the Windows receipt;
none is final acceptance. The 17 explicit whole-case exclusions and their
coverage owners remain in the qualification matrix.

Execution order for remaining work:

1. Preserve the CDB attribution, original failing receipts and clean Node 26.10.0
   bootstrap while closing the remaining Windows correctness and timeout cases.
2. Qualify the summary and authority repairs, then run every remaining Windows
   cohort on one frozen source. Preserve negatives and real installed-tool proof.
3. Retain the now-passing original coupling budgets. Partition slow aggregate
   wrappers with explicit coverage ownership; do not raise the 30-second audit
   deadline.
4. Execute all 44 file-link cases in the strict hosted Windows job; retain real
   ConPTY lifetime checks. Linux/macOS qualification remains separate.
5. Run hosted acceptance against the actual integrated head, then representative
   corpus/model, retained-heap and release campaigns where those claims are needed.

## Delivered product follow-up

User priority order: JS/TS precision, real edit-to-search latency, search relevance,
then actionable freshness. The implementation adds immutable computed keys and
function aliases, real filesystem-watch publication/search coverage, exact symbol
and filename ranking, and bounded hash comparisons of indexed source files.
The watch experiment reproduced a Parcel subscription cleanup defect; it is
repaired. Optional MCP build imports now load on demand. Complete context-pack
responses have a 128 KiB ceiling with explicit optional-section omissions.
Whole-repository cleanup now uses local process admission/lifetime leases.
Freshness discovers new candidate files using indexing ignore/routing rules.
Ten real-index search-quality cases pass across code and extracted prose.

Validation and limitations are recorded in the
[follow-up receipt](archived/product-follow-up-2026-10-14.md).
The preceding 45-item audit table and completed product batches are preserved in
[the prior roadmap snapshot](archived/roadmap-product-wins-2026-10-14.md).
The audit classification remains 39 bounded-verified and six qualification-limited.

The [October 15 follow-up receipt](archived/product-follow-up-2026-10-15.md)
records online-GC concurrency, bounded new-file discovery, search quality and
remaining qualification limits.

Remaining work, when separately scoped:

1. Final-head hosted acceptance for the integrated PR candidate. The current
   GitHub inventory does not supply that proof; local checks remain separate.
2. Live watcher identity verification; saved watcher state still does not prove
   liveness. Bounded file discovery and hash comparisons are not an atomic snapshot.
3. Production-corpus relevance and retained-heap analysis if MCP memory remains
   a practical issue. The new eight-file, ten-query fixture is bounded acceptance.
4. Remaining semantic precision and release qualification listed below.

The earlier bounded investigation did not reproduce the old native crash. The
October 18 deep suite now supplies new native process-failure evidence and reopens
investigation as described above. Real-model and broad cross-platform acceptance
remain unqualified.

## Other current work and validation limits

The audit task does not close release-wide acceptance, full-index throughput,
optional provider/platform campaigns, or the calibrated estimator. The bounded
Windows cold-index/EBUSY scenario closed in the
[October 14 closeout](archived/product-closeout-2026-10-14.md), which retains its
initial timeouts and distinguishes the original machine state from current
cleanup evidence. Reopen that scenario only on new evidence. Native C work
is bounded to the qualified clangd authority route; other native provider and
local/cross-file precision limits remain explicit. Perfetto remains optional.

The prior roadmap's dated lineage, completed receipts, historical claims, and
release discipline are preserved in the [pre-audit snapshot](archived/roadmap-pre-audit-2026-10-12.md).
Contracts and executable tests own behavior; this page owns current status.
Historical tests are not refreshed proof for this task's branch.

Remaining semantic scope outside this task: JS/TS class/heap/call/completion
frontiers beyond the supported precise subset; Worker/WASM/provider integration;
remaining host/module precision; broader native-language analysis. Hardware
power-loss and unrelated build-writer/global disk quotas remain separate.

## Current Initiatives

| Initiative | Status | Done now | Remaining / next |
| --- | --- | --- | --- |
| Execution, storage and download authority | `implemented; focused validation` | Launch authority, native artifacts and bounded storage/download paths have regressions. | Preserve the explicit authority boundaries in the [guide](guides/execution-authority.md); native TUI and non-Linux platform acceptance remain separate. |
| Stage1 ordered throughput cutover | `implemented` | Ordered windows, commit cursors and no-gap recovery have targeted tests. | Refresh perf and memory budget tests in the release gate before release. |
| Phase 10 interprocedural risk flows | `implemented` | Risk flows, validators and consumers retain capped/deduplicated results. | Run the affected risk and release acceptance lanes on the final release candidate. |
| Phase 14 IndexRefs, snapshots, diffs, and as-of retrieval | `implemented` | Snapshot and IndexRef contracts include historical/cache-boundary corrections. | Refresh cross-platform and end-to-end snapshot acceptance before release. |
| Lexicon, relation boosts, chargram enrichment, and ANN candidate safety | `implemented` | Lexicon/chargram controls, ANN filtering and semantic constraints are implemented. | Measure representative search quality and optional native backends before release. |
| USR consolidated contract and rollout program | `implemented` | Language/framework matrices, canonical schemas and conformance surfaces are present. | Refresh technical acceptance; the former approval-lock process is archived and is not a release blocker. |
| Shared-module reduction | `coupling audit open` | Six ownership batches retain their backlog; current inventory omissions are reconciled explicitly. | Review the October 18 direct/transitive import-budget failures without raising baselines. |
| Duplicate-code reduction | `checkpoint clean` | The May refresh found no current fragments among 212 saved candidates. | A future intentional full audit refresh, not ad hoc rework of stale saved-report entries, establishes a new repository-wide baseline. |
| Production readiness | `deferred validation` | Release tooling and bounded platform/security receipts remain revision-specific. | Run production verification and release-readiness evidence against the final candidate; later security changes require their own merge and rescan. |
| Phase 0.5 language/framework execution contract | `implemented` | Capability matrices, language adapters and executable conformance lanes are present. | Preserve the contract and rerun affected language/tooling acceptance when those owners change. |
| Worklogs and benchmark JSON under `docs/worklogs/**` | `historical evidence` | Historical measurements and authored worklogs remain preserved. | Keep new execution status here; label measurements with their exact revision and environment. |


## Current Validation Boundary

Current reconciliation, 2026-10-18: the prior 45-item implementation audit retains
39 bounded-verified and six qualification-limited classifications. This
maintenance run refreshes selected product/governance checks; it does not repeat
every item's qualification.
Real-model expansion and multi-OS execution remain unqualified on this Windows
host. Their useful requirements are recorded in the qualification matrix above.
The October 14/15 front-gate receipts remain historical; they do not qualify
the current working tree. Fresh audit results are recorded in the maintenance
receipt linked above.
Hosted CI is bounded validation, not release-wide readiness. Release-wide acceptance,
optional-backend and measured-performance campaigns remain deferred.

The [October 7 closeout](guides/closeout-evidence-2026-10-07.md) and
[ordinary integration archive](archived/ordinary-integration-roadmap-2026-10-06.md)
retain their revision-specific results, including the incomplete historical run.
Historical diagnostic callback failures were reproduced; warning callbacks
cannot bypass finalization. The [bounded recovery guide](guides/recovery-low-load-2026-10-03.md)
retains that earlier correction and its resource configuration.

Gate B1-B7 technical, compatibility, matrix, conformance,
observability, quality, and security-risk controls remain the USR acceptance surface;
old green results have not been relabeled as fresh proof. Phases and lifecycle
acceptance stay in the [rollout policy](specs/usr-core-rollout-release-migration.md).

## Completed product and integration receipts

The ten-priority closeout, selected product-win table, original failures and
bounded install/upgrade proof are preserved in the
[pre-maintenance snapshot](archived/roadmap-pre-maintenance-2026-10-18.md),
[closeout receipt](archived/product-closeout-2026-10-14.md), and
[product receipt](archived/product-wins-2026-10-14.md).

PRs #556, #557 and #558 were merged in the recorded October 14 integration;
#571 also merged at `a8c19738e`. The current open follow-up is #572. Earlier
candidate/install acceptance does not qualify its newer source automatically.
The earlier Windows native crash was closed as non-reproduced in that historical
batch. The October 18 dump reopened and attributed the current worker crash.
Embedding expansion, broader semantic precision and platform
or production-scale qualification remain explicit remaining scope.

## Release discipline

Preserve revision-specific lineage and explicit launch authority. Follow
[release validation](roadmap-release-validation-plan.md) when scheduled; bounded
fixtures and setup receipts do not replace its acceptance. Update the affected
contract and this queue when behavior changes. Completed command transcripts
belong in historical receipts. [Language/toolchain acceptance](guides/language-toolchain-acceptance.md)
separates parser activation from provider initialization and real project proof.


## Validation Commands

Documentation/status checks remain bounded and preserve existing contract/link checks:

```powershell
node tests/run.js tooling/docs/contract-matrix tooling/docs/usr-contract-checklists ci/markdown-link-check --lane all --jobs 1 --timeout-ms 30000 --retries 0 --native-status-redo=false
node tools/docs/generated-surfaces.js --check-freshness
git diff --check
```

Status edits do not authorize full indexes, release campaigns or duplicate scans.
