# Context-Pack Risk Contract

The `risk` section inside `CompositeContextPack` is a public machine-facing contract.

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
