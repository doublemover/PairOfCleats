# Spec -- USR Security and Data Governance Contract

Status: Draft v0.2
Last updated: 2026-02-11T02:40:00Z

## 0. Purpose and scope

This document defines mandatory security controls and data-governance behavior for USR extraction and artifacts.

It decomposes `docs/specs/unified-syntax-representation.md` section 18.

## 1. Required machine-readable policy artifacts

Implementations MUST maintain:

- `tests/lang/matrix/usr-redaction-rules.json`
- `tests/lang/matrix/usr-security-gates.json`
- `tests/lang/matrix/usr-threat-model-matrix.json`

## 2. Redaction rule schema (normative)

```ts
type USRRedactionRuleRowV1 = {
  id: string;
  class:
    | "credential"
    | "token"
    | "key-material"
    | "secret-env"
    | "pii"
    | "sensitive-literal";
  detection: {
    kind: "regex" | "prefix" | "entropy" | "structured";
    pattern: string;
  };
  replacement: string; // canonical placeholder format
  appliesTo: Array<"diagnostic.message" | "edge.attrs" | "symbol.attrs" | "node.attrs" | "report.payload">;
  blocking: boolean;
};
```

Rules:

- replacement MUST match `<redacted:<reason-code>>` format.
- redaction rules MUST be deterministic and order-stable.
- overlapping rules MUST resolve by deterministic priority.

## 3. Security gate schema (normative)

```ts
type USRSecurityGateRowV1 = {
  id: string;
  check: string;
  scope: "parser" | "path" | "serialization" | "reporting" | "runtime";
  enforcement: "strict" | "warn";
  blocking: boolean;
};
```

Required gate categories:

- unsafe path rejection
- no untrusted code execution
- parser/runtime identity verification
- redaction coverage validation
- bounded diagnostic snippet behavior

## 4. Required validation and evidence outputs

- `usr-redaction-validation.json`
- `usr-security-gate-results.json`
- `usr-sensitive-surface-audit.json`
- `usr-threat-model-coverage.json`
- `usr-control-gap-report.json`

## 5. Fail-safe behavior policy

- strict security gate failures MUST fail closed and block promotion.
- warn gates MUST emit diagnostics and owner-assigned triage records.
- all redaction actions MUST be observable in audit outputs.

## 6. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-implementation-readiness-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
- `docs/specs/usr-threat-model-and-abuse-case-contract.md`
