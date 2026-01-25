# Phase 3 Analysis Policy Spec (Draft)

## Goal
Centralize analysis feature toggles into one `analysisPolicy` object with explicit defaults.

## Proposed shape
```
analysisPolicy:
  metadata: { enabled: true }
  risk: { enabled: true }
  git: { enabled: false, blame: false, churn: false }
  typeInference:
    local: { enabled: true }
    crossFile: { enabled: false }
    tooling: { enabled: false }
```

## Behavior
- Policy is constructed once per run and passed to metadata v2, risk analysis, git analysis, and type inference.
- Policy is internal-only (no new public config surface).
- It is derived from existing runtime/config flags (e.g., riskAnalysis, git signals, type inference toggles).
- Disabling a section must skip work deterministically (no partial state).
- Policy objects are validated against the internal analysis-policy schema (non-boolean flags are rejected).

## Defaults
- `metadata.enabled` remains true by default.
- `risk.enabled` follows the existing `indexing.riskAnalysis` toggle (default on).
- `git.enabled`/`git.blame` follow the existing `indexing.gitBlame` toggle (default on unless disabled).
- `typeInference.*` follows existing `indexing.typeInference` / `indexing.typeInferenceCrossFile` toggles.

## Docs impact
- Document policy shape in config docs and any analysis feature docs that reference defaults.
