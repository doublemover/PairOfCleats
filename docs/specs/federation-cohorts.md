# Federation cohorts spec (Phase 15.4)

## Status

- **Spec version:** 1
- **Audience:** contributors implementing cohort gating for federated search.
- **Implementation status:** planned.

---

## 1. Purpose

Cohorts prevent unsafe cross-repo mixing when repos were built with incompatible indexing/runtime settings.

Each mode (`code`, `prose`, `extracted-prose`, `records`) is partitioned by:

- `cohortKey` (preferred, mode-scoped)
- fallback `compatibilityKey`

Effective key:

```text
effectiveKey = cohortKey ?? compatibilityKey ?? null
```

---

## 2. Inputs

For each selected repo + mode:

- `repoId`
- `priority`
- `enabled`
- `effectiveKey`

Missing key (`null`) is its own cohort bucket.

---

## 3. Policy modes

### 3.1 Default policy

Select one cohort per mode using deterministic ranking:

1. Highest repo count.
2. Highest total priority.
3. Lexicographically smallest `effectiveKey` (with `null` last).

Excluded cohorts emit `WARN_FEDERATED_MULTI_COHORT`.

### 3.2 Strict policy

If more than one cohort exists for any requested mode:

- fail with `ERR_FEDERATED_MULTI_COHORT`.

### 3.3 Explicit selection

Allow:

- `--cohort <key>` (all modes)
- `--cohort <mode>:<key>`

Unknown keys fail with `ERR_FEDERATED_COHORT_NOT_FOUND`.

Rules:

- `--cohort <key>` must resolve in every requested mode; otherwise fail.
- `--cohort <mode>:<key>` only applies to that mode.

### 3.4 Unsafe mix policy

`--allow-unsafe-mix` allows mixed cohorts and emits `WARN_FEDERATED_UNSAFE_MIXING`.

---

## 4. Output contract

Federated response includes:

- `cohorts.policy`
- `cohorts.modeSelections[mode]`
- `cohorts.excluded[mode][]` with repo ids and reasons
- `cohorts.warnings[]`

Example fragment:

```json
{
  "cohorts": {
    "policy": "default",
    "modeSelections": {
      "code": "ck-code-abc",
      "prose": "ck-prose-def"
    },
    "excluded": {
      "code": [{ "repoId": "svc-b-1234", "effectiveKey": "ck-code-old", "reason": "cohort-excluded" }]
    },
    "warnings": ["WARN_FEDERATED_MULTI_COHORT"]
  }
}
```

---

## 5. Backward compatibility

1. If `cohortKey` is missing, fallback to `compatibilityKey`.
2. If both missing, set `effectiveKey = null` and include diagnostic warning.
3. Existing single-repo searches are unaffected.

---

## 6. Determinism rules

1. Cohort grouping is sorted by key before ranking.
2. Repo lists inside each cohort are sorted by `repoId`.
3. Diagnostics are sorted by `repoId`.
4. `null` effective keys are always ranked last.

---

## 7. Touchpoints

- `src/contracts/compatibility.js`
- `src/integrations/core/build-index/compatibility.js`
- `src/index/build/indexer/steps/write.js`
- `src/workspace/manifest.js` (new)
- `src/retrieval/federation/coordinator.js` (new)

---

## 8. Required tests

- `tests/retrieval/federation/compat-cohort-defaults.test.js`
- `tests/retrieval/federation/compat-cohort-determinism.test.js`
- `tests/retrieval/federation/compat-cohort-explicit-selection.test.js`
- `tests/retrieval/federation/compat-cohort-strict-error.test.js`
