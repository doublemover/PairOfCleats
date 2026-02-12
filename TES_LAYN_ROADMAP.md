# TES_LAYN_ROADMAP - USR-Aligned Language and Framework Execution Master Plan

Last rewritten: 2026-02-12T06:24:31Z
Branch: `usr-skyforge-primer`
Document status: active master plan baseline v1.5

## 0) Scope Reset

This roadmap supersedes the previous test-heavy draft and is now tightly aligned to `docs/specs/unified-syntax-representation.md` (USR v1.5).

Primary shifts in this rewrite:

- Implementation-first sequencing remains mandatory.
- Test rollout starts only after USR conformance prerequisites are implemented.
- Language work is split into explicit execution batches.
- Every registry language has language-specific granular tasks that include unique features, edge cases, and likely failure modes.
- Framework profiles are first-class overlays and have dedicated execution and conformance phases.
- Phase gates explicitly track USR C0-C4 conformance and USR deterministic guarantees.

## 1) Program Objective

Deliver full, deterministic, and auditable support for all registry languages and required frameworks under the USR model so that:

- parsing and normalization are contract-stable
- node/symbol/edge identities satisfy USR ID grammar and stability rules
- language and framework-specific semantics are represented without silent degradation
- conformance levels C0-C4 are measurable and enforceable
- all unsupported/partial capabilities are explicit and diagnosable

## 2) Authoritative Inputs

