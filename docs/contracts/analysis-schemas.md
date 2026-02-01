# Analysis Schemas (0.0.2)

This document defines the analysis-related schemas used across indexing, validation, and retrieval. Schema validation is enforced by `src/contracts/validators/analysis.js`.

> Note: Phase 11 introduces several **analysis output** schemas (JSON-first) intended for CLI today and API/MCP consumers later. These outputs are not index artifacts unless explicitly stated.

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

## Phase 11 analysis output schemas (graph-powered features)

Phase 11 adds JSON-first outputs that are validated under `src/contracts/schemas/analysis.js` and `src/contracts/validators/analysis.js`.

### Shared Phase 11 contract notes

All Phase 11 outputs share:
- **Deterministic ordering** for all arrays.
- **Strict caps** (depth/fanout/nodes/edges/paths/candidates/work-units).
- **Truncation records** when caps trigger:
  - which cap fired + measurable counts when available.
- **Warning records** for partial/missing artifact behavior.
- Versioned top-level payloads (SemVer string).

Authoritative Phase 11 spec:
- `docs/phases/phase-11/spec.md`

### Graph context pack

Schema: `GRAPH_CONTEXT_PACK_SCHEMA`

Purpose:
- Bounded deterministic neighborhood extraction for a seed node.

Minimum fields:
- `version`
- `seed`
- `nodes[]`
- `edges[]`
- optional `paths[]`
- optional `truncation[]`
- optional `warnings[]`

### Impact analysis

Schema: `GRAPH_IMPACT_SCHEMA`

Purpose:
- Bounded upstream/downstream impact sets with witness paths.

Minimum fields:
- `version`
- `seed`, `direction`, `depth`
- `impacted[]` (distance, confidence, witnessPath)
- optional `truncation[]`
- optional `warnings[]`

### Composite context pack (tooling/LLM)

Schema: `COMPOSITE_CONTEXT_PACK_SCHEMA`

Purpose:
- A bounded package intended for LLM/tooling consumption:
  - primary excerpt + optional graph/types/risk slices.

Minimum fields:
- `version`
- `seed`
- `primary` (excerpt + provenance)
- optional `graph`
- optional `types`
- optional `risk`
- optional `truncation[]`
- optional `warnings[]`

### API contracts report

Schema: `API_CONTRACTS_SCHEMA`

Purpose:
- Cross-file “API contract” extraction from existing artifacts:
  - declared/tooling signature + observed calls + compatibility warnings.

Minimum fields:
- `version`
- `symbols[]` (bounded)
- optional `truncation[]`
- optional `warnings[]`

### Architecture report

Schema: `ARCHITECTURE_REPORT_SCHEMA`

Purpose:
- Evaluate architectural constraints over graphs and produce CI-friendly output.

Minimum fields:
- `version`
- `rules[]` summary
- `violations[]` (bounded)
- optional `truncation[]`
- optional `warnings[]`

### Suggest-tests report

Schema: `SUGGEST_TESTS_SCHEMA`

Purpose:
- Suggest impacted tests given a changed file set.

Minimum fields:
- `version`
- `changed[]`
- `suggestions[]` (bounded)
- optional `truncation[]`
- optional `warnings[]`

## Contract notes

- Schemas allow `additionalProperties` so fields may be extended; only documented keys are relied upon by core logic.
- Any schema change that affects `compatibilityKey` inputs is a hard break for mixing indexes.
