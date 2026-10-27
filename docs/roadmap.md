# PairOfCleats Roadmap

Status: Solo owner-batched repairs resumed; bounded Windows qualification
Last audited: 2026-10-27
Last reconciled: 2026-10-27
Canonical for: initiative status, execution order, and remaining work

## Current GitHub repair program

Current reconciliation, 2026-10-27: [the closeout review](archived/github-issue-closeout-2026-10-26.md)
assessed **770 issues and 238 comments**, closing 27. Subsequent repair batches close
twenty-one more: **722 remain open**—461 awaiting qualification, 147 partial/follow-up and
114 with unresolved implementation status. The unresolved label is tracking
evidence, not proof of absent code. Every remaining issue has a completion
checklist; the linked owner queue records current execution status.

The [complete assessment](archived/github-issue-closeout-2026-10-26.json) records
remaining work, current source/test mappings and exact closure witnesses.
At `accf98f64`, 27 focused Windows checks pass with zero failures/timeouts/skips/
crashes/retries; native/patch verification is clean. This does not qualify the
full suite or other new batches. [Implementation receipts](archived/solo-issue-repairs-2026-10-25.md)
retain source checkpoints and the [prior inventory](archived/github-issue-coverage-2026-10-25.json)
remains historical. Work is solo and Windows-only. Hosted gate/policy/Rust TUI
passed at `f8532f1d2`; seven broader jobs failed (see the review).

Source-bound Windows repair and qualification receipts retain details, failing
controls and scope. Full front gates include 40/40 gate cases:

| Receipt / source | Issue scope | Passing affected checks |
| --- | --- | --- |
| [c4bec36c8](archived/remaining-issue-repairs-2026-10-26.md) | #586, #670, #811, #1642 | 29; gate repair receipt |
| [8bf742ec6](archived/service-progress-repairs-2026-10-26.md) | #1593 | 20 + full front gate |
| [9d1c90a5c](archived/cache-retirement-repairs-2026-10-27.md) | #1591, #1718 | 14 + full front gate |
| [3a1d08813](archived/runtime-p1-closeout-2026-10-27.md) | #1050, #1072–#1074, #1106, #1107 | 37 + full front gate |
| [45e216edc](archived/stage-closeout-repairs-2026-10-27.md) | #1397 | 14 + full front gate |
| [a73b37be1](archived/storage-artifact-p1-closeout-2026-10-27.md) | #1089, #1109, #1551 | 12 + full front gate |
| [7c3683ad0](archived/watch-retention-repairs-2026-10-27.md) | #690 | 38 + full front gate |
| [1f7579910](archived/cache-ownership-p1-closeout-2026-10-27.md) | #1582, #1746 | 12 + full front gate |
| [06c3324d0](archived/repository-cleanup-admission-2026-10-27.md) | Partial #1574; custom backend adoption remains | 8 + full front gate |
| [957230b12](archived/tui-install-qualification-2026-10-27.md) | #1554; actual Windows upgrade/sharing | 7 + 3 native controls + full front gate |
| [e191d2402](archived/sublime-native-registration-2026-10-27.md) | Partial #1289; native command registration repaired; search/reload pending | 30 headless + full front gate |

