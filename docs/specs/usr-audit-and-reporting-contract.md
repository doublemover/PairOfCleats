# Spec -- USR Audit and Reporting Contract

Status: Draft v0.1
Last updated: 2026-02-11T01:05:00Z

## 0. Purpose and scope

This document defines deterministic schemas and invariants for required USR audit outputs and reporting rollups.

It decomposes `docs/specs/unified-syntax-representation.md` sections 30 and 31.

## 1. Common report envelope (normative)

All required report files MUST use the canonical envelope:

```ts
type USRReportEnvelopeV1<T> = {
  schemaVersion: "usr-report-1.0.0";
  reportId: string;
  generatedAt: string; // ISO 8601
  runId: string;
  lane: string;
  buildId: string | null;
  status: "pass" | "warn" | "fail";
  summary: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
    blockingFailures: number;
  };
  rows: T[];
};
```

Rules:

- `reportId` MUST equal filename stem.
- `summary.total` MUST equal `rows.length`.
- `status` MUST be derived deterministically from row severities.
- unknown top-level keys are strict-mode errors.

## 2. Required report schemas

### 2.1 `usr-conformance-summary.json`

```ts
type USRConformanceSummaryRowV1 = {
  profileType: "language" | "framework";
  profileId: string;
  conformanceLevel: "C0" | "C1" | "C2" | "C3" | "C4";
  status: "pass" | "warn" | "fail";
  blocking: boolean;
  failedAssertions: string[];
};
```

### 2.2 `usr-capability-state-transitions.json`

```ts
type USRCapabilityTransitionRowV1 = {
  languageId: string;
  frameworkProfile: string | null;
  capability: string;
  fromState: "supported" | "partial" | "unsupported";
  toState: "supported" | "partial" | "unsupported";
  reasonCode: string;
  diagnosticCode: string | null;
  occurrenceCount: number;
  blocking: boolean;
};
```

### 2.3 `usr-diagnostic-distribution.json`

```ts
type USRDiagnosticDistributionRowV1 = {
  diagnosticCode: string;
  severity: "info" | "warning" | "error";
  languageId: string | null;
  frameworkProfile: string | null;
  count: number;
  blocking: boolean;
};
```

### 2.4 `usr-determinism-rerun-diff.json`

```ts
type USRDeterminismDiffRowV1 = {
  entityType: "document" | "segment" | "node" | "symbol" | "edge" | "flowPath" | "route" | "styleScope" | "diagnostic";
  entityId: string;
  diffClass: "missing" | "extra" | "value-change" | "order-change";
  fieldPath: string | null;
  baselineHash: string | null;
  rerunHash: string | null;
  blocking: boolean;
};
```

### 2.5 `usr-profile-coverage.json`

```ts
type USRProfileCoverageRowV1 = {
  profileType: "language" | "framework";
  profileId: string;
  requiredCount: number;
  coveredCount: number;
  coverageRate: number; // 0..1
  status: "pass" | "warn" | "fail";
  blocking: boolean;
};
```

## 3. Cross-report invariants (normative)

The following invariants MUST hold for each run:

- each language and framework profile in registry matrices appears in both `usr-conformance-summary.json` and `usr-profile-coverage.json`
- any `fail` row in `usr-determinism-rerun-diff.json` MUST drive parent report `status=fail`
- capability downgrade rows (`supported -> partial|unsupported`) MUST map to at least one diagnostic-distribution row with matching diagnostic code
- blocking failures in any required report MUST be reflected in release-readiness scorecard checks

## 4. Deterministic ordering and serialization

Default ordering:

1. primary profile or entity key lexical
2. secondary discriminator lexical (`conformanceLevel`, `capability`, `diagnosticCode`, `diffClass`)

Writers MUST preserve stable ordering for identical inputs.

## 5. CI gating policy

CI MUST enforce:

- schema validation for all required report files
- cross-report invariant checks from section 3
- deterministic rerun of report generation in strict lanes

Any blocking failure in required reports is release-blocking.

## 6. Recommended release scorecard artifact

For section 31 automation, producers SHOULD emit:

- `usr-release-readiness-scorecard.json`

Suggested row schema:

```ts
type USRReleaseScorecardRowV1 = {
  checkId: string;
  description: string;
  status: "pass" | "warn" | "fail";
  blocking: boolean;
  evidenceReportIds: string[];
};
```

## 7. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
