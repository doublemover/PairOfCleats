# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-21
Last reconciled: 2026-10-21
Canonical for: initiative status, execution order, and remaining work

## Repository maintenance audit, October 18

Work continues on `codex/pr557-audit-repairs-20261012` from audited base
`ab00d918d`; the archive retains the original upstream reconciliation.

The October 20 live inventory now has 84 open issues (#584–#667), repair PR
[#572](https://github.com/doublemover/PairOfCleats/pull/572) against `main`, and
11 original Dependabot PRs (#573–#583). Dependency-upgrade review remains separate.
The [issue repair receipt](archived/github-issue-repairs-2026-10-20.md) tracks
every issue and its acceptance. All 84 are in scope, including TUI functionality,
optional tooling, representative workloads and Linux/macOS deep qualification.
P1 publication and resource-lifecycle defects are first; the earlier green
campaign below does not establish that the newly reported bugs are fixed.
Seventy-seven issues have implemented repairs. The six later correctness repairs
(#662–#667) retain Windows/Linux checks and front gates in the archive.
MinHash source `cfc5cbf9a` passes the same 221 unique affected/contract cases on both
OSes, including real workers/LMDB, records and 100 required SQLite cases. Its
calibrated family, incremental signature 12 and SQLite schema 16 reject old hashes.
Those observations do not qualify later sources or full deep/platform acceptance.
The linked receipt retains original
failures, source identities, obsolete-code proofs, assertion mappings and every affected check; all
issues remain open until their own acceptance and publication are verified.
Canonical settings (#633) and repository search (#634) now connect the native
keyboard path to real supervisor operations. Search includes ordered results,
supported cursors, bounded source previews and confirmed trusted editor launch.
Source `208395791` adds #635's typed index/watch/validation/report/stats, seven
snapshot and workspace-build workflows, preserving #638's verified artifact actions.
Previews bind scope, configuration sources and reserved job identity; process exit
does not establish publication readiness. Snapshot directory copying, nullable
artifact sizes, checksum selection and terminal-worker disposal gain regressions.
Windows passes 52 native cases and 234 unique selected checks; Linux passes 34
native cases and 219 unique checks. Both pass 60 Rust tests, native/patch verification
and complete front gates. The 216 common IDs and all platform exclusions are
reconciled in the archive. These are selected checks, not a current full-deep pass.
The 49-case Windows file-link authority cohort still requires a capable launch;
the fresh actual probe gets EPERM. Hosted/macOS execution remains external.

Earlier `720bfbd0a` CI (39495523746) passes Linux/macOS, Rust, gate, 47 Windows
authority cases and five ownership cases. Its baseline timeout now has bounded
owners retaining all nine child checks. SQLite worker-start and cold PowerShell
stalls remain unattributed; serial/timing controls preserve their original bounds.
Publication and PR refresh remain blocked by automatic approval review; local
commits and exact-source checks continue, without an alternative publication route.

Frozen `ffde426be` passes 2982 Windows cases across 48 cohorts, with 17 declared
exclusions, 16 supplementary passes and seven green PR checks. Its receipt maps
all 65 original failures, including 27 timeouts. Later repairs retain separate
checks; that frozen result does not qualify the current source.

Remaining implementation/qualification owners are #636–#637 and #639–#640 (setup/service,
recorded-session and registered-analysis native workflows), #630
(Linux/macOS deep/native/package acceptance), #631 (real tooling/platform gaps)
and #632 (representative retrieval/freshness/memory/model evidence). Real Windows
Pyright, Go 1.27.3/gopls and .NET 10.0.113/csharp-ls startup/shutdown have separate
receipts. The clean WSL checkout qualifies approved PHPactor bytes on PHP 8.3.6;
native Windows POSIX support is explicitly unavailable. LSP disposal now awaits
observed exits across cancellation/restart. Ruby startup/install warnings, the
macOS `fsevents` policy warning and later hosted tool execution remain open.
Fresh Solargraph 0.61.0 checks still miss their original deadline. An isolated
RubyGems update also fails; neither the runtime nor probe bounds are changed.
Detection, startup and semantic precision remain distinct; no failed readiness
or warning is suppressed. The clean Linux locked rebuild also exposes two Perl
scanner fall-through compiler warnings; quiet readiness verification does not
erase those diagnostics or qualify their parsing/lifecycle behavior.

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
That earlier batch covers 168 distinct fixtures, including 50 recent-change
regressions, 78 governance cases and a 39-case front gate. Its original taxonomy
failure and repaired checks remain recorded. These results precede the deeper
repairs below and do not qualify their final working tree.

## Deep test audit, October 18

The [original audit](archived/deep-test-audit-2026-10-18.md) preserves failures,
timeouts and removal proof. The [Windows repair receipt](archived/windows-deep-repairs-2026-10-18.md)
records immutable candidate identities, all original-failure coverage mappings,
dependency verification, crash attribution, raw-receipt provenance and limits.
The [qualification matrix](testing/qualification-matrix.md) separates required
platform behavior, structural budgets and measured performance.

The Windows deep suite is **green** at `ffde426be`: 2982 required cases pass
first attempt within 30 seconds, with zero retries/native redo. All 2999
discovered cases have an explicit disposition; the 17 platform/helper/optional
exclusions retain coverage owners and original assertions. Three excluded script
wrappers return declared status 77; no required case is skipped. The slowest
required case is 24.094 seconds. The 16-case serial supplement also passes.
Linux/macOS full deep execution, optional sqlite-vec/Tantivy, Bash/jq helpers,
representative workloads, real models and release qualification remain separate.

The original access violation is a Node 26.8.1 worker-teardown use-after-free,
identified from a matching-symbol CDB dump and the upstream ASAN regression.
Node 26.10.0 fixes the demonstrated owner; the pin, engine floor, lockfile,
bootstrap and bounded VM lifecycle probe agree. The original installation and
dump remain preserved. Ten explicit fresh-process compiler/embedded-source
controls pass after repair; every original crash route passes again in the
complete frozen campaign with normal production settings. Clean verification
reports 37 packages/33 routes, without warning/error lines. Activation is distinct
from runtime lifecycle qualification.

All 51 serial native/TUI cases pass, including real ConPTY quit, supervisor error,
terminal transport error, descendant reaping and terminal restoration. The strict
hosted Windows job passes all 44 real file-symlink authority cases at the exact
head/tree, without security-setting changes. All three separate Windows subprocess
ownership cases pass. All 101 serial performance fixtures pass; both SQLite
queries retrieve the expected source before 20 warm samples, p95 170.7213 ms
below the unchanged 7500 ms bound. The original coupling budgets pass unchanged.
Map-cache isolation passes locally in 17.171 seconds; broad Windows CI takes
39.669 seconds under its separate 600-second deadline, not strict qualification.
All diagnostic warning/error lines have asserted owners; none is unexplained.

Meaningful content, authority and invalid-request assertions remain. Only two
proved-unused private test helpers were removed; no test or production entrypoint
was deleted. Split wrappers retain their assertions, script claims and ordered
membership. Exact NTFS identities, append-close draining and the descriptor-zero
fixture have retained before/after proofs. Contributor caches and coverage use
`temp/dev/`; original logs stay under ignored `.testLogs/`, and old caches
were reversibly archived. See the [workspace layout](guides/setup.md#contributor-workspace-files).

Remaining execution order:

1. Finish native index/setup/service/artifact/session/catalog workflows (#635–#640).
   Preserve qualified regressions and rerun affected checks as owners change.
2. Qualify Linux/macOS full deep behavior and supported native release targets.
   Keep Linux ELF positives distinct from Windows unsupported-platform coverage.
3. Run optional backends, installed providers/models and representative corpus,
   edit-to-search, retained-heap and release campaigns only for the claims needed.
4. Review dependency-upgrade PRs separately; retain original import budgets and
   measured samples instead of increasing thresholds to accommodate failures.

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
| Shared-module reduction | `coupling audit open` | Six ownership batches retain their backlog; current inventory omissions are reconciled explicitly. | Retain fixes for the October 18 direct/transitive import-budget failures without raising baselines; measure remaining startup/coupling work separately. |
| Duplicate-code reduction | `checkpoint clean` | The May refresh found no current fragments among 212 saved candidates. | A future intentional full audit refresh, not ad hoc rework of stale saved-report entries, establishes a new repository-wide baseline. |
| Production readiness | `deferred validation` | Release tooling and bounded platform/security receipts remain revision-specific. | Run production verification and release-readiness evidence against the final candidate; later security changes require their own merge and rescan. |
| Phase 0.5 language/framework execution contract | `implemented` | Capability matrices, language adapters and executable conformance lanes are present. | Preserve the contract and rerun affected language/tooling acceptance when those owners change. |
| Worklogs and benchmark JSON under `docs/worklogs/**` | `historical evidence` | Historical measurements and authored worklogs remain preserved. | Keep new execution status here; label measurements with their exact revision and environment. |


## Current Validation Boundary

Current reconciliation, 2026-10-21: the prior 45-item implementation audit retains
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
