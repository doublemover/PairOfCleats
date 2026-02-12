# Spec -- USR Core Rollout, Release, and Migration Contract

Status: Draft v2.0
Last updated: 2026-02-12T07:49:17Z

## Purpose

Define staged rollout, compatibility policy, release-readiness gates, and rollback requirements.

## Consolidated source coverage

This contract absorbs:

- `usr-rollout-and-migration-contract.md` (legacy)
- `usr-release-train-contract.md` (legacy)
- `usr-operational-runbook-contract.md` (legacy)
- `usr-cutover-runbook.md` (legacy)
- `usr-rollback-runbook.md` (legacy)
- `usr-release-checklist.md` (legacy)
- `usr-incident-severity-matrix.md` (legacy)

## Rollout phases

1. `shadow-read`
2. `dual-write`
3. `strict-gate pre-cutover`
4. `cutover`
5. `post-cutover stabilization`

Each phase must define entry/exit criteria and required evidence artifacts.

Phase gate minimums:

| Phase | Required entry | Required exit |
| --- | --- | --- |
| `shadow-read` | baseline artifacts available | parity deltas measured and within advisory bounds |
| `dual-write` | shadow-read exit met | writer/read parity green for blocking scenarios |
| `strict-gate pre-cutover` | compatibility matrix strict scenarios green | operational readiness drills green and fresh |
| `cutover` | no blocking waivers expired, no-cut checks clear | production validation window complete |
| `post-cutover stabilization` | cutover complete | churn/regression metrics within thresholds |

### Roadmap phase mapping (A/B/C/D)

Appendix F.1 in `TES_LAYN_ROADMAP.md` maps rollout implementation milestones onto the lifecycle phases above.

| Roadmap phase | Required scope | Blocking evidence bundle |
| --- | --- | --- |
| Phase A (schema and registry readiness) | schema + registry validation + drift checks green | `usr-validation-report.json`, `usr-drift-report.json` |
| Phase B (dual-write parity validation) | parity checks between legacy outputs and USR-derived outputs | `usr-backcompat-matrix-results.json`, `usr-validation-report.json` |
| Phase C (USR-backed production path validation) | USR-backed internals with compatibility outputs retained | `usr-operational-readiness-validation.json`, `usr-release-readiness-scorecard.json`, `usr-observability-rollup.json` |
| Phase D (full conformance enforcement) | required conformance levels C0-C4 (profile-dependent) green in required lanes | `usr-conformance-summary.json`, `usr-quality-evaluation-results.json`, `usr-release-readiness-scorecard.json` |

Rollout phases MUST be promoted in order A -> B -> C -> D; phase skipping is forbidden without explicit Tier 3 exception approval and rollback evidence.

### Phase-to-CI gate mapping

Each roadmap phase maps to a minimum CI gate bundle that must remain active in both `ci` and `ci-lite` lanes.

| Roadmap phase | Minimum CI gate bundle |
| --- | --- |
| Phase A | `lang/contracts/usr-contract-enforcement`, `shared/contracts/usr-schema-validators`, `shared/contracts/usr-matrix-validators`, `decomposed-drift/decomposed-drift-validation` |
| Phase B | `backcompat/backcompat-matrix-validation`, `lang/contracts/usr-rollout-migration-policy-validation`, `lang/contracts/usr-rollout-phase-gate-validation` |
| Phase C | `lang/contracts/usr-implementation-readiness-validation`, `lang/contracts/usr-observability-rollup-validation`, `lang/contracts/usr-security-gate-validation` |
| Phase D | `lang/contracts/usr-c0-baseline-validation`, `lang/contracts/usr-c1-baseline-validation`, `lang/contracts/usr-c2-baseline-validation`, `lang/contracts/usr-c3-baseline-validation`, `lang/contracts/usr-c4-baseline-validation` |

## Compatibility policy

Compatibility enforcement must use:

