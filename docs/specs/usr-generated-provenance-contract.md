# Spec -- USR Generated and Macro Provenance Contract

Status: Draft v0.1
Last updated: 2026-02-10T07:05:00Z

## 0. Purpose and scope

This document defines deterministic provenance requirements for generated, transpiled, macro-expanded, or compiler-synthesized USR entities.

It decomposes `docs/specs/unified-syntax-representation.md` section 39.

## 1. Canonical provenance schema (normative)

Entities derived from non-direct source surfaces MUST carry provenance attrs in canonical form:

```ts
type USRProvenanceV1 = {
  provenanceKind: "direct" | "macro" | "transpile" | "codegen" | "framework-compiler" | "synthetic";
  generatorKind: string | null; // compiler/tool/macro identifier
  originPath: string | null;
  originRange: {
    startByte: number | null;
    endByte: number | null;
    startLine: number | null;
    startCol: number | null;
    endLine: number | null;
    endCol: number | null;
  } | null;
  mappingQuality: "exact" | "approximate" | "missing";
  provenanceConfidence: number; // 0..1 normalized
};
```

Rules:

- `provenanceKind` MUST be present for all entities; direct source entities use `direct`.
- non-direct provenance kinds MUST provide `generatorKind`.
- `mappingQuality=exact` MUST include non-null `originPath` and `originRange`.
- `mappingQuality=missing` MUST set `originRange=null` and emit required diagnostics.

## 2. Provenance mapping policy

Mapping requirements:

1. if exact source mapping exists, emit `mappingQuality=exact`
2. if only coarse mapping exists, emit `mappingQuality=approximate` with downgraded confidence
3. if no mapping exists, emit `mappingQuality=missing` with deterministic diagnostics

Producers MUST NOT silently upgrade `approximate` or `missing` mappings to `exact`.

## 3. Language and framework provenance classes

Required provenance coverage classes:

- macro expansion (`rust`, `clike`, `scala`, templated generators)
- transpilation (`typescript`, JSX transforms, framework compilers)
- generated stubs/artifacts (`proto`, code generators, build outputs)
- framework compiler synthesis (`vue`, `svelte`, `astro`, Angular template compilers)

Each applicable language/framework profile MUST define expected provenance classes and unsupported classes explicitly.

## 4. Diagnostics and degradation policy

Required behavior:

- missing provenance mappings MUST emit deterministic diagnostics
- approximate mappings MUST emit non-blocking diagnostics with confidence downgrade
- strict mode MUST reject invalid provenance enum values or malformed origin ranges
- non-strict mode MAY carry additive provenance extension fields only when namespaced

## 5. Required machine-readable artifacts

Implementations MUST maintain:

- `tests/lang/matrix/usr-generated-provenance-cases.json`

Each case row MUST include:

- `id`
- `languageId`
- `generationKind`
- `mappingExpectation`
- `requiredDiagnostics`
- `blocking`

Required report outputs:

- `usr-generated-provenance-coverage.json`
- `usr-generated-provenance-downgrades.json`
- `usr-generated-provenance-drift.json`

## 6. Conformance requirements

Required conformance checks:

- provenance attrs schema validation across all entity families
- deterministic provenance emission across reruns
- mapping quality and confidence coherence checks
- provenance diagnostics correctness under missing/approximate mappings

For languages requiring C2/C3/C4 provenance-aware behavior, provenance conformance failures are blocking.

## 7. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
