# Repository maintenance audit — 2026-10-18

Canonical status: [roadmap](../roadmap.md). This is a dated local audit receipt,
not a second execution queue or release-readiness declaration.

## Revision and scope

The authorized checkout was clean on `codex/pr557-audit-repairs-20261012` at
`d6041226b95baa6d7be8c6a06611b6d9e452d4ba`. Its configured upstream was 33
commits ahead. After inspecting that history, the branch was fast-forwarded to
`ab00d918d77fd45c086831e9759d7596ac18a16d`, matching the remote branch SHA.
No branch switch, PR merge, push or publication was performed during this audit.

Validation uses that head plus the local maintenance diff. Host: Windows x64,
PowerShell 7.5, Node 26.8.1, npm 11.19.0. The audit covers current task tracking,
recent integration history, source/runtime instructions, dependency advisories,
test discovery/governance, focused product regressions and the prescribed front
gate. There are 2,715 checked-in test files; this is a selected bounded audit,
not execution of that entire suite or a line-by-line proof of all source paths.

## Findings and disposition

| Finding | Disposition |
| --- | --- |
| Stale local branch obscured 33 commits of fixes and newer receipts | Fast-forwarded the requested branch before evaluating its current state. |
| Native verification passed activation but could not record readiness because `happy-dom` was missing | Completed the locked bootstrap, all required native rebuilds/activation probes and patch verification. Optional Sharp is absent; it is not a required native capability. |
| Application, contributor, editor, fixture-tracking, CI and release guides still advertised Node 18/24 | Aligned active instructions with `>=26.0.0 <27`, `.nvmrc` 26.8.1 and current workflow target IDs/action majors. Original runtime policy is archived. |
| Bootstrap recovery errors recommended dependency-resolving installation by default | Errors now recommend `npm run bootstrap:ci`; the admission regression checks the exact locked recovery command. Intentional dependency changes retain `npm run bootstrap`. |
| Guided setup blurred checkout preparation and optional resource setup | Documented verified bootstrap first and `--skip-install` for preserving the prepared lock graph. |
| A Node 24/macOS comparison recipe cannot pass the current Node 26 guard | Marked the unexecuted recipe deprecated without changing runtime admission or inventing comparison results. Dated native/platform plans are explicitly historical. |
| Roadmap simultaneously treated Windows cold-index cleanup as open and bounded-closed | Reconciled with the October 14 receipt, preserving original failures and the distinction from the original machine state. The non-reproduced native crash stays closed unless new evidence appears. |
| Completed product tables and obsolete candidate PR status obscured remaining work | Preserved the prior roadmap snapshot, retained the initiative contracts, and identified #572 as the current open follow-up. |
| Changelog contained only its initial placeholder | Added an Unreleased summary of the implemented product improvements and maintenance corrections, without changing release version/status. |
| Historical passing evidence could be mistaken for current-head CI | Kept dated evidence separate and recorded the exact-head GitHub inventory below. |
| `runner/suite-taxonomy` expected a removed classification reason | Aligned the fixture with the classifier/manifests' existing `peripheral-tooling-or-smoke-surface` contract and covered smoke/install/Sublime precedence over long-lane tags. Classification behavior was preserved. |

Existing author caches, worklogs and test receipts were preserved. No full index,
duplicate scan, model download or native crash campaign was launched. Targeted
fixtures create their own small indexes. Production-source TODO/FIXME/HACK/XXX/TBD
scanning found no such outstanding markers; markers in test inputs are fixtures.

## GitHub inventory

