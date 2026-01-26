# Analysis Schemas (0.0.1)

This document defines the analysis-related schemas used across indexing, validation, and retrieval. Schema validation is enforced by `src/contracts/validators/analysis.js`.

## Metadata v2 (per chunk)

- Canonical spec: `docs/specs/metadata-schema-v2.md`.
- Used in `chunk_meta` as `metaV2`.
- Notes:
  - `metaV2.lang` is the effective language registry id for segment-aware chunks (for example, `typescript`).
  - Container vs effective identity may be represented explicitly:
    - `metaV2.container.{ext,languageId}`
    - `metaV2.effective.{ext,languageId}`
  - `segment.languageId` remains the raw segment hint (for example, `tsx` from a fence or `<script lang="tsx">`).
  - `modifiers` may be an array of strings (canonical) or a legacy object map (e.g., `{ visibility: 'public', static: true }`).
- `types` is an object with optional `declared`, `inferred`, and `tooling` buckets.
- Canonical shapes:
  - `types.<bucket>.returns`: `TypeEntry[]`
  - `types.<bucket>.params`: `{ paramName: TypeEntry[] }`
- `types.*.params` may be an array in legacy artifacts, but the canonical form is an object map keyed by param name.

## Risk rules bundle

Schema: `RISK_RULES_BUNDLE_SCHEMA` in `src/contracts/schemas/analysis.js`.

- Required fields: `version`, `sources`, `sinks`, `sanitizers`.
- `version`: SemVer string.
- Each rule entry requires `id`, `name`, `patterns` and supports:
  - `type`, `category`, `severity`, `tags`, `confidence`, `languages`, `requires`.
- Optional `regexConfig`:
  - `maxPatternLength`, `maxInputLength`, `maxProgramSize`, `timeoutMs`, `flags`, `engine`.
- Optional `provenance`:
  - `defaults` (bool), `sourcePath` (string|null).

## Analysis policy

Schema: `ANALYSIS_POLICY_SCHEMA` in `src/contracts/schemas/analysis.js`.

- Top-level object with optional sections:
  - `metadata.enabled`: enable/disable metadata emission.
  - `risk.enabled`, `risk.crossFile`: risk analysis toggles.
  - `git.enabled`, `git.blame`, `git.churn`: git-based signals.
  - `typeInference.local.enabled`, `typeInference.crossFile.enabled`, `typeInference.tooling.enabled`.

## Contract notes

- Schemas allow `additionalProperties` so fields may be extended; only documented keys are relied upon by core logic.
- Any schema change that affects `compatibilityKey` inputs is a hard break for mixing indexes.

