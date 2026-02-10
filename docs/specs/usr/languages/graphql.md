# USR Language Contract -- graphql

Status: Draft v0.1
Last updated: 2026-02-10T03:00:00Z
Language ID: graphql

## 0. Scope

This document defines the graphql-specific USR contract as a child profile of:

- docs/specs/usr-language-profile-catalog.md
- docs/specs/usr-normalization-mapping-contract.md
- docs/specs/usr-resolution-and-linking-contract.md
- docs/specs/usr-language-risk-contract.md
- docs/specs/usr-conformance-and-fixture-contract.md

## 1. Profile baseline

- Parser preference: tree-sitter
- Required conformance levels: C0,C1,C2
- Applicable framework overlays: none
- Required fallback chain: tree-sitter,heuristic

## 2. Required syntax and node coverage

graphql MUST define language-specific required mappings for declarations, callables, linkage constructs, and control/data constructs required by its conformance levels.

## 3. Required edge coverage

graphql MUST provide deterministic extraction for applicable edge kinds: defines, references, calls, contains, plus language-applicable imports, exports, and uses_type.

## 4. Capability state baseline

Capabilities MUST explicitly declare state for docmeta, ast, symbolGraph, relations, imports, controlFlow, dataFlow, riskLocal, and riskInterprocedural.

## 5. Language-specific edge focus

- schema and type extension merges; fragment spread resolution; operation-variable usage

## 6. Normalization mapping requirements

Raw parser kinds for graphql MUST map via table-driven mapping rules. Unknown kinds MUST preserve raw kind, map to normKind=unknown, and emit deterministic fallback diagnostics.

## 7. Resolution and linking requirements

Resolution MUST emit deterministic resolved, ambiguous, or unresolved outcomes with canonical reason codes and ordered candidates for non-resolved outcomes.

## 8. Risk requirements

Risk coverage MUST define required source/sink/sanitizer taxonomies and interprocedural gating behavior aligned with the language risk contract.

## 9. Fixtures and conformance requirements

Required fixture families: positive syntax, malformed/fallback, unresolved/ambiguous linking, deterministic rerun, and risk fixtures where C3 applies.

Conformance checks MUST align with C0,C1,C2.

## 10. Open implementation notes

Follow-up revisions SHOULD add exact parser-kind mapping rows, risk taxonomy row entries, and concrete fixture IDs and owning test lanes.