This roadmap is governed by these authoritative documents:

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr/README.md`
- `docs/specs/usr-consolidation-coverage-matrix.md`
- `docs/specs/usr-core-governance-change.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-pipeline-incremental-transforms.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
- `docs/specs/usr-core-security-risk-compliance.md`
- `docs/specs/usr-core-observability-performance-ops.md`
- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-diagnostics-reasoncodes.md`
- `docs/specs/metadata-schema-v2.md`
- `docs/specs/identity-contract.md`
- `docs/specs/identity-and-symbol-contracts.md`
- `docs/specs/tooling-vfs-and-segment-routing.md`
- `docs/guides/usr-contract-enforcement.md`
- `docs/guides/usr-new-language-onboarding.md`
- `docs/schemas/usr/*.json`
- `docs/contracts/public-artifact-surface.md`
- `docs/contracts/artifact-schemas.md`
- `docs/contracts/analysis-schemas.md`
- `src/index/language-registry/registry-data.js`

### 2.1 Contract precedence policy

When two documents overlap, precedence is:

1. `docs/specs/unified-syntax-representation.md` (umbrella USR contract)
2. consolidated USR contracts in `docs/specs/usr-core-*.md` plus `docs/specs/usr/README.md`
3. roadmap task decompositions and appendices

If contradictions are found:

- treat as blocker
- open explicit contract reconciliation task in Phase 0
- do not continue implementation on contradictory areas until resolved

## 3) Supported Coverage Surface

### 3.1 Registry Language IDs (authoritative)

`javascript`, `typescript`, `python`, `clike`, `go`, `java`, `csharp`, `kotlin`, `ruby`, `php`, `html`, `css`, `lua`, `sql`, `perl`, `shell`, `rust`, `swift`, `cmake`, `starlark`, `nix`, `dart`, `scala`, `groovy`, `r`, `julia`, `handlebars`, `mustache`, `jinja`, `razor`, `proto`, `makefile`, `dockerfile`, `graphql`

### 3.2 Required framework profiles

`react`, `vue`, `next`, `nuxt`, `svelte`, `sveltekit`, `angular`, `astro`

## 4) Batch Model (Mandatory Execution Partitioning)

| Batch | Name | Scope | Primary Risk Profile | Required Gate |
| --- | --- | --- | --- | --- |
| B0 | Contracts and Registries | USR schemas, matrices, drift checks | Contract drift, schema mismatch | Gate A |
| B1 | JS/TS and Framework Core | javascript, typescript + all framework overlays | High parser and framework segmentation complexity | Gate B1 |
| B2 | Systems Languages | clike, go, rust, swift | AST/flow fidelity and macro/build semantics | Gate B2 |
| B3 | Managed OO Languages | java, csharp, kotlin, scala, groovy, dart | type and modifier normalization drift | Gate B3 |
| B4 | Dynamic and Scripting | python, ruby, php, lua, perl, shell, r, julia | dynamic semantics and heuristic fallback risk | Gate B4 |
| B5 | Markup, Style, and Templates | html, css, handlebars, mustache, jinja, razor | template binding and segmentation risk | Gate B5 |
| B6 | Data and Interface DSLs | sql, proto, graphql | statement/schema coverage drift | Gate B6 |
| B7 | Build and Infra DSLs | cmake, starlark, nix, makefile, dockerfile | rule/instruction graph incompleteness | Gate B7 |
| B8 | Cross-Batch Integration | all batches together | mixed-repo and regression interaction risk | Gate C |

## 5) Global Non-Negotiable Gates

- [ ] USR section 5.4 path normalization rules are implemented and validated.
- [ ] USR section 5.5 null/empty/omission semantics are encoded in writers and validators.
- [ ] USR section 5.6 numeric normalization is enforced for persisted payloads.
- [ ] USR section 6.7 canonical ID grammar is validated in strict mode.
- [ ] USR section 7.11 entity integrity constraints are enforced.
- [ ] USR section 8.5 edge endpoint constraints are enforced.
- [ ] USR section 11.3 parser precedence matrix is implemented deterministically.
- [ ] USR section 11.4 normalization mapping is table-driven and deterministic.
- [ ] USR section 12.3 capability state machine transitions are validated.
- [ ] USR section 16.4 determinism pass criteria are part of CI gates.
- [ ] USR section 17 performance/resource requirements are enforced via blocking SLO budgets.
- [ ] USR section 18 security/safety requirements are enforced via strict security gates and redaction policy.
- [ ] USR section 33 diagnostic and resolution reason-code taxonomy is fully implemented and strict-validated.
- [ ] USR section 34 canonical JSON examples are mirrored by executable fixture bundles and validator checks.
- [ ] USR section 35 per-framework route/template/style canonicalization rules are enforced in framework profiles.
- [x] USR section 36 backward-compat matrix is implemented in CI with blocking/non-blocking behavior parity.
- [ ] USR section 38 embedded-language bridge requirements are implemented for all container/virtual-doc frameworks.
- [ ] USR section 39 generated/macro provenance requirements are implemented and validated.
- [ ] USR section 40 implementation-readiness requirements are complete before promotion gates.
- [x] USR registry-schema contract is enforced for all `tests/lang/matrix` artifacts, including parser/runtime lock.
- [x] USR section 41 observability and SLO contract is enforced across required lanes.
- [x] USR section 42 security and data governance contract is enforced with fail-closed blocking semantics.
- [x] USR section 43 runtime configuration and feature-flag contract is enforced with strict-mode validation.
- [x] USR section 44 failure injection and resilience contract is enforced with blocking strict fault scenarios.
- [x] USR section 45 fixture and golden governance contract is enforced with ownership and mutation policy controls.
- [x] USR section 46 performance benchmark methodology contract is enforced with deterministic methodology and regression gates.
- [x] USR section 47 threat model and abuse-case coverage contract is enforced with blocking threat/control fixture coverage.
- [x] USR section 48 waiver and exception governance contract is enforced with expiry and approver controls.
- [x] Decomposed USR contract suite (`docs/specs/usr*.md`) remains semantically aligned with umbrella USR spec.
- [x] Every registry language has a maintained per-language contract in `docs/specs/usr/languages/<language-id>.md`.
- [x] Machine-readable catalog/matrix files are synchronized with decomposed contracts and pass drift checks.

## 6) Phase Index (Implementation before Test Rollout)

| Phase | Name | Track | Output |
| --- | --- | --- | --- |
| 0 | Program Governance and Contract Lock | Implementation | Traceable roadmap to USR v1.2 sections |
| 1 | USR Registries and Schema Package | Implementation | machine-readable profile registries + validators |
| 2 | Identity, Coordinates, and Integrity Enforcement | Implementation | canonical IDs/ranges/integrity enforcement |
| 3 | Parser and Normalization Core | Implementation | deterministic parse and normalization engine |
| 4 | Batch Execution B1-B7 (Language Core) | Implementation | per-language support completion by batch |
| 5 | Framework Overlay Completion | Implementation | framework profile completeness |
| 6 | Flow, Risk, and Query Semantics | Implementation | C2/C3 semantic coverage |
| 7 | Fixture and Golden Corpus Expansion | Implementation | exhaustive fixture inventories and goldens |
| 8 | Determinism, Caps, and Performance Hardening | Implementation | stable and bounded outputs |
| 9 | Pre-Test Readiness and Batch Sign-Off | Implementation | go/no-go for test rollout |
| 10 | Harness and Lane Materialization | Test Infra | matrix-driven conformance harness |
| 11 | Baseline Conformance C0/C1 | Testing | language baseline enforcement |
| 12 | Deep Conformance C2/C3 | Testing | AST/flow/risk enforcement |
| 13 | Framework Conformance C4 | Testing | framework profile enforcement |
| 14 | Integration and Failure-Mode Enforcement | Testing | mixed-repo and recovery confidence |
| 15 | CI Gates, Reporting, and Maintenance Operations | Ops | sustainable enforcement and change-control |

---

## Phase 0 - Program Governance and Contract Lock

### 0.1 USR traceability

- [x] Add a traceability matrix linking USR sections 5 through 36 to roadmap tasks.
- [x] Add decomposition traceability matrix mapping each `docs/specs/usr*.md` contract to roadmap phases and CI gates.
- [x] Define owner role per USR section group (identity, schema, framework, conformance, operations).
- [x] Define ownership matrix artifact (`usr-ownership-matrix.json`) and escalation artifact (`usr-escalation-policy.json`) requirements.
- [x] Define escalation path for contract conflicts between USR and existing artifact contracts.
- [x] Define requirement that all future roadmap edits preserve exact language registry coverage.

### 0.2 Planning guardrails

- [x] Disallow advancing any batch without Gate criteria evidence.
- [x] Require deterministic rerun evidence for any phase marked complete.
- [x] Require explicit partial/unsupported capability declarations before test phase promotion.

### 0.3 Exit criteria

- [x] USR traceability matrix drafted and approved.
- [x] Batch ownership map complete.
- [x] Gate definition and evidence templates ready.

---

## Phase 1 - USR Registries and Schema Package

### 1.1 Machine-readable registries (USR section 23)

- [x] Create `tests/lang/matrix/usr-language-profiles.json`.
- [x] Create `tests/lang/matrix/usr-language-version-policy.json`.
- [x] Create `tests/lang/matrix/usr-language-embedding-policy.json`.
- [x] Create `tests/lang/matrix/usr-framework-profiles.json`.
- [x] Create `tests/lang/matrix/usr-node-kind-mapping.json`.
- [x] Create `tests/lang/matrix/usr-edge-kind-constraints.json`.
- [x] Create `tests/lang/matrix/usr-capability-matrix.json`.
- [x] Create `tests/lang/matrix/usr-conformance-levels.json`.
- [x] Create `tests/lang/matrix/usr-backcompat-matrix.json` (USR section 36.4).
- [x] Create `tests/lang/matrix/usr-framework-edge-cases.json`.
- [x] Create `tests/lang/matrix/usr-language-risk-profiles.json`.
- [x] Create `tests/lang/matrix/usr-embedding-bridge-cases.json`.
- [x] Create `tests/lang/matrix/usr-generated-provenance-cases.json`.
- [x] Create `tests/lang/matrix/usr-parser-runtime-lock.json`.
- [x] Create `tests/lang/matrix/usr-slo-budgets.json`.
- [x] Create `tests/lang/matrix/usr-alert-policies.json`.
- [x] Create `tests/lang/matrix/usr-redaction-rules.json`.
- [x] Create `tests/lang/matrix/usr-security-gates.json`.
- [x] Create `tests/lang/matrix/usr-runtime-config-policy.json`.
- [x] Create `tests/lang/matrix/usr-failure-injection-matrix.json`.
- [x] Create `tests/lang/matrix/usr-fixture-governance.json`.
- [x] Create `tests/lang/matrix/usr-benchmark-policy.json`.
- [x] Create `tests/lang/matrix/usr-threat-model-matrix.json`.
- [x] Create `tests/lang/matrix/usr-waiver-policy.json`.
- [x] Create `tests/lang/matrix/usr-quality-gates.json`.
- [x] Create `tests/lang/matrix/usr-operational-readiness-policy.json`.
- [x] Add deterministic baseline generator `tools/usr/generate-usr-matrix-baselines.mjs` and matrix inventory doc `tests/lang/matrix/README.md`.
- [x] Keep consolidated core contracts (`docs/specs/usr-core-*.md`) aligned with machine-readable registry schema keys.

### 1.2 Schema and validator package (USR section 24)

- [x] Add `src/contracts/schemas/usr.js`.
- [x] Add `src/contracts/schemas/usr-matrix.js`.
- [x] Add `src/contracts/validators/usr.js`.
- [x] Add `src/contracts/validators/usr-matrix.js`.
- [x] Export all required USR schema constants.
- [x] Add strict matrix schemas and validators for `usr-runtime-config-policy.json`, `usr-failure-injection-matrix.json`, and `usr-fixture-governance.json`.
- [x] Add runtime config resolution validator enforcing precedence and strict-mode behavior contract.
- [x] Enforce strict ID grammar validation.
- [x] Enforce strict edge endpoint constraints.
- [x] Enforce strict diagnostic code/reason-code enum validation (USR section 33).
- [x] Enforce strict canonical example fixture validation rules (USR section 34.11).

### 1.3 Drift and completeness checks

- [x] Add registry drift test: language registry IDs vs `usr-language-profiles.json` exact-set equality.
- [x] Add version/embedding policy drift test: language IDs vs `usr-language-version-policy.json` and `usr-language-embedding-policy.json` exact-set equality.
- [x] Add framework profile referential integrity test.
- [x] Add unknown-key strictness test for all USR matrix files.
- [x] Add parser/runtime lock coverage drift test vs parser sources referenced by language/framework profiles.
- [x] Add SLO/alert policy schema drift tests and scope-coverage checks.
- [x] Add redaction/security gate schema drift tests and enforcement-level coverage checks.
- [x] Add runtime config policy schema drift tests and strict-mode behavior coverage checks.
- [x] Add failure-injection matrix completeness drift tests (required fault classes and blocking scenario coverage).
- [x] Add fixture-governance drift tests (fixture ID uniqueness, owner/reviewer completeness, profile linkage).
- [x] Add benchmark policy schema drift tests (warmup/measure/percentile/variance requirements and lane coverage).
- [x] Add threat-model matrix drift tests (critical threat/control/fixture mapping completeness).
- [x] Add waiver policy drift tests (expiry, approver, compensating-control, and disallowed-bypass checks).
- [x] Add matrix generator idempotence test (`node tools/usr/generate-usr-matrix-baselines.mjs` yields zero diff on clean repo).
- [x] Add diagnostic taxonomy drift test (section 12.1 baseline vs section 33.1 full taxonomy).
- [x] Add reason-code drift test (`attrs.resolution.reasonCode` values vs section 33.2).
- [x] Add per-language spec existence test: every registry language ID has exactly one `docs/specs/usr/languages/<language-id>.md`.
- [x] Add decomposed-contract cross-reference consistency test: required contract links are present and valid.

### 1.4 Exit criteria

- [x] USR registry files exist and validate.
- [x] USR schema package exists and validates.
- [x] Drift tests pass in CI.

---

## Phase 2 - Identity, Coordinates, and Integrity Enforcement

### 2.1 Coordinate enforcement (USR section 5)

- [ ] Enforce path normalization rules.
- [ ] Enforce dual coordinate-space range preservation.
- [ ] Enforce null/empty/omission semantics consistently.
- [ ] Enforce numeric normalization for confidence fields.

### 2.2 Identity enforcement (USR section 6)

- [ ] Enforce canonical ID grammar for all USR IDs.
- [ ] Enforce deterministic collision handling for node identities.
- [ ] Preserve original external IDs in attrs when adaptation is required.

### 2.3 Integrity constraints (USR section 7.11)

- [ ] Enforce all required entity uniqueness constraints.
- [ ] Enforce range containment and parent linkage constraints.
- [ ] Enforce symbol declaration linkage constraints.
- [ ] Enforce edge source/target resolution constraints.

### 2.4 Exit criteria

- [ ] Strict validation rejects intentionally malformed identity/range payloads.
- [ ] Deterministic reruns preserve ID sets and integrity outcomes.

---

## Phase 3 - Parser and Normalization Core

### 3.1 Deterministic parser precedence (USR section 11.3)

- [ ] Implement deterministic parser source precedence matrix.
- [ ] Implement deterministic tie-break rules for same-level parser candidates.
- [ ] Record parser source and version metadata in USR entities.

### 3.2 Normalization mapping (USR section 11.4)

- [ ] Implement table-driven rawKind to normKind mapping.
- [ ] Preserve raw parser/compiler kind in `rawKind`.
- [ ] Map unknown kinds deterministically to `unknown`.
- [ ] Validate family-specific synonym mappings.
- [ ] Enforce canonical mapping registry ordering and strict mapping conflict checks from `docs/specs/usr-core-normalization-linking-identity.md`.
- [ ] Enforce generated/macro provenance mapping requirements and deterministic source-origin mapping retention.

### 3.3 Framework extraction ordering (USR section 11.5)

- [ ] Enforce step ordering from segmentation through enrichment.
- [ ] Preserve partial outputs and emit diagnostics on late-stage failures.

### 3.4 Exit criteria

- [ ] Parser precedence tests pass across representative languages.
- [ ] Normalization mapping tests pass with deterministic snapshots.
- [ ] Framework extraction ordering invariants pass for `.vue`, `.svelte`, `.astro`, Angular template surfaces.

---

## Phase 4 - Batch Execution B1-B7 (Language Core)

### 4.1 Batch sequencing requirements

- [ ] Execute B1 first to stabilize framework and segmentation baseline.
- [ ] Execute B2 through B7 in parallel where dependencies permit.
- [ ] Require per-batch Gate checklist completion before advancing.

### 4.2 Mandatory batch deliverables

- [ ] Complete language-specific task packs in Appendix C for each language in batch.
- [ ] Complete per-language fixture inventories and edge-case fixtures.
- [ ] Complete per-language C0/C1 conformance evidence.
- [ ] Complete per-language embedding/provenance policy declarations and artifact mappings.
- [ ] Record known degradations with diagnostic code mapping.

### 4.3 Exit criteria

- [ ] B1-B7 each have signed Gate evidence.
- [ ] No language is missing a completed task pack.

---

## Phase 5 - Framework Overlay Completion

### 5.1 Framework profile implementation

- [ ] Complete React profile tasks (Appendix D).
- [ ] Complete Vue profile tasks (Appendix D).
- [ ] Complete Next profile tasks (Appendix D).
- [ ] Complete Nuxt profile tasks (Appendix D).
- [ ] Complete Svelte/SvelteKit profile tasks (Appendix D).
- [ ] Complete Angular profile tasks (Appendix D).
- [ ] Complete Astro profile tasks (Appendix D).
- [ ] Implement section 35 canonical edge attrs requirements (`route_maps_to`, `template_binds`, `style_scopes`) for each framework profile.
- [ ] Implement deterministic framework detection conflict resolution policy from `docs/specs/usr-core-language-framework-catalog.md`.
- [ ] Implement section 38 embedded-language bridge requirements and required bridge evidence attrs for all multi-block framework profiles.

### 5.2 Framework applicability enforcement

- [ ] Enforce framework applicability matrix constraints from USR section 25.
- [ ] Emit `USR-W-FRAMEWORK-PROFILE-INCOMPLETE` for out-of-applicability inference attempts.

### 5.3 Exit criteria

- [ ] All framework profiles produce required entities/edges.
- [ ] Framework diagnostics are deterministic and complete.

---

## Phase 6 - Flow, Risk, and Query Semantics

### 6.1 Flow and semantic coverage

- [ ] Complete C2 requirements for languages requiring AST/control/data flow.
- [ ] Validate AST normalization and edge endpoint constraints.

### 6.2 Risk model coverage

- [ ] Complete C3 requirements for risk-local and risk-interprocedural where required.
- [ ] Implement capability state machine transitions and diagnostic semantics.
- [ ] Implement remediation-class routing for diagnostics (USR section 33.4) in reporting outputs.
- [ ] Implement machine-readable risk signal taxonomy and risk gating outputs aligned with `docs/specs/usr-core-security-risk-compliance.md`.

### 6.3 Query/filter semantics

- [ ] Align query/filter behavior with framework and language profile semantics.
- [ ] Validate deterministic ranking and tie-break behavior.

### 6.4 Embedded/provenance semantics

- [ ] Implement embedded bridge evidence attrs and deterministic bridge confidence behavior.
- [ ] Implement generated/macro provenance attrs and mapping quality downgrade semantics.
- [ ] Validate provenance diagnostics for exact/approximate/missing mapping classes.

### 6.5 Security/data governance semantics

- [ ] Implement deterministic redaction rules for diagnostics and attrs payloads.
- [ ] Implement strict security gate enforcement for path safety and runtime identity.
- [ ] Validate security audit artifact generation and gate blocking behavior.
- [ ] Implement threat-model matrix mapping for critical threat classes, attack surfaces, controls, and abuse-case fixtures.
- [ ] Validate threat/control coverage and control-gap report generation.

### 6.6 Exit criteria

- [ ] C2/C3 requirements pass for required profiles.
- [ ] Capability transition diagnostics are correct and complete.
- [ ] Embedded/provenance semantics are validated for required language/framework profiles.
- [ ] Security and redaction semantics are validated for required profiles and lanes.
- [ ] Critical threat-model coverage and abuse-case mappings are validated for required lanes.

---

## Phase 7 - Fixture and Golden Corpus Expansion

### 7.1 Fixture completeness

- [ ] Expand fixture inventories per language to include positive, negative, malformed, cap-triggering, and mixed cases.
- [ ] Expand framework fixtures for all profile-specific edge cases.
- [ ] Materialize canonical example bundles matching USR section 34 minimal/maximal entities with cross-entity coherence checks.
- [x] Materialize framework edge-case fixtures per USR section 35.11 checklist.
- [x] Materialize embedded-language bridge fixtures per USR section 38 matrix requirements.
- [x] Materialize generated/macro provenance fixtures per USR section 39 matrix requirements.
- [x] Ensure every per-language contract has concrete fixture ID mappings and fixture family coverage.
- [x] Add fixture-governance policy rows for every blocking fixture family and framework overlay fixture.
- [ ] Add fixture ownership/reviewer assignment checks for all blocking fixtures.
- [ ] Add fixture mutation-policy tags (`require-rfc|require-review|allow-generated-refresh`) and validate policy coverage.
- [x] Enforce fixture-governance coverage floor for every language/framework profile across required conformance levels and semantic families.

### 7.2 Golden generation and review

- [ ] Regenerate deterministic goldens for USR entities and mapped artifacts.
- [x] Add fixture-to-roadmap linkage tags for every language and framework task pack.

### 7.3 Exit criteria

- [ ] Every language and framework has exhaustive fixture coverage evidence.
- [ ] Golden diffs are deterministic on rerun.

---

## Phase 8 - Determinism, Caps, and Performance Hardening

### 8.1 Deterministic outputs

- [ ] Enforce deterministic ordering rules for all USR entities.
- [ ] Enforce deterministic serialization for persisted USR artifacts.

### 8.2 Caps and truncation behavior

- [ ] Enforce parser/node/edge/path caps per policy.
- [ ] Emit truncation diagnostics and maintain schema validity under caps.
- [ ] Enforce diagnostics taxonomy severity/code alignment under cap-triggered degradation.

### 8.3 Performance thresholds

- [ ] Define per-batch runtime/memory thresholds.
- [ ] Add per-batch profiling and hotspot reporting.
- [ ] Validate parser/runtime lock reproducibility and update budget for lock-file upgrades.
- [x] Materialize SLO budget and alert policy evaluations in CI outputs.
- [ ] Enforce benchmark policy methodology (warmup/measure runs, percentile targets, variance budgets) for blocking lanes.
- [ ] Materialize benchmark regression artifacts and promotion-gate evaluation.

### 8.4 Exit criteria

- [ ] Determinism checks pass under repeated runs.
- [ ] Cap-trigger tests pass with expected diagnostics.
- [ ] Runtime thresholds meet target envelopes.
- [ ] Blocking SLO budgets are met for required lanes.

---

## Phase 9 - Pre-Test Readiness and Batch Sign-Off

### 9.1 Readiness audit

- [ ] Validate completion evidence for all B1-B7 task packs.
- [ ] Validate framework profile completion evidence.
- [x] Materialize framework extension contract template governance and CI enforcement controls.
- [x] Enforce framework profile matrix sync invariants for applicability, edge-case linkage, and route/hydration/binding semantics.
- [ ] Validate conformance matrix readiness by language.
- [x] Enforce language-contract vs language-profile matrix exact-set synchronization for conformance/framework/node/edge declarations.
- [x] Validate section 36 compatibility matrix readiness and blocking policy evidence.
- [x] Materialize per-language approval checklist and completion evidence scaffolding in `docs/specs/usr/languages/*.md`.
- [ ] Validate per-language contract approval checklists are complete for target rollout set.
- [ ] Validate implementation-readiness contract evidence set is complete for promotion target phase.
- [x] Validate runtime config policy evidence and feature-flag state outputs are complete.
- [x] Validate blocking failure-injection evidence and recovery artifacts are complete.
- [x] Validate fixture-governance validation evidence for blocking fixture families is complete.
- [x] Validate benchmark policy evidence and regression/variance reports are complete for blocking lanes.
- [x] Validate threat-model coverage and abuse-case execution evidence are complete.
- [x] Validate waiver-policy evidence (active/expiry/breach reports) and approver controls are complete.
- [x] Enforce phase-9 readiness evidence gate coverage across CI validators and required report artifacts.

### 9.2 Go/No-Go decision

- [x] Block test rollout if any language lacks C0/C1 readiness.
- [x] Block deep conformance if C2/C3 prerequisites are missing.
- [x] Block framework conformance if C4 profile prerequisites are missing.

### 9.3 Exit criteria

- [ ] Readiness report approved.
- [ ] Test rollout authorized.

---

## Phase 10 - Harness and Lane Materialization

### 10.1 Harness capabilities

- [x] Materialize USR entity validators in harness.
- [x] Materialize ID grammar checks in harness.
- [x] Materialize edge endpoint constraint checks in harness.
- [x] Materialize capability state machine checks in harness.
- [x] Materialize diagnostic code/reason-code strict validators and remediation-class routing checks.
- [x] Materialize canonical example bundle validator lane for section 34 references.
- [x] Materialize decomposed contract drift checks (language/profile/mapping/resolution/risk/conformance/rollout/embedding/provenance/registry/readiness/observability/security contracts).
- [x] Materialize section 38 embedded-language bridge validators.
- [x] Materialize section 39 generated/macro provenance validators.
- [x] Materialize section 40 implementation-readiness evidence validators and promotion blockers.
- [x] Materialize section 43 runtime config/feature-flag validators and precedence checks.
- [x] Materialize section 44 failure-injection scenario evaluator and strict/non-strict outcome validators.
- [x] Materialize section 45 fixture-governance validators (owner/reviewer/mutation-policy).
- [x] Materialize section 46 benchmark methodology validators and regression threshold checks.
- [x] Materialize section 47 threat-model coverage and abuse-case mapping validators.
- [x] Materialize section 48 waiver-policy validators (expiry/approver/compensating-control constraints).
- [x] Materialize section 30 report envelope validators for all required audit outputs.

### 10.2 Lane wiring

- [x] Add conformance lane(s) per C0-C4.
- [x] Add per-batch shards and deterministic order manifests.
- [x] Add diagnostics summary and transition reporting.
- [x] Add backward-compat matrix lane executing BC-001 through BC-012 scenario classes and pairwise expansion.
- [x] Add runtime-config validation lane and feature-flag conflict lane.
- [x] Add failure-injection strict blocking lane in CI and full scenario lane in CI-long/nightly.
- [x] Add fixture-governance validation lane and mutation-policy enforcement lane.
- [x] Add benchmark regression lane for blocking benchmark policy rows.
- [x] Add threat-model and abuse-case lane with critical threat coverage checks.
- [x] Add waiver-enforcement lane validating expiry and disallowed bypass conditions.
- [x] Add report-schema lane validating section 30/31/43/44/45/46/47/48 required report artifacts.

### 10.3 Exit criteria

- [x] Harness can execute matrix-driven checks for all languages/frameworks.
- [x] Lane ordering and sharding are deterministic.

---

## Phase 11 - Baseline Conformance C0/C1

### 11.1 C0 baseline

- [x] Execute C0 checks for all language profiles.

### 11.2 C1 baseline

- [x] Execute C1 checks for all language profiles.

### 11.3 Exit criteria

- [x] All languages pass required C0/C1 checks.

---

## Phase 12 - Deep Conformance C2/C3

### 12.1 C2 deep semantics

- [x] Execute C2 checks for languages requiring AST/flow.

### 12.2 C3 risk semantics

- [x] Execute C3 checks for languages requiring risk coverage.

### 12.3 Exit criteria

- [x] Required C2/C3 profile checks pass.

---

## Phase 13 - Framework Conformance C4

### 13.1 C4 execution

- [x] Execute C4 checks for React, Vue, Next, Nuxt, Svelte/SvelteKit, Angular, Astro.
- [x] Execute section 35 canonicalization checks for route/template/style edges and edge-case fixtures across all framework profiles.

### 13.2 Exit criteria

- [x] All required framework profiles pass C4 checks.

---

## Phase 14 - Integration and Failure-Mode Enforcement

### 14.1 Mixed-repo integration

- [ ] Validate cross-language and cross-framework relation coherence.
- [ ] Validate route/template/API/data boundary flows.

### 14.2 Failure-mode validation

- [ ] Validate parser failure recovery paths.
- [ ] Validate schema mismatch behavior.
- [ ] Validate partial extraction behavior with diagnostics.
- [ ] Validate redaction fail-safe behavior under forced sensitive payload fixtures.
- [ ] Validate strict security gate fail-closed behavior under unsafe-path and runtime-identity failures.
- [ ] Validate blocking failure-injection scenarios for parser, mapping, serialization, security, and resource-budget fault classes.
- [ ] Validate rollback trigger thresholds and recovery evidence for each blocking failure-injection class.
- [ ] Validate threat-model abuse-case fixtures for critical threat classes and control mappings.
- [ ] Validate waiver misuse prevention (expired waivers, missing approvers, disallowed strict-security bypass attempts).

### 14.3 Exit criteria

- [ ] Integration and failure-mode suites pass.

---

## Phase 15 - CI Gates, Reporting, and Maintenance Operations

### 15.1 CI gates

- [x] Enforce Gate A, B1-B8, and C gates in CI.
- [x] Enforce C0-C4 conformance lane required checks.
- [x] Enforce section 36 strict scenario blocking behavior and non-strict warning budgets.
- [x] Enforce section 41 SLO budget blocking policies and alert escalation behavior.
- [x] Enforce section 42 security gate fail-closed blocking policies.
- [x] Enforce section 43 runtime configuration strict-validation and disallowed-flag conflict policies.
- [x] Enforce section 44 failure-injection blocking scenario pass requirements.
- [x] Enforce section 45 fixture-governance blocking mutation policies and ownership checks.
- [x] Enforce section 46 benchmark methodology and regression threshold policies.
- [x] Enforce section 47 threat-model critical-coverage and abuse-case execution policies.
- [x] Enforce section 48 waiver expiry and approver-governance policies.

### 15.2 Reporting

- [x] Emit language-level conformance dashboards.
- [x] Emit framework-level conformance dashboards.
- [x] Emit capability transition and degradation reports.
- [x] Emit compatibility matrix rollups including required section 36.8 dimensions.
- [x] Emit embedded-language bridge coverage and failure dashboards.
- [x] Emit generated/macro provenance coverage and confidence-downgrade dashboards.
- [x] Emit implementation-readiness evidence scorecards and promotion blocker summaries.
- [x] Emit SLO budget compliance and alert evaluation dashboards.
- [x] Emit redaction/security gate compliance dashboards.
- [x] Validate section 30 report envelopes and row schemas per `docs/specs/usr-core-observability-performance-ops.md`.
- [x] Emit automated section 31 scorecard artifact (`usr-release-readiness-scorecard.json`).
- [x] Emit runtime configuration and feature-flag state dashboards.
- [x] Emit failure-injection scenario pass/fail and recovery dashboards.
- [x] Emit fixture-governance coverage and mutation-policy compliance dashboards.
- [x] Emit benchmark regression and variance dashboards with lane/profile dimensions.
- [x] Emit threat-model coverage, abuse-case results, and control-gap dashboards.
- [x] Emit waiver active/expiry/breach dashboards and scorecard linkage.

### 15.3 Maintenance

- [x] Enforce USR spec change-control policy linkage in PR templates.
- [x] Enforce registry drift checks for language/framework profile files.
- [x] Enforce decomposed contract suite update workflow (`docs/specs/usr/README.md`) in doc-change PR templates.
- [x] Enforce per-language contract freshness checks and ownership rotation policy.
- [x] Enforce parser/runtime lock update workflow with impact and fallback evidence in PR templates.
- [x] Enforce runtime config key and feature-flag policy update workflow in PR templates.
- [x] Enforce failure-injection matrix update workflow when new blocking failure classes are introduced.
- [x] Enforce fixture-governance owner/reviewer coverage checks for new blocking fixtures.
- [x] Enforce benchmark policy update workflow when SLO or lane thresholds change.
- [x] Enforce threat-model matrix update workflow when new security gates or attack surfaces are added.
- [x] Enforce waiver-policy update workflow and expiry review cadence in PR/release templates.

### 15.4 Exit criteria

- [x] CI and maintenance controls are stable for ongoing development.

---

## Appendix A - USR Spec to Roadmap Traceability

| USR Section | Requirement | Roadmap Phase |
| --- | --- | --- |
| 5.4 | path normalization | 2 |
| 5.5 | null/empty/omission semantics | 2 |
| 5.6 | numeric normalization | 2 |
| 6.7 | ID grammar | 2, 10 |
| 7.11 | entity integrity constraints | 2, 10 |
| 8.5 | edge endpoint constraints | 2, 10 |
| 11.3 | parser precedence matrix | 3 |
| 11.4 | normalization mapping | 3 |
| 11.5 | framework extraction ordering | 3, 5 |
| 12.3 | capability state machine | 6, 10 |
| 12.4 | diagnostic severity mapping | 6, 10 |
| 16.3 | level pass criteria | 11, 12, 13 |
| 16.4 | determinism pass criteria | 8, 11, 12, 13 |
| 17 | performance and resource requirements | 8, 15 |
| 18 | security and safety requirements | 6, 14, 15 |
| 23 | machine-readable registries | 1 |
| 24 | schema package and validators | 1 |
| 25 | framework applicability matrix | 5 |
| 26 | rollout and migration gates | 9, 15 |
| 27 | deprecation policy | 15 |
| 28 | change-control policy | 15 |
| 29 | extension policy | 15 |
| 33 | diagnostic and reason-code taxonomy | 1, 6, 10, 15 |
| 34 | canonical JSON examples | 7, 10 |
| 35 | per-framework edge canonicalization examples | 5, 7, 13 |
| 36 | backward-compatibility matrix | 1, 9, 10, 15 |
| 37 | decomposed contract governance | 0, 1, 15 |
| 38 | embedded-language bridge contract | 1, 3, 5, 6, 7, 10, 13, 14 |
| 39 | generated/macro provenance contract | 1, 3, 4, 6, 7, 10, 12, 14 |
| 40 | implementation readiness contract | 0, 1, 9, 10, 15 |
| 41 | observability and SLO contract | 8, 15 |
| 42 | security and data governance contract | 6, 14, 15 |
| 43 | runtime configuration and feature-flag contract | 0, 1, 9, 15 |
| 44 | failure injection and resilience contract | 8, 14, 15 |
| 45 | fixture and golden governance contract | 7, 10, 11, 12, 13, 15 |
| 46 | performance benchmark methodology contract | 8, 9, 15 |
| 47 | threat model and abuse-case coverage contract | 6, 14, 15 |
| 48 | waiver and exception governance contract | 9, 15 |

---

## Appendix B - Batch Gate Checklists

### Gate A (B0 contracts/registries)

- [ ] USR registry JSON files created and schema-validated.
- [ ] USR schema/validator package implemented.
- [ ] USR matrix schema/validator package implemented and enforced.
- [ ] registry drift checks pass.
- [ ] diagnostic/reason-code taxonomy validators implemented and passing.
- [x] compatibility matrix registry (`usr-backcompat-matrix.json`) exists and validates.
- [ ] framework edge-case and language risk matrix registries exist and validate.
- [ ] embedded-language bridge and generated provenance matrix registries exist and validate.
- [ ] language version and embedding policy matrices exist, validate, and stay key-synchronized with language profiles.
- [ ] parser/runtime lock registry exists, validates, and covers parser sources referenced by language/framework profiles.
- [ ] SLO budget/alert policy matrices exist, validate, and cover required lanes/scopes.
- [ ] redaction/security gate matrices exist, validate, and cover required control classes.
- [ ] runtime config policy matrix exists, validates, and defines strict-mode behavior for required keys.
- [ ] failure-injection matrix exists, validates, and covers required blocking fault classes.
- [ ] fixture-governance matrix exists, validates, and links blocking fixtures to owners/reviewers.
- [ ] benchmark policy matrix exists, validates, and covers blocking lane benchmark classes.
- [ ] threat-model matrix exists, validates, and maps critical threats to controls and fixtures.
- [ ] waiver policy matrix exists, validates, and enforces time-bounded approver-governed waivers.
- [ ] per-language contract existence and naming checks pass.

### Gate B1-B7 (language batch gates)

- [ ] all language task packs in batch completed.
- [ ] C0/C1 checks pass for batch languages.
- [ ] determinism checks pass for batch languages.
- [ ] known degradations recorded with diagnostic codes.
- [ ] diagnostic severity/code alignment checks pass for language batch fixtures.

### Gate B8 (cross-batch integration)

- [ ] mixed-repo integration checks pass.
- [ ] cross-batch regressions resolved.
- [ ] cross-language canonical example bundle coherence checks pass.

### Gate C (test rollout)

- [ ] all prior gates pass.
- [ ] harness and lanes materialized.
- [ ] conformance rollout authorized.
- [x] backward-compat matrix strict scenarios are green in CI.
- [ ] decomposed contract drift checks are green in CI.
- [ ] implementation-readiness evidence validators are green for promotion target phase.
- [ ] blocking SLO budgets are green for required lanes.
- [ ] strict security gates are green in CI.
- [ ] strict blocking failure-injection scenarios are green in CI.
- [ ] fixture-governance validation is green for blocking fixture families.
- [ ] benchmark regression policy is green for blocking benchmark rows.
- [ ] threat-model critical coverage and abuse-case lanes are green.
- [ ] waiver expiry/breach enforcement checks are green.

---

## Appendix C - Exhaustive Per-Language Task Packs by Batch

### Batch B1 - JS/TS and Framework Core

#### javascript

- [ ] Implement full JS syntax handling for ESM, CJS, dynamic import, top-level await, decorators (when parser supports), and JSX mode transitions.
- [ ] Normalize JS-specific symbol semantics for function declarations, function expressions, class fields, private fields, computed properties, and export forms.
- [ ] Implement relation handling for `import`, `require`, re-exports, dynamic import placeholders, and unresolved specifier diagnostics.
- [ ] Implement control/data flow for closures, async/await chains, generator/yield paths, optional chaining/nullish paths, and try/catch/finally.
- [ ] Implement risk coverage for `eval`, `Function`, dynamic import execution paths, DOM sink usage, and command/process APIs where applicable.
- [ ] Add fixtures for mixed ESM/CJS repos, transpiled output adjacency, ambiguous extension resolution, circular imports, and minified-but-parseable files.
- [ ] Add negative fixtures for parser fallback, malformed module syntax, unresolved path aliases, and unsupported proposal syntax.
- [ ] Require conformance levels C0, C1, C2, C3, and C4 (through framework overlays).

#### typescript

- [ ] Implement TS syntax handling for interfaces, type aliases, generics, conditional/mapped types, enums, namespaces, overloads, and decorators where enabled.
- [ ] Normalize type-level constructs into USR symbol and `uses_type` edge surfaces without collapsing value-space symbols.
- [ ] Implement relation handling for `import type`, type-only re-exports, declaration merging cases, project reference boundaries, and tsconfig path alias expansion.
- [ ] Implement flow handling for async/await, control branches, discriminated unions where inferable, and overload call-site linkage.
- [ ] Implement risk coverage for JS runtime sinks in TS code, unsafe `any` propagation markers, and dynamic execution APIs.
- [ ] Add fixtures for `.ts`, `.tsx`, `.mts`, `.cts`, declaration files, declaration merging, and mixed JS/TS projects.
- [ ] Add edge-case fixtures for isolatedModules behavior, unresolved type-only imports, path mapping collisions, and compiler API fallback to parser fallback.
- [ ] Require conformance levels C0, C1, C2, C3, and C4 (through framework overlays).

### Batch B2 - Systems Languages

#### clike

- [ ] Implement C/C++/ObjC preprocessing-aware extraction for includes, macros, conditional compilation regions, and header/source symbol pairing.
- [ ] Normalize symbol semantics for structs/classes/templates/functions/operators while preserving raw-kind distinctions.
- [ ] Implement relation handling for local/system includes, include guards, and unresolved include path diagnostics.
- [ ] Implement flow extraction for pointer-heavy control paths, early returns, and exception-style flows where language dialect supports.
- [ ] Implement risk coverage for unsafe memory and process execution primitives (`strcpy`, `system`, unsafe buffer patterns).
- [ ] Add fixtures for macro-generated declarations, template specializations, overloaded operators, and mixed C/C++ translation units.
- [ ] Add failure fixtures for missing include roots, macro expansion ambiguity, and parser degradation under complex preprocessor paths.
- [ ] Require conformance levels C0, C1, C2, C3.

#### go

- [ ] Implement package/module semantics for `go.mod`, package clauses, import aliases, and vendor boundaries.
- [ ] Normalize symbol semantics for methods with receivers, interfaces, embedded fields, and generic type parameters.
- [ ] Implement relation handling for module-local and external imports, dot imports, and blank imports.
- [ ] Implement flow extraction for goroutines, channels/select, defer/panic/recover, and error-return branching.
- [ ] Implement risk coverage for `os/exec`, unsafe package usage, and network/file sink patterns.
- [ ] Add fixtures for multi-package modules, internal package visibility patterns, build tags, and cgo-adjacent files.
- [ ] Add failure fixtures for unresolved module replace directives and partial parse fallback behavior.
- [ ] Require conformance levels C0, C1, C2, C3.

#### rust

- [ ] Implement crate/module semantics for `mod`, `use`, extern crates, and workspace boundaries.
- [ ] Normalize symbols for traits, impl blocks, generics, lifetimes, associated types, and macro-generated declarations where representable.
- [ ] Implement relation handling for use trees, glob imports, alias imports, and unresolved path segments.
- [ ] Implement flow extraction for match branching, async futures, iterator chains where inferable, and error propagation (`?`).
- [ ] Implement risk coverage for `unsafe` blocks, FFI boundaries, process execution, and deserialization sink patterns.
- [ ] Add fixtures for trait implementations across modules, macro-heavy files, workspace crates, and feature-flagged code.
- [ ] Add degradation fixtures for macro expansion limitations and parser fallback scenarios.
- [ ] Require conformance levels C0, C1, C2, C3.

#### swift

- [ ] Implement module and import semantics for framework imports, extensions, and protocol-oriented constructs.
- [ ] Normalize symbols for structs/classes/enums/protocols/extensions/property wrappers and generic constraints.
- [ ] Implement relation handling for import graphs and type/protocol conformance edges.
- [ ] Implement flow extraction for optional chaining, guard/defer patterns, async/await/task constructs, and throwing functions.
- [ ] Implement risk coverage for process/network/file sinks where available in standard or common runtime APIs.
- [ ] Add fixtures for protocol extensions, actor/concurrency patterns, and mixed UIKit/SwiftUI style files.
- [ ] Add degradation fixtures for parser tooling unavailability and partial extraction paths.
- [ ] Require conformance levels C0, C1, C2, C3.

### Batch B3 - Managed OO Languages

#### java

- [ ] Implement package/import semantics including static imports and nested class imports.
- [ ] Normalize symbols for classes/interfaces/enums/records/sealed hierarchies, methods, constructors, annotations, and generics.
- [ ] Implement relation handling for inheritance, interface implementation, method override chains, and type usage edges.
- [ ] Implement flow extraction for try-with-resources, switch expression forms, lambda/method reference call paths.
- [ ] Implement risk coverage for process execution, reflection-based dynamic loading, deserialization, and SQL/API sink patterns.
- [ ] Add fixtures for multi-module projects, overloaded methods, Lombok-like generated patterns, and annotation-heavy code.
- [ ] Add degradation fixtures for incomplete classpath and parser/tooling fallback.
- [ ] Require conformance levels C0, C1, C2, C3.

#### csharp

- [ ] Implement namespace/import semantics including alias `using`, global using, and file-scoped namespace forms.
- [ ] Normalize symbols for classes/records/interfaces/structs/enums, partial classes, properties, events, attributes, and generics.
- [ ] Implement relation handling for inheritance, interface implementation, extension methods, and delegate/event usage.
- [ ] Implement flow extraction for async/await tasks, LINQ chains where inferable, and exception/filter control paths.
- [ ] Implement risk coverage for process execution, reflection, serialization, and dynamic invocation sinks.
- [ ] Add fixtures for partial classes across files, source-generated style artifacts, and top-level statements.
- [ ] Add degradation fixtures for missing project context and parser fallback.
- [ ] Require conformance levels C0, C1, C2, C3.

#### kotlin

- [ ] Implement package/import semantics including alias imports and file-level declarations.
- [ ] Normalize symbols for data/sealed classes, objects/companions, extension functions, and nullability-aware signatures.
- [ ] Implement relation handling for inheritance/interface conformance, extension receiver usage, and type usage edges.
- [ ] Implement flow extraction for coroutines/suspend flows, when-expressions, and safe-call/elvis branches.
- [ ] Implement risk coverage for process/network/file sinks and reflective dynamic loading patterns where detectable.
- [ ] Add fixtures for multi-file extension-heavy projects, delegated properties, and annotation processing adjacency.
- [ ] Add degradation fixtures for parser/tooling fallback under large-file caps.
- [ ] Require conformance levels C0, C1, C2, C3.

#### scala

- [ ] Implement package/import semantics for objects/packages, wildcard imports, and renamed imports.
- [ ] Normalize symbols for classes/case classes/traits/objects, implicits/givens, and type parameterization.
- [ ] Implement relation handling for inheritance/mixins and implicit/given resolution traces where representable.
- [ ] Implement flow extraction for match/case control, for-comprehension expansion where inferable, and functional call chains.
- [ ] Implement risk coverage for process execution and serialization/deserialization sinks.
- [ ] Add fixtures for mixed Scala 2/3 style syntax, companion object patterns, and macro-like constructs.
- [ ] Add degradation fixtures for parser ambiguities and fallback paths.
- [ ] Require conformance levels C0, C1, C2, C3.

#### groovy

- [ ] Implement package/import semantics including static imports and script-mode defaults.
- [ ] Normalize symbols for classes/traits/interfaces/scripts/closures and dynamic method/property patterns.
- [ ] Implement relation handling for imports, dynamic invocation hints, and DSL-style symbol usage.
- [ ] Implement flow extraction for closure-heavy control paths and exception branches.
- [ ] Implement risk coverage for `evaluate`, dynamic class loading, process execution, and SQL APIs.
- [ ] Add fixtures for Gradle-like DSL files, script/class hybrids, and metaprogramming idioms.
- [ ] Add degradation fixtures for dynamic resolution ambiguity and parser fallback.
- [ ] Require conformance levels C0, C1, C2, C3.

#### dart

- [ ] Implement library/import semantics including `part` and `part of` boundaries.
- [ ] Normalize symbols for classes/mixins/extensions, null-safety types, and async stream/future constructs.
- [ ] Implement relation handling for package imports, relative imports, and export combinators.
- [ ] Implement flow extraction for async/await, stream transformations where inferable, and control branches.
- [ ] Implement risk coverage for process/network/file sink APIs.
- [ ] Add fixtures for Flutter-style widget classes, mixin usage, and multi-library package layouts.
- [ ] Add degradation fixtures for partial analysis under missing package context.
- [ ] Require conformance levels C0, C1, C2, C3.

### Batch B4 - Dynamic and Scripting Languages

#### python

- [ ] Implement module/package semantics for absolute and relative imports, namespace packages, and `__all__` export filtering.
- [ ] Normalize symbols for functions/classes/methods, decorators, dataclasses, async defs, and pattern matching constructs.
- [ ] Implement relation handling for import variants, deferred imports, and module alias usage.
- [ ] Implement flow extraction for async/await, generator/yield, exception paths, and context manager control transitions.
- [ ] Implement risk coverage for `eval`, `exec`, subprocess/process APIs, unsafe deserialization, and SQL sinks.
- [ ] Add fixtures for packaging layouts, type-hint-heavy modules, metaclass usage, and dynamic attribute patterns.
- [ ] Add degradation fixtures for syntax-version mismatches and partial AST fallback.
- [ ] Require conformance levels C0, C1, C2, C3.

#### ruby

- [ ] Implement file/module semantics for `require`, `require_relative`, autoload-like patterns, and monkey patch boundaries.
- [ ] Normalize symbols for modules/classes/methods, singleton methods, mixins, and block/proc/lambda declarations.
- [ ] Implement relation handling for require edges and constant resolution hints.
- [ ] Implement flow extraction for block-heavy control, rescue/ensure paths, and dynamic dispatch hints.
- [ ] Implement risk coverage for `eval`, command execution, unsafe YAML/Marshal deserialization, and SQL sinks.
- [ ] Add fixtures for Rails-like conventions, module mixins, and metaprogramming (`define_method`, `class_eval`).
- [ ] Add degradation fixtures for highly dynamic constructs and fallback behavior.
- [ ] Require conformance levels C0, C1, C2, C3.

#### php

- [ ] Implement namespace/import semantics for `use`, aliasing, traits, and mixed PHP/HTML contexts.
- [ ] Normalize symbols for classes/interfaces/traits/functions/methods and magic methods.
- [ ] Implement relation handling for autoload style references, include/require edges, and namespace resolution.
- [ ] Implement flow extraction for exception paths, async-like library patterns where inferable, and branch control.
- [ ] Implement risk coverage for `eval`, command execution, deserialization sinks, and SQL injection surfaces.
- [ ] Add fixtures for Composer-style layout, trait-heavy code, and templated PHP files.
- [ ] Add degradation fixtures for mixed template parsing and partial extraction fallback.
- [ ] Require conformance levels C0, C1, C2, C3.

#### lua

- [ ] Implement module semantics for `require`, local module tables, and global environment interactions.
- [ ] Normalize symbols for local/global functions, table methods, metamethod-related declarations.
- [ ] Implement relation handling for require edges and unresolved module diagnostics.
- [ ] Implement flow extraction for coroutine usage, table mutation paths, and branch/loop control.
- [ ] Implement risk coverage for dynamic loading and command/process execution patterns.
- [ ] Add fixtures for metatable-driven APIs, colon method syntax, and multi-file module setups.
- [ ] Add degradation fixtures for dynamic global lookups and heuristic fallback.
- [ ] Require conformance levels C0, C1, C2, C3.

#### perl

- [ ] Implement package/use semantics and module import forms.
- [ ] Normalize symbols for subs/packages and lexical/global variable contexts.
- [ ] Implement relation handling for `use`, `require`, and dynamic module loading hints.
- [ ] Implement flow extraction for regex-heavy control, eval blocks, and exception-like patterns.
- [ ] Implement risk coverage for eval/system/backticks and unsafe deserialization/file patterns.
- [ ] Add fixtures for package-heavy code, regex-centric scripts, and legacy syntax variants.
- [ ] Add degradation fixtures for ambiguous parse outcomes and fallback extraction.
- [ ] Require conformance levels C0, C1, C2, C3.

#### shell

- [ ] Implement script semantics for shebang variants, function declarations, and sourced file boundaries.
- [ ] Normalize symbols for shell functions, environment assignments, and command aliases where representable.
- [ ] Implement relation handling for `source` and `.` includes, script call edges, and unresolved include diagnostics.
- [ ] Implement flow extraction for pipeline/subshell branching, conditional expressions, and trap/error paths.
- [ ] Implement risk coverage for command injection surfaces, unsafe expansion patterns, and file/process sinks.
- [ ] Add fixtures for bash/zsh/ksh style differences, here-doc usage, and pipeline-heavy scripts.
- [ ] Add degradation fixtures for non-portable syntax and partial parser support.
- [ ] Require conformance levels C0, C1, C2, C3.

#### r

- [ ] Implement package/load semantics (`library`, `require`, `source`) and script-level scope handling.
- [ ] Normalize symbols for functions, S3/S4-style declarations where inferable, and assignment patterns.
- [ ] Implement relation handling for package imports and sourced script edges.
- [ ] Implement flow extraction for vectorized control forms and function call chains where inferable.
- [ ] Implement risk coverage for system/process calls, unsafe evaluation, and file/network sinks.
- [ ] Add fixtures for package scripts, formula-heavy code, and non-standard evaluation idioms.
- [ ] Add degradation fixtures for NSE ambiguity and parser fallback.
- [ ] Require conformance levels C0, C1, C2, C3 (risk may be partial where unsupported).

#### julia

- [ ] Implement module/import semantics (`using`, `import`, relative modules) and multiple dispatch surfaces.
- [ ] Normalize symbols for functions, macros, types/structs, and module-scoped declarations.
- [ ] Implement relation handling for module imports and exported symbol references.
- [ ] Implement flow extraction for control and exception paths where representable.
- [ ] Implement risk coverage for process execution, dynamic evaluation, and file/network sinks.
- [ ] Add fixtures for package/module layout, macro usage, and multiple-dispatch overload sets.
- [ ] Add degradation fixtures for macro expansion limitations and fallback paths.
- [ ] Require conformance levels C0, C1, C2, C3 (risk may be partial where unsupported).

### Batch B5 - Markup, Style, and Templates

#### html

- [ ] Implement markup node normalization for nested DOM structures, attributes, and inline script/style boundaries.
- [ ] Implement relation extraction for linked assets, module scripts, and embedded segment references.
- [ ] Implement template binding surfaces when HTML is used in framework contexts.
- [ ] Implement diagnostics for malformed DOM and partial parse recovery.
- [ ] Add fixtures for custom elements, slots, inline event handlers, and malformed tags.
- [ ] Add degradation fixtures for deeply nested malformed markup and segmented fallback.
- [ ] Require conformance levels C0, C1, C4 when framework overlays apply.

#### css

- [ ] Implement style node normalization for selectors, at-rules, declarations, and nested constructs where supported.
- [ ] Implement relation extraction for `@import` and linked style dependencies.
- [ ] Implement style scope modeling for framework-bound styles (scoped/module/global).
- [ ] Implement diagnostics for malformed CSS and partial parse recovery.
- [ ] Add fixtures for media queries, keyframes, custom properties, and CSS module naming patterns.
- [ ] Add degradation fixtures for vendor-specific syntax and parser fallback.
- [ ] Require conformance levels C0, C1, and C4 where framework overlays apply.

#### handlebars

- [ ] Implement template symbol/binding extraction for partials, helpers, blocks, and context paths.
- [ ] Implement relation extraction for partial/include references.
- [ ] Implement diagnostics for malformed block structure and unresolved helpers.
- [ ] Add fixtures for nested helpers, partial recursion, and escaped/unescaped output forms.
- [ ] Add degradation fixtures for malformed delimiters and fallback behavior.
- [ ] Require conformance levels C0, C1, C4 where template semantics are used.

#### mustache

- [ ] Implement section/inverted-section/partial extraction and variable binding edges.
- [ ] Implement relation extraction for partial references.
- [ ] Implement diagnostics for malformed sections and unresolved partials.
- [ ] Add fixtures for nested sections, lambdas where representable, and escaping variants.
- [ ] Add degradation fixtures for malformed delimiters and parse fallback.
- [ ] Require conformance levels C0, C1, C4 where template semantics are used.

#### jinja

- [ ] Implement template extraction for blocks, includes, extends, macros, and filter applications.
- [ ] Implement relation extraction for include/extends/import macro edges.
- [ ] Implement binding extraction for variable contexts and template inheritance references.
- [ ] Implement diagnostics for malformed template control structures.
- [ ] Add fixtures for inheritance chains, macro libraries, and custom filter usage.
- [ ] Add degradation fixtures for partial templates and unresolved include paths.
- [ ] Require conformance levels C0, C1, C4 where template semantics are used.

#### razor

- [ ] Implement mixed markup/code segmentation for directives, code blocks, inline expressions, and tag helper forms.
- [ ] Implement symbol and binding extraction bridging template and code regions.
- [ ] Implement relation extraction for layout/partial references where available.
- [ ] Implement diagnostics for malformed directive/code transition boundaries.
- [ ] Add fixtures for directive-heavy views, partial layouts, and inline code expressions.
- [ ] Add degradation fixtures for malformed transitions and fallback behavior.
- [ ] Require conformance levels C0, C1, C4 where template semantics are used.

### Batch B6 - Data and Interface DSLs

#### sql

- [ ] Implement statement-level normalization for DDL, DML, CTEs, window functions, and dialect-sensitive constructs.
- [ ] Implement symbol extraction for tables/views/functions where representable.
- [ ] Implement relation extraction for table/view/procedure references and cross-file SQL include patterns where used.
- [ ] Implement diagnostics for dialect ambiguity and parse fallback.
- [ ] Implement risk coverage for dangerous SQL execution patterns where available from calling context.
- [ ] Add fixtures across SQLite/PostgreSQL/MySQL style syntax variations.
- [ ] Add degradation fixtures for mixed dialect files and unsupported grammar fragments.
- [ ] Require conformance levels C0, C1, C2 (and C3 when risk links are enabled).

#### proto

- [ ] Implement schema normalization for messages, enums, services, RPC methods, options, and package declarations.
- [ ] Implement symbol extraction for message/service/type declarations.
- [ ] Implement relation extraction for imports and type references.
- [ ] Implement diagnostics for schema version mismatches and unresolved imports.
- [ ] Add fixtures for multi-file proto packages, nested messages, and service options.
- [ ] Add degradation fixtures for malformed proto syntax and partial extraction.
- [ ] Require conformance levels C0, C1, C2 where AST support exists.

#### graphql

- [ ] Implement normalization for SDL and operation documents (types, fields, directives, fragments, operations).
- [ ] Implement symbol extraction for type and field declarations where representable.
- [ ] Implement relation extraction for fragment spreads, type references, and schema-extension links.
- [ ] Implement diagnostics for schema-operation mismatch and unresolved fragments.
- [ ] Add fixtures for schema stitching patterns, fragment-heavy operations, and directive usage.
- [ ] Add degradation fixtures for malformed SDL/operation combinations.
- [ ] Require conformance levels C0, C1, C2 where AST support exists.

### Batch B7 - Build and Infra DSLs

#### cmake

- [ ] Implement normalization for targets, macros/functions, include directives, and generator expression usage where representable.
- [ ] Implement relation extraction for include/find_package and target dependency hints.
- [ ] Implement diagnostics for unresolved includes and malformed target declarations.
- [ ] Add fixtures for multi-file CMake projects with subdirectories and imported targets.
- [ ] Add degradation fixtures for complex generator expressions and parser fallback.
- [ ] Require conformance levels C0, C1 (C2 only where AST support is available).

#### starlark

- [ ] Implement normalization for `load`, rule definitions, macro calls, and attribute declarations.
- [ ] Implement relation extraction for load edges and rule dependency references.
- [ ] Implement diagnostics for unresolved loads and malformed macro/rule syntax.
- [ ] Add fixtures for Bazel-style repo structures with shared `.bzl` files.
- [ ] Add degradation fixtures for dynamic macro patterns and fallback behavior.
- [ ] Require conformance levels C0, C1 (C2 where AST support exists).

#### nix

- [ ] Implement normalization for let/in expressions, attrsets, functions, and import semantics.
- [ ] Implement relation extraction for imports and package reference edges where inferable.
- [ ] Implement diagnostics for unresolved import paths and malformed expressions.
- [ ] Add fixtures for flake and non-flake style layouts, overlays, and package outputs.
- [ ] Add degradation fixtures for lazy/dynamic evaluation ambiguities.
- [ ] Require conformance levels C0, C1 (C2 where AST support exists).

#### makefile

- [ ] Implement normalization for target declarations, pattern rules, variable assignments, and include directives.
- [ ] Implement relation extraction for include edges and target dependency graphs.
- [ ] Implement diagnostics for unresolved includes and malformed target syntax.
- [ ] Add fixtures for recursive make patterns, phony targets, and pattern substitution.
- [ ] Add degradation fixtures for shell-embedded complexity and parser fallback.
- [ ] Require conformance levels C0, C1 (C2 where AST support exists).

#### dockerfile

- [ ] Implement normalization for instructions, stage boundaries, ARG/ENV scopes, and `COPY --from` relations.
- [ ] Implement relation extraction for stage dependency edges and base image references.
- [ ] Implement diagnostics for malformed instruction sequences and ambiguous stage references.
- [ ] Add fixtures for multi-stage builds, build args, and cross-stage copy patterns.
- [ ] Add degradation fixtures for unsupported experimental syntax.
- [ ] Require conformance levels C0, C1 (C2 where AST support exists).

---

## Appendix D - Exhaustive Framework Profile Task Packs (C4)

### react

- [ ] Implement component detection for function/class components and export variants.
- [ ] Implement hook detection for built-in and user-defined `use*` patterns with confidence tags.
- [ ] Implement JSX element/component binding edges with deterministic ordering.
- [ ] Implement prop-flow linkage from JSX usage to component definitions where resolvable.
- [ ] Implement risk sink coverage for `dangerouslySetInnerHTML` and unsafe DOM APIs.
- [ ] Implement SSR/CSR marker capture for hybrid React environments.
- [ ] Implement and validate all React-specific route/template/style edge-case canonicalization cases from USR section 35.11.
- [ ] Add fixtures for context providers, memo/forwardRef, suspense/lazy boundaries.
- [ ] Add degradation fixtures for malformed JSX and mixed transpiler syntax.

### vue

- [ ] Implement SFC segmentation for template/script/script setup/style/custom blocks.
- [ ] Implement template directive binding edges for `v-bind`, `v-on`, `v-model`, `v-if`, `v-for`.
- [ ] Implement emits/props extraction including declared and inferred emit surfaces.
- [ ] Implement style scope linkage for scoped/module/global styles.
- [ ] Implement risk sink coverage for `v-html` and template injection surfaces.
- [ ] Implement script setup metadata capture in attrs.
- [ ] Implement and validate all Vue-specific route/template/style edge-case canonicalization cases from USR section 35.11.
- [ ] Add fixtures for slots/scoped slots, teleport, suspense, and composition API patterns.
- [ ] Add degradation fixtures for malformed SFC block boundaries.

### next

- [ ] Implement app-router and pages-router route extraction.
- [ ] Implement route-to-component and route-to-handler linkage edges.
- [ ] Implement server/client boundary detection and hydration boundary edges.
- [ ] Implement API route extraction and runtimeSide attribution.
- [ ] Implement deterministic route pattern normalization for dynamic segments.
- [ ] Implement and validate all Next-specific route/template/style edge-case canonicalization cases from USR section 35.11.
- [ ] Add fixtures for nested routes, route groups, server actions, and middleware adjacency.
- [ ] Add degradation fixtures for ambiguous route files and mixed conventions.

### nuxt

- [ ] Implement pages route extraction and composable discovery.
- [ ] Implement `server/api` and `server/routes` handler extraction.
- [ ] Implement route/component/server linkage edges with deterministic ordering.
- [ ] Implement server/client boundary metadata for universal code paths.
- [ ] Implement and validate all Nuxt-specific route/template/style edge-case canonicalization cases from USR section 35.11.
- [ ] Add fixtures for layered Nuxt configs and module integration cases.
- [ ] Add degradation fixtures for unresolved auto-import and alias scenarios.

### svelte

- [ ] Implement `.svelte` segmentation for module script, instance script, template, and style.
- [ ] Implement binding edges for `bind:`, `on:`, `let:` semantics.
- [ ] Implement style scope linkage for component-local and global styles.
- [ ] Implement component symbol extraction and template linkage.
- [ ] Implement and validate all Svelte-specific route/template/style edge-case canonicalization cases from USR section 35.11.
- [ ] Add fixtures for stores/actions/transitions and slot forwarding.
- [ ] Add degradation fixtures for malformed Svelte markup/script boundaries.

### sveltekit

- [ ] Implement route extraction from filesystem conventions.
- [ ] Implement route-to-component/handler linkage for `+page`, `+layout`, and server endpoints.
- [ ] Implement server/client boundary metadata for load/actions.
- [ ] Implement deterministic route pattern normalization.
- [ ] Implement and validate all SvelteKit-specific route/template/style edge-case canonicalization cases from USR section 35.11.
- [ ] Add fixtures for nested layouts and endpoint adjacency.
- [ ] Add degradation fixtures for partial route trees and malformed conventions.

### angular

- [ ] Implement decorator-based symbol extraction for components/directives/services/modules.
- [ ] Implement template binding edges for inputs/outputs and structural directives.
- [ ] Implement standalone and module-mode coverage.
- [ ] Implement route extraction and route-to-component linkage.
- [ ] Implement style/template URL linkage and inline equivalents.
- [ ] Implement and validate all Angular-specific route/template/style edge-case canonicalization cases from USR section 35.11.
- [ ] Add fixtures for lazy modules, standalone routes, and signal-based patterns.
- [ ] Add degradation fixtures for malformed decorators/templates.

### astro

- [ ] Implement frontmatter/template/style segmentation for `.astro` files.
- [ ] Implement framework island component import/reference linkage.
- [ ] Implement frontmatter symbol extraction and template binding bridge edges.
- [ ] Implement route extraction for Astro file-based routing contexts.
- [ ] Implement and validate all Astro-specific route/template/style edge-case canonicalization cases from USR section 35.11.
- [ ] Add fixtures for mixed framework islands and content collections usage.
- [ ] Add degradation fixtures for malformed frontmatter/template boundaries.

---

## Appendix E - Conformance Matrix by Language/Framework

| Profile | Required Conformance |
| --- | --- |
| javascript | C0, C1, C2, C3, C4 |
| typescript | C0, C1, C2, C3, C4 |
| python | C0, C1, C2, C3 |
| clike | C0, C1, C2, C3 |
| go | C0, C1, C2, C3 |
| java | C0, C1, C2, C3 |
| csharp | C0, C1, C2, C3 |
| kotlin | C0, C1, C2, C3 |
| ruby | C0, C1, C2, C3 |
| php | C0, C1, C2, C3 |
| html | C0, C1, C4 when framework overlay applies |
| css | C0, C1, C4 when framework overlay applies |
| lua | C0, C1, C2, C3 |
| sql | C0, C1, C2, C3 when risk-linked |
| perl | C0, C1, C2, C3 |
| shell | C0, C1, C2, C3 |
| rust | C0, C1, C2, C3 |
| swift | C0, C1, C2, C3 |
| cmake | C0, C1, C2 where supported |
| starlark | C0, C1, C2 where supported |
| nix | C0, C1, C2 where supported |
| dart | C0, C1, C2, C3 |
| scala | C0, C1, C2, C3 |
| groovy | C0, C1, C2, C3 |
| r | C0, C1, C2, C3 where supported |
| julia | C0, C1, C2, C3 where supported |
| handlebars | C0, C1, C4 where template semantics apply |
| mustache | C0, C1, C4 where template semantics apply |
| jinja | C0, C1, C4 where template semantics apply |
| razor | C0, C1, C4 where template semantics apply |
| proto | C0, C1, C2 where supported |
| makefile | C0, C1, C2 where supported |
| dockerfile | C0, C1, C2 where supported |
| graphql | C0, C1, C2 where supported |
| react | C4 |
| vue | C4 |
| next | C4 |
| nuxt | C4 |
| svelte | C4 |
| sveltekit | C4 |
| angular | C4 |
| astro | C4 |

---

## Appendix F - Rollout and Change-Control Tasks

### F.1 Rollout gates (USR section 26)

- [ ] Complete Phase A schema and registry readiness.
- [ ] Complete Phase B dual-write parity validation.
- [ ] Complete Phase C USR-backed production path validation.
- [ ] Complete Phase D full conformance enforcement.

### F.2 Backward compatibility and deprecation (USR section 27)

- [x] Keep legacy artifact outputs until parity and migration evidence are approved.
- [x] For any deprecation, create archive doc entry with canonical replacement and reason.

### F.3 Change-control (USR section 28)

- [x] Add Tier 1/Tier 2/Tier 3 change classification checklist to PR workflow.
- [x] Enforce required reviewer thresholds by tier.
- [x] Enforce required updates to registries/schemas/tests for Tier 2 and Tier 3 changes.

### F.4 Extension policy (USR section 29)

- [x] Enforce namespaced extension usage.
- [x] Disallow extension overrides of canonical required semantics.
- [x] Validate extension determinism in CI.

### F.5 Diagnostics/examples/canonicalization/backcompat hard requirements (USR sections 33-36)

- [x] Enforce section 33 diagnostic and reason-code taxonomy in strict validators and reporting.
- [x] Keep section 34 canonical JSON examples synchronized with executable fixture bundles.
- [x] Enforce section 35 route/template/style canonical attrs and framework edge-case checklist in C4 lanes.
- [x] Enforce section 36 compatibility matrix execution, pairwise expansion, and reporting dimensions in CI.

### F.6 Decomposed contract synchronization requirements

- [x] Keep umbrella USR spec and decomposed contract suite synchronized on every Tier 2/Tier 3 change.
- [x] Keep per-language contracts synchronized with language/profile matrix rows.
- [x] Keep framework and risk contracts synchronized with fixture and conformance lane implementations.
- [x] Keep registry schema and implementation-readiness contracts synchronized with CI validators and promotion policies.
- [x] Keep observability/SLO and security-governance contracts synchronized with CI dashboards and blocking gate policies.

---

## Appendix G - Immediate Execution Milestones

1. Complete Phase 0 traceability and governance lock.
2. Complete Phase 1 machine-readable registries and schema package.
3. Complete Phase 2 identity/coordinate/integrity enforcement.
4. Complete Phase 3 parser/normalization core.
5. Execute B1 in full before starting B2-B7 parallel execution.
6. Complete framework overlays (Phase 5) after B1 baseline stability.
7. Complete Phase 6 through Phase 9 implementation gates.
8. Start phased conformance rollout (Phase 10 through Phase 14).
9. Finalize CI and change-control operations (Phase 15).

---

## Appendix H - Decomposed Contract Workstream Traceability

| Consolidated contract | Primary intent | Required phases | Required CI gates/lanes |
| --- | --- | --- | --- |
| `docs/specs/usr-core-governance-change.md` | governance, ownership, drift, RFC/change workflow | 0, 9, 10, 15 | `ci-lite`, `ci`, `decomposed-drift`, `lang/contracts/usr-roadmap-sync`, `lang/contracts/usr-maintenance-controls-stability` |
| `docs/specs/usr-core-artifact-schema-catalog.md` | registries, schema contracts, validator and lane policy | 0, 1, 10, 15 | `ci-lite`, `ci`, `report-schema`, `harness-core`, `lang/contracts/usr-contract-enforcement` |
| `docs/specs/usr-core-language-framework-catalog.md` | language/framework profiles, embeddings, route/template/style edge cases | 0, 1, 3, 4, 5, 6, 10, 12, 13, 14 | `batch-b1..batch-b8`, `conformance-c4`, `lang/contracts/usr-framework-canonicalization`, `lang/contracts/usr-language-contract-freshness-validation` |
| `docs/specs/usr-core-normalization-linking-identity.md` | kind mapping, resolution, identity, module/type/query semantics | 0, 1, 3, 4, 5, 6, 10, 12, 13, 14 | `harness-core`, `batch-b0..batch-b8`, `conformance-c2`, `conformance-c3` |
| `docs/specs/usr-core-pipeline-incremental-transforms.md` | stage chain, adapters, provenance, incremental/full parity, resilience | 0, 1, 3, 4, 5, 6, 10, 12, 13, 14 | `batch-b1..batch-b8`, `conformance-c2`, `conformance-c3`, `backcompat` |
| `docs/specs/usr-core-quality-conformance-testing.md` | C0-C4, fixture governance, differential/fuzzing/golden policy | 0, 7, 8, 10, 11, 12, 13, 14, 15 | `conformance-c0..conformance-c4`, `fixture-governance`, `benchmark-regression`, `lang/contracts/usr-matrix-driven-harness-validation` |
| `docs/specs/usr-core-security-risk-compliance.md` | language/framework risk taxonomy, threat model, compliance gates | 0, 6, 10, 14, 15 | `security-gates`, `threat-model`, `waiver-enforcement`, `lang/contracts/usr-language-risk-profile-validation` |
| `docs/specs/usr-core-observability-performance-ops.md` | SLO, benchmark, capacity, audit reporting | 0, 8, 9, 10, 15 | `observability`, `benchmark-regression`, `diagnostics-summary`, `lang/contracts/usr-observability-rollup-validation` |
| `docs/specs/usr-core-rollout-release-migration.md` | compatibility matrix policy, release/cutover/rollback controls | 0, 9, 10, 15 | `backcompat`, `report-schema`, `implementation-readiness` |
| `docs/specs/usr-core-diagnostics-reasoncodes.md` | diagnostic envelopes, reason-code taxonomy, lifecycle | 0, 6, 10, 14, 15 | `diagnostics-summary`, `harness-core`, `lang/contracts/usr-diagnostic-remediation-routing-validation` |
| `docs/specs/usr-core-evidence-gates-waivers.md` | gate evaluation, evidence freshness, waiver governance | 0, 9, 10, 15 | `waiver-enforcement`, `report-schema`, `lang/contracts/usr-pr-template-policy-validation` |
| `docs/specs/usr-consolidation-coverage-matrix.md` | legacy-to-core merge traceability | 0, 10, 15 | `decomposed-drift`, `lang/contracts/usr-roadmap-sync` |

---

## Appendix I - Per-Language Definition of Done

A language profile is implementation-complete only when all items below are true:

- [ ] Consolidated language catalog rows define exact node/edge/capability/fallback requirements (no remaining seed placeholders).
- [ ] Consolidated language catalog rows define explicit version/dialect and embedding policy baselines.
- [ ] Language profile row in `usr-language-profiles.json` matches the contract exactly.
- [ ] Language version and embedding policy rows match the contract exactly.
- [ ] Required fixture families are present with concrete fixture IDs and deterministic goldens.
- [ ] Required conformance levels for the language are green in strict mode.
- [ ] Risk expectations (where C3 applies) are implemented and validated with required diagnostics.
- [ ] Generated/macro provenance behavior is either implemented or explicitly unsupported with diagnostics.
- [ ] Embedded-language bridge behavior is implemented or explicitly non-applicable with evidence.
- [ ] Unknown-kind budget for the language is within allowed threshold and reported.
- [ ] All degradations and unsupported capabilities are explicitly declared and mapped to diagnostics/reason codes.

---

## Appendix J - Spec Dependency Graph

This appendix defines hard dependency ordering across the consolidated USR contract suite.

### J.1 Foundation (must be green first)

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr/README.md`
- `docs/specs/usr-core-governance-change.md`
- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-diagnostics-reasoncodes.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`

### J.2 Modeling layer

- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-pipeline-incremental-transforms.md`

### J.3 Quality and operations layer

- `docs/specs/usr-core-quality-conformance-testing.md`
- `docs/specs/usr-core-security-risk-compliance.md`
- `docs/specs/usr-core-observability-performance-ops.md`
- `docs/specs/usr-core-rollout-release-migration.md`

### J.4 Traceability and enforcement

- `docs/specs/usr-consolidation-coverage-matrix.md`
- `docs/guides/usr-contract-enforcement.md`
- `TES_LAYN_ROADMAP.md` appendices H/J/M/N

---

## Appendix K - Minimum Implementable Slice

The minimum implementation slice for architecture proof is:

1. Language: `typescript`
2. Framework profile: `vue`
3. End-to-end domains: parsing, normalization, linking, route/template/style canonicalization, risk baseline, reporting

### K.1 Required deliverables

- `usr-language-profiles.json` row for `typescript` green under strict schema validation.
- `usr-framework-profiles.json` row for `vue` with edge-case IDs and segmentation policy.
- deterministic fixture bundle for:
  - TypeScript module resolution and type edges
  - Vue template bindings, slots, directives, scoped styles, and route overlays
- outputs:
  - `usr-conformance-summary.json`
  - `usr-quality-evaluation-results.json`
  - `usr-threat-model-coverage-report.json`
  - `usr-release-readiness-scorecard.json`

### K.2 Exit criteria

- C0-C4 required checks for the slice are green.
- Strict-mode runs show zero unknown blocking diagnostics.
- Full build and incremental build parity for slice fixtures is green.
- Backcompat strict scenarios for slice outputs are green.

---

## Appendix L - Hard Block vs Advisory Gate Matrix

| Domain | Hard block gate | Advisory gate |
| --- | --- | --- |
| Schema and registries | schema validation failure, unknown required keys, cross-registry invariant break | non-blocking schema warning with active waiver |
| Language/framework mapping | missing required node/edge/capability mapping | partial coverage warning with explicit unsupported diagnostics |
| Resolution and identity | unresolved required links, identity instability beyond budget | ambiguous non-blocking links with bounded confidence |
| Security and threat | critical control gap, redaction failure, supply-chain integrity failure | medium-severity gap with compensating controls and expiry |
| Quality and conformance | blocking quality threshold failure, C-level required lane failure | non-blocking quality drift with remediation ETA |
| Performance and capacity | blocking benchmark or SLO budget breach | early-trend regression below block threshold |
| Operations and rollout | missing cutover runbook, failed blocking drill, expired waiver | drill recommendation warnings, advisory readiness notes |
| Documentation and governance | contract drift on normative fields, missing required RFC metadata | stale narrative docs with no normative drift |

---

## Appendix M - Evidence and Execution Documentation

Required supporting docs for implementation execution and governance:

- `docs/specs/usr-core-evidence-gates-waivers.md`
- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-governance-change.md`
- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-consolidation-coverage-matrix.md`
- `docs/guides/usr-contract-enforcement.md`
- `docs/guides/usr-new-language-onboarding.md`
- `docs/schemas/usr/*.json`

Roadmap enforcement requirements:

- [x] Every phase gate links to at least one concrete evidence artifact in `docs/specs/usr-core-evidence-gates-waivers.md`.
- [x] Every blocking evidence artifact has an active schema in `docs/schemas/usr/*.json` and a row in `docs/specs/usr-core-artifact-schema-catalog.md`.
- [x] CI contract enforcement follows `docs/guides/usr-contract-enforcement.md`.
- [x] New language onboarding follows `docs/guides/usr-new-language-onboarding.md`.
- [x] Framework onboarding and interop expectations follow `docs/specs/usr-core-language-framework-catalog.md`.
- [x] Contract consolidation traceability is maintained in `docs/specs/usr-consolidation-coverage-matrix.md`.
- [x] Any contract addition/removal updates Appendix H traceability, Appendix J dependency graph, and Appendix N governance lock in same change.

### M.1 Phase-to-gate evidence artifact map

| Phase | Required evidence artifact(s) |
| --- | --- |
| 0 | `usr-validation-report.json`, `usr-drift-report.json` |
| 1 | `usr-validation-report.json`, `usr-drift-report.json` |
| 2 | `usr-validation-report.json` |
| 3 | `usr-validation-report.json` |
| 4 | `usr-conformance-summary.json` |
| 5 | `usr-conformance-summary.json`, `usr-quality-evaluation-results.json` |
| 6 | `usr-quality-evaluation-results.json`, `usr-threat-model-coverage-report.json` |
| 7 | `usr-quality-evaluation-results.json` |
| 8 | `usr-benchmark-regression-summary.json`, `usr-observability-rollup.json` |
| 9 | `usr-operational-readiness-validation.json`, `usr-release-readiness-scorecard.json` |
| 10 | `usr-validation-report.json`, `usr-conformance-summary.json` |
| 11 | `usr-conformance-summary.json` |
| 12 | `usr-conformance-summary.json`, `usr-quality-evaluation-results.json` |
| 13 | `usr-conformance-summary.json` |
| 14 | `usr-failure-injection-report.json`, `usr-threat-model-coverage-report.json`, `usr-waiver-active-report.json` |
| 15 | `usr-release-readiness-scorecard.json`, `usr-waiver-expiry-report.json`, `usr-observability-rollup.json` |

---

## Appendix N - Phase 0 Governance Lock Artifacts

### N.1 USR section-to-task traceability anchors (sections 5 through 36)

The canonical section map is Appendix A. Task anchors below are required when updating those sections:

| USR section | Required roadmap task anchors |
| --- | --- |
| 5.4, 5.5, 5.6 | Phase 2.1 coordinate enforcement tasks |
| 6.7 | Phase 2.2 identity enforcement tasks |
| 7.11, 8.5 | Phase 2.3 integrity constraints and endpoint checks |
| 11.3, 11.4, 11.5 | Phase 3.1-3.3 parser, normalization, extraction ordering |
| 12.3 | Phase 6.2 capability transitions and diagnostic semantics |
| 16.4 | Phase 8 determinism hardening and Phase 11-13 conformance gates |
| 17 | Phase 8 resource hardening and Phase 15 observability/SLO enforcement |
| 18 | Phase 6.5 security semantics and Phase 14-15 security gates |
| 23, 24 | Phase 1 registry/schema package and validator ownership |
| 25 | Phase 5 framework applicability enforcement |
| 26, 27, 28, 29 | Appendix F rollout, deprecation, change-control, extension policy tasks |
| 30, 31 | Phase 15 reporting and readiness scorecard outputs |
| 33 | Phase 1/6/10 diagnostic taxonomy + remediation routing |
| 34, 35 | Phase 7 fixture corpus + framework canonicalization execution |
| 36 | Phase 15 compatibility matrix CI enforcement |

### N.2 Section-group ownership and escalation mapping

| Section group | Primary owner role | Backup owner role | Escalation policy |
| --- | --- | --- | --- |
| identity/normalization/integrity (5-12) | `usr-architecture` | `usr-conformance` | `esc-contract-conflict` |
| language/framework catalog and overlays (23-25, 35) | `usr-framework` | `usr-architecture` | `esc-framework-contract-conflict` |
| diagnostics/reasoning/conformance policy (16, 33, 34, 36) | `usr-conformance` | `usr-architecture` | `esc-taxonomy-drift` |
| security/risk/waiver governance (18, 47, 48) | `usr-security` | `usr-operations` | `esc-security-gate-failure` |
| observability/performance/release operations (17, 30, 31, 41, 46) | `usr-observability` | `usr-operations` | `esc-slo-budget-breach` |

Source artifacts: `tests/lang/matrix/usr-ownership-matrix.json` and `tests/lang/matrix/usr-escalation-policy.json`.

### N.3 Batch ownership map

| Batch | Primary owner role | Backup owner role |
| --- | --- | --- |
| B0 | `usr-architecture` | `usr-conformance` |
| B1 | `usr-framework` | `usr-architecture` |
| B2 | `usr-conformance` | `usr-architecture` |
| B3 | `usr-conformance` | `usr-architecture` |
| B4 | `usr-conformance` | `usr-architecture` |
| B5 | `usr-framework` | `usr-conformance` |
| B6 | `usr-conformance` | `usr-architecture` |
| B7 | `usr-operations` | `usr-architecture` |
| B8 | `usr-architecture` | `usr-operations` |

### N.4 Contract conflict escalation path

1. Detect contradiction between `docs/specs/unified-syntax-representation.md` and any decomposed contract, matrix row, or validator behavior.
2. Freeze advancement for affected batch/phase gates and mark the item as blocked.
3. Open escalation using the mapped policy ID from section N.2 and attach failing evidence artifacts.
4. Resolve through owner + backup owner review; blocking policies require required approvers in `usr-escalation-policy.json`.
5. Merge reconciled spec/matrix/validator updates in one change with roadmap + appendix linkage updates.

### N.5 Planning guardrails and evidence policy

- Batch advancement is prohibited unless required gate evidence artifacts are present and schema-valid.
- Any phase completion checkbox requires deterministic rerun evidence with stable run IDs and zero drift deltas.
- Promotion into testing phases requires explicit declarations for `supported`, `partial`, and `unsupported` capabilities with diagnostic coverage.
- Required evidence templates and gate logic are defined in `docs/specs/usr-core-evidence-gates-waivers.md` and `docs/specs/usr-core-artifact-schema-catalog.md`.

### N.6 Roadmap edit invariants

- Roadmap edits must preserve exact language coverage parity with `src/index/language-registry/registry-data.js`, `tests/lang/matrix/usr-language-profiles.json`, and per-language contracts under `docs/specs/usr/languages/*.md`.
- Any Tier 2/Tier 3 contract change must update impacted matrix rows, validator enforcement, and roadmap appendix mappings in the same PR.
- Appendix H, Appendix J, Appendix M, and this appendix must remain synchronized whenever contract scope or CI gate ownership changes.
- Any change that affects CI gate behavior must update `docs/guides/usr-contract-enforcement.md` and corresponding lane order files.

### N.7 Traceability approval lock

- Traceability approval is authoritative only when `docs/specs/usr-consolidation-coverage-matrix.md` remains in `Status: Approved` state and includes a current approval lock record.
- The approval lock must include an approval record ID, ISO 8601 approval timestamp, and explicit decisions for `usr-architecture`, `usr-conformance`, and `usr-operations`.
- If the lock is missing or downgraded to draft, Phase 0.3 is considered not satisfied and must be reopened until approval metadata is restored.


