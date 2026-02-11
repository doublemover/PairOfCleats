# Spec -- USR Runtime Configuration and Feature-Flag Contract

Status: Draft v0.2
Last updated: 2026-02-11T02:40:00Z

## 0. Purpose and scope

This document defines deterministic runtime configuration policy, feature-flag behavior, and strict validation requirements for USR execution.

It decomposes `docs/specs/unified-syntax-representation.md` sections 26, 28, and 40.

## 1. Configuration goals (normative)

USR runtime configuration MUST:

- be deterministic for identical inputs
- be schema-validated in strict mode
- fail closed for unknown critical keys
- expose explicit defaults for every required key
- provide rollout-safe feature flags with audit trails

## 2. Canonical config schema

```ts
type USRRuntimeConfigPolicyRowV1 = {
  id: string;
  key: string; // canonical dotted path
  valueType: "boolean" | "integer" | "number" | "string" | "enum" | "array" | "object";
  defaultValue: string | number | boolean | null;
  allowedValues?: Array<string | number | boolean>;
  minValue?: number | null;
  maxValue?: number | null;
  rolloutClass: "stable" | "experimental" | "migration-only";
  strictModeBehavior: "reject-unknown" | "warn-unknown" | "coerce" | "disallow";
  requiresRestart: boolean;
  blocking: boolean;
};
```

Required matrix file:

- `tests/lang/matrix/usr-runtime-config-policy.json`

## 3. Required key families

The policy matrix MUST include at least these families:

- `usr.strictMode.*`
- `usr.parser.*`
- `usr.framework.*`
- `usr.risk.*`
- `usr.reporting.*`
- `usr.rollout.*`
- `usr.fallback.*`

## 4. Resolution precedence

Configuration resolution order MUST be deterministic:

1. explicit CLI override
2. environment variable mapping
3. workspace config file
4. repository defaults from policy matrix

Conflicts MUST be resolved by precedence order only; tie-breaking by insertion order is forbidden.

## 5. Feature-flag policy

Feature flags MUST declare:

- owner
- rollout class
- default state
- strict and non-strict behavior
- rollback semantics
- deprecation target date

Migration-only flags MUST include automatic removal criteria tied to rollout gates.

## 6. Strict-mode behavior

Strict mode MUST:

- reject unknown blocking keys
- reject invalid enum/range values
- reject conflicting flag combinations marked disallow
- emit deterministic diagnostics for every rejection

Non-strict mode MAY coerce non-blocking values only when `strictModeBehavior=coerce`.

## 7. Required artifacts

Validation and runtime outputs MUST include:

- `usr-runtime-config-validation.json`
- `usr-runtime-config-resolution.json`
- `usr-feature-flag-state.json`
- `usr-feature-flag-conflicts.json`

## 8. Change control

Config key additions or behavior changes MUST update:

- `tests/lang/matrix/usr-runtime-config-policy.json`
- this contract
- rollout and readiness contracts
- roadmap gate/task references

## 9. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-implementation-readiness-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
- `docs/specs/usr-waiver-and-exception-contract.md`
