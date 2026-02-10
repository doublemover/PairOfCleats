# Spec -- USR Resolution and Linking Contract

Status: Draft v0.1
Last updated: 2026-02-10T03:00:00Z

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
- emit `USR-W-CANONICALIZATION-FALLBACK` or profile-specific truncation diagnostics

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
- non-strict mode MAY preserve original in extension fields and emit compatibility diagnostics

## 6. Linking behavior by edge kind

| Edge kind | Required resolution behavior |
| --- | --- |
| `imports` | target MUST resolve to document/segment/symbol; unresolved imports require reason code |
| `references` | symbol/node linking MUST emit candidate set when ambiguous |
| `calls` | call target resolution MUST include callable-shape compatibility checks |
| `route_maps_to` | route target ambiguity MUST use `USR-R-ROUTE-PATTERN-CONFLICT` where applicable |
| `template_binds` | cross-block/template binding ambiguity MUST preserve bridge candidates |
| `style_scopes` | unresolved style ownership MUST use style-specific reason codes |

## 7. Compatibility and migration rules

- readers MUST handle `resolved|ambiguous|unresolved` in `usr-1.0.0`
- strict compatibility scenarios MUST reject unknown reason codes
- non-strict compatibility scenarios MAY accept additive resolution fields

## 8. Required tests

Minimum test categories:

- deterministic candidate ordering
- reason-code mapping coverage
- strict rejection for unknown reason codes
- non-strict compatibility adapter behavior
- edge endpoint + resolution envelope coherence

## 9. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
