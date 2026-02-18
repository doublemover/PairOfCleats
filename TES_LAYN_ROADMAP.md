# TES_LAYN_ROADMAP - Functional USR Delivery Plan

Last updated: 2026-02-17T00:00:00Z
Status: active
Supersedes: prior contract-heavy rollout plans

## 0) Purpose

This roadmap is the execution-facing USR plan.

It is intentionally implementation-first:
- one source of truth for phase order and active scope
- go/no-go gates based on functional readiness
- minimal policy overhead for language/framework delivery
- detailed per-pack execution and governance in companion docs

Companion docs:
- `TES_LAYN_EXECUTION_PACKS.md`
- `TES_LAYN_GOVERNANCE.md`

## 1) Program Objective

Deliver deterministic, production-usable USR support for all registry languages and required frameworks with:
- stable identity, normalization, and serialization
- explicit capability and graceful degradation signaling
- complete language/framework functional behavior (including edge cases)
- repeatable rollout operations that scale across 20+ languages

## 2) Authoritative Inputs

Primary specs and runtime sources:
- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr/README.md`
- `docs/specs/usr-consolidation-coverage-matrix.md`
- `docs/specs/usr-core-*.md`
- `docs/specs/metadata-schema-v2.md`
- `src/index/language-registry/registry-data.js`

Precedence:
1. `docs/specs/unified-syntax-representation.md`
2. USR core spec set (`docs/specs/usr-core-*.md`, `docs/specs/usr/README.md`)
3. this roadmap and companion docs

## 3) Coverage Surface

Registry language IDs (authoritative):
- `javascript`, `typescript`, `python`, `clike`, `go`, `java`, `csharp`, `kotlin`, `ruby`, `php`, `html`, `css`, `lua`, `sql`, `perl`, `shell`, `rust`, `swift`, `cmake`, `starlark`, `nix`, `dart`, `scala`, `groovy`, `r`, `julia`, `handlebars`, `mustache`, `jinja`, `razor`, `proto`, `makefile`, `dockerfile`, `graphql`

Required framework profiles:
- `react`, `vue`, `next`, `nuxt`, `svelte`, `sveltekit`, `angular`, `astro`

## 4) Operating Rules

- Implementation-first: deliver runtime behavior before adding governance overhead.
- Functional readiness only: do not block on document-check or contract-enforcement-only work.
- Keep WIP narrow: at most two active phases at a time.
- Keep deterministic behavior non-negotiable: IDs, ordering, serialization, diagnostics.
- Use repeatable language/framework pack templates to accelerate 20+ language rollout.
- Keep unsupported/partial states explicit and actionable in diagnostics.

## 5) Phase Plan

### Phase A - Runtime Foundation Baseline

Objective: lock adapter scaffolding, registry wiring, and deterministic core plumbing.

Deliverables:
- [x] Unified adapter scaffolding and language registry wiring are complete.
- [x] Baseline identity/normalization envelope is stable across reruns.
- [ ] Core diagnostics are explicit for unsupported and partial features.

Exit checks:
- [ ] Baseline fixture runs are deterministic for core outputs.
- [ ] No unresolved runtime blockers remain in foundation scope.

### Phase B - Identity and Normalization Core

Objective: finish identity grammar, coordinate normalization, and cross-language mapping stability.

Deliverables:
- [ ] Canonical ID grammar and collision handling are implemented in runtime.
- [ ] Endpoint/entity integrity constraints are enforced in runtime paths.
- [ ] Parser precedence and normalization mapping are deterministic and table-driven.

Exit checks:
- [ ] Determinism reruns match for ID and normalize outputs.
- [ ] Failure paths emit correct, actionable diagnostics.

### Phase C - Language Batch Execution (B1-B7)

Objective: implement and harden language adapters in repeatable batches.

Deliverables:
- [ ] B1 complete (JS/TS + framework foundations).
- [ ] B2-B7 complete with required adapters and language-specific edges.
- [ ] Import-only entries replaced by full adapters where required.

Exit checks:
- [ ] All batch packs in `TES_LAYN_EXECUTION_PACKS.md` are complete.
- [ ] Each language meets required functional capability targets.

### Phase D - Framework Overlay Completion

Objective: complete framework-specific route/template/style semantics.

Deliverables:
- [ ] Framework handlers and profile wiring are complete for all required frameworks.
- [ ] Framework edge cases are implemented and reflected in fixtures/spec docs.

Exit checks:
- [ ] Framework profile behavior is deterministic and functionally complete.

### Phase E - Semantics and Quality Hardening

Objective: complete semantic/risk behavior, canonical examples, and deterministic goldens.

Deliverables:
- [ ] Flow/query/risk semantics implemented for required profiles.
- [ ] Canonical bundles and fixture indexes are complete and deterministic.
- [ ] Drift controls for functional outputs are operational.

Exit checks:
- [ ] Semantic and risk outputs match expected runtime behavior.
- [ ] Golden outputs are deterministic on rerun.

### Phase F - Readiness and Operational Hardening

Objective: finalize caps/perf/observability guardrails for rollout readiness.

Deliverables:
- [ ] Resource caps and fallback behavior are stable under load.
- [ ] Operational observability fields are complete for rollout scope.
- [ ] Readiness evidence artifacts are current and approved.

Exit checks:
- [ ] Readiness report approved.
- [ ] Rollout authorization approved.

### Phase G - Rollout and Maintenance

Objective: execute production rollout and keep behavior stable over time.

Deliverables:
- [ ] Required language/framework scope is released.
- [ ] Regression triage and maintenance loops are active.
- [ ] Governance remains lightweight and functional-outcome driven.

Exit checks:
- [ ] Release readiness scorecard remains green for target scope.

## 6) Current Tranche (Now / Next / Later)

Now:
1. Phase B completion gaps (identity/integrity/parser precedence normalization)
2. Phase C B1 completion (JS/TS + framework foundations)

Next:
1. Phase C B2-B4 language batches
2. Phase D framework overlays

Later:
1. Phase C B5-B7 completion
2. Phases E-G rollout and steady-state operations

## 7) Gate Invariants (Short Form)

1. No rollout approval without readiness approval.
2. No phase completion with unresolved functional blockers.
3. No strict-mode promotion with unresolved blocking diagnostics.
4. No deterministic-output regressions for active rollout scope.
5. No runtime behavior changes without synchronized spec/matrix updates.

Detailed policy: `TES_LAYN_GOVERNANCE.md`.

## 8) Evidence Artifacts (Primary)

- `usr-language-support-matrix.json`
- `usr-framework-support-matrix.json`
- `usr-functional-readiness-summary.json`
- `usr-determinism-summary.json`
- `usr-release-readiness-scorecard.json`

Detailed evidence mapping: `TES_LAYN_GOVERNANCE.md`.

## 9) Linked Execution and Governance Docs

- Execution packs (batch and framework delivery details): `TES_LAYN_EXECUTION_PACKS.md`
- Governance and rollout controls: `TES_LAYN_GOVERNANCE.md`

---

## Appendix - Batch Gate Checklists (Compatibility)

### Gate A (foundation)

- [ ] foundation runtime outputs are deterministic.
- [ ] registry and adapter scaffolding are complete.

### Gate B1-B7 (language batches)

- [ ] language pack deliverables in active scope are complete.
- [ ] required baseline capabilities are met for active target scope.
- [ ] deterministic behavior is stable for active batch outputs.

### Gate B8 (cross-language integration)

- [ ] mixed-repo and cross-batch behavior is complete.
- [ ] cross-language canonical coherence is stable.

### Gate C (rollout)

- [ ] all prior gates pass.
- [ ] rollout authorization approved.

---

## Legacy Appendix Mapping

| Legacy appendix | New home |
| --- | --- |
| language/framework exhaustive packs | `TES_LAYN_EXECUTION_PACKS.md` |
| gates/governance/evidence/locks/controls | `TES_LAYN_GOVERNANCE.md` |

Use this file as the active execution index; keep detailed pack content in companion docs.
