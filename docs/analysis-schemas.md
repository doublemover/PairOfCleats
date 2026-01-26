# Analysis Schemas (0.0.1) — Updated Notes for Phases 5–7

This document defines analysis-related schemas used across indexing, validation, and retrieval. Validation is enforced by `src/contracts/validators/analysis.js`.

## Metadata v2 (per chunk)

Canonical spec: `docs/metadata-schema-v2.md`.

### Key clarifications (Phase 5)

- `metaV2.lang` should be treated as the **effective language registry id** (e.g., `typescript`) for segment-aware chunks.
- Container vs effective identity may be represented explicitly:
  - `metaV2.container.{ext,languageId}`
  - `metaV2.effective.{ext,languageId}`
- `segment.languageId` remains the raw segment hint (e.g., `tsx` from a fence or `<script lang="tsx">`).

### Type buckets

- `types` has optional `declared`, `inferred`, `tooling` buckets.
- `types.*.params`:
  - canonical: object map `{ paramName: entry[] }`
  - legacy: array of entries (name-less); tolerated for backward compatibility

## Risk rules bundle

Schema: `RISK_RULES_BUNDLE_SCHEMA` in `src/contracts/schemas/analysis.js`.

- Required fields: `version`, `sources`, `sinks`, `sanitizers`.
- `version`: SemVer string.

## Analysis policy

Schema: `ANALYSIS_POLICY_SCHEMA` in `src/contracts/schemas/analysis.js`.

- `metadata.enabled`: enable/disable metadata emission.
- `risk.enabled`, `risk.crossFile`: risk analysis toggles.
- `git.enabled`, `git.blame`, `git.churn`: git-based signals.
- `typeInference.local.enabled`, `typeInference.crossFile.enabled`, `typeInference.tooling.enabled`.

## Contract notes

- Schemas currently allow `additionalProperties` in several places for evolvability. Where strict extension policy is desired, new fields should be introduced under `extensions`.
- Any schema change that affects `compatibilityKey` inputs is a hard break for mixing indexes.
