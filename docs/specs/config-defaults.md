# Config defaults spec (Phase 14/15 additions)

## Status

- **Spec version:** 1
- **Audience:** contributors adding config-backed behavior in snapshot/diff/federation features.
- **Implementation status:** planned.

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

- `maxPointerSnapshots`: `25`
- `maxFrozenSnapshots`: `10`
- `retainDays`: `30`
- `stagingMaxAgeHours`: `24`
- `protectedTagGlobs`: `["release", "keep-*"]`

Normalization:

- counts clamp to `>= 1`
- retain/staging days clamp to `>= 0`
- globs normalized to lowercase trimmed strings

---

## 3. Diff defaults (`indexing.diffs.*`)

- `maxDiffs`: `50`
- `retainDays`: `30`
- `maxEvents`: `25000`
- `maxBytes`: `134217728` (128 MiB)
- `compute.modes`: `["code", "prose", "extracted-prose", "records"]`
- `compute.persistEvents`: `true`

Normalization:

- `maxEvents`, `maxBytes`, `maxDiffs` clamp to `>= 1`
- empty mode lists fallback to full default mode set

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
