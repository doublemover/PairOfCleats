# Phase 9 Spec — Migration and Backward Compatibility

## Why a migration spec is necessary
Phase 9 replaces several legacy join assumptions:
- graph nodes keyed by `file::name`
- cross-file linking that assumes uniqueness of a bare name
- implicit “pick a winner” behaviors

These changes must ship with explicit back-compat rules so older artifacts (or partially upgraded indexes) do not silently break.

## Compatibility model
### Contract versions
- Public symbol artifacts are versioned (schema version in their meta sidecars if sharded; otherwise in manifest entries).
- Readers must support N-1 schema major, with adapters.

### Legacy fields retained (display-only)
Phase 9 will preserve the legacy fields **only as evidence/display**:
- `legacyKey = file::name`
- raw name matches
- leaf name matches

But:
- they must not be used as join keys in new code paths.

### Partial-upgrade behavior
If symbol artifacts are missing:
- Graph building falls back to `chunkUid` nodes and emits edges only when endpoints can be identified by `chunkUid`.
- Any name-only joins must be explicitly labeled as `status: unresolved` rather than guessed.

### Strict mode
Strict mode requires:
- symbol artifacts present
- no legacy name-only joins for cross-file edges

## Deprecations
After Phase 9, these patterns are deprecated:
- `Map` keyed by `${file}::${name}` for anything cross-file.
- `chunkIdByKey.set(file::name, ...)` without multi-mapping or ambiguity handling.

## Rollout plan
1. Land identity module + symbol artifacts behind a feature flag (`indexing.symbolIdentity=on`).
2. Update graphs and cross-file linking to prefer symbol identity when present.
3. Add strict validation gates and enable in CI for fixtures.
4. Flip default on once metrics show acceptable ambiguity/unresolved rates.

