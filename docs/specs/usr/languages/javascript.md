# USR Language Contract -- javascript

Status: Draft v0.4
Last updated: 2026-02-10T07:05:00Z
Language ID: javascript

## 0. Scope

This document defines the javascript-specific USR contract as a child profile of:

- docs/specs/usr-language-profile-catalog.md
- docs/specs/usr-normalization-mapping-contract.md
- docs/specs/usr-resolution-and-linking-contract.md
- docs/specs/usr-language-risk-contract.md
- docs/specs/usr-embedding-bridge-contract.md
- docs/specs/usr-generated-provenance-contract.md

## 1. Profile baseline

- Parser preference: hybrid
- Required conformance levels: C0,C1,C2,C3,C4
- Applicable framework overlays: react,next
- Required fallback chain: native-parser,tree-sitter,tooling,heuristic

## 2. Required syntax and node coverage

javascript MUST define language-specific required mappings for declarations, callables, linkage constructs, and control/data constructs required by its conformance levels.

### 2.1 RequiredNodeKinds baseline

- module_decl, function_decl, class_decl, import_stmt, export_stmt, call_expr

## 3. Required edge coverage

javascript MUST provide deterministic extraction for applicable edge kinds: defines, references, calls, contains, plus language-applicable imports, exports, and uses_type.

### 3.1 RequiredEdgeKinds baseline

- imports, exports, defines, references, calls, uses_type, contains

## 4. Capability state baseline

Capabilities MUST explicitly declare state for docmeta, ast, symbolGraph, relations, imports, controlFlow, dataFlow, riskLocal, and riskInterprocedural.

### 4.1 RequiredCapabilities baseline

- imports: supported
- relations: supported
- docmeta: supported
- ast: supported
- controlFlow: supported
- dataFlow: partial
- graphRelations: supported
- riskLocal: supported
- riskInterprocedural: partial
- symbolGraph: supported

## 5. Language-specific edge focus

- ESM/CJS interoperability; dynamic import paths; JSX boundary normalization

## 6. Normalization mapping requirements

Raw parser kinds for javascript MUST map via table-driven mapping rules. Unknown kinds MUST preserve raw kind, map to normKind=unknown, and emit deterministic fallback diagnostics.

## 7. Resolution and linking requirements

Resolution MUST emit deterministic resolved, ambiguous, or unresolved outcomes with canonical reason codes and ordered candidates for non-resolved outcomes.

## 8. Risk requirements

Risk coverage MUST define required source/sink/sanitizer taxonomies and interprocedural gating behavior aligned with the language risk contract.

## 9. Fixtures and conformance requirements

Required fixture families: positive syntax, malformed/fallback, unresolved/ambiguous linking, deterministic rerun, and risk fixtures where C3 applies.

Conformance checks MUST align with C0,C1,C2,C3,C4.

## 10. Dialect/version and embedding contract

The language contract MUST explicitly declare:

- supported language versions and dialects (with fallback boundaries)
- parser/compiler feature flags required for deterministic extraction
- whether the language can host embedded languages and allowed embedded language IDs
- whether the language can be embedded inside container documents and required bridge behavior

## 11. Required fixture minimums and evidence

Minimum fixture groups for this language:

- javascript::positive::*
- javascript::fallback::*
- javascript::resolution::*
- javascript::determinism::*
- javascript::provenance::*
- javascript::risk::* (when C3 applies)

If this language hosts embedded surfaces, add:

- javascript::embedding-bridge::*

## 12. Required profile deltas before implementation-complete

The following MUST be explicitly filled for this language before declaring profile completion:

- exact requiredNodeKinds set
- exact requiredEdgeKinds set
- exact requiredCapabilities map
- exact fallback downgrade behavior by stage
- exact framework applicability overrides (if any)

## 13. Required fixture ID mapping

This language contract MUST map concrete fixture IDs to conformance assertions.

Minimum required fixture ID groups:

- javascript::positive::*
- javascript::fallback::*
- javascript::resolution::*
- javascript::determinism::*
- javascript::provenance::*
- javascript::risk::* (when C3 applies)

## 14. Approval checklist

- [ ] Node kind mapping rows are defined and validated.
- [ ] Edge extraction assertions are covered by fixtures.
- [ ] Capability baseline and downgrade behavior are validated.
- [ ] Resolution reason-code expectations are validated.
- [ ] Risk expectations (if applicable) are validated.
- [ ] Generated/macro provenance expectations are validated.
- [ ] Embedded-language bridge behavior is validated or marked non-applicable with evidence.
- [ ] Deterministic rerun checks are green.

## 15. Completion evidence artifacts

- `usr-language-profile-coverage.json`
- `usr-node-kind-mapping-coverage.json`
- `usr-resolution-outcome-distribution.json`
- `usr-risk-coverage-summary.json` (when C3 applies)
- `usr-determinism-rerun-diff.json`