# Spec -- USR Core Quality, Conformance, and Testing Contract

Status: Draft v2.1
Last updated: 2026-02-12T06:29:00Z

## Purpose

Define C0-C4 conformance levels, fixture governance, quality thresholds, and deterministic test evidence policy.

## Consolidated source coverage

This contract absorbs:

- `usr-conformance-and-fixture-contract.md` (legacy)
- `usr-fixture-governance-contract.md` (legacy)
- `usr-quality-evaluation-contract.md` (legacy)
- `usr-cross-parser-differential-contract.md` (legacy)
- `usr-fuzzing-and-property-testing-contract.md` (legacy)
- `usr-golden-diff-and-triage-contract.md` (legacy)
- `usr-test-data-generation-contract.md` (legacy)
- `usr-fixture-minimums.md` (legacy)
- `usr-fixture-taxonomy.md` (legacy)
- `usr-flaky-test-policy.md` (legacy)
- `usr-golden-update-policy.md` (legacy)
- `usr-regression-triage-playbook.md` (legacy)
- `usr-test-runtime-budget-policy.md` (legacy)
- `usr-documentation-quality-contract.md` (legacy)

## Conformance levels

- `C0`: schema/envelope correctness and deterministic serialization
- `C1`: identity and normalization correctness
- `C2`: linking/resolution/query correctness
- `C3`: risk/security behavior correctness
- `C4`: framework route/template/style/hydration correctness

Each language/framework profile must explicitly declare required target class.

Exact assertion requirements:

| Class | Mandatory assertions |
| --- | --- |
| `C0` | schema validity, deterministic serialization, required envelope fields |
| `C1` | ID grammar compliance, stable ordering, normalized kind invariants |
| `C2` | resolution state correctness, edge endpoint validity, query parity invariants |
| `C3` | risk taxonomy coverage, control-path expectations, redaction/security behavior |
| `C4` | framework route/template/style canonicalization and runtime-boundary semantics |

## Required fixture families

- parser normalization fixtures
- identity/linking fixtures
- embedded-language bridge fixtures
- framework route/template/style fixtures
- risk source/sink/sanitizer fixtures
- compatibility matrix fixtures
- failure-injection fixtures

Fixture family completeness policy:

1. every family must define minimum case count per language/framework scope
2. every case must define deterministic fixture ID and expected diagnostics
3. every family must define blocking/advisory classification per lane
4. fixture mutations must preserve historical baseline provenance

Fixture governance row requirements:

- every active language profile must have at least one blocking fixture-governance row
- every active framework profile must have at least one blocking fixture-governance row
- coverage across fixture-governance rows must include every required conformance level declared by the covered profile
- framework rows must include semantic families implied by required edge kinds (`template-binding`, `style-scope`, `route-semantics`, `hydration`)
- blocking rows must include owner/reviewer assignments with at least one reviewer distinct from owner and governance reviewer coverage (`usr-architecture` or `usr-conformance`)
- language rows must include `appendix-c:<language-id>` in `roadmapTags`; framework rows must include `appendix-d:<framework-id>` in `roadmapTags`

## Golden policy

- golden updates must be explicit, attributable, and reviewed
- deterministic reruns must produce stable outputs for unchanged inputs
- diff triage must classify expected, regression, or unknown drift

Golden update acceptance checklist:

- change reason documented
- owner and reviewer recorded
- baseline hash before/after recorded
- compatibility impact class recorded

## Differential/fuzzing policy

Differential tests must compare parser/tooling outputs for consistency classes.

Fuzzing/property tests must run on schedule by lane with triage artifacts.

Differential policy minimums:

- at least two independent parser/tooling paths per major language family where feasible
- deterministic reduction workflow for mismatches
- mismatch classes mapped to diagnostic reason codes

## Flake policy

- tests exceeding runtime budget are triaged and either optimized or lane-moved
- flaky tests require issue linkage and owner assignment
- recurring flake threshold breaches can block release lanes

## Required outputs

- `usr-conformance-summary.json`
- `usr-quality-evaluation-results.json`
- `usr-determinism-rerun-diff.json`
- `usr-differential-drift-report.json`
- `usr-fuzzing-summary.json`
- `usr-fixture-governance-report.json`
- `usr-golden-update-audit.json`
- `usr-conformance-level-assertions.json`

## Failure triage protocol

When a blocking test fails:

1. classify by conformance class and fixture family
2. attach failing artifact IDs and reason codes
3. log attempted fixes and outcomes
4. escalate after repeated failed attempts according to governance policy

## References

- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-rollout-release-migration.md`

