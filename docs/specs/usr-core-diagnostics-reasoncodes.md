# Spec -- USR Core Diagnostics and Reason-Code Contract

Status: Draft v2.0
Last updated: 2026-02-11T08:20:00Z

## Purpose

Define canonical diagnostic envelopes, reason-code taxonomy, lifecycle behavior, and escalation policy.

## Consolidated source coverage

This contract absorbs:

- `usr-diagnostic-catalog.md` (legacy)
- `usr-reason-code-catalog.md` (legacy)
- `usr-diagnostics-lifecycle-contract.md` (legacy)

## Diagnostic identity and format

Diagnostics must use stable IDs and code format:

- `diagnosticUid`: `diag64:v1:<hex16>`
- code format: `USR-[EWI]-<DOMAIN>-<DETAIL>`
- severity must match code prefix (`E` error, `W` warning, `I` info)

## Mandatory diagnostic envelope fields

- `diagnosticUid`
- `code`
- `severity`
- `phase`
- `message`
- `reasonCode`
- `languageId` (nullable)
- `frameworkProfile` (nullable)
- `docUid` / `segmentUid` / `nodeUid` as applicable
- `remediationClass`

## Reason-code taxonomy policy

Reason codes must define:

- trigger condition
- required context fields
- expected remediation class
- blocking/advisory impact

Taxonomy domains:

- parsing (`PARSE-*`)
- normalization (`NORM-*`)
- linking (`LINK-*`)
- framework extraction (`FRAME-*`)
- risk/security (`RISK-*`, `SEC-*`)
- conformance/quality (`CONF-*`, `QUAL-*`)
- operational gates (`GATE-*`, `WAIVER-*`)

Reason-code row schema:

| Field | Required | Description |
| --- | --- | --- |
| `reasonCode` | yes | Canonical stable identifier. |
| `domain` | yes | Taxonomy domain. |
| `trigger` | yes | Deterministic trigger condition. |
| `requiredFields` | yes | Required diagnostic envelope fields. |
| `remediationClass` | yes | Routing class for triage. |
| `blockingClass` | yes | `blocking` or `advisory`. |

## Lifecycle and recurrence

Diagnostics lifecycle states:

1. detected
2. emitted
3. triaged
4. mitigated
5. closed

Recurrence policy:

- repeated advisory diagnostics crossing threshold escalate severity class
- repeated unresolved blocking diagnostics must fail cutover gates

## Deduping and grouping

Deduping key must include:

- code
- reasonCode
- primary location identity
- canonical message fingerprint

Grouping dimensions must include:

- language
- framework profile
- phase
- remediation class

Recurrence escalation defaults:

- same `reasonCode` in >=3 consecutive runs for same scope: promote advisory -> warning-severe
- same blocking `reasonCode` unresolved in >=2 consecutive release lanes: force ownership escalation

## Remediation classes

- `authoring`: source-level fix required
- `registry`: matrix/profile contract update required
- `adapter`: parser/compiler adapter fix required
- `policy`: gate/waiver configuration update required
- `runtime`: operational handling required

## Required outputs

- `usr-diagnostic-catalog-validation.json`
- `usr-reason-code-catalog-validation.json`
- `usr-diagnostics-lifecycle-summary.json`
- `usr-diagnostic-recurrence-report.json`
- `usr-reason-code-coverage-report.json`
- `usr-remediation-routing-summary.json`

## Quality gates

- unknown reason codes in strict mode are blocking
- missing required diagnostic envelope fields are blocking
- non-deterministic diagnostic ordering is blocking

## References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`

