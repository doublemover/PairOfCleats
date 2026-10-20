# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-20
Last reconciled: 2026-10-20
Canonical for: initiative status, execution order, and remaining work

## Repository maintenance audit, October 18

Work continues on `codex/pr557-audit-repairs-20261012` from audited base
`ab00d918d`; the archive retains the original upstream reconciliation.

The October 20 live inventory has 78 new open issues (#584–#661), repair PR
[#572](https://github.com/doublemover/PairOfCleats/pull/572) against `main`, and
11 new Dependabot PRs (#573–#583). Dependency-upgrade review remains separate.
The [issue repair receipt](archived/github-issue-repairs-2026-10-20.md) tracks
every issue and its acceptance. All 78 are in scope, including TUI functionality,
optional tooling, representative workloads and Linux/macOS deep qualification.
P1 publication and resource-lifecycle defects are first; the earlier green
campaign below does not establish that the newly reported bugs are fixed.
Fifty-nine issues have implemented repairs through the twenty-second batch.
Equal-text VFS origins retain distinct compiler targets, imported types and diagnostics;
ambiguous content-only tokens fail closed. Python AST relations, defaults and Unicode
ranges, plus HTML summary metadata, survive registry/index paths.
First-run preflight has a clean fresh Windows bootstrap. TypeScript doctor,
loaders and host/preflight share version/capability admission. Release assets have
unique staged names/checksum mappings and CI Long has explicit release-only scope. GNU Global cxref ingestion
separates source text from encoded paths and owns valid query arguments; LSIF follows
result-to-range direction and document/URI authority. MCP builds retain
request cancellation through core, SQLite ingestion and publication. FTS applies query
eligibility before its candidate cap, federation enumerates exact eligible modes,
and relative modification filters bind result caches to one request cutoff.
Incoming edges retain source direction and CSR risk guidance preserves callers and graph-derived tests.
Explicit graph exclusion, semantic omissions, owner metadata restoration and
test-suggestion node caps have regressions. Earlier batches cover resource leases,
publication/cancellation, cache authority, evidence contracts, triage, setup and
editor/provider correctness. Every failed candidate and original receipt remains
in the linked issue audit. Five proven wrapper aliases are retired; broader
wrapper/direct equivalence remains open under #616.
Large semantic pieces now verify decoded blocks even with unchanged file clocks;
history import has a proven linear turn-lookup repair. Windows orphan cleanup
now reads Toolhelp snapshots, with native layout/failure and real descendant/isolation controls.
All seven hosted checks pass at `5adcb13d9` (39416248627), including broad Windows
and strict authority. Earlier CIM/SysWOW64 failures and cancelled runs retain
their source identities in the issue receipt; the supported native System32 owner
keeps its two-second bound. Later CI exposes a real preflight entry-alias bypass,
now reproduced and repaired with the existing real-path owner. Windows API core
also exceeds 30 seconds after real clangd takes 18.6 seconds; a local 20.1-second
pass does not close that hosted timeout. Fresh hosted/candidate qualification remains required.
Eight API cases and serial
production parser/summary bounds have explicit owners. Candidate qualification
remains pending; earlier passing observations do not qualify the resulting tree.
Windows acceptance is complete at frozen candidate `ffde426be`: all 2982
required cases pass across 48 explicit cohorts, with 17 enumerated exclusions.
There are no failures, timeouts, native crashes, retries or unexpected skips.
All 16 serial supplementary checks and all seven PR checks pass. The receipt
maps all 65 original failures, including 27 timeouts, to their current coverage.
Earlier failed candidates remain historical; their green observations are not
inherited. The closeout and subsequent managed-Go cache-path repair have separate
checks; they do not relabel the frozen run as a later-head whole-suite pass.
Managed-Go cache defaults and reused SDK launch paths now resolve absolutely;
explicit user caches remain active. Both path defects have real-Go before/after
controls and 22 affected passing cases; the SDK regression joins regular CI.
macOS optional-tool readiness still rejects missing PHP and unverified
Pyright/C#/Ruby installations. Its npm `fsevents` script-policy warning also
remains separate from clean Windows native setup; installed-tool qualification
stays open rather than turning successful installer exits into readiness.

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

1. Preserve the qualified Windows source and its negative/lifecycle regressions.
   Rerun affected checks whenever owners change; do not inherit a whole-suite pass.
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

Current reconciliation, 2026-10-20: the prior 45-item implementation audit retains
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
