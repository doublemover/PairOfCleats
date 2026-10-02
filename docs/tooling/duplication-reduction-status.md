# Duplication Reduction Status

Status: Checkpoint clean
Documentation consolidated: 2026-10-02
Last full duplicate audit: 2026-05-21
Canonical execution queue: [roadmap](../roadmap.md)

The completed duplicate-reduction work is retained in the
[historical worklog](../archived/duplication-reduction-status.md). This page owns
its baseline, current disposition and rules for reopening work.

## Recorded Baseline

| Measurement | Recorded result |
| --- | --- |
| Tool/config | `jscpd@4.2.3`, `.jscpd.json` |
| Full audit scope | 4,036 files; 551,681 lines; 5,682,730 tokens |
| Prior checkpoint | 393 clones; 6,366 duplicated lines; 72,063 duplicated tokens |
| May 21 full audit | 212 clones; 3,153 duplicated lines; 36,023 duplicated tokens |
| Subsequent saved-report refresh | 0 still-current fragments among those 212 saved candidates |

The saved-report exact-current refresh found 0 still-current fragments. This is
a result about that saved candidate set. A fresh full-repository duplicate count
has not been established for the current branch.

Historical evidence locations are `temp/jscpd/audit-duplicates-20260521-012600.log`,
`temp/jscpd/jscpd-report.json`, `temp/jscpd/jscpd-report.md`, and
`temp/validation/saved-jscpd-exact-current-fragments-refresh-20260521.log`.
These machine-local May files may be unavailable in a fresh clone. Their absence
is recorded honestly; it does not justify inventing a passing report.

## Current Disposition

Completed reductions span artifact/storage IO, process and lock ownership,
retrieval helpers, language/tooling adapters, API/MCP/editor surfaces and test
fixtures. Narrow domain owners and their behavioral tests remain the supported
implementation. A generic shared helper is useful only when callers genuinely
share the same contract.

No saved-baseline candidate is an active implementation assignment solely because
its old worklog mentions a future step. Older completed-slice notes may preserve
then-current instructions to rerun `npm run audit:duplicates`; those are historical
records. Their acceptance tests and future constraints remain reference material.
Preserved historical/intermediate failures are not current checkpoint proof.

## Reopening Work

Start from one of:

- A concrete current duplicate with a safe shared owner and equivalent behavior
- A failing ownership/governance contract
- A measured import, memory or execution regression
- A deliberately scheduled full duplicate audit to establish a new baseline

For a new batch, name the affected callers, prove the common contract, retain
caller-specific assertions and run the smallest meaningful checks. Avoid broad
codemods, speculative abstractions and compatibility facades that hide ownership.

Do not rerun `jscpd` for this checkpoint or ordinary documentation edits. A future
intentional full audit refresh should preserve its exact revision, configuration,
report and resource budget. The canonical command is `npm run audit:duplicates`;
its scan roots are `src`, `bin`, `tools`, `tests`, `extensions` and `sublime`.
Lockfiles, generated artifacts, fixtures, temporary outputs, archived docs and the
intentional vendored VS Code mirror are excluded by the checked-in configuration.

## Historical Saved-Baseline Candidate Details

The [archived original](../archived/duplication-reduction-status.md) preserves all
completed slices, candidate tables, evidence citations, failures and later passes.
It is evidence and design history, not a second task queue. Current decisions
belong in [the roadmap](../roadmap.md).
