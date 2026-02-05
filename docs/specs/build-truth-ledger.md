# Build Truth Ledger Spec

## Goals
- Provide deterministic ordering verification across artifacts.
- Record ordering hashes and inputs for post-build diagnostics.

## Non-goals
- Backward compatibility with prior build_state layouts.

## Ledger Schema
Stored in build_state sidecar as JSON:
- version
- generatedAt
- stageEntries: array

Each stage entry:
- stage
- mode
- artifact
- orderingHash
- inputsHash
- rowCount
- notes

## Ordering Hash Rules
- Hash is computed over the ordered list of (id, key fields).
- Hash algorithm: xxhash64.

## Inputs Hash
- Derived from discovery list hash and file list hash.
- Used to diagnose ordering drift.

## Write Cadence
- Write after each stage completes.
- Replace existing ledger entry for the same stage/mode/artifact.

## Validation
- On load, compare ledger hashes to recomputed hashes if strict validation is enabled.
- Mismatch results in error in strict mode, warning otherwise.

## Integration
- Validation hooks in index-validate.
- Exposed in telemetry for determinism diagnostics.

## Breaking Changes
No backward compatibility; ledger version is required.
