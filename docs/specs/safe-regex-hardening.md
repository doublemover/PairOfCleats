# Spec: Safe Regex Hardening and Determinism (Phase 4.8)

Date: 2026-01-25  
Repo reviewed: `PairOfCleats-main (39).zip`

## 0. Goals

Phase 4.8 ensures that any *user-driven* or *config-driven* regex evaluation is:

1. **Safe by construction** (no catastrophic backtracking / ReDoS class hazards).
2. **Deterministic** across environments (native `re2` present vs fallback `re2js`).
3. **Bounded** by explicit, preemptive guardrails:
   * max pattern length
   * max program size
   * max input length
4. **Consistent** in flag handling and feature support, so behavior does not silently differ by engine.
5. **Observable**: compilation rejections should be diagnosable (warnings + structured error info where feasible).

## 1. Current State (zip 39)

### 1.1 SafeRegex implementation exists
* `src/shared/safe-regex.js`
  * Chooses engine: `re2` (if available) else `re2js`.
  * Normalizes configuration: `normalizeSafeRegexConfig()`.
  * Builds a `SafeRegex` wrapper with `.exec()` / `.test()`.

### 1.2 Guardrails already present
Already enforced today:
* `maxPatternLength`
* `maxInputLength`
* `maxProgramSize`
  * `re2js`: enforced in backend compile (`src/shared/safe-regex/backends/re2js.js`)
  * `re2`: enforced via `checkProgramSize()` (RE2JS translation) before compiling (`src/shared/safe-regex.js`)

### 1.3 User-driven call sites already using safe-regex
* `src/index/risk-rules.js` compiles risk rule patterns via `createSafeRegex`.
* `src/retrieval/output/filters.js` compiles user-provided file regex matchers (e.g., `/.../flags`) via `createSafeRegex`.

## 2. Problems to Fix

### 2.1 Post-hoc timeouts are misleading and nondeterministic
`SafeRegex.exec()` and `SafeRegex.test()` currently do:

* run the regex to completion
* then compare `Date.now()` against `timeoutMs`
* discard results if the duration exceeded the threshold

This is not a real safety mechanism (it cannot prevent expensive work), and it makes behavior nondeterministic under load.

### 2.2 Flag support is not guaranteed identical across engines
Current normalizer accepts `gimsu`. However:
* RE2JS backend only maps `i/m/s` into its flag mask; `u` is not mapped.
* This can cause engine-dependent behavior (native `re2` vs `re2js`).

### 2.3 Compilation failures are silent (no reason)
`createSafeRegex()` returns `null` on:
* invalid pattern
* pattern too long
* program too large
* unsupported flags / engine issues

Call sites can silently drop patterns or degrade behavior without telling the user.

## 3. Best-Version Decisions

### 3.1 Remove post-hoc timeout semantics entirely
**Decision:** Phase 4.8 removes `timeoutMs` from SafeRegex evaluation semantics.

* Default behavior must not depend on timing.
* Safety is provided via RE2/RE2JS + compile-time + input-length guardrails.

Compatibility policy:
* If users specify `timeoutMs` in config, treat it as **deprecated and ignored**, and (optionally) emit a one-time stderr warning in verbose mode.

### 3.2 Restrict normalized flags to the cross-engine deterministic set
**Decision:** Normalize and permit only `g`, `i`, `m`, `s`.

* Drop `u` (and any other flags) during normalization.
* Guarantee deterministic ordering and uniqueness (canonical string order: `gims`).

Rationale:
* Cross-engine determinism is more important than accepting flags that only apply in one backend.
* If `u` support is needed later, it must be implemented with parity across engines and covered by tests.

### 3.3 Provide diagnostics for rejected compilation
**Decision:** Add a non-breaking API that provides structured diagnostics while keeping `createSafeRegex()` stable.

Proposed API additions (in `src/shared/safe-regex.js`):

```js
export function compileSafeRegex(pattern, flags = '', config = {}) {
  // returns { regex: SafeRegex|null, error: { code, message }|null }
}
```

Rules:
* `createSafeRegex(...)` remains as-is (returns `SafeRegex|null`).
* New `compileSafeRegex(...)` is used by call sites that need observability (risk rules, config validation, etc.).

Error codes (minimum set):
* `EMPTY_PATTERN`
* `PATTERN_TOO_LONG`
* `PROGRAM_TOO_LARGE`
* `UNSUPPORTED_FLAGS`
* `INVALID_PATTERN`
* `ENGINE_UNAVAILABLE` (rare; only if backend cannot initialize)

## 4. Implementation Plan

