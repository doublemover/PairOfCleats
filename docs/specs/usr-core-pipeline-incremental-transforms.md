# Spec -- USR Core Pipeline, Incremental, and Transform Contract

Status: Draft v2.0
Last updated: 2026-02-11T08:35:00Z

## Purpose

Define deterministic stage IO behavior, parser adapter obligations, incremental parity, and provenance requirements.

## Consolidated source coverage

This contract absorbs:

- `usr-parser-adapter-sdk-contract.md` (legacy)
- `usr-transforms-stage-map.md` (legacy)
- `usr-incremental-indexing-contract.md` (legacy)
- `usr-generated-provenance-contract.md` (legacy)
- `usr-build-tooling-integration-contract.md` (legacy)
- `usr-preprocessor-and-conditional-compilation-contract.md` (legacy)
- `usr-determinism-and-reproducibility-contract.md` (legacy)
- `usr-failure-injection-and-resilience-contract.md` (legacy)
- `usr-packaging-and-artifact-layout-contract.md` (legacy)
- `usr-schema-evolution-and-versioning-contract.md` (legacy)

## Canonical stage chain

Required order:

1. parse
2. normalize
3. resolve
4. enrich
5. framework overlay
6. evaluate
7. emit

Each stage must declare input/output schema shape and failure behavior.

Stage manifest requirements:

| Field | Required | Notes |
| --- | --- | --- |
| `stageId` | yes | Stable stage identifier. |
| `inputContracts` | yes | Expected artifact/input shapes. |
| `outputContracts` | yes | Produced artifact/output shapes. |
| `determinismClass` | yes | strict or bounded-delta. |
| `failureModes` | yes | Declared failure classes and handling policy. |

## Parser adapter contract

Adapters must define:

- supported language IDs and versions
- emitted raw kinds and metadata
- failure classes and fallback policy
- deterministic output ordering guarantees

## Incremental parity contract

Incremental runs must be compared against full runs for affected scopes:

- same canonical identities where inputs unchanged
- no missing required entities/edges
- bounded allowed differences for non-deterministic metadata fields only

Parity thresholds:

- unchanged fixture scope: 100% identity parity required for `docUid` and `symbolUid`
- changed fixture scope: no missing mandatory entities/edges versus full run
- non-deterministic metadata deltas must remain within documented bounded fields only

## Generated/macro/transpile provenance

Provenance policy must preserve:

- origin file and generated file mapping
- reversible span mapping where available
- transformation chain metadata
- uncertainty markers when exact mapping unavailable

## Preprocessor/conditional behavior

When conditional branches are inactive, producers must:

- mark omitted paths explicitly
- avoid emitting guessed active-path semantics
- emit diagnostics for unresolved conditional context in strict modes

## Failure injection/resilience

Required scenarios:

- parser crash/fallback
- partial artifact corruption
- adapter timeout
- malformed generated source maps

Scenario outcomes must be deterministic and surfaced in evidence outputs.

Resilience acceptance requirements:

1. every required scenario class has at least one deterministic fixture
2. scenario outcomes include reason codes and remediation classes
3. retry behavior never changes deterministic ordering semantics for successful outputs

## Required outputs

- `usr-transform-stage-metadata.json`
- `usr-incremental-vs-full-parity.json`
- `usr-generated-provenance-coverage.json`
- `usr-failure-injection-report.json`
- `usr-stage-contract-validation.json`
- `usr-incremental-parity-threshold-report.json`

## References

- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