These are scoped observations, not a combined full-suite or platform/model/release
pass. Task checks omit only an inherited missing trusted-config selector;
user/global settings and trust rules remain intact. Common lifecycle policy
(#1267) and custom backend cleanup adoption (#1574) remain open.

Execution is solo, Windows-only and implementation-first. The [complete owner
queue](archived/remaining-issue-batches-2026-10-26.json) orders source work by
severity and shared dependencies, retaining qualification separately:

1. Remaining P1 backend cleanup ownership (#1574), then source-pinned publication (#1627).
2. Worker/child/service ownership, provider installation and compilation context
   (#631, #289), keeping live readers and original cleanup owners intact.
3. Language/semantic/replay and retrieval/API evidence contracts.
4. Native TUI/editor workflows, including the catalog-loaded blocker (#635).
5. Performance/evaluation after correctness: retained comparisons (#1663),
   representative SQLite trials (#1733) and whole-process-tree RSS (#1675).
6. Research capabilities after their prerequisite source/retrieval/evidence owners.

Frontload related implementation, then run bounded affected checks and repair
actual failures. Keep real-tool/model, non-Windows and release execution explicit;
source receipts and small fixtures do not discharge those qualifications. Earlier
completed detail remains in the linked repair archives.

Previous validation reconciliation, 2026-10-24: the user replaced the proposed full Windows
rerun with **targeted re-checks** of failures and changed shared owners. Work is
solo; workers remain parked. The [current validation receipt](archived/windows-solo-validation-2026-10-23.md)
separates current observations from older qualified sources. Prior source-bound checks are preserved in that receipt.
Gate B1-B7 technical, compatibility, matrix, conformance, observability, quality, and security-risk controls remain subject to current validation.
The [459-case re-check receipt](archived/windows-historical-rechecks-2026-10-24.md)
records 32 baseline passes, 426 failures (10 timeouts) and one POSIX exclusion.
Focused repairs through `f6c7812a4` move 73 failures to passing: latest scoped
counts are 105 passes, 353 failures and one exclusion (nine timeouts remain).
The [360-item implementation queue](archived/windows-360-failure-repair-attempts-2026-10-24.json)
tracks all 360 initial attempts: 308 unvalidated repairs, 25 unresolved causes,
20 existing owner repairs and seven earlier tested repairs. The [360-case re-check](archived/windows-360-recheck-2026-10-24.json)
passed 260; 100 failed (seven timeouts), with no skips or access violations. A [focused re-check](archived/windows-targeted-rechecks-2026-10-24.json) moved 96 to passing; 4 await closure.
The
[next repair receipt](archived/windows-failure-repairs-2026-10-24.md) records
37 passing checks plus 15 cache/setup, 12 import/lease, 19 runtime and eight coverage/probe checks; heap
acknowledgement, batch byte receipts and closed admission now work correctly.
It also records dependency, regex/PHP, preflight, delegation, MCP, VSIX and fallback fixes. No access violation was
recorded; these observations are not a final-tree deep-suite pass.
The earlier CDB-attributed
Node-API finalizer lifetime repair retains its fail-before, ten-process and
exposing-fixture evidence; no crash workaround or Node downgrade is used.
Older campaign details remain in the linked source-bound receipts.
The current narrow security repair excludes DOCX deleted/moved-from text,
versions extraction and bundle reuse, and corrects UNC service-root authority.
Focused regressions and the 40-case front gate passed and were published. Existing
published document indexes need a normal rebuild to reflect corrected extraction.

Continue on `codex/pr557-audit-repairs-20261012` through
[PR #572](https://github.com/doublemover/PairOfCleats/pull/572), retaining its
existing `main` base. Node is **26.12.1**. Publication is authorized; no merge is
authorized. The user resumed work **solo**, with all workers parked, and requested
source implementation first on October 25, with functional execution deferred
until the implementation batches are ready. Formatting and static checks continue. Commit and push completed batches;
refresh the PR overview at least every 20 commits.

The historical October 23 snapshot contained **1,151 open reports (#147–#1722)**: P0 0,
P1 58, P2 574, P3 105, P4 0, Perf 125, and other/unprioritized 289.
Compared with the previous 970-report snapshot this adds 181 reports, including
12 older/reopened reports. Titles supply priority; labels do not supply those
priorities. The [solo repair receipt](archived/solo-issue-repairs-2026-10-23.md)
records this delta, reviewed scopes, source checkpoints and unfinished owners.
The [prior comprehensive receipt](archived/github-issue-repairs-2026-10-21.md)
and [pause handoff](archived/implementation-pause-2026-10-23.md) retain the
previous wave's detailed mappings and provenance. Open status, source changes
and accepted issue closure are separate facts.

Earlier solo source batches repaired exact embedding/cache identities, sparse Boolean
completion and execution-qualified result reuse, offsets/bitmap/signed ranking,
transactional TUI installation, document/wire/lease/method LSP lifetimes, and
original SQLite/profile/native-read failure propagation. Those historical
counts are superseded by the current intake above. These implementations and their authored
regressions remain unqualified; category cleanup/parent drain and the broader
intake remain unfinished. LSP identity is 47/rq11; offline runtime parser is 4.

### Execution order

1. **P0–P4 first**, prioritizing destructive authority/data-loss and lifecycle
   failures within a priority. Batch shared owners rather than issue numbers.
   New P1 #1679 credential projection and #1582 embedding channel identity have
   source repairs; #1574/#1693 now use cleanup admission/exclusion and truthful
   retained outcomes. Full index/backend category cleanup and real parent drain
   remain partial. #1554 now stages complete verified generations before atomic
   selection; fault/concurrency and native Windows qualification remain unrun.
2. Remaining P2/P3 issues, including prior partial owners, ordered by dependency:
   publication/resource ownership; source/cache identities; semantic and retrieval
   correctness; transports/providers; operator and evaluation workflows. Read full
   issue scopes before implementing or declaring equivalence.
3. Perf reports after priority issues. Preserve correctness, separate bounded
   operations from measured latency/heap claims, and measure serially later.
4. Other work, including setup/runtime distribution and research foundations,
   before dependent consumers. Do not create duplicate infrastructure.
5. After source integration, refresh generated contracts, fixture inventories,
   ordered lanes and MCP schemas/snapshots through their registered generators.
   Prepare/verify locked dependencies, run affected regressions and the complete
   front gate for each ready publication batch. Continue targeted failure groups;
   do not repeat the full campaign without a new user request. Preserve
   original assertions, 30-second limits, zero retries and native redo disabled.

Many earlier authored regressions remain unrun; current targeted acceptance is
limited to the exact cases in the receipt. No current-head deep-suite pass, issue
closure or measured speedup is claimed. Fresh native/patch verification passed
on Node 26.12.1 (eight patches, 26 targets, 61 hunks); setup activation is not
runtime qualification. At historical frozen `245be5fc2`, 70 broad cases produced 60 passes,
9 failures and 1 timeout; a subsequent focused selection produced 11 passes and
3 wrapper timeouts. Source repairs followed and await execution. The
[Windows receipt](archived/windows-post-wave-validation-2026-10-22.md) preserves
exact-source results. No Linux/WSL, elevation, security changes, worktrees or
arbitrary physical-link creation are included.

### Historical source chronology

The [archived source chronology](archived/roadmap-source-chronology-2026-10-25.md)
retains earlier owner repairs, versions and qualification gaps. Its implementation
claims remain distinct from current-source validation and accepted issue closure.

## Environment and qualification boundaries

Work is **Windows-only**; Linux/macOS execution is deferred. Do not launch WSL,
change machine security settings or register a machine-wide debugger. Current
Node is **26.12.1**, ABI 147, Windows x64. The
[workspace/runtime receipt](archived/workspace-layout-node-2026-10-21.md) records
a clean locked bootstrap (37 required packages/33 routes; zero warning/error
lines), 16 focused passes and all 40 front-gate passes at checkpoint 8685a0dec.
New behavior needs its own affected checks. Product activation is not full runtime
or release qualification. Current contributor scratch lives under ignored
`.tmp/dev/` and `.tmp/tasks/`; the old root scratch directory is retired.

The Windows deep suite is **green** at `ffde426be` as a historical, immutable
Windows baseline. Linux/macOS full deep execution, optional backends, real models
and release qualification remain separate.

The [qualification matrix](testing/qualification-matrix.md) and
[Windows repair receipt](archived/windows-deep-repairs-2026-10-18.md) retain the
historical 2982-case full Windows baseline at `ffde426be`, including 65 original
failures and 27 timeouts. That baseline does not qualify the current source.
The original Node 26.8.1 RealmCppGC access violation and separate Tree-sitter
0xC0000409 repair retain their own debugger/patch evidence. Bulky author-workspace
dumps and symbols were removed at the user's request; compact analyses, hashes
and reproduction inputs remain historical evidence, not clean-checkout assets.

The user removed physical file-symlink creation from this repair program's
acceptance prerequisites. Preserve existing link-specific assertions as optional
capability qualification; new guards use real ordinary-filesystem controls and
injected link attributes. No elevation, arbitrary symlink creation or OS security
setting change is required for ordinary repair validation. Native TUI setup/service/replay/catalog workflows, Solargraph
startup, SQLite worker/cold-helper stalls, representative retrieval/edit freshness/
heap evidence, real models and supported release targets remain explicit open
work. Do not relabel unsupported, skipped or unrun cases as passed.

## Existing product and semantic scope

The [prior roadmap snapshot](archived/roadmap-pre-issue-reconciliation-2026-10-21.md)
preserves all preceding initiative details, execution history and validation
limits. JS/TS class/heap/call/completion frontiers, host/module precision,
Worker/WASM/provider integration and broader native-language analysis remain
within the new issue reconciliation rather than being silently declared finished.
[Language/toolchain acceptance](guides/language-toolchain-acceptance.md) separates
parser activation, provider initialization and real consumer-visible project facts.
The existing USR schemas, scheduler, journal, lease and publication-recovery owners
remain authoritative. Meaning changes must advance their shared producer versions.

## Current Initiatives

| Initiative | Status | Done now | Remaining / next |
| --- | --- | --- | --- |
| Execution, storage and download authority | `implemented; focused validation` | Launch authority, native artifacts and bounded storage/download paths have regressions. | Preserve the explicit authority boundaries in the [guide](guides/execution-authority.md); native TUI and non-Linux platform acceptance remain separate. |
| Stage1 ordered throughput cutover | `implemented` | Ordered windows, commit cursors and no-gap recovery have targeted tests. | Refresh perf and memory budget tests in the release gate before release. |
| Phase 10 interprocedural risk flows | `implemented` | Risk flows, validators and consumers retain capped/deduplicated results. | Run the affected risk and release acceptance lanes on the final release candidate. |
| Phase 14 IndexRefs, snapshots, diffs, and as-of retrieval | `implemented` | Snapshot and IndexRef contracts include historical/cache-boundary corrections. | Refresh cross-platform and end-to-end snapshot acceptance before release. |
| Lexicon, relation boosts, chargram enrichment, and ANN candidate safety | `implemented` | Lexicon/chargram controls, ANN filtering and semantic constraints are implemented. | Measure representative search quality and optional native backends before release. |
| USR consolidated contract and rollout program | `implemented` | Language/framework matrices, canonical schemas and conformance surfaces are present. | Refresh technical acceptance; the former approval-lock process is archived and is not a release blocker. |
| Shared-module reduction | `coupling audit open` | Query registry 2/2, artifact I/O 71/73 and retrieval CLI 7/60 pass; broader ownership inventory remains separate. | Retain fixes for the October 18 direct/transitive import-budget failures without raising baselines; measure remaining startup/coupling work separately. |
| Duplicate-code reduction | `checkpoint clean` | The May refresh found no current fragments among 212 saved candidates. | A future intentional full audit refresh, not ad hoc rework of stale saved-report entries, establishes a new repository-wide baseline. |
| Production readiness | `deferred validation` | Release tooling and bounded platform/security receipts remain revision-specific. | Run production verification and release-readiness evidence against the final candidate; later security changes require their own merge and rescan. |
| Phase 0.5 language/framework execution contract | `implemented` | Capability matrices, language adapters and executable conformance lanes are present. | Preserve the contract and rerun affected language/tooling acceptance when those owners change. |
| Worklogs and benchmark JSON under `docs/worklogs/**` | `historical evidence` | Historical measurements and authored worklogs remain preserved. | Keep new execution status here; label measurements with their exact revision and environment. |



## Release discipline

Preserve revision-specific lineage and explicit launch authority. Follow the
[release validation plan](roadmap-release-validation-plan.md) and
[USR rollout policy](specs/usr-core-rollout-release-migration.md) for their
respective acceptance. Dependency PRs and live source-security/release scans
retain separate evidence. Historical green results are not final-head acceptance.

Hosted CI is bounded validation, not release-wide readiness. Release-wide acceptance,
optional-backend and measured-performance campaigns remain deferred until the
corresponding planned candidate. The [October 7 closeout](guides/closeout-evidence-2026-10-07.md)
and [ordinary integration archive](archived/ordinary-integration-roadmap-2026-10-06.md)
retain revision-specific results; old green results have not been relabeled as fresh proof.
Historical diagnostic callback failures were reproduced; diagnostic callbacks cannot bypass
finalization. The [bounded recovery guide](guides/recovery-low-load-2026-10-03.md)
retains the correction and original resource settings.

## Validation Commands

```powershell
node tests/run.js tooling/docs/contract-matrix tooling/docs/usr-contract-checklists ci/markdown-link-check --lane all --jobs 1 --timeout-ms 30000 --retries 0 --native-status-redo=false
node tools/docs/generated-surfaces.js --check-freshness
git diff --check
```

