# Spec -- USR Quality Evaluation and Accuracy Gate Contract

Status: Draft v0.2
Last updated: 2026-02-11T03:30:00Z

## 0. Purpose and scope

This document defines accuracy and quality-evaluation requirements for USR semantic outputs (resolution, risk, framework bindings, and provenance mapping quality).

It decomposes `docs/specs/unified-syntax-representation.md` sections 31, 33, and 49.

## 1. Required quality-gate artifact

Implementations MUST maintain:

- `tests/lang/matrix/usr-quality-gates.json`

## 2. Canonical quality-gate schema (normative)

```ts
type USRQualityGateRowV1 = {
  id: string;
  domain: "resolution" | "risk" | "framework-binding" | "provenance";
  scopeType: "global" | "language" | "framework";
  scopeId: string;
  metric: "precision" | "recall" | "f1" | "false-positive-rate" | "false-negative-rate";
  thresholdOperator: ">=" | "<=";
  thresholdValue: number; // 0..1
  fixtureSetId: string;
  blocking: boolean;
};
```

## 3. Quality-evaluation requirements

Quality evaluations MUST:

1. run against deterministic labeled fixture sets
2. report metric outputs per domain and scope
3. enforce blocking thresholds for configured blocking rows
4. retain diagnostic-level evidence for false-positive and false-negative cases
5. treat `precision|recall|f1` as `>=` thresholds and `false-positive-rate|false-negative-rate` as `<=` thresholds
6. fail strict validation when operator/metric semantics are mismatched

## 4. Labeled fixture-set policy

Fixture sets referenced by `fixtureSetId` MUST:

- declare frozen corpus version and deterministic sampling policy
- include positive/negative label provenance and reviewer metadata
- define allowed-language/framework scope and required conformance level
- emit deterministic fixture checksum evidence

## 5. Required outputs

- `usr-quality-evaluation-results.json`
- `usr-quality-regression-report.json`
- `usr-quality-failure-samples.json`

## 6. Promotion policy

- blocking quality gate failures are release-blocking
- non-blocking failures require triage and owner ETA
- repeated non-blocking failures across two release windows MUST escalate unless explicitly waived

## 7. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-audit-and-reporting-contract.md`
- `docs/specs/usr-waiver-and-exception-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
