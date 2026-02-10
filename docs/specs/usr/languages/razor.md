# USR Language Contract -- razor

Status: Draft v0.1
Last updated: 2026-02-10T04:00:00Z
Language ID: razor

## 0. Scope

This document defines the razor-specific USR contract as a child profile of:

- docs/specs/usr-language-profile-catalog.md
- docs/specs/usr-normalization-mapping-contract.md
- docs/specs/usr-resolution-and-linking-contract.md
- docs/specs/usr-language-risk-contract.md
- docs/specs/usr-conformance-and-fixture-contract.md

## 1. Profile baseline

- Parser preference: hybrid
- Required conformance levels: C0,C1,C4
- Applicable framework overlays: none
- Required fallback chain: native-parser,tree-sitter,heuristic

## 2. Required syntax and node coverage

razor MUST define language-specific required mappings for declarations, callables, linkage constructs, and control/data constructs required by its conformance levels.

## 3. Required edge coverage

razor MUST provide deterministic extraction for applicable edge kinds: defines, references, calls, contains, plus language-applicable imports, exports, and uses_type.

## 4. Capability state baseline

Capabilities MUST explicitly declare state for docmeta, ast, symbolGraph, relations, imports, controlFlow, dataFlow, riskLocal, and riskInterprocedural.

## 5. Language-specific edge focus

- C-sharp and markup boundary mapping; tag-helper binding; layout and partial route linkage

## 6. Normalization mapping requirements

Raw parser kinds for razor MUST map via table-driven mapping rules. Unknown kinds MUST preserve raw kind, map to normKind=unknown, and emit deterministic fallback diagnostics.

## 7. Resolution and linking requirements

Resolution MUST emit deterministic resolved, ambiguous, or unresolved outcomes with canonical reason codes and ordered candidates for non-resolved outcomes.

## 8. Risk requirements

Risk coverage MUST define required source/sink/sanitizer taxonomies and interprocedural gating behavior aligned with the language risk contract.

## 9. Fixtures and conformance requirements

Required fixture families: positive syntax, malformed/fallback, unresolved/ambiguous linking, deterministic rerun, and risk fixtures where C3 applies.

Conformance checks MUST align with C0,C1,C4.

## 10. Open implementation notes

Follow-up revisions SHOULD add exact parser-kind mapping rows, risk taxonomy row entries, and concrete fixture IDs and owning test lanes.

## 11. Required profile deltas before implementation-complete

The following MUST be explicitly filled for this language before declaring profile completion:

- exact requiredNodeKinds set
- exact requiredEdgeKinds set
- exact requiredCapabilities map
- exact fallback downgrade behavior by stage
- exact framework applicability overrides (if any)

## 12. Required fixture ID mapping

This language contract MUST map concrete fixture IDs to conformance assertions.

Minimum required fixture ID groups:

- razor::positive::*
- razor::fallback::*
- razor::resolution::*
- razor::determinism::*
- razor::risk::* (when C3 applies)

## 13. Approval checklist

- [ ] Node kind mapping rows are defined and validated.
- [ ] Edge extraction assertions are covered by fixtures.
- [ ] Capability baseline and downgrade behavior are validated.
- [ ] Resolution reason-code expectations are validated.
- [ ] Risk expectations (if applicable) are validated.
- [ ] Deterministic rerun checks are green.


