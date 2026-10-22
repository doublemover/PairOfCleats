# Context-Pack Risk Contract

The `risk` section inside `CompositeContextPack` is a public machine-facing contract.

Risk summaries retain local analysis admission/completion, effective caps and
summary reduction counts as `inputCoverage`. Interprocedural stats aggregate this
evidence independently of execution success. A completed traversal with zero flows
can still have partial or unknown upstream coverage. Strict packs reject those
claims, including summary row drops and legacy inputs without coverage evidence.
Coverage is scoped to all admitted input chunks; completeness for a narrower
requested slice remains unknown unless separately established. Piece assembly
retains input evidence and cannot turn independent partial analyses into a
complete cross-piece result.

## Current contract

- `risk.version`: `1`
- `risk.contractVersion`: `1.0.0`
- Accepted `risk.provenance.artifactSurfaceVersion`: `0.0.2`

## Compatibility rules

- Readers and validators must fail closed when `risk.contractVersion` is missing or does not exactly equal `1.0.0`.
- Readers and validators must fail closed when `risk.version !== 1`.
- Readers and validators must fail closed when `risk.provenance.artifactSurfaceVersion` is present and outside the accepted set.
- There is no dual-read or compatibility shim path for incompatible risk payloads.

## Hard cutover

- Any incompatible change to the public `risk` payload requires:
  - a new `risk.contractVersion`
  - schema and validator updates in the same change
  - fixture and compatibility-gate test updates in the same change
  - removal of superseded compatibility paths in the same change set

## Validation surfaces

- `src/contracts/schemas/analysis.js`
- `src/contracts/validators/analysis.js`
- `tests/context-pack/public-risk-contract.test.js`

Complete-response budgeting keeps an exact request-local pretty-JSON byte count
until a section or evidence/warning field changes. Absent and protected optional
sections reuse that count. Omission order, strict required evidence and the byte
limit remain unchanged. Risk edge callsite samples are memoized only within one
propagation run by caller, callee, file and sampling cap; taint and witness state
remain specific to each traversal state.

Within one risk propagation run, sink/callee order and immutable edge parameter and
framework-rule matches are prepared lazily. Edge preparation has an 8 MiB accounted
cache budget and falls back to recomputation when full. Tainted arguments, semantic
transitions, confidence, watch steps and witness admission remain state-specific.
