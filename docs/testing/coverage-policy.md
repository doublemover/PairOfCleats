# Coverage Policy

Coverage policy is progressive and risk-aware.

## Current phase

Phase: `report-only`

Current CI output emphasizes visibility over gating:
- overall test coverage artifact
- changed-file coverage summary when git history makes it practical
- critical-surface breakdowns for:
  - CLI
  - API
  - MCP
  - indexing/runtime
  - retrieval
  - TUI
  - release/packaging

These reports are emitted under `.diagnostics/coverage/` by the CI suite.

## Why this policy exists

Repo-wide blanket thresholds are easy to game and often hide the files that
actually matter for a given change. Production readiness needs coverage signal
that matches risk and shipped surfaces.

## Progression

1. Report changed-file and critical-surface coverage in CI artifacts.
2. Ensure pull requests consistently surface that report for review.
3. Add targeted gating only after the signal is stable and trusted.

## Review guidance

- Treat low changed-file coverage as a review prompt, not an automatic reject.
- Prioritize critical surfaces over aggregate percentages.
- Favor tests that exercise shipped behavior and failure modes instead of
  chasing broad but low-value numerical gains.
