# Spec -- USR Resolution and Linking Contract

Status: Draft v0.4
Last updated: 2026-02-10T07:05:00Z

## 0. Purpose and scope

This document defines import/reference resolution and linking behavior for USR edges.

It decomposes `docs/specs/unified-syntax-representation.md` sections 7.12, 8.5, 12, 33, and 36 compatibility requirements.

## 1. Resolution state machine (normative)

Resolution outcomes MUST use this state model:

- `resolved`
- `ambiguous`
- `unresolved`
- `derived`
- `suppressed`

Allowed transitions:

- initial -> `resolved|ambiguous|unresolved`
- `resolved` -> `ambiguous|unresolved|suppressed` (degradation only)
- `ambiguous` -> `resolved|unresolved|suppressed`
- `unresolved` -> `resolved|ambiguous|suppressed`

Every transition into non-resolved states MUST emit required diagnostics and reason codes.

## 2. Resolution envelope contract

`attrs.resolution` MUST follow:

```ts
type USRResolutionEnvelopeV1 = {
  status: "resolved" | "ambiguous" | "unresolved";
  targetName: string | null;
  resolver: "language-native" | "tree-sitter" | "framework-compiler" | "tooling" | "heuristic";
  reasonCode: string | null; // required for ambiguous/unresolved
  candidates: Array<{
    uid: string;
    entity: "document" | "segment" | "node" | "symbol";
    confidence: number | null;
    why: string | null;
  }>;
};
```

Rules:

- `status` MUST match edge `status` for unresolved/ambiguous/resolved outcomes
- `reasonCode` MUST use taxonomy from USR section 33.2
- candidate ordering MUST be deterministic: confidence desc, uid lexical
- ambiguous outcomes MUST include >=2 candidates

## 3. Candidate policy (normative)

Candidate generation MUST be explicit and bounded.

Required candidate attributes:

- `uid`, `entity`
- `confidence` (or null where unavailable)
- `why` explanation string (or null for compact mode)

Bounded limits:

- default max candidates: 16
- strict conformance fixtures MUST test cap hit handling

When cap is hit:

- retain best N deterministically
- emit canonical truncation diagnostics and include retained-candidate count metadata

## 4. Confidence normalization

Confidence MUST be normalized to `[0,1]` with deterministic rounding (section 5.6 numeric normalization).

Confidence source precedence:

1. language-native resolver confidence
2. framework-compiler metadata confidence
3. tooling-derived confidence
4. heuristic confidence

Mixed-source candidates MUST record resolver source in edge evidence.

## 5. Reason-code normalization

Reason codes MUST map to canonical taxonomy from USR section 33.2.

Normalization rules:

- profile-specific raw reasons MUST map into canonical `USR-R-*` values
- unknown reasons are strict-mode errors
- non-strict mode MUST preserve original only in namespaced extension fields and MUST emit compatibility diagnostics

## 6. Linking behavior by edge kind

| Edge kind | Required resolution behavior |
| --- | --- |
| `imports` | target MUST resolve to document/segment/symbol; unresolved imports require reason code |
| `references` | symbol/node linking MUST emit candidate set when ambiguous |
| `calls` | call target resolution MUST include callable-shape compatibility checks |
| `route_maps_to` | route target ambiguity MUST use `USR-R-ROUTE-PATTERN-CONFLICT` where applicable |
| `template_binds` | cross-block/template binding ambiguity MUST preserve bridge candidates |
| `style_scopes` | unresolved style ownership MUST use style-specific reason codes |

## 7. Candidate scoring policy

Implementations MUST apply deterministic candidate scoring inputs in this precedence:

1. lexical and scope compatibility
2. type/shape compatibility
3. module/import graph proximity
4. framework/compiler provenance strength
5. heuristic evidence

Score tie handling MUST produce deterministic ambiguity output and MUST NOT auto-resolve ties.

## 8. Embedded bridge resolution policy

For edges crossing virtual segments in embedded/multi-surface documents:

- resolution evidence MUST include bridge attrs from the embedding contract
- candidate sets MUST preserve segment-level provenance for each candidate
- bridge-edge unresolved/ambiguous outcomes MUST use canonical bridge reason codes

## 9. Suppression and derived-edge policy

- `suppressed` edges are allowed only when explicit policy forbids emission of an otherwise derivable edge.
- `derived` edges MUST include evidence source and confidence rationale in attrs/evidence.
- suppressed or derived outcomes MUST never violate endpoint constraints.

## 10. Compatibility and migration rules

- readers MUST handle `resolved|ambiguous|unresolved` in `usr-1.0.0`
- strict compatibility scenarios MUST reject unknown reason codes
- non-strict compatibility scenarios MAY accept additive resolution fields

## 11. Required tests

Minimum test categories:

- deterministic candidate ordering
- reason-code mapping coverage
- strict rejection for unknown reason codes
- non-strict compatibility adapter behavior
- edge endpoint + resolution envelope coherence
- candidate-cap truncation diagnostics and retained-order stability
- suppression/derived-edge evidence coherence checks

Required report outputs:

- `usr-resolution-outcome-distribution.json`
- `usr-resolution-reason-code-distribution.json`
- `usr-resolution-ambiguity-budget.json`
- `usr-resolution-candidate-cap-events.json`

## 12. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-embedding-bridge-contract.md`


