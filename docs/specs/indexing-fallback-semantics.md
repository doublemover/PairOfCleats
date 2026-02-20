# Spec: Indexing Fallback Semantics

Status: Draft v1.0  
Last updated: 2026-02-20T00:00:00Z

## Purpose

Define deterministic behavior when parser/runtime constraints force fallback from full parsing.

## Fallback modes

1. `ast-full`: full parser + relations + flow where supported.
2. `syntax-lite`: reduced syntax extraction (imports/defs/core symbols) without full flow.
3. `chunk-only`: chunk extraction only; no deep symbol/flow edges.

## Trigger conditions

Fallback may be triggered by:

- parse timeout,
- parser activation failure,
- file size/line cap pressure,
- memory-pressure state.

## Output contract by mode

- `ast-full`: emit full capabilities.
- `syntax-lite`: emit partial capabilities with explicit reason codes.
- `chunk-only`: emit chunk metadata and deterministic minimal relation surface only.

All non-full modes must emit explicit fallback diagnostics in build stats and per-file metadata.

## Determinism rules

1. Same inputs/config must choose same fallback mode.
2. Fallback reason code set is closed and versioned.
3. Downstream outputs (search/explain/graph) must not silently imply full-mode coverage.

## Compatibility policy

No silent fallback behavior is permitted.
