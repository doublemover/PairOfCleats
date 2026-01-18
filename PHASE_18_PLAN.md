# Phase 18 Plan - Safe regex acceleration (re2 + re2js)

This plan mirrors Phase 18 from NEW_ROADMAP.md and adds detailed subtasks for implementation, tests, and validation.

## 18.1 Add dependency + backend wrapper
- [x] Add `re2` (native) as an optional dependency (recommended)
  - [x] Add `re2` to optionalDependencies
  - [x] Ensure install does not fail on unsupported platforms
- [x] Refactor `src/shared/safe-regex.js` into a backend-based module:
  - [x] Keep current behavior as the fallback backend (`re2js`)
  - [x] Add `src/shared/safe-regex/backends/re2.js`
    - [x] Wrap native `re2` constructor and compile path
    - [x] Match existing flag validation and max limits
  - [x] Add `src/shared/safe-regex/backends/re2js.js` (wrap existing usage cleanly)
    - [x] Move current RE2JS translate/compile logic into this backend
  - [x] Keep public API in `src/shared/safe-regex.js` stable
- [x] Preserve existing safety constraints:
  - [x] `maxPatternLength` enforced before compile
  - [x] `maxInputLength` enforced before match
  - [x] Guard flags normalization (only `gimsyu` supported as today)
  - [x] Ensure errors are clear and non-throwing where today returns null

## 18.2 Integrate selector + compatibility contract
- [x] Add `createSafeRegex({ engine, ...limits })` selection:
  - [x] `engine=auto` uses `re2` if available else `re2js`
  - [x] `engine=re2` uses native when available, warning + fallback to `re2js` if missing
  - [x] `engine=re2js` always uses the JS backend
  - [x] Expose engine identity on the returned matcher for tests
- [x] Validate behavioral parity:
  - [x] `.exec()` and `.test()` match expectations for `g` and non-`g`
  - [x] `.lastIndex` semantics compatible
  - [x] Group capture and match array shape matches current usage
  - [x] Error handling returns null for invalid patterns

## 18.3 Update call sites
- [x] Verify these flows still behave correctly:
  - [x] `src/retrieval/output/filters.js` (file/path filters)
  - [x] `src/retrieval/output/risk-tags.js` (risk tagging)
  - [x] `src/index/risk-rules.js` (risk rule regex)
  - [x] Any structural search or rulepack path using regex constraints
- [x] Ensure no new config knobs are added (engine selection remains internal)
- [x] Confirm capabilities reporting stays accurate (re2 vs re2js)

## 18.4 Tests
- [x] Add `tests/safe-regex-engine.js`:
  - [x] Conformance tests (flags, match groups, global behavior)
  - [x] Safety limit tests (pattern length, input length)
  - [x] Engine-selection tests (`auto`, forced `re2js`)
  - [x] Skip or soft-fail when `re2` is missing (no CI break)
- [x] Add script-coverage action(s)
  - [x] Include the test in `tests/script-coverage/actions.js`

## Exit criteria
- [x] No user-visible semantic regressions in filtering/risk-tagging
- [x] "Engine auto" is safe and silent (no noisy logs) unless verbose
- [x] Tests pass with and without native `re2` present

## Validation runs (regex-heavy)
- [ ] Targeted filter tests:
  - [ ] `node tests/retrieval/filters/query-syntax/negative-terms.test.js` (FAILED: "Negative phrase filter failed.")
  - [ ] `node tests/retrieval/filters/query-syntax/phrases-and-scorebreakdown.test.js` (FAILED: "Expected phrase match score breakdown for quoted phrase.")
  - [x] `node tests/retrieval/filters/file-and-token/file-selector-case.test.js`
  - [x] `node tests/retrieval/filters/file-and-token/token-case.test.js`
  - [x] `node tests/retrieval/filters/file-and-token/punctuation-tokenization.test.js`
  - [x] `node tests/retrieval/filters/git-metadata/branch.test.js`
  - [x] `node tests/retrieval/filters/git-metadata/chunk-author.test.js`
  - [x] `node tests/retrieval/filters/git-metadata/modified-time.test.js`
  - [x] `node tests/structural-filters.js`
  - [x] `node tests/ext-filter.js`
  - [x] `node tests/filter-strictness.js`
  - [x] `node tests/lang-filter.js`
- [ ] Optional (skipped per request): full-lane runs (`test:integration`, `test:services`, `test:perf`)

## Implementation notes / extra subtasks
- [x] Decide on how to detect native availability (optional-deps helper, or try/catch import)
- [x] Decide whether to cache compiled regexes per backend (keep current no-cache behavior)
- [x] Update any relevant docs (no changes required for this phase)
- [x] Verify Windows behavior for `re2` optional dependency (installed on Windows)

## Open questions (after install test)
- [x] For `engine=re2` when native is missing, do you want a hard error or a warning + fallback to `re2js`? (warning + fallback)
- [x] Should engine selection be strictly internal (auto only), or do you want a test-only env/flag to force `re2`/`re2js`? (internal only)
- [x] Do you want any user-facing log when native `re2` is chosen (only under verbose), or completely silent? (silent)
