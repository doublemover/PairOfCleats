# USR New Language Onboarding Guide

Current contributor journey reconciled on 2026-10-22. Qualification is per route,
runtime/platform/head; this guide does not promote unrun integrations.

## Add the runtime route before claiming capability

1. Declare admission and routing in `src/index/language-registry/registry-data.js`,
   descriptors/special-file owners and segment/fence mappings. Keep container and
   effective language identities distinct.
2. Use the existing native-only Tree-sitter registry, binding and scheduler for a
   grammar route. There is no indexing WASM fallback. Add a bounded activation
   sample and actual chunk/relation fixtures under `tests/fixtures/languages/src/`.
3. Add imports/simple relations through the existing language-registry collectors
   and chunk/metadata owners. Report unsupported/partial extraction explicitly.
4. Add compiler/LSP enrichment through its provider/profile owner. Keep
   installation, protocol capability and project semantics separate; respect
   trust before repository-local compiler/tool resolution and build context.
5. Update the catalog/matrix declarations below only for implemented consumers.
   Record supported, partial and unsupported routes, source identity and omission
   evidence. Resource tuning is not permission to assert semantic completeness.

Use actual discovered IDs from the canonical runner, for example:

```sh
node tests/run.js --lane all --match indexing/tree-sitter/scheduler-native-language-contract --list
node tests/run.js --lane all --match indexing/tree-sitter/scheduler-native-language-contract --jobs 1 --timeout-ms 30000 --retries 0
```

Add/run the affected language/provider/consumer fixtures rather than treating a
single native sample as qualification. See [contributing](contributing.md) for
the once-per-batch front gate and [user capability guidance](language-capabilities.md)
for the distinction between route coverage and dated acceptance history. The
[retired playbook](../language/onboarding-playbook.md) retains its replacement
pointer; it is not a competing WASM or test-runner workflow.

## Purpose

Define mandatory steps for adding a registry language with deterministic, testable USR behavior.

## Preconditions

- language added to `src/index/language-registry/registry-data.js`
- owner assigned per `docs/specs/usr-core-governance-change.md`
- rollout plan defined per `docs/specs/usr-core-rollout-release-migration.md`

## Required specification updates

1. Catalog updates
- `docs/specs/usr-core-language-framework-catalog.md`
- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-language-version-policy.json`
- `tests/lang/matrix/usr-language-embedding-policy.json`
- `tests/lang/matrix/usr-capability-matrix.json`

2. Semantics updates
- `docs/specs/usr-core-normalization-linking-identity.md`
- raw-kind mapping, resolution ambiguity policy, identity stability constraints

3. Security/risk updates
- `docs/specs/usr-core-security-risk-compliance.md`
- risk source/sink/sanitizer coverage (if applicable)

4. Test/conformance updates
- `docs/specs/usr-core-quality-conformance-testing.md`
- required fixture families, C-level targets, expected diagnostics

5. Roadmap updates
- `docs/roadmap.md` phase/gate status
- `docs/specs/usr-core-rollout-release-migration.md` affected lifecycle/evidence bundle
- `docs/specs/usr-core-governance-change.md` only when gate/lock/evidence policy changes
- `docs/specs/usr-consolidation-coverage-matrix.md` if new normative scope is introduced

6. Capability and interop declarations
- capability states must be explicitly declared as `supported`, `partial`, or `unsupported`
- framework interop expectations must be declared against `docs/specs/usr-core-language-framework-catalog.md`
- if framework overlays are applicable, route/template/style canonicalization obligations must be linked to required fixture families
- per-language contract under `docs/specs/usr/languages/<language-id>.md` must include `## Required fixture ID mappings`, `## Approval checklist`, and `## Completion evidence artifacts` sections

## Promotion gates

- schema and invariant checks green
- required conformance levels green
- compatibility matrix scenarios green for impacted surfaces
- blocking security/performance/quality gates green
- release-readiness scorecard evidence updated
