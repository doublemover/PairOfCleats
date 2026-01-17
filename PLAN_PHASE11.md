# Phase 11 Plan - Extracted-Prose + Records Parity

## Goals
- Make extracted-prose and records full first-class modes across build, search, stats, and tooling.
- Ensure comments live only in extracted-prose (code references them), with a default join for display.
- Ensure records are detected anywhere and excluded from other modes.

## Worktree
- Path: worktrees/phase-11-where-comments-go-to-die
- Branch: phase11-parity

## Plan

### 1) Discovery + mode semantics inventory
- [x] Audit mode enumeration call sites in build/runtime/tools/tests.
- [x] Confirm current indexing contract in docs/contracts/indexing.md and note gaps.
- [x] Identify all spots where code/prose are assumed as the only modes.
- [x] Add getRepoRoot helper to standardize repo root resolution in core/cli/validate.

### 2) Mode orchestration parity
- [x] Ensure args/mode expansion includes records for --mode all.
- [x] Ensure build orchestration uses the same mode list everywhere (core/index.js and parseBuildArgs).
- [x] Ensure embeddings stage includes extracted-prose and honors mode list.
- [x] Extend build-index-all tests to assert records.

### 3) Extracted-prose strictness
- [x] Enforce extracted-prose only emits extracted segments; no full-file fallback.
- [x] Ensure prose files with no comment segments produce zero extracted-prose chunks.
- [x] Add tests for markdown with and without HTML comments.

### 4) Comments: store once, join on retrieval
- [x] Remove comment tokenization from code chunks; store references only.
- [x] Store comment text in extracted-prose chunk meta.
- [x] Add default join to include comment excerpts in code results.
- [x] Add --no-comments flag to disable join.
- [x] Add tests for code search (no comment-only matches) and extracted-prose search (comment matches).

### 5) Records detection + exclusion
- [x] Add records classifier (extensions, paths, light content sniff).
- [x] Add config overrides (records.detect/includeGlobs/excludeGlobs).
- [x] Exclude records from code/prose/extracted-prose discovery.
- [x] Add tests for records in arbitrary subdir and non-duplication.

### 6) Mode parity for tooling and stats
- [x] Update tooling/validators to include extracted-prose + records (or explicitly state unsupported).
- [x] Update stats output in retrieval CLI to include extracted-prose + records.
- [x] Normalize mode ordering everywhere (code, prose, extracted-prose, records).
- [x] Add smoke test covering build summary and stats output.

### 7) Rust/prose isolation
- [x] Add discovery test to ensure .rs files are never in prose.
- [x] Add integration test for prose build on repo with .rs files.

### 8) Critical dependency references
- [x] Define critical dependency set and add CI-friendly check for docs.
- [x] Add stub docs for missing deps.

### 9) Validate + finish
- [x] Run targeted tests for new coverage.
- [x] Update NEW_ROADMAP.md (check off tasks) and append Phase 11 to COMPLETED_PHASES.md when done.
- [x] Format, commit, and push.

## Test Plan (initial)
- npm run format
- node tests/build-index-all.js (if updated)
- node tests/shard-progress-determinism.js (already in repo, optional)
- Add new tests per sections above and run them directly
- npm run test:unit (if time)
