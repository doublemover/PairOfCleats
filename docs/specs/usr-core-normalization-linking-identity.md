# Spec -- USR Core Normalization, Linking, and Identity Contract

Status: Draft v2.0
Last updated: 2026-02-11T07:40:00Z

## Purpose

Define deterministic mapping from raw parser/compiler outputs into canonical USR entities, identities, and links.

## Consolidated source coverage

This contract absorbs:

- `docs/specs/usr-normalization-mapping-contract.md`
- `docs/specs/usr-resolution-and-linking-contract.md`
- `docs/specs/usr-identity-stability-contract.md`
- `docs/specs/usr-module-system-contract.md`
- `docs/specs/usr-type-system-normalization-contract.md`
- `docs/specs/usr-generics-and-polymorphism-contract.md`
- `docs/specs/usr-query-semantics-contract.md`
- `docs/specs/usr-routing-normalization-contract.md`
- `docs/specs/usr-template-expression-binding-contract.md`
- `docs/specs/usr-styling-and-css-semantics-contract.md`
- `docs/specs/usr-state-management-integration-contract.md`
- `docs/specs/usr-ssr-csr-hydration-contract.md`
- `docs/specs/usr-runtime-config-contract.md`
- `docs/specs/usr-embedding-bridge-contract.md`
- `docs/specs/usr-component-lifecycle-contract.md`
- `docs/specs/usr-concurrency-and-async-semantics-contract.md`
- `docs/specs/usr-error-handling-semantics-contract.md`

## Mapping rules

1. raw kind must always be preserved (`rawKind`)
2. normalized kind must be from canonical taxonomy or `unknown`
3. unknown kinds must emit deterministic diagnostics and reason codes
4. mapping conflicts must fail deterministically with explicit conflict artifacts

## Resolution state machine

Allowed outcomes:

- `resolved`
- `ambiguous`
- `unresolved`

State transition policy:

- candidate set generation must be deterministic
- candidate ordering must be deterministic
- ambiguity thresholding must be explicit and profile-aware
- reason code must be present for non-resolved outcomes

## Identity stability contract

Identity classes (`docUid`, `segmentUid`, `nodeUid`, `symbolUid`, `edgeUid`) must satisfy:

- canonical grammar compliance
- deterministic generation for identical inputs
- controlled churn budgets between releases
- explicit migration metadata when identity algorithm changes

## Module/type/generic semantics

Normalization must preserve:

- import/export and namespace semantics
- generic type parameters, bounds, and instantiation relationships
- runtime-vs-type-only references where language supports distinction
- framework runtime boundaries (server/client/hydration)

## Routing/template/style semantics

Route/template/style edges must be canonicalized per umbrella section 35 and framework catalog rules.

Fallback behavior must be explicit for unsupported pattern classes.

## Concurrency/error semantics

When extraction or linking fails under partial parsing or async resolution races:

- fail deterministically
- emit diagnostics with remediation class
- do not emit guessed resolved links

## Required outputs

- `usr-node-kind-mapping-coverage.json`
- `usr-resolution-outcome-distribution.json`
- `usr-identity-stability-report.json`
- `usr-linking-ambiguity-report.json`

## Gate obligations

Blocking checks:

- unknown normalized kinds without diagnostics
- non-deterministic candidate ordering
- identity grammar violations
- invalid endpoint entity combinations for edges

## References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-diagnostics-reasoncodes.md`