- `tests/lang/matrix/usr-backcompat-matrix.json`
- scenario classes `BC-001` through `BC-012`
- strict and non-strict reader profiles

Strict scenario failures in blocking classes are release-blocking.

Legacy-output retention requirements:

- legacy artifact outputs MUST remain emitted until Phase B parity and Phase C readiness evidence are both approved
- Phase C cannot mark complete if legacy compatibility outputs are removed or materially degraded
- any proposal to remove legacy outputs before Phase D requires Tier 3 approval and explicit rollback playbook updates

No-cut triggers:

1. any strict blocking scenario failure
2. stale required drill evidence
3. unresolved critical security gate
4. rollback drill failure

## Operational readiness requirements

Before cutover:

- rollback drill must be fresh and passing
- incident response drill must be fresh and passing
- release checklist must be complete
- no expired waivers in blocking scope

## Release train controls

Release train rows must define:

- freeze windows
- required gate bundles
- owner approvals
- no-cut decision thresholds

Rollout authorization lock requirements:

- rollout approval lock state is tracked in `docs/specs/usr-rollout-approval-lock.md`
- Gate C rollout authorization cannot be checked unless the lock state is `approved`
- required role decisions (`usr-architecture`, `usr-conformance`, `usr-operations`) must be explicitly recorded with ISO 8601 timestamps

Appendix F.1 checklist promotion lock requirements:

- Phase A can only be checked after Gate A checklist is fully checked.
- Phase B can only be checked after Phase A is checked and Phase B parity evidence remains green.
- Phase C can only be checked after Phase A and Phase B are checked, `Readiness report approved.` is checked, and `Test rollout authorized.` is checked.
- Phase D can only be checked after Phase A/B/C are checked, Gate C `all prior gates pass.` and `conformance rollout authorized.` are checked, and rollout approval lock state is `approved`.

Phase 9 readiness authorization lock requirements:

- `Readiness report approved.` cannot be checked while any item in Phase 9.1 (`Readiness audit`) or Phase 9.2 (`Go/No-Go decision`) is unchecked.
- `Test rollout authorized.` cannot be checked unless `Readiness report approved.` is checked and Gate B1-B7 checklist has no unchecked items.
- If Gate B8 mixed-repo/cross-batch coherence controls regress, readiness and test-rollout authorization lines must be reopened.

Gate B1-B7 language-batch completion lock requirements:

- `all language task packs in batch completed.` cannot be checked while Appendix C contains unchecked language task-pack items.
- `C0/C1 checks pass for batch languages.` cannot be checked unless Phase 11 exit criterion `All languages pass required C0/C1 checks.` is checked.
- `determinism checks pass for batch languages.` cannot be checked unless Phase 8 exit criterion `Determinism checks pass under repeated runs.` is checked.
- `known degradations recorded with diagnostic codes.` and `diagnostic severity/code alignment checks pass for language batch fixtures.` require diagnostic/reason-code contracts and CI severity/reason-code validators to remain active.

Phase 9.1 readiness-audit completion lock requirements:

- `Validate completion evidence for all B1-B7 task packs.` cannot be checked while Gate B1-B7 or Gate B8 checklist lines remain unchecked.
- `Validate per-language contract approval checklists are complete for target rollout set.` cannot be checked while any file in `docs/specs/usr/languages/*.md` contains unchecked approval checklist lines.
- If either Phase 9.1 lock line regresses to unchecked dependencies, `Readiness report approved.` and `Test rollout authorized.` must be reopened.

Gate C conformance-authorization chain lock requirements:

- `conformance rollout authorized.` cannot be checked unless `all prior gates pass.` and `harness and lanes materialized.` are checked in Gate C.
- `conformance rollout authorized.` cannot be checked unless `Readiness report approved.` and `Test rollout authorized.` are checked in Phase 9.3.
- `conformance rollout authorized.` cannot be checked unless Appendix F.1 `Complete Phase A`, `Complete Phase B`, and `Complete Phase C` are checked and rollout approval lock state is `approved`.
- If Gate C conformance authorization is checked, no blocking checklist line in Gate C may remain unchecked.

