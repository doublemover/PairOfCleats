# TES_LAYN_ROADMAP - Lean USR Execution Plan

Last updated: 2026-02-13T09:58:25Z
Status: active
Supersedes: prior exhaustive single-file master-plan format

## 0) Purpose

This roadmap is the execution-facing USR plan.

It is intentionally lean:
- One source of truth for phase order and current execution focus.
- Clear go/no-go gates.
- Minimal duplication of policy text and per-language boilerplate.
- Detailed task packs and governance controls are moved to companion docs.

Companion docs:
- `TES_LAYN_EXECUTION_PACKS.md`
- `TES_LAYN_GOVERNANCE.md`

## 1) Program Objective

Deliver deterministic and auditable USR support for all registry languages and required frameworks with:
- stable identity and normalization behavior
- explicit capability and degradation signaling
- C0-C4 conformance enforcement where required
- clear rollout and maintenance controls

## 2) Authoritative Inputs

Primary contracts:
- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr/README.md`
- `docs/specs/usr-consolidation-coverage-matrix.md`
- `docs/specs/usr-core-*.md`
- `docs/specs/metadata-schema-v2.md`
- `docs/specs/identity-contract.md`
- `docs/specs/identity-and-symbol-contracts.md`
- `docs/contracts/public-artifact-surface.md`
- `docs/contracts/artifact-schemas.md`
- `docs/contracts/analysis-schemas.md`
- `src/index/language-registry/registry-data.js`

Contract precedence:
1. `docs/specs/unified-syntax-representation.md`
2. USR core contract set (`docs/specs/usr-core-*.md`, `docs/specs/usr/README.md`)
3. This roadmap and its companion docs

## 3) Coverage Surface

Registry language IDs (authoritative):
- `javascript`, `typescript`, `python`, `clike`, `go`, `java`, `csharp`, `kotlin`, `ruby`, `php`, `html`, `css`, `lua`, `sql`, `perl`, `shell`, `rust`, `swift`, `cmake`, `starlark`, `nix`, `dart`, `scala`, `groovy`, `r`, `julia`, `handlebars`, `mustache`, `jinja`, `razor`, `proto`, `makefile`, `dockerfile`, `graphql`

Required framework profiles:
- `react`, `vue`, `next`, `nuxt`, `svelte`, `sveltekit`, `angular`, `astro`

## 4) Operating Rules

- Implementation-first: do not front-load deep conformance rollout before implementation phases are complete.
- Keep WIP narrow: at most two active phases at a time.
- Keep checklist semantics strict: checkboxes are completed only when code, tests, and docs are landed together.
- Keep deterministic behavior non-negotiable: stable IDs, ordering, serialization, and diagnostics.
- Avoid placeholder paths (`tests/<new>`, `docs/<new>`) in active-phase tasks; use concrete paths only.

## 5) Phase Plan (Lean)

### Phase A - Contract and Registry Baseline

Objective: lock traceability, registries, schema validators, and drift checks.

Deliverables:
- [x] USR traceability matrix drafted and approved.
- [x] Registry and matrix artifacts exist and schema-validate.
- [x] Parser/runtime lock policy artifacts exist and validate.
- [ ] Remaining unresolved contract contradictions are closed.

Exit checks:
- [ ] No contract precedence conflicts remain unresolved.
- [ ] Drift checks pass for registry/schema/matrix surfaces.

### Phase B - Identity and Normalization Core

Objective: enforce coordinate, identity, integrity, and parser/normalization determinism.

Deliverables:
- [ ] Canonical ID grammar and collision handling enforced in runtime + validators.
- [ ] Endpoint/entity integrity constraints enforced and tested.
- [ ] Parser precedence and normalization mapping are deterministic and table-driven.

Exit checks:
- [ ] Determinism reruns pass for ID and parse/normalize outputs.
- [ ] Integrity/constraint failure cases produce expected diagnostics.

### Phase C - Language Batch Execution (B1-B7)

Objective: implement and harden language adapters by batch with concrete conformance targets.

Deliverables:
- [ ] B1 complete (JS/TS + framework foundations).
- [ ] B2-B7 complete with required adapters and fixture coverage.
- [ ] Import-only language entries are replaced by full adapters where required.

Exit checks:
- [ ] All batch deliverables in `TES_LAYN_EXECUTION_PACKS.md` marked complete.
- [ ] Required C-levels are achievable for each language profile.

### Phase D - Framework Overlay Completion (C4)

Objective: complete framework-specific route/template/style canonicalization and overlay semantics.

Deliverables:
- [ ] Framework handlers and profile wiring are implemented for all required frameworks.
- [ ] Framework edge-case fixtures and C4 lanes are in place.

Exit checks:
- [ ] Framework C4 conformance is green for required profiles.

### Phase E - Semantics, Risk, and Fixture Hardening

Objective: complete C2/C3 semantics, risk surfaces, canonical examples, and deterministic goldens.

Deliverables:
- [ ] Flow/query/risk semantics implemented for required profiles.
- [ ] Fixture indexes and canonical bundles are complete and deterministic.
- [ ] Golden refresh and drift controls are operational.

Exit checks:
- [ ] Required semantic/risk lanes pass with expected diagnostics.
- [ ] Golden outputs are deterministic on rerun.

### Phase F - Hardening and Readiness

Objective: finalize determinism/caps/perf guardrails and produce rollout readiness evidence.

Deliverables:
- [ ] Determinism and cap behavior pass required checks.
- [ ] Runtime/resource guardrails and observability baselines are green.
- [ ] Readiness evidence artifacts are current and approved.

Exit checks:
- [ ] Readiness report approved.
- [ ] Test rollout authorized.

### Phase G - Conformance Rollout

Objective: execute conformance sequence C0/C1 -> C2/C3 -> C4 -> integration/failure-mode suites.

Deliverables:
- [ ] C0/C1 baseline complete.
- [ ] C2/C3 complete for required profiles.
- [ ] C4 complete for required frameworks.
- [ ] Integration/failure-mode suites complete.

Exit checks:
- [ ] Required conformance lanes are green in required CI lanes.

### Phase H - CI, Reporting, and Maintenance Operations

Objective: maintain stable policy enforcement, reporting, and governance over time.

Deliverables:
- [ ] Gate enforcement remains stable in CI/CI-long/nightly.
- [ ] Required report artifacts remain schema-valid and current.
- [ ] Change-control, waiver, and maintenance policies remain enforced.

Exit checks:
- [ ] Release readiness scorecard remains green for target rollout scope.

## 6) Current Tranche (Now / Next / Later)

Now:
1. Phase B completion gaps (identity/integrity/parser precedence normalization)
2. Phase C B1 completion (JS/TS + framework foundations)

Next:
1. Phase C B2-B4 language batches
2. Phase D framework overlays

Later:
1. Phase C B5-B7 completion
2. Phases E-H rollout and steady-state operations

## 7) Gate Invariants (Short Form)

1. No rollout authorization without readiness approval.
2. No conformance authorization while prior gates have unresolved blocking items.
3. No phase completion when required evidence artifacts are missing or stale.
4. No strict-mode promotion with unresolved blocking diagnostics.
5. No required lane removal from CI without governance approval.
6. No schema/contract changes without synchronized validator and drift updates.

Detailed invariant and lock policy: `TES_LAYN_GOVERNANCE.md`.

## 8) Evidence Artifacts (Primary)

- `usr-validation-report.json`
- `usr-drift-report.json`
- `usr-conformance-summary.json`
- `usr-quality-evaluation-results.json`
- `usr-operational-readiness-validation.json`
- `usr-release-readiness-scorecard.json`
- `usr-observability-rollup.json`
- `usr-waiver-active-report.json`
- `usr-waiver-expiry-report.json`

Detailed evidence mapping: `TES_LAYN_GOVERNANCE.md`.

## 9) Linked Execution and Governance Docs

- Execution packs (batch and profile implementation details): `TES_LAYN_EXECUTION_PACKS.md`
- Governance, locks, evidence, and change-control: `TES_LAYN_GOVERNANCE.md`

---

## Appendix B - Batch Gate Checklists (Compatibility)

These retained headings preserve existing contract-test anchors while governance detail lives in `TES_LAYN_GOVERNANCE.md`.

### Gate A (B0 contracts/registries)

- [ ] contracts/registries are fully reconciled with no unresolved blockers.
- [x] machine-readable matrices and validators are present and drift-checked.

### Gate B1-B7 (language batch gates)

- [ ] all language task packs in active scope are complete.
- [ ] required C0/C1 baseline readiness is met for active rollout target.
- [ ] determinism checks are green for active batch outputs.

### Gate B8 (cross-batch integration)

- [ ] mixed-repo and cross-batch integration checks are complete.
- [ ] cross-language canonical coherence checks are green.

### Gate C (test rollout)

- [ ] all prior gates pass.
- [x] harness and lanes materialized.
- [ ] conformance rollout authorized.

---

## Appendix N - Governance Lock Artifacts (Compatibility)

Detailed lock policies moved to `TES_LAYN_GOVERNANCE.md`.

### N.7 Traceability approval lock

- Traceability approval remains authoritative only when `docs/specs/usr-consolidation-coverage-matrix.md` is in approved state with complete approval-lock metadata.
- If traceability approval metadata regresses, readiness authorization must be reopened until restored.

---

## Legacy Appendix Mapping

To keep the roadmap lean, former detailed appendices are mapped to companion docs:

| Legacy appendix | New home |
| --- | --- |
| Appendix C, D (language/framework exhaustive packs) | `TES_LAYN_EXECUTION_PACKS.md` |
| Appendix F, L, M, N, O (gates/governance/evidence/locks/controls) | `TES_LAYN_GOVERNANCE.md` |
| Appendix H, J (traceability/dependency policy detail) | `TES_LAYN_GOVERNANCE.md` |
| Appendix K (minimum implementable slice) | `TES_LAYN_EXECUTION_PACKS.md` |

Use this file as the active execution index; keep deep detail in companion docs.
