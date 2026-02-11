# Spec -- USR Failure Injection and Resilience Contract

Status: Draft v0.2
Last updated: 2026-02-11T02:40:00Z

## 0. Purpose and scope

This document defines mandatory failure-injection scenarios, fail-closed behavior, and resilience evidence required before production cutover.

It decomposes `docs/specs/unified-syntax-representation.md` sections 14, 26, 40, 41, and 42.

## 1. Canonical failure matrix schema

```ts
type USRFailureInjectionRowV1 = {
  id: string;
  faultClass:
    | "parser-unavailable"
    | "parser-timeout"
    | "mapping-conflict"
    | "resolution-ambiguity-overflow"
    | "serialization-corruption"
    | "security-gate-failure"
    | "redaction-failure"
    | "resource-budget-breach";
  injectionLayer: "input" | "parser" | "normalization" | "resolution" | "serialization" | "reporting" | "runtime";
  strictExpectedOutcome: "fail-closed" | "degrade-with-diagnostics";
  nonStrictExpectedOutcome: "degrade-with-diagnostics" | "warn-only";
  requiredDiagnostics: string[];
  requiredReasonCodes: string[];
  blocking: boolean;
};
```

Required matrix file:

- `tests/lang/matrix/usr-failure-injection-matrix.json`

## 2. Required failure families

The matrix MUST include at least one blocking scenario for each:

- parser unavailability and timeout
- mapping conflict and unknown-kind surge
- unresolved/ambiguous resolution budget breach
- serialization/report corruption
- strict security-gate failure
- strict redaction failure
- SLO/resource budget breach

## 3. Expected resilience behavior

Strict mode MUST:

- fail closed for blocking failures
- prevent promotion on unresolved blocking faults
- emit deterministic diagnostics and reason-code evidence

Non-strict mode MUST:

- never silently suppress blocking failures
- preserve partial valid outputs when allowed by contract
- emit downgrade diagnostics for all degraded behavior

## 4. Required evidence outputs

Failure-injection runs MUST emit:

- `usr-failure-injection-results.json`
- `usr-failure-injection-diagnostics.json`
- `usr-failure-injection-recovery.json`
- `usr-failure-injection-drift.json`

## 5. Rollback and recovery assertions

For each blocking scenario:

- rollback trigger thresholds MUST be validated
- rollback event MUST be generated and linked
- recovery-to-green criteria MUST be explicitly asserted

## 6. CI policy

CI MUST run:

- strict blocking subset on every relevant PR
- full failure matrix on scheduled/nightly lanes

Any strict blocking scenario failure is release-blocking.

## 7. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-observability-and-slo-contract.md`
- `docs/specs/usr-security-and-data-governance-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
- `docs/specs/usr-threat-model-and-abuse-case-contract.md`
- `docs/specs/usr-waiver-and-exception-contract.md`
