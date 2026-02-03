# Spec: Safe Regex Hardening (current)

Status: Implemented

This document describes the current safe-regex behavior in `src/shared/safe-regex.js` and its
RE2/RE2JS backends.

## 1) Goals

- Prevent catastrophic backtracking by using RE2/RE2JS engines.
- Enforce deterministic guards: max pattern length, max input length, max program size.
- Normalize regex flags to a cross-engine deterministic subset.
- Provide structured diagnostics via `compileSafeRegex`.

## 2) Engines and selection

- Preferred engine: native `re2` if available.
- Fallback: `re2js` when `re2` is unavailable or explicitly requested.
- If `engine: 're2'` is requested and unavailable, a warning is emitted and `re2js` is used.

## 3) Config and normalization

`DEFAULT_SAFE_REGEX_CONFIG`:
- `maxPatternLength`: 512
- `maxInputLength`: 10000
- `maxProgramSize`: 2000
- `timeoutMs`: null (ignored)
- `flags`: ''

Normalization rules:
- `timeoutMs` is ignored (always `null`).
- Limits are clamped to positive integers or `null` when disabled.
- Allowed flags: `gims` only; any other flag is rejected by `compileSafeRegex`.
- Canonical flag order: `gims` with duplicates removed.

## 4) APIs

### 4.1 `compileSafeRegex(pattern, flags, config)`
Returns `{ regex, error }` with structured errors:
- `EMPTY_PATTERN`
- `PATTERN_TOO_LONG`
- `PROGRAM_TOO_LARGE`
- `UNSUPPORTED_FLAGS`
- `INVALID_PATTERN`
- `ENGINE_UNAVAILABLE`

If compilation succeeds, `regex` is a SafeRegex instance and `error` is null.

### 4.2 `createSafeRegex(pattern, flags, config)`
Returns a SafeRegex instance or `null` without diagnostics.

### 4.3 SafeRegex runtime behavior
- `exec` and `test` enforce `maxInputLength` deterministically.
- Global regexes track `lastIndex` using backend-provided `nextIndex`.
- No post-hoc timeout checks are used.

## 5) Deterministic program size checks

Program size checks are performed before compilation:
- `checkProgramSize` from `re2js` backend is used for both engines.
- If the program is too large but the pattern is valid, `compileSafeRegex`
  returns `PROGRAM_TOO_LARGE`.

## 6) Implementation references

- `src/shared/safe-regex.js`
- `src/shared/safe-regex/backends/re2.js`
- `src/shared/safe-regex/backends/re2js.js`

Tests:
- `tests/shared/safe-regex/program-size-cap.test.js`
- `tests/shared/safe-regex/input-length-cap.test.js`
- `tests/shared/safe-regex/flags-normalization.test.js`
- `tests/shared/safe-regex/safe-regex-engine.test.js`

## 7) Compatibility notes

- Unsupported flags are rejected by `compileSafeRegex`; `createSafeRegex` silently drops them
  via normalization.
- `timeoutMs` in config is deprecated and ignored.
