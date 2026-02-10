# Spec -- USR Registry Schema and Serialization Contract

Status: Draft v0.1
Last updated: 2026-02-10T08:15:00Z

## 0. Purpose and scope

This document defines canonical machine-readable schema shapes, key constraints, and serialization rules for all USR registry/matrix files under `tests/lang/matrix/`.

It decomposes `docs/specs/unified-syntax-representation.md` sections 23 and 24.

## 1. Required registry files (normative)

Implementations MUST maintain and validate all files below:

- `usr-language-profiles.json`
- `usr-language-version-policy.json`
- `usr-language-embedding-policy.json`
- `usr-framework-profiles.json`
- `usr-node-kind-mapping.json`
- `usr-edge-kind-constraints.json`
- `usr-capability-matrix.json`
- `usr-conformance-levels.json`
- `usr-backcompat-matrix.json`
- `usr-framework-edge-cases.json`
- `usr-language-risk-profiles.json`
- `usr-embedding-bridge-cases.json`
- `usr-generated-provenance-cases.json`
- `usr-parser-runtime-lock.json`

## 2. Canonical wrappers and metadata

Every registry file MUST follow:

```ts
type USRRegistryFileV1<T> = {
  schemaVersion: "usr-registry-1.0.0";
  registryId: string;
  generatedAt: string; // ISO 8601
  generatedBy: string;
  rows: T[];
};
```

Rules:

- `registryId` MUST match filename stem exactly.
- `rows` MUST be deterministically sorted according to section 4.
- unknown top-level keys are strict-mode errors.

## 3. Per-registry row minimum schema

### 3.1 `usr-language-version-policy.json`

```ts
type USRLanguageVersionPolicyRowV1 = {
  languageId: string;
  minVersion: string;
  maxVersion: string | null;
  dialects: string[];
  featureFlags: string[];
};
```

### 3.2 `usr-language-embedding-policy.json`

```ts
type USRLanguageEmbeddingPolicyRowV1 = {
  languageId: string;
  canHostEmbedded: boolean;
  canBeEmbedded: boolean;
  embeddedLanguageAllowlist: string[];
};
```

### 3.3 `usr-parser-runtime-lock.json`

```ts
type USRParserRuntimeLockRowV1 = {
  parserSource: "native-parser" | "tree-sitter" | "framework-compiler" | "tooling" | "heuristic";
  languageId: string | "*";
  parserName: string;
  parserVersion: string;
  runtimeName: string | null;
  runtimeVersion: string | null;
  lockReason: string; // deterministic reason/category
};
```

## 4. Canonical ordering policy

Sorting MUST be stable and deterministic.

Default row ordering:

1. primary ID key lexical (`languageId`, `id`, or scenario id)
2. secondary discriminator lexical (`frameworkProfile`, `parserSource`, `generationKind`) when present
3. numeric priority ascending when present

Array field ordering:

- lexical ordering for identifiers/enums
- canonical conformance order for levels (`C0,C1,C2,C3,C4`)

## 5. Cross-registry invariants

The following MUST hold:

- all registry language IDs appear exactly once in:
  - `usr-language-profiles.json`
  - `usr-language-version-policy.json`
  - `usr-language-embedding-policy.json`
- framework IDs referenced by language/framework registries MUST exist in framework registry.
- parser/runtime lock rows MUST cover all parser sources used by language/framework profiles.
- case IDs referenced by framework/risk/bridge/provenance contracts MUST resolve to existing matrix rows.

## 6. Strict validation behavior

Strict validators MUST enforce:

- schemaVersion exact match
- required keys present
- unknown keys rejected
- enum values and numeric bounds validated
- deterministic ordering checks on output

Required validation outputs:

- `usr-registry-schema-validation.json`
- `usr-registry-cross-invariant-validation.json`
- `usr-registry-serialization-drift.json`

## 7. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-language-profile-catalog.md`
- `docs/specs/usr-framework-profile-catalog.md`
- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