Appendix F.1 phase-evidence lock requirements:

- `Complete Phase A schema and registry readiness.` cannot be checked while Gate A contains unchecked checklist lines.
- `Complete Phase B dual-write parity validation.` cannot be checked unless Gate C `backward-compat matrix strict scenarios are green in CI.` is checked.
- `Complete Phase C USR-backed production path validation.` cannot be checked unless Gate C operational/security/performance/threat/waiver evidence lines remain checked.
- `Complete Phase D full conformance enforcement.` cannot be checked unless Phase 11.3, Phase 12.3, and Phase 13.2 exit criteria are checked and Gate C `conformance rollout authorized.` is checked.

Phase 9.2 go/no-go decision lock requirements:

- `Block test rollout if any language lacks C0/C1 readiness.` cannot be checked unless Phase 11.3 exit criterion is checked and C0/C1 baseline conformance lane validators remain in required CI lanes.
- `Block deep conformance if C2/C3 prerequisites are missing.` cannot be checked unless Phase 12.3 exit criterion is checked and C2/C3 baseline conformance lane validators remain in required CI lanes.
- `Block framework conformance if C4 profile prerequisites are missing.` cannot be checked unless Phase 13.2 exit criterion is checked and C4 baseline conformance lane validators remain in required CI lanes.
- If any Phase 9.2 go/no-go line regresses to unchecked prerequisites, `Readiness report approved.` and `Test rollout authorized.` must be reopened.

Gate C evidence-completeness lock requirements:

- `all prior gates pass.` cannot be checked unless every Gate C evidence line (backcompat, drift, implementation-readiness, SLO, security, failure-injection, fixture-governance, benchmark, threat-model, waiver) is checked.
- If `all prior gates pass.` regresses to unchecked, `conformance rollout authorized.` and Appendix F.1 `Complete Phase D full conformance enforcement.` must remain unchecked until Gate C evidence is restored.
- If any required Gate C evidence line regresses to unchecked, readiness and rollout authorization lines must be reopened.

Phase 15 exit-completion lock requirements:

- `CI and maintenance controls are stable for ongoing development.` cannot be checked unless every checklist line in sections 15.1, 15.2, and 15.3 is checked.
- Phase 15 exit cannot be checked unless required maintenance/rollout/report-schema validators remain present in `ci` and `ci-lite` lane order manifests.
- If any Phase 15 prerequisite control regresses to unchecked, Phase 15 exit must be reopened and release-readiness promotion must remain blocked.

## Rollback policy

Rollback must provide:

- one-step path to prior stable read behavior
- explicit trigger thresholds
- data loss and compatibility impact assessment

Rollback must also include:

- deterministic switchback command path
- maximum rollback decision window
- post-rollback validation checklist

## Deprecation and archival protocol

Any USR deprecation MUST satisfy all of the following before merge:

- deprecated/superseded doc moved under `docs/archived/`
- archived doc begins with a DEPRECATED header block
- DEPRECATED block includes canonical replacement, reason, date, and PR/commit metadata
- migration and parity evidence references included when deprecation affects artifact semantics or outputs

Deprecation changes are blocking until archival metadata requirements are met and linked from PR governance checklist controls.

## Required outputs

- `usr-backcompat-matrix-results.json`
- `usr-operational-readiness-validation.json`
- `usr-incident-response-drill-report.json`
- `usr-rollback-drill-report.json`
- `usr-release-train-readiness.json`
- `usr-no-cut-decision-log.json`
- `usr-post-cutover-stabilization-report.json`

## References

- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/specs/usr-core-observability-performance-ops.md`
- `docs/specs/usr-rollout-approval-lock.md`
- `docs/archived/README.md`

