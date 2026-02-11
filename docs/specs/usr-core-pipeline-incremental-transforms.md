# Spec -- USR Core Pipeline, Incremental, and Transform Contract

Status: Draft v2.0
Last updated: 2026-02-11T07:40:00Z

## Purpose

Define deterministic stage IO behavior, parser adapter obligations, incremental parity, and provenance requirements.

## Consolidated source coverage

This contract absorbs:

- `docs/specs/usr-parser-adapter-sdk-contract.md`
- `docs/specs/usr-transforms-stage-map.md`
- `docs/specs/usr-incremental-indexing-contract.md`
- `docs/specs/usr-generated-provenance-contract.md`
- `docs/specs/usr-build-tooling-integration-contract.md`
- `docs/specs/usr-preprocessor-and-conditional-compilation-contract.md`
- `docs/specs/usr-determinism-and-reproducibility-contract.md`
- `docs/specs/usr-failure-injection-and-resilience-contract.md`
- `docs/specs/usr-packaging-and-artifact-layout-contract.md`
- `docs/specs/usr-schema-evolution-and-versioning-contract.md`

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

## Required outputs

- `usr-transform-stage-metadata.json`
- `usr-incremental-vs-full-parity.json`
- `usr-generated-provenance-coverage.json`
- `usr-failure-injection-report.json`

## References

- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
