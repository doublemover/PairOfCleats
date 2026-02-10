# Build Truth Ledger Spec

## Goals
- Record deterministic ordering evidence per stage artifact.
- Make ordering drift diagnosable with stage/mode/artifact attribution.
- Keep seed inputs that explain ordering changes between builds.

## Non-goals
- Preserving legacy ledger layouts.
- Acting as a complete build-state event history.

## Runtime Location
- Stored inside `build_state.json` as `orderingLedger`.

## Schema
- `orderingLedger.schemaVersion` (number, current `1`)
- `orderingLedger.seeds` (object)
- `orderingLedger.stages` (object keyed by stage key)

### Seeds Object
- `discoveryHash` (string|null)
- `fileListHash` (string|null)
- `fileCount` (number|null)
- `mode` (string|null)

### Stage Key
- `stage` for mode-agnostic entries.
- `stage:mode` for mode-scoped entries (for example `stage2:code`).

### Stage Entry
- `seeds` (object, optional, same shape as top-level seeds)
- `artifacts` (object keyed by artifact name)

### Artifact Entry
- `hash` (string, ordering hash, expected format `sha1:<hex>`)
- `rule` (string|null; comparator/hash rule attribution)
- `count` (number|null; ordered line count)
- `mode` (string|null; mode attribution for diagnostics)

## Ordering Hash Input Definition
- Hashes are computed from emitted ordering lines, not semantic set equality.
- Each emitted line is fed into the hasher and delimited with `\n`.
- Current hasher: SHA-1 (`sha1:<hex>`), produced by `createOrderingHasher`.
- For row artifacts, the ordering line is the emitted row serialization (`JSON.stringify(row)`).
- For vocab-like artifacts, the ordering line is the emitted vocab token text.

## Write Cadence
- Seed inputs can be written before/alongside stage processing.
- Artifact ordering hashes are upserted per `{stageKey, artifact}`.
- Existing artifact entries are replaced when a new hash is recorded.

## Validation Contract
- Validators recompute ordering hashes from ordering lines and compare to ledger entries.
- Missing stage/artifact entries are warnings by default.
- With strict ordering validation enabled, mismatches are errors.

## Breaking Changes
- Ledger schema is versioned; incompatible layouts require schema-version migration.
