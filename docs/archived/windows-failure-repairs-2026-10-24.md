# Windows failure repairs — October 24, 2026

This follow-up to the [459-case historical re-check](windows-historical-rechecks-2026-10-24.md)
repairs shared causes without repeating that campaign. Work was solo on
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1 / ABI 147.
No Linux/WSL, elevation, security-setting change, worktree or symlink creation
was used. Publication continues through PR #572; no merge is authorized.

## Source and observations

The focused candidate is `adfdcc85b790dab767915b47c775f6a4efeb539d`, tree
`594e8338c88ae385a2a32484c85bfcbb2336742f`. All **37 selected IDs pass** at that
candidate: one job, one indexing thread, 30-second per-case deadline, zero
retries and native-status redo disabled. The runner reports 143.0 seconds total,
22.7 seconds for the slowest case, and zero failures, timeouts, skips or access
violations. No warning diagnostic was found in the focused transcripts.
The per-ID outcomes are appended as a distinct repair wave to the
[durable inventory](windows-historical-rechecks-2026-10-24.json).

Of these checks, **28 were failing in the frozen 459-case inventory**. Together
with the preceding 16 repairs, latest scoped observations are **76 passing,
382 failing and one POSIX exclusion**. Those counts combine explicitly named
checkpoints; they are not a new full-suite or final-head 459-case pass. Original
failure summaries, the frozen baseline and earlier observations remain intact.

Local receipts under `.tmp/tasks/windows-failure-repairs-20261024/` are historical
author-workspace evidence, unavailable in a clean checkout. Intermediate failures
remain in their own reports/logs. The inventory records selected IDs, candidate,
durations and policy without promising those ignored files to other checkouts.

## Production repairs

| Commit | Demonstrated cause and repair |
| --- | --- |
| `dd53c476f` | Hosted CI reached bootstrap and failed its unchanged audit gate on six high and one moderate affected entries. Happy DOM and permitted transitives are updated; a scoped Azure Identity override selects fixed MSAL 7.1.0. The real Identity adapter performs offline discovery, token acquisition and cache reuse. |
| `0e1c3820b` | The regex autofix collapsed an optional literal backslash into a literal question mark. Both expressions compile, so syntax-only checking missed the semantic corruption. The rule now preserves regex operators; seven operator controls supplement the existing escape fixes. The old rule fails the new regression, and formatting with the repaired rule preserves the PHP parser correction. Proven missing runtime prerequisites degrade; trust, ineligible-path and pending-owner denials still block. Semantic producer identity advances to `lspBindings47`, retaining `rq11`. |
| `6e55e9f03` | Node rejects Windows drive paths in `--import`. Delegated cache workers now receive the actual preload file URL. A real SQLite child opens, uses, closes and transmits settlement. Wrong-child and stale grants must fail inside the real admission gate; no-settlement, forged receipt, failed IPC, stale-parent and retained-reader controls remain. |
| `918f61cc8` | `graph_evidence` had object-only alternatives but no root `type: object`, invalidating SDK tool discovery. MCP 1.10.1 adds that declaration while retaining the exact `oneOf` branches and strict validators. The registered generator refreshes its snapshot. Every tool is parsed by the real SDK schema; stdio search/context, cancellation, timeout, progress-token-zero, disconnect and child/capacity ownership pass. |
| `dbe962953` | The official pinned VSIX packager emits dotted content-type extensions; our validator accepted only undotted names. Both spellings now validate the same actual payload. Missing XML/assets/runtime modules, identity/engine mismatch, escaping/dynamic requires and invalid content types remain negative controls. An explicit package file list eliminates the inclusion warning; the archive check uses the official normalized `readme.md` name. The editor settings reference again covers the canonical names. |
| `257115a08` | Directory EXDEV fallback created an exclusive staging root and then asked `fs.cp` to reject that root's existence. It now streams root entries through the existing directory owner and copies each child into an absent destination with unchanged overwrite refusal. Nested payloads and empty directories survive. Root identity, retry bounds, foreign replacement, unknown native work, backup preservation and original parent-close recovery remain covered. Pending copy work also retains the actual directory recovery capability. |

These fixes make previously broken paths usable. No latency improvement or new
native-crash attribution is inferred from them.

## Fixture corrections and retained coverage

No test or production function was removed. Obsolete expectations were identified
against their actual owners before changing assertions:

- Descriptor wrappers now forward the original `fd` and read method required by
  contained-file admission. The transfer test recognizes the documented handle
  handoff: two initial source close-method captures, with **no new capture during
  recovery**, no repeated successful close and the original receiver intact.
- Configuration and migration reconcile their original directory/transfer/root
  owners before retrying the separate operation-coordinator lock. Early metadata
  release still rejects. Both frozen causes and independent failures remain in
  the error graph; composition need not make a leaf the immediate `cause`.
- Closing a managed file does not close its enclosing inventory directory. The
  fixture explicitly proves pending ownership between those two closures.
- Doctor positives explicitly trust their fixture root. A custom preflight test
  selects Node so real command admission reaches its intended custom block. The
  Dart missing-command case now asserts zero initialization/requests after proven
  discovery failure, retaining sparse/degraded diagnostics and contribution bounds.
- `adfdcc85b` preserves existing final and backup bytes when a missing source cannot
  prove a prior commit. Synchronous close ambiguity must remain pending instead
  of retrying a potentially reused numeric fd. The fixture alone disposes its
  known injected handle, without presenting that disposal as an owner receipt.
  Compression exit controls wait for actual worker/queue admission before
  asserting rejection of active, queued and idle waiters.

## Dependency preparation and qualification boundary

Locked `npm run bootstrap:ci` completed native rebuild, parser activation, all
eight required patches (26 targets / 61 hunks) and readiness publication. Its
transcript contains no warning/error diagnostic. Optional Sharp was absent and
explicitly reported by setup. The subsequent full-graph `npm audit --json`
reports zero vulnerabilities, including development and optional entries.
See the [dependency guide](../guides/dependency-security.md) for the exact revised
versions and temporary MSAL bridge. No advisory or live audit check was suppressed.

The publication front gate passes: formatting, configuration budget, environment
usage, generated freshness, command surface, workflow contract, all 40 gate
cases, whitespace and the additional Markdown link check. Freshness first caught
the old MCP version in the tooling/API contract spec; correcting that reference
and rerunning freshness resolves it. The inventory retains both attempts. No
unexpected warning diagnostic was found. Formatting leaves executable source
unchanged; publication adds documentation/receipts only. Setup activation,
focused tests and that gate do not qualify all runtime lifecycles or the hosted matrix.

All ten original timeout IDs remain unresolved, as do the remaining semantic,
retrieval/cache, language, report, provider and import-budget groups. Existing
transitive budgets remain unchanged; correctness/resource bounds are not latency
measurements. Windows terminal lifecycle, platform-specific native authority,
optional sqlite-vec, real models, Linux/macOS and release acceptance retain their
separate owners. No comprehensive backlog or issue-closure claim is made.
