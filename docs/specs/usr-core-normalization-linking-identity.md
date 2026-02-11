# Spec -- USR Core Normalization, Linking, and Identity Contract

Status: Draft v2.0
Last updated: 2026-02-11T08:20:00Z

## Purpose

Define deterministic mapping from raw parser/compiler outputs into canonical USR entities, identities, and links.

## Consolidated source coverage

This contract absorbs:

- `usr-normalization-mapping-contract.md` (legacy)
- `usr-resolution-and-linking-contract.md` (legacy)
- `usr-identity-stability-contract.md` (legacy)
- `usr-module-system-contract.md` (legacy)
- `usr-type-system-normalization-contract.md` (legacy)
- `usr-generics-and-polymorphism-contract.md` (legacy)
- `usr-query-semantics-contract.md` (legacy)
- `usr-routing-normalization-contract.md` (legacy)
- `usr-template-expression-binding-contract.md` (legacy)
- `usr-styling-and-css-semantics-contract.md` (legacy)
- `usr-state-management-integration-contract.md` (legacy)
- `usr-ssr-csr-hydration-contract.md` (legacy)
- `usr-runtime-config-contract.md` (legacy)
- `usr-embedding-bridge-contract.md` (legacy)
- `usr-component-lifecycle-contract.md` (legacy)
- `usr-concurrency-and-async-semantics-contract.md` (legacy)
- `usr-error-handling-semantics-contract.md` (legacy)

## Mapping rules

1. raw kind must always be preserved (`rawKind`)
2. normalized kind must be from canonical taxonomy or `unknown`
3. unknown kinds must emit deterministic diagnostics and reason codes
4. mapping conflicts must fail deterministically with explicit conflict artifacts

Deterministic mapping policy:

1. parser output traversal order must be stable and explicitly defined
2. mapping table precedence must be explicit and versioned
3. ties between mapping candidates must resolve by deterministic precedence and lexical fallback
4. unknown-kind passthrough must preserve `rawKind`, parser ID, and parser version

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

Resolution candidate envelope requirements:

| Field | Required | Notes |
| --- | --- | --- |
| `candidateUid` | yes | Target entity candidate ID. |
| `candidateType` | yes | `document`, `segment`, `node`, or `symbol`. |
| `confidence` | yes | 0..1 finite value. |
| `rank` | yes | Deterministic integer rank. |
| `evidence` | yes | Ordered evidence descriptors used for scoring. |
| `rejectionReason` | conditional | Required for pruned candidates in debug reports. |

Candidate ordering tie-break sequence:

1. confidence descending
2. evidence weight descending
3. canonical UID lexical ascending

## Identity stability contract

Identity classes (`docUid`, `segmentUid`, `nodeUid`, `symbolUid`, `edgeUid`) must satisfy:

- canonical grammar compliance
- deterministic generation for identical inputs
- controlled churn budgets between releases
- explicit migration metadata when identity algorithm changes

Identity churn budget policy:

| Identity class | Baseline churn threshold | Blocking threshold |
| --- | --- | --- |
| `docUid` | 0% for unchanged files | >0% |
| `segmentUid` | <=0.5% in unchanged fixtures | >1% |
| `nodeUid` | <=2% in unchanged fixtures | >5% |
| `symbolUid` | <=0.5% in unchanged fixtures | >1% |
| `edgeUid` | <=2% in unchanged fixtures | >5% |

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

Additional failure semantics:

1. adapter timeout must produce unresolved/ambiguous outcomes with deterministic reason codes
2. partial AST or partial compiler output must retain all emitted edges as explicitly partial where relevant
3. retries must not reorder successful candidate rankings for identical inputs

## Required outputs

- `usr-node-kind-mapping-coverage.json`
- `usr-resolution-outcome-distribution.json`
- `usr-identity-stability-report.json`
- `usr-linking-ambiguity-report.json`
- `usr-normalization-conflict-report.json`
- `usr-identity-churn-budget-report.json`

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

