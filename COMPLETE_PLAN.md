# Complete Plan

This document consolidates all phase docs and tracks implementation status. Phase markdown files are removed after merge; this is the single source of truth.
Completed phases live in `COMPLETED_PHASES.md` at the repo root. When a phase is marked done, move it there; that file is long, so scan in small chunks or append new completed phases to the end.

## Status key
- done: implemented and validated
- partial: implemented with known gaps or follow-ups
- todo: not implemented
- in-progress: actively being implemented


## Deferred / Do Not Surface (status: deferred)
- [ ] Evaluate FTS5 vs BM25 parity on larger benchmarks and retune weights.     
  - Do not prioritize or bring this up unless explicitly requested.


## Phase 75: Deps Fixes - Language Tooling Alignment (status: done)
Implemented; details moved to `COMPLETED_PHASES.md`.


## Phase 76: Deps Fixes - Tree-sitter Backbone (status: done)
Implemented; details moved to `COMPLETED_PHASES.md`.


## Phase 77: Deps Fixes - Dependency Hygiene (status: done)
Goal: Remove unused packages and consolidate redundant parsing stacks.
Work items:
- [ ] Audit usage of `minhash` (npm), `varint`, `seedrandom`, `yaml`, `strip-comments`; remove if unused.
- [ ] Consolidate JS parsing dependencies (prefer Babel) and remove redundant `acorn`/`esprima` paths if safe.
- [ ] Update `package.json`, lockfile, and docs to reflect dependency removals.
- [ ] Add a small dependency audit test to ensure removed packages are not referenced.


## Phase 78: Deps Fixes - Correctness and Spec Mismatches (status: done)
Goal: Resolve correctness bugs and spec mismatches highlighted in deps_fixes.md.
Work items:
- [ ] Remove dead `posts` computation in `src/indexer/build/postings.js`; add a test asserting no unused allocations.
- [ ] Either implement a real `maxVocab` cap or remove the trimmed-vocab path to avoid misleading behavior.
- [ ] Decide whether to use `dense_vectors_doc_uint8.json`/`dense_vectors_code_uint8.json`; wire into ranking or stop writing/loading them.
- [ ] Fix dense vector `scale` metadata to match quantization step size (or remove field).
- [ ] Skip `scanImports()` for prose mode and add a regression test ensuring no import scan runs.
- [ ] Fix per-chunk relation duplication by separating file-level vs chunk-level relations (avoid copying full file relations into every chunk).
- [ ] Rework `buildChunkRelations` to avoid O(chunks * calls) scanning (pre-index call maps per file).
- [ ] Validate `git blame` line range off-by-one when chunk end offsets are exclusive; adjust `endLine` calculation as needed and add tests.
- [ ] Clarify and document `importLinks` semantics; add tests that verify intended behavior.
- [ ] Review ESLint API usage (`useEslintrc` options) and update for current ESLint version with a fallback warning.


## Phase 80: Deps Fixes - Performance Refactors (status: done)
Implemented; details moved to `COMPLETED_PHASES.md`.

## Phase 82: Deps Fixes - Search Prefilter (status: done)
Implemented; details moved to `COMPLETED_PHASES.md`.

## Phase 83: Deps Fixes - Query Filters + Symbol Boosts (status: done)
Implemented; details moved to `COMPLETED_PHASES.md`.


## Todo Phase Detail + Questions (status: active)
Goal: Add implementation detail for remaining todo phases and capture any open decisions.
