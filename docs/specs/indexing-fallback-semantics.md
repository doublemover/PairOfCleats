# Spec: Indexing Fallback Semantics

Status: Active v1.0  
Last updated: 2026-02-22T00:00:00Z

## Purpose

Define deterministic behavior when parser/runtime constraints force fallback from full parsing.

## Fallback modes

1. `ast-full`: full parser path for the file, with normal enrichment behavior.
2. `syntax-lite`: deterministic downgraded parser path; stable chunk/docmeta shape with reduced enrichment.
3. `chunk-only`: deterministic minimal mode for constrained files; stable chunk shape and minimal metadata.

## Trigger conditions

Fallback may be triggered by:

- parse timeout / parser unavailable scheduler artifacts,
- heavy-file downshift policy (size/line/chunk pressure),
- heavy-file tokenization skip thresholds.

## Mode selector (deterministic order)

For code-mode files:

1. `chunk-only` when heavy-file tokenization skip activates.
2. `syntax-lite` when heavy-file downshift activates (without tokenization skip).
3. `syntax-lite` when tree-sitter scheduler fallback/miss forces heuristic chunking.
4. `ast-full` otherwise.

For non-code files, mode is `chunk-only`.

## Output contract by mode

- `ast-full`:
  - parser metadata: `metaV2.parser.mode = ast-full`
  - local type inference/risk enrichment may run (policy-gated)
  - relation extraction uses active path behavior
- `syntax-lite`:
  - parser metadata: `metaV2.parser.mode = syntax-lite`
  - parser reason code emitted
  - local type inference/risk enrichment disabled
  - relation/output shape remains stable
- `chunk-only`:
  - parser metadata: `metaV2.parser.mode = chunk-only`
  - parser reason code emitted
  - local type inference/risk enrichment disabled
  - chunk relations reduced to deterministic minimal surface

All non-full modes must emit explicit fallback diagnostics in build stats and per-file metadata.

## Determinism rules

1. Same inputs/config must choose same fallback mode.
2. Fallback reason code set is closed and versioned.
3. Downstream outputs (search/explain/graph) must not silently imply full-mode coverage.

## Compatibility policy

No silent fallback behavior is permitted.
