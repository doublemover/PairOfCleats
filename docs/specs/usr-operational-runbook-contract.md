# Spec -- USR Operational Runbook and Incident Response Contract

Status: Draft v0.2
Last updated: 2026-02-11T03:30:00Z

## 0. Purpose and scope

This document defines machine-readable operational runbook requirements for incident handling, rollback, escalation, and cutover readiness.

It decomposes `docs/specs/unified-syntax-representation.md` sections 26, 40, and 50.

## 1. Required operational policy artifact

Implementations MUST maintain:

- `tests/lang/matrix/usr-operational-readiness-policy.json`

## 2. Canonical operational policy schema (normative)

```ts
type USROperationalReadinessRowV1 = {
  id: string;
  phase: "pre-cutover" | "cutover" | "post-cutover" | "incident";
  runbookId: string;
  severityClass: "sev1" | "sev2" | "sev3" | "n/a";
  requiredRoles: string[];
  requiredArtifacts: string[];
  communicationChannels: string[];
  maxResponseMinutes: number;
  maxRecoveryMinutes: number;
  blocking: boolean;
};
```

## 3. Operational requirements

Operational readiness MUST define:

- incident severity routing and escalation roles
- rollback execution steps and trigger thresholds
- communications protocol for release-blocking incidents
- post-incident artifact and postmortem requirements

Incident/runbook policies MUST also enforce:

- non-empty role coverage for blocking entries
- at least one communication channel for `phase=incident`
- response/recovery SLO budgets bounded to positive integers
- runbook version pinning in evidence artifacts to prevent drift

## 4. Drill cadence and evidence policy

- blocking incident and rollback drills MUST run before each cutover window and at least once per 30-day cycle
- failed blocking drills MUST create a remediation owner, ETA, and rerun evidence artifact
- promotion MUST consume the latest successful drill artifact for each blocking row

## 5. Required outputs

- `usr-operational-readiness-validation.json`
- `usr-incident-response-drill-report.json`
- `usr-rollback-drill-report.json`

## 6. Promotion policy

- missing blocking runbook policies are promotion blockers
- failed incident/rollback drill requirements are promotion blockers for cutover phases

## 7. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-implementation-readiness-contract.md`
- `docs/specs/usr-audit-and-reporting-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