On October 18 the connector returned zero open issues and one open PR,
[#572](https://github.com/doublemover/PairOfCleats/pull/572), titled
“Improve code search, watch reliability, and agent context workflows.” Its base
is `main` at `a8c19738eb236032a56f2ac6d583b799508d5d67`, and its head is
`ab00d918d77fd45c086831e9759d7596ac18a16d`. No inline review threads or discussion
comments were returned. No workflow runs or commit statuses were returned for
that exact head; its final two commits include `[skip ci]`. This is not a passing
hosted CI result. No workflow dispatch or external discussion update was sent.

## Setup and environment provenance

Initial verification failed on the missing development dependency. An install
started against the old checkout was stopped after the upstream reconciliation;
the complete subsequent `npm run bootstrap:ci` against the current lockfile
finished successfully. No readiness receipt was fabricated or bypassed.

The launch environment contained `PAIROFCLEATS_TRUSTED_CONFIG` pointing at a
missing file. Validation subprocesses removed only that invalid inherited
override, leaving the user's shell/global settings untouched. The normal test
environment helpers and production authority checks remained in use.

`npm audit --audit-level=low --json` exited zero with zero known vulnerabilities
across the complete lock graph. This does not establish a hosted CodeQL,
Dependabot rescan or generic secret-scanning result.

## Validation

All selected fixture runs use one job, a 30-second per-test limit, zero retries,
disabled native-status redo and fail-fast execution. Intentional failure/skip/
redo/timeout helper targets are excluded as standalone tests; their outer
governance tests validate the corresponding runner behavior. No model-backed
embedding qualification is claimed by the isolated embedding contract fixtures.

| Check | Result |
| --- | --- |
| Locked bootstrap, required native activation and patches | pass |
| Live npm audit | pass; zero known vulnerabilities |
| Full-repository `npm run lint` | pass |
| `npm run test:lane-audit` | pass; five lanes, zero missing IDs, duplicates, manifest mismatches or timing overruns |
| Rust 1.88.0 `cargo fmt --check` | pass; no Rust build/platform acceptance implied |
| Recent-change regressions | 50/50 passed in 194.455s; zero failures, timeouts or skips |
| CI, runner, docs and setup governance | 78 unique cases passed: 59 before the fixture failure, then 19/19 in the focused repaired/remainder run (33.241s); no remaining unexecuted selection |
| Prescribed front gate | pass: format, config budget, environment usage, generated freshness, command surface, workflow contract and all 39 gate cases (22.410s); zero gate failures, timeouts or skips |
| Final docs, repaired fixtures and changelog metadata extraction | 6/6 passed in 3.79s; zero failures, timeouts or skips |
| Diff whitespace | pass |

The recent selection includes every changed test since the stale starting head
except the workflow contract reserved for the front gate. Fresh passes include
edit/delete/rename equivalence, continuous-edit scheduling, watch publication,
query ranking, bounded cold metadata paging, source-preview safety, process cache
leases, context budgets, SDK MCP requests, installed Pyright imports, cold Windows
cleanup and supervised TUI recovery. Its slowest case was 20.3 seconds.

Historical author-workspace receipts from this run are under
`temp/tasks/repo-maintenance-20261018`: selection IDs/JSON, report JSON and timing
JSON. These local files are not promised in a clean checkout. The recent runner
log directory is `.testLogs/run-1792329399767-yymvc6`.

The first governance run (`.testLogs/run-1792329612230-2ouw9u`) passed 59 cases,
then failed the stale taxonomy assertion; fail-fast left 18 cases unexecuted.
Those rows are not passing evidence. After the fixture repair, only that failed
case and the 18 unexecuted cases were selected for continuation. The original
failure report remains separate from the post-repair report. An initial list
request also correctly rejected a combined match expression above the 256-character
limit; repeated bounded exact-match selectors were used without changing limits.
The repaired/remainder log is `.testLogs/run-1792329738891-40h1vj`.

The command-surface check initially rejected the same missing inherited trusted
configuration file. Repeating that check with only the invalid subprocess
override removed passed (21 scripts, 71 CLI commands, 44 capabilities). The
authority guard was retained. The final gate log is
`.testLogs/run-1792329949798-baqqwj`; the 50 recent, 78 governance and 39 gate
cases cover 167 distinct fixtures with accepted one-attempt results. The
standalone workflow contract also passes. Final documentation/repair checks
passed at `.testLogs/run-1792330038770-znnrq7`, including release metadata
extraction with the new Unreleased section. That adds one distinct fixture,
bringing the accepted runner inventory to 168. No product source changed after
the accepted runs. Documentation links/contracts are checked again after the
receipt/status update; the full gate is not repeated for evidence-only edits.

The tested local code/test overlay is identified by these Git blob hashes:

| File | Blob |
| --- | --- |
| `src/shared/bootstrap-readiness.js` | `34bf2f107231bed0822646043302a9dbecb63d81` |
| `tools/setup/apply-patches.js` | `d9b48d953d295ade3637376713f1f959db844110` |
| `tests/tooling/install/bootstrap-readiness.test.js` | `41ed11f0a8d225d4a7c376323472338e7b0b467a` |
| `tests/runner/suite-taxonomy.test.js` | `64c334232a2ca467c4e578c087ac0edf1fd0d356` |

## Remaining qualification

Final-head hosted CI is outstanding. Live watcher identity, representative
production-corpus relevance, retained-heap analysis, calibrated cost admission,
broader semantic precision, other native platforms/providers, real-model/GPU
qualification and full release qualification remain separate scopes. The
existing qualification limits are preserved rather than relabeled as failures
or fresh passes. The [roadmap](../roadmap.md) owns their current order/status.
