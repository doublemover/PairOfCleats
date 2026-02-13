# Config defaults spec (Phase 14/15 additions)

## Status

- **Spec version:** 1
- **Audience:** contributors adding config-backed behavior in snapshot/diff/federation features.
- **Implementation status:** implemented.

---

## 1. Purpose

Define stable default values and normalization rules for new roadmap features so behavior is predictable without custom config.

Precedence order for resolved values:

1. CLI flags
2. environment overrides
3. user config file
4. defaults in this spec

---

## 2. Snapshot defaults (`indexing.snapshots.*`)

- `keepPointer`: `25`
- `keepFrozen`: `10`
- `maxAgeDays`: `30`
- `stagingMaxAgeHours`: `24`
- `protectedTagGlobs`: `["release", "keep-*"]`

Normalization:

- counts clamp to `>= 1`
- retain/staging days clamp to `>= 0`
- globs normalized to lowercase trimmed strings

---

## 3. Diff defaults (`indexing.diffs.*`)

- `keep`: `50`
- `maxAgeDays`: `30`
- `compute.modes`: `["code"]`
- `compute.detectRenames`: `true`
- `compute.includeRelations`: `true`
- `compute.maxChangedFiles`: `200`
- `compute.maxChunksPerFile`: `500`
- `compute.maxEvents`: `20000`
- `compute.maxBytes`: `2097152` (2 MiB)
- `compute.persist`: `true`

Normalization:

- `keep`, `maxAgeDays`, `compute.maxChangedFiles`, `compute.maxChunksPerFile`, `compute.maxEvents`, `compute.maxBytes` clamp to `>= 1`
- empty mode lists fallback to `["code"]`

---

## 4. Federation defaults (`indexing.federation.*`)

- `selection.includeDisabled`: `false`
- `search.concurrency`: `4`
- `search.perRepoTop`: `null` (use coordinator derivation)
- `merge.strategy`: `"rrf"`
- `merge.rrfK`: `60`
- `cohorts.policy`: `"default"` (`default|strict|explicit|unsafe-mix`)

---

## 5. Federated query cache defaults (`indexing.federation.queryCache.*`)

- `enabled`: `true`
- `maxEntries`: `500`
- `maxBytes`: `268435456` (256 MiB)
- `maxAgeDays`: `14`

---

## 6. CAS/GC defaults (`indexing.cache.*`)

- `gc.enabled`: `false` (until design gate complete)
- `gc.graceDays`: `7`
- `gc.maxDeletesPerRun`: `5000`
- `gc.concurrentDeletes`: `4`

---

## 7. Validation and unknown keys

1. Unknown keys in new config blocks must hard-fail in strict validation.
2. Type mismatches hard-fail with actionable errors.
3. Defaults are applied only after schema/type validation succeeds.

No default in this spec should implicitly enable an experimental subsystem unless explicitly stated (`gc.enabled=false` remains the default).

---

## 8. Docs/contracts to update when implementing

- `docs/config/schema.json`
- `docs/config/contract.md`
- `docs/config/inventory.md`
- `docs/config/inventory-notes.md`
- `tools/dict-utils/config.js`

---

## 9. Required tests

- `tests/config/snapshot-defaults-normalization.test.js`
- `tests/config/diff-defaults-normalization.test.js`
- `tests/config/federation-defaults-normalization.test.js`
- `tests/config/unknown-key-hard-fail.test.js`