### 4.1 `src/shared/safe-regex.js`
1. Remove time measurement in `SafeRegex.exec()` and `SafeRegex.test()`:
   * Delete `Date.now()` timing logic.
   * Remove `timeoutMs` from `DEFAULT_SAFE_REGEX_CONFIG` (or set to `null` but unused).
2. Update `normalizeFlags()` / allowed flag set:
   * allowed: `gims`
   * canonicalize to deterministic unique order.
3. Update `normalizeSafeRegexConfig()`:
   * Accept `timeoutMs` but set normalized value to `null` and/or drop it (documented as deprecated).
4. Implement `compileSafeRegex(pattern, flags, config)`:
   * Perform the same validations as `createSafeRegex`, but return structured error info.
   * Internally call `createSafeRegex` after pre-checks when feasible.
5. Ensure engine selection remains deterministic:
   * Maintain existing `tryRequire('re2')` behavior.
   * Keep the warning when falling back to `re2js`, but ensure it does not contaminate stdout (stderr only).

### 4.2 `src/shared/safe-regex/backends/*`
No functional changes required unless:
* additional flag parity work is needed, or
* we need to surface "unsupported flag" diagnostics more precisely.

### 4.3 Call-site updates

#### 4.3.1 `src/index/risk-rules.js`
Use `compileSafeRegex(...)` instead of `createSafeRegex(...)` for:
* rule `requires`
* rule `patterns`

Behavior:
* If a pattern is rejected, record a warning (preferably via the Phase 4.5 logging/progress infrastructure) including:
  * which rule id/source
  * which pattern/flags
  * error code/message
* Continue loading other patterns/rules (best-effort).

Output contract:
* Extend the normalized risk rules bundle to include:
  * `bundle.diagnostics = { errors: [...], warnings: [...] }` (names can be tuned)
  * This must be bounded in size (cap number of diagnostic records) to avoid exploding on a bad ruleset.

#### 4.3.2 `src/retrieval/output/filters.js`
Two acceptable options:

**Option A (minimal change, backward compatible):**
* Keep the current behavior (regex-like `/.../flags` that fails compilation becomes substring match).
* Change the substring fallback to use the **pattern** (not the raw `/.../flags`) to reduce surprise.
* Do not log by default (avoid noisy output for interactive retrieval).

**Option B (clearer semantics, preferred for correctness):**
* If user explicitly uses `/.../flags` syntax and compilation fails:
  * treat that matcher as **invalid** (ignore it)
  * attach a warning to the query plan (requires plumbing warnings upward)
* This is more correct but requires additional API surface in retrieval CLI/pipeline.

**Decision for Phase 4.8:** implement **Option A** (low-risk), and leave Option B as a follow-up once query-plan surfaces warnings consistently.

### 4.4 Contracts / schema updates
If `fileCaps.byMode` or other Phase 4.7 config changes are implemented, ensure safe-regex schema changes remain isolated.

For safe-regex specifically:
* Update `src/contracts/schemas/analysis.js` (or relevant schema) if it explicitly enumerates allowed flags or safe-regex config fields.

## 5. Tests / Verification

### 5.1 Required tests (as per Phase 4.8 roadmap)
1. `tests/shared/safe-regex/program-size-cap.test.js`
   * Configure `maxProgramSize` small and ensure compilation returns null / error code.
2. `tests/shared/safe-regex/input-length-cap.test.js`
   * Compile a simple matcher with small `maxInputLength`.
   * Ensure `.test()` returns `null` / false deterministically on oversized inputs.
3. `tests/shared/safe-regex/flags-normalization.test.js`
   * Verify:
     * duplicates removed
     * ordering canonical (`gims`)
     * unsupported flags dropped (including `u`)
     * behavior identical with `re2` present vs absent (this can be simulated by forcing engine selection in tests via config)

### 5.2 Additional recommended tests
4. `tests/safe-regex/no-timeout-semantics.test.js`
   * Ensure `timeoutMs` does not affect evaluation (ignored/deprecated).
5. `tests/indexing/risk/rules/invalid-pattern-diagnostics.test.js`
   * Provide a ruleset with an invalid regex.
   * Ensure diagnostics are produced and the rest of rules still load.

## 6. Performance Notes

* Removing `Date.now()` checks slightly reduces overhead in tight loops (risk scanning, filters).
* Guardrails are constant-time checks (length, program size).

## 7. Future Phase Alignment

* Phase 10.6.4 expects safe-regex compilation to be deterministic; this spec tightens determinism via flag parity and removal of timing-based behavior.
* If "real timeout" semantics are desired later, they should be implemented externally (worker/subprocess kill) and tied into Phase 4.4 cancellation semantics.

