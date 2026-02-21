# Artifact Trimming Policy Contract

Status: Draft v1.0  
Last updated: 2026-02-20T00:00:00Z

## Purpose

Define deterministic trimming behavior for oversized artifact rows and enforce stable output semantics.

## Scope

Applies to all artifact writers that may trim records due to size/row limits.

## Deterministic trim order

1. Stable writer-defined ordering of candidate records.
2. Stable trim priority categories for optional fields.
3. Stable final row rejection when required fields cannot be preserved.

No randomized or environment-dependent ordering is allowed.

## Required invariants

1. Required fields are never dropped.
2. Trimmed output preserves schema validity.
3. Trim counters are emitted in artifact/state stats.
4. Trim reasons are deterministic and enumerable.

## Policy metadata

Each trimmed artifact path must record:

- `trimPolicyVersion`
- `trimmedRows`
- `trimmedFields`
- `trimReasonCounts`

Trim metadata is emitted under `extensions.trim` for sharded JSONL meta artifacts,
and in stage checkpoint telemetry for unsharded outputs.

## Trim reason taxonomy

Reasons are deterministic keys and must be emitted in stable taxonomy order:

- `row_oversize`
- `drop_required_fields`
- `drop_row_over_budget`
- `deduped`
- `dedupe_collision`
- `call_sites_clear_args`
- `call_sites_clear_evidence`
- `call_sites_clear_kwargs`
- `call_sites_clear_snippet_hash`
- `symbols_clear_signature`
- `symbols_clear_name`
- `symbols_clear_kind`
- `symbols_clear_lang`
- `symbols_drop_extensions`
- `symbol_occurrences_clear_range`
- `symbol_ref_trim_candidates`
- `symbol_ref_clear_import_hint`
- `symbol_edges_drop_evidence`
- `symbol_edges_clear_reason`
- `symbol_edges_clear_confidence`
- `chunk_meta_drop_token_fields`
- `chunk_meta_drop_context_fields`
- `chunk_meta_drop_optional_fields`
- `chunk_meta_fallback_minimal`
- `chunk_meta_truncate_fallback_text`
- `chunk_meta_clear_fallback_text`

## Compatibility policy

No legacy trim modes are supported. Active policy is authoritative.

## Related docs

- `docs/contracts/artifact-schemas.md`
- `docs/contracts/artifact-contract.md`
- `src/index/build/artifacts/writers/*`
