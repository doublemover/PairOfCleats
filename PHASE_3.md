# Phase 3 Plan — Correctness Endgame (imports • signatures • watch • build state)

Intent: complete Phase 3 with correctness-first sequencing. Parts 1–3 are core correctness work; Part 4 consolidates E/F and all P2 follow-ons. Any new behavior must ship with an initial doc/spec.

Notes:
- 2026-01-24: Import collectors now receive `root` + `filePath` via `collectLanguageImports` (options flattened, root/filePath injected).
- 2026-01-24: Cached bundle reuse now requires `fileRelations`; missing relations skip reuse instead of sampling a chunk.
- 2026-01-24: Import Resolution Graph wired via `src/index/build/import-resolution.js`, writing `artifacts/import_resolution_graph.json` by default (test-only override `PAIROFCLEATS_IMPORT_GRAPH=0`).
- 2026-01-24: Signature hashing now uses `stableStringifyForSignature` + canonicalization with `SIGNATURE_VERSION=2`; runtime config hash no longer JSON-stringifies away regex flags.
- 2026-01-24: Incremental manifests now carry `signatureSummary`; reuse skips log top-level delta keys when signatures diverge (verbose cache only).
- 2026-01-24: Watch rebuilds now use attempt roots + promotion barrier + lock backoff; retention cleanup only after success (internal defaults); delta-aware discovery enforces guardrails on add/change events.
- 2026-01-24: Removed remaining `allImports` callsites in tests; import scan assertions now use `importsByFile`.
- 2026-01-24: Build state now writes schemaVersion/currentPhase with queued updates; watch/builds record ignore warnings + per-mode signature/count diagnostics.
- 2026-01-24: analysisPolicy now gates metadata/risk/git/type inference paths (runtime policy propagated into file processing + signatures).
- 2026-01-24: Metadata v2 + risk rules schemas consolidated in `src/contracts/schemas/analysis.js`; `chunk_meta` and `index_state` now validate against them, with serialized `riskRules` persisted in `index_state.json`.
- 2026-01-24: Risk analysis switched to a single-pass scan with prefiltering; maxBytes/maxLines now short-circuit and SafeRegex failures are treated as no-match.
- 2026-01-24: Markdown segmentation now uses a single micromark traversal for fenced blocks + inline spans.
- 2026-01-24: Tooling providers now reuse a shared fileText cache to avoid duplicate reads across type inference and diagnostics.
- 2026-01-24: Signature parsers hardened for function pointers + Python typing prefixes; added tests for LSP CRLF/surrogate offsets and risk-rule edge cases.
- 2026-01-24: Added tests for import cache reads, signature multi-mode stability, watch attempt retention/backoff, ignore path safety, records discovery, build_state merge, promotion safety, analysisPolicy gating, and embedding queue payloads.
- 2026-01-24: Embedding queue entries now persist build identity fields (buildId/buildRoot/indexRoot) for unambiguous worker targeting.
- 2026-01-24: Optional import-scan I/O reuse enabled via bounded fileText cache (pre-scan stores buffers for processing reuse).
- 2026-01-24: Added analysisPolicy schema validation + test; import scan now optionally caches text/buffers for processing reuse via fileText cache.
- 2026-01-24: Watch now supports abortSignal/handleSignals + injectable deps for tests; added watch promotion/atomicity/shutdown tests.

## Part 1 — Import fidelity and resolution

### Objective

Eliminate the remaining high-impact correctness and operator-safety gaps before broader optimization work: (a) import extraction must be accurate (dynamic imports, TS aliases) and produce a **true dependency graph** (not co-import similarity), (b) incremental reuse must be **provably safe** via complete, deterministic signatures, (c) watch mode must be **stable, bounded, and atomic** (no build-root reuse; promotion only after success), and (d) `build_state.json` / `current.json` must be **concurrency-safe, validated, and debuggable**, so partial/incorrect builds cannot become “current” and failures are diagnosable.

---

### 3.1 Fix dynamic import scanning, TS alias handling, and module boundary fidelity

- [x] Fix the language registry wrapper bug that nests `options` incorrectly when calling `collectImports` (so per-language import collectors actually receive `text`, `options`, `filePath`, `root` as intended).
  - Primary touchpoints:
    - `src/index/language-registry/registry.js`
  - Notes:
    - Confirm that language-specific collectors that depend on `options` (e.g., WASM/parser options) behave correctly after this fix.
- [x] Make JS/TS fast-path import extraction resilient: always run the `require(...)` regex fallback even when `es-module-lexer` parsing fails (so syntax errors don’t suppress require detection).
  - Primary touchpoints:
    - `src/index/build/imports.js` (`collectModuleImportsFast`)
  - Notes:
    - Keep dynamic `import('...')` extraction when possible (string literal cases), but do not regress the “fast path” on large repositories.
- [x] Replace “co-import graph” behavior with true dependency resolution for `importLinks`, so the import graph represents **importer → imported target** for in-repo files (and not “files that share a module string”).
  - Primary touchpoints:
    - `src/index/build/imports.js` (import scanning + link construction)
    - `src/index/build/graphs.js` (consumer expectations for `ImportGraph`)
    - `src/index/build/file-processor/cached-bundle.js` (preserve/reconstruct relations during reuse)
  - Implementation details:
    - For each file, resolve raw import specifiers to repo-local file targets where possible:
      - Relative specifiers (`./`, `../`): resolve against importer directory; apply extension and `index.*` resolution consistently across JS/TS.
      - TypeScript path aliases: read `tsconfig.json` (`baseUrl`, `paths`) and resolve alias patterns deterministically; if multiple matches, apply a deterministic tie-break (e.g., shortest path, then lexicographic).
      - External specifiers (packages): do **not** map into `ImportGraph` file nodes; keep as raw import metadata (for later features) without corrupting the file-to-file graph.
    - Normalize resolved targets (posix separators, no `..` segments, ensure within repo root).
- [x] Spec integration: Import Resolution Graph (IRG) — implement as the **single source of truth** for dependency edges
  - [x] Define an `ImportResolutionGraph` in-memory model (serializable for debug output) with:
    - Nodes:
      - internal file node id: `file:<relPosixPath>`
      - external module node id: `ext:<rawSpecifier>` (kept out of file-to-file edges)
    - Directed edges (importer → resolved target) with per-edge metadata:
      - `rawSpecifier`
      - `kind: 'import' | 'require' | 'dynamic_import' | 'reexport'`
      - `resolvedType: 'relative' | 'ts-path' | 'external' | 'unresolved'`
      - `resolvedPath` (internal only; repo-relative posix)
      - `packageName` (external only; best-effort)
      - `tsconfigPath` / `tsPathPattern` (ts-path only; for explainability)
    - Graph-level metadata (bounded + stable):
      - `generatedAt`, `toolVersion`, `importScanMode`, `warnings[]` (bounded), `stats`
  - [x] Implement a deterministic resolver `resolveImportLinks({ root, importsByFile, languageOptions, mode })`:
    - [x] Input: `importsByFile[importerRelPath] = string[]` of raw specifiers (deduped + sorted)
    - [x] Output (per file):
      - `fileRelations.imports` = raw specifiers (sorted unique)
      - `fileRelations.importLinks` = resolved **internal** targets (sorted unique, importer → target)
      - `fileRelations.externalImports` = raw external specifiers (sorted unique; optional but recommended)
    - [x] Resolution rules (contract):
      - Relative (`./`, `../`): Node-like file + extension + `index.*` resolution; normalize to posix and ensure within repo.
      - TS path aliases: load nearest applicable `tsconfig.json` (`baseUrl`, `paths`, `extends`) and resolve with a deterministic tie-break:
        1) fewest wildcard expansions,
        2) shortest resolved path,
        3) lexicographic on normalized path.
      - External specifiers: never map into `ImportGraph` file nodes; keep as `externalImports`.
      - Unresolved: do not emit `importLinks` edges; optionally record a bounded warning with `importer`, `rawSpecifier`, `reason`.
  - [x] Make the pipeline use IRG outputs consistently (eliminate the co-import adjacency behavior):
    - [x] Update `scanImports()` to return `importsByFile` (raw specifiers per importer) in addition to any aggregate stats.
    - [x] Refactor language relation builders to stop synthesizing `importLinks` from `allImports`:
      - `src/lang/javascript/relations.js` (remove `importLinks = imports.map(i => allImports[i])...`)
      - `src/index/language-registry/registry.js` (TypeScript `importsOnly` path)
    - [x] Ensure `src/index/build/graphs.js` uses `fileRelations.importLinks` as true dependency edges (importer → imported target).
    - [x] Ensure cached-bundle reuse preserves `imports` and `importLinks` exactly as persisted (no reconstruction from `allImports`).
  - [x] (Optional but recommended) Add a debug artifact behind a flag:
    - `artifacts/import_resolution_graph.json` (or `.jsonl`), capped/sampled to avoid huge outputs.
  - [x] Docs: add `docs/phase-3-import-resolution-spec.md` (IRG model, resolution rules, debug artifact default-on + disable control) and update `docs/import-links.md`.
- [x] Remove redundant cached-import reads and ensure cached import lookup is performed at most once per file per scan (avoid “read twice on miss” behavior).
  - Primary touchpoints:
    - `src/index/build/imports.js` (`scanImports`)
  - Implementation details:
    - When preloading cached imports for sort-by-import-count, store an explicit “miss” sentinel so the later per-file pass does not call `readCachedImports()` again for the same file.
    - Keep the “import-heavy first” ordering, but make it deterministic and not dependent on incidental Map iteration order.
- [x] Fix cached-bundle relation reconstruction correctness: do not rebuild bundle-level fileRelations by sampling a single chunk; enforce presence of the canonical relation data (or treat the bundle as invalid for reuse).
  - Primary touchpoints:
    - `src/index/build/file-processor/cached-bundle.js`
  - Implementation details:
    - If bundle-level fileRelations are missing, either:
      - Skip reuse (prefer correctness), or
      - Recompute by aggregating all chunk-level relations deterministically (only if performance impact is acceptable for this phase).
- [x] Fix cached-bundle hash metadata: do not hardcode `hashAlgo: 'sha1'`; preserve the actual hash algorithm used to compute the stored hash.
  - Primary touchpoints:
    - `src/index/build/file-processor/cached-bundle.js`
- [x] (Optional; may defer) Reduce import-scan I/O by avoiding duplicate file reads when the pipeline already has the file contents in memory.
  - Primary touchpoints:
    - `src/index/build/imports.js`
    - `src/index/build/indexer/steps/process-files.js` (if a “pass-through text” optimization is introduced)

#### Tests

- [x] Unit test: language registry passes `options` correctly to a test language’s `collectImports` (regression for wrapper nesting bug).
- [x] Import extraction regression tests:
  - [x] A JS file with a deliberate parse error still yields `require('x')` imports via regex fallback.
  - [x] A file with `import('x')` (string literal) is captured where supported by lexer.
- [x] Import graph fidelity tests:
  - [x] Two different files importing `./utils` in different directories do **not** link to each other; they each link to their own resolved `utils` target.
  - [x] A TS alias import resolves using `tsconfig` `paths` and produces a stable file-to-file edge.
- [x] Cached bundle reuse tests:
  - [x] If bundle-level fileRelations are missing, reuse is skipped (or recomputed correctly across all chunks, depending on chosen design).
  - [x] The stored `hashAlgo` matches the configured file hash algorithm (not hardcoded).
- [x] Efficiency test (unit-level): `readCachedImports()` is called ≤ 1 time per file per scan in the cache-miss case.
- [x] Import resolution determinism tests:
  - [x] Same repo + config produces identical `importLinks` ordering and identical edge sets across two runs.
  - [x] TS config caching behaves correctly: modifying `tsconfig.json` invalidates alias resolution; unchanged tsconfig reuses cached patterns.
- [x] External import isolation test:
  - [x] `import react from 'react'` does not create a file-to-file edge in `ImportGraph`, but is preserved as an external import (if `externalImports` is enabled).

---

## Part 2 — Signature determinism and reuse gating

### 3.2 Repair incremental cache signature correctness and reuse gating

- [x] Make signature payload hashing deterministic: replace `sha1(JSON.stringify(payload))` with `sha1(stableStringify(payload))` (or equivalent stable serializer) for both tokenization and incremental signatures.
  - Primary touchpoints:
    - `src/index/build/indexer/signatures.js`
    - `src/shared/stable-json.js` (serializer)
  - Notes:
    - This is a correctness change (reproducibility + “explainability” of reuse), even if it increases invalidations.

- [x] Spec integration: Signature canonicalization utilities + version bump (make hashing reproducible and explainable)
  - [x] Add a canonicalizer used **only** for signature-bearing hashes:
    - Implement `canonicalizeForSignature(value)` to convert non-JSON / order-unstable values into stable JSON-friendly forms:
      - `RegExp` → `{ __type: 'regexp', source, flags }`
      - `Set` → sorted array (or `{ __type: 'set', values: [...] }`)
      - `Map` → sorted `[key,value]` tuples (keys stringified deterministically)
      - `BigInt` → `{ __type: 'bigint', value: '<decimal>' }`
      - `undefined` → omitted consistently (or `{ __type: 'undefined' }` if omission is not acceptable; pick one policy and enforce)
    - Implement `stableStringifyForSignature(obj)`:
      - stable key ordering for all plain objects
      - stable ordering only where semantics are “set-like”; otherwise preserve order
      - no lossy dropping of canonicalized sentinel objects
  - [x] Refactor all signature-bearing hash sites to use the canonicalizer (ban raw `JSON.stringify` in these paths):
    - `src/index/build/indexer/signatures.js` (tokenization + incremental signature)
    - `src/index/build/runtime/hash.js` (config hash normalization)
  - [x] Bump and persist `signatureVersion` (recommend `2`) and treat mismatches as **no reuse**:
    - record in incremental manifests
    - record in `build_state.json` diagnostics
  - [x] Reuse explainability:
    - Implement a bounded “top-level delta” diff helper that reports the top N differing keys without dumping entire configs.
- [x] Docs: add `docs/phase-3-signature-spec.md` (canonicalization rules, signatureVersion, reuse gating, diagnostics) and update `docs/sqlite-incremental-updates.md` as needed.
- [x] Include regex flags (not just `.source`) for signature-bearing regex configuration (e.g., `licensePattern`, `generatedPattern`, `linterPattern`).
  - Primary touchpoints:
    - `src/index/build/indexer/signatures.js`
  - Implementation detail:
    - Canonicalize regex as `{ source, flags }` (not a raw `RegExp` object) before hashing.
- [x] Eliminate hidden signature weakening caused by JSON normalization that drops non-JSON values (e.g., `RegExp` objects) during config hashing. (Static Review: runtime/hash normalization)
  - Primary touchpoints:
    - `src/index/build/runtime/hash.js`
    - `src/index/build/indexer/signatures.js`
  - Notes:
    - Ensure any config structures that can contain regex or other non-JSON objects are serialized explicitly and deterministically before hashing.
- [x] Stop mutating shared runtime config during a multi-mode build: compute adaptive dict config as a per-run/per-mode derived value instead of overwriting `runtime.dictConfig`. (Static Review B3f60a5bb44d` notes)
  - Primary touchpoints:
    - `src/index/build/indexer/pipeline.js`
    - `src/index/build/indexer/signatures.js` (ensure signatures use the _effective_ dict config)
  - Notes:
    - This prevents cross-mode coupling (e.g., `code` mode discovery affecting `prose` mode tokenizationKey).
- [x] Add explicit signature versioning / migration behavior so that changing signature semantics does not silently reuse prior manifests.
  - Primary touchpoints:
    - `src/index/build/indexer/signatures.js`
    - `src/index/build/incremental.js` (manifest/state format markers)
  - Notes:
    - Bump a `signatureVersion` or `bundleFormat`/manifest marker and treat mismatches as “do not reuse.”

- [x] Add an “explain reuse decision” diagnostic path for incremental reuse failures (safe-by-default; useful in CI and field debugging).
  - Primary touchpoints:
    - `src/index/build/indexer/steps/incremental.js`
    - `src/index/build/indexer/signatures.js`
  - Notes:
    - Keep logs bounded (do not print entire configs by default); prefer “top N differing keys” summary.

#### Tests

- [x] Unit test: two regexes with identical `.source` but different `.flags` produce different tokenization keys.
- [x] Unit test: two payload objects with identical semantics but different key insertion order produce identical signature hashes (stable stringify).
- [x] Integration test: multi-mode run (`code` then `prose`) yields the same `prose` signature regardless of `code` file counts (no adaptive dict mutation bleed-through).
- [x] Integration test: signatureVersion mismatch causes reuse to be rejected (forced rebuild).
- [x] Unit test: canonicalization does not throw on unsupported-but-possible config values (e.g., `BigInt`, `Set`, `Map`) and produces stable output.
- [x] Unit test: canonicalization policy for `undefined` is deterministic (either consistently omitted or consistently encoded).

---

## Part 3 — Watch stability and build-state integrity

### 3.3 Resolve watch mode instability and ensure build root lifecycle correctness

- [x] Make watch builds atomic and promotable: each rebuild writes to a new attempt root (or A/B inactive root), validates, then promotes via `current.json`—never reusing the same buildRoot for successive rebuilds. also addresses race class: `9ed923dfae`)
  - Primary touchpoints:
    - `src/index/build/watch.js`
    - `src/index/build/promotion.js`
    - `src/index/build/runtime/runtime.js` (support “override buildRoot/buildId” or “derive attempt root”)
  - Notes:
    - Promotion must occur only after build success + validation; on failure, current stays unchanged.
    - Decide and document cleanup policy for old attempt roots (time-based, count-based, or explicit `--watch-keep-builds=N`).
- [x] Spec integration: Watch Atomic Builds (attempt roots + promotion barrier + retention)
  - [x] Introduce an attempt manager (new helper module recommended: `src/index/build/watch/attempts.js`):
    - Derive a stable `watchSessionId` per watch invocation (timestamp + random suffix).
    - Maintain a monotonic `attemptNumber` and compute:
      - `attemptBuildId = <watchSessionId>-<attemptNumber>`
      - `attemptRoot = <repoCacheRoot>/builds/attempts/<attemptBuildId>/`
    - Ensure attempt roots are never reused (even after failure).
  - [x] Promotion barrier contract (fail-closed):
    - Build artifacts into `attemptRoot`.
    - Run validation against `attemptRoot` outputs (enough to catch partial/incomplete builds).
    - Only then call `promoteBuild(...)` to update `current.json`.
    - On failure: do **not** promote; optionally mark the attempt build_state as failed and keep it for debugging.
  - [x] Retention policy (implement + document; safe defaults):
    - Keep last N successful attempts (default: 2).
    - Keep last M failed attempts (default: 1) for debugging.
    - Delete older attempts best-effort after a successful promotion (never during an active attempt).
  - [x] Lock backoff policy:
    - Exponential backoff with jitter (e.g., 50ms → 2s) and a hard max delay.
    - Log at bounded frequency (first retry, then every ~5s) to avoid spam.
  - [x] Docs: add `docs/phase-3-watch-atomicity-spec.md` (attempt roots, promotion barrier, retention defaults, backoff).
- [x] Implement delta-aware discovery in watch: maintain `trackedEntriesByMode` from an initial full scan, update on FS events, and pass the tracked entries into the pipeline—avoiding repeated whole-repo discovery each rebuild.
  - Primary touchpoints:
    - `src/index/build/watch.js`
    - `src/index/build/discover.js` (if helper extraction needed)
  - Notes:
    - Include periodic “reconcile scan” to heal missed watcher events (especially on platforms with lossy FS event delivery).
- [x] Enforce watch bounds: `maxFiles` and `maxFileBytes` must apply not just to the initial scan, but also to subsequent add/change events.
  - Primary touchpoints:
    - `src/index/build/watch.js`
  - Notes:
    - Behavior when cap would be exceeded must be explicit (ignore + warn, or evict deterministically, or require reconcile).
- [x] Add lock acquisition backoff to prevent tight retry loops when another build holds the lock.
  - Primary touchpoints:
    - `src/index/build/watch.js`
    - `src/index/build/lock.js` (optional helper: backoff strategy / jitter)
- [x] Fix watch shutdown crash by guarding scheduler access during initialization and ensuring shutdown is safe at any point in startup.
  - Primary touchpoints:
    - `src/index/build/watch.js`
- [x] Fix `waitForStableFile()` semantics so it returns `false` if stability is not observed within the configured check window (i.e., do not proceed “as if stable” when it never stabilized).
  - Primary touchpoints:
    - `src/index/build/watch.js`
- [x] Ensure runtime contains `recordsDir` and `recordsConfig` so watch/discovery can correctly handle record file behavior (and not silently disable records-aware logic).
  - Primary touchpoints:
    - `src/index/build/runtime/runtime.js`
    - `src/index/build/indexer/steps/discover.js`
    - `src/index/build/watch.js`
- [x] Fix Parcel watcher backend ignore behavior to avoid directory misclassification when `fs.Stats` is absent (and prevent incorrect inclusion/exclusion). (Static Review note)
  - Primary touchpoints:
    - `src/index/build/watch/backends/parcel.js`
- [x] Prevent watch from mutating shared runtime fields (`runtime.incrementalEnabled`, `runtime.argv.incremental`); clone runtime per attempt/build loop (runtime is immutable once constructed). (Static Review 9235afd3e9` notes)
  - Primary touchpoints:
    - `src/index/build/watch.js`
- [x] Harden ignore file handling used by watch and builds: validate ignore file paths stay within repo root (or require explicit opt-in for absolute paths), and make ignore load failures visible (warn + recorded in state). (Static Review C1
  - Primary touchpoints:
    - `src/index/build/ignore.js`
    - `src/index/build/watch.js` (propagate/report ignore load status)

#### Tests

- [x] Watch E2E promotion test:
  - [x] Start watch, modify a file, assert a new build root is created and `current.json` is updated only after successful completion.
- [x] Watch atomicity test:
  - [x] Force a controlled failure during rebuild; assert `current.json` remains pointing to the previous build root.
- [x] Lock backoff test:
  - [x] Hold lock; start watch; assert retries are spaced (no tight loop) and logs show backoff.
- [x] Shutdown tests:
  - [x] SIGINT during early startup does not throw (scheduler guard).
  - [x] SIGINT during an active build stops cleanly and releases lock.
- [x] `waitForStableFile` unit test:
  - [x] File rewritten repeatedly during check window returns `false`.
- [x] Records-aware discovery test:
  - [x] With recordsDir configured, record files are handled per expectations (excluded from code/prose, or routed appropriately).
- [x] Ignore path safety test:
  - [x] `ignoreFiles: ['../outside']` is rejected (or requires explicit opt-in) and is visible in logs/state. (Static Review C1

---

### 3.4 Enforce build-state integrity and debugging friendliness

- [x] Make `build_state.json` updates concurrency-safe: prevent clobbering between heartbeat ticks and phase/progress updates via a per-buildRoot write queue or file lock.
  - Primary touchpoints:
    - `src/index/build/build-state.js`
  - Notes:
    - “Last write wins” must not erase phase/progress updates; merging must be correct under concurrent callers.
  - Docs: add `docs/phase-3-build-state-integrity-spec.md` (schema + writer queue + promotion validation expectations).
- [x] Implementation detail (recommended; keeps callers simple and safe):
  - [x] Implement `createBuildStateWriter(buildRoot)` that serializes updates through a single note-taking queue:
    - `enqueue(patch)` performs: read → deep-merge → validate → atomic write
    - deep-merge at least: `phases`, `progress`, `heartbeat` (and any future nested sections)
    - coalesce heartbeat writes (e.g., at most 1 write per 5s) to reduce IO churn
    - never swallow write failures silently; record a bounded error in memory + (optionally) in state
  - [x] Add `schemaVersion` and `signatureVersion` to `build_state.json` and require them on read/validate.
- [x] Remove or formalize the ambiguous top-level `phase` field (replace with `currentPhase` / `activePhase` and document schema).
  - Primary touchpoints:
    - `src/index/build/build-state.js`
- [x] Enrich `build_state.json` with the minimum diagnostics needed for field debugging:
  - buildId, buildRoot, stage/mode, startedAt/finishedAt, counts (files, chunks), and signature identifiers (tokenizationKey/cacheSignature/signatureVersion) to explain reuse/promote decisions.
  - Primary touchpoints:
    - `src/index/build/build-state.js`
    - `src/integrations/core/index.js` (or other orchestration entrypoints that own phase transitions)
- [x] Harden `current.json` promotion/read path safety and validation: promotion must reject build roots outside the intended cache root, and readers must fail closed on unsafe/invalid roots. `fde9568d49`; race class: `9ed923dfae`)
  - Primary touchpoints:
    - `src/index/build/promotion.js`
    - `tools/dict-utils.js` (current build resolution)
  - Notes:
    - Validate resolved root is within the repo cache root (or within `repoCacheRoot/builds`), not just “some path string.”
    - If deeper schema overhaul (stage-vs-mode separation) is owned by **Phase 2**, implement the safety validation now and explicitly defer schema redesign to **Phase 2 — Contracts & Policy Kernel** (named follow-on).
- [x] Make embedding enqueue clearly best-effort (when configured as optional), and include unambiguous index identity in job payload (buildId + mode + output directory) so background workers cannot target the wrong build. (Static Review
  - Primary touchpoints:
    - `src/index/build/indexer/embedding-queue.js`
    - `tools/build-embeddings.js` (or embedding worker entrypoint consuming payload)
  - Notes:
    - If job payload changes require worker updates that are too broad for this phase, implement payload additions now and defer worker consumption hardening to a named follow-on (e.g., **Phase 6 — Service Hardening**).

#### Tests

- [x] Concurrency test: simulate concurrent `build_state.json` updates (heartbeat + phase update) and assert no loss of fields.
- [x] Schema test: `build_state.json` no longer writes ambiguous top-level `phase`; uses documented `currentPhase` field instead.
- [x] Promotion safety tests:
  - [x] Promotion rejects build roots outside cache root with a clear error.
  - [x] Reader rejects unsafe `current.json` roots and falls back safely (fail closed) rather than using arbitrary filesystem paths.
- [x] Embedding enqueue tests:
  - [x] Enqueue failure logs warning and does not fail the build when configured as optional.
  - [x] Enqueued job payload contains build identity fields and is stable across runs.

---

## Part 4 — E/F/P2 follow-ons (performance/refactor/deferred)

Note: Part 4 items are intentionally sequenced after Parts 1–3. They remain Phase 3 scope but are deferred until the core correctness work is stable.

### E) Performance improvements to prioritize (cross-cutting)

#### E.1 Risk analysis hot path (P1)

- [x] Implement a single-pass scanner that evaluates sources/sinks/sanitizers in one traversal with deterministic ordering.
  - Primary touchpoints:
    - `src/index/risk.js`
    - `src/index/risk-rules.js`
    - `src/index/build/file-processor/process-chunks.js`
  - Implementation details:
    - Apply a cheap prefilter (substring/charclass) before SafeRegex evaluation.
    - Enforce early return on caps (`maxBytes`, `maxLines`) so large files short-circuit.
    - Guard SafeRegex exceptions and treat them as no-match, not fatal.
  - Docs:
    - Update `docs/risk-rules.md` to reflect cap behavior and early-exit semantics.
  - Tests:
    - Add a caps test to assert early exit yields `analysisStatus.capped`.
    - Add a long-line regression test to ensure no crash.
    - Add determinism test to confirm stable ordering of emitted matches.

#### E.2 Markdown segmentation duplication (P2)

- [x] Consolidate markdown segmentation into a single micromark traversal (avoid double parse).
  - Primary touchpoints:
    - `src/index/segments/markdown.js`
    - `src/index/segments/frontmatter.js`
    - `src/index/segments.js`
  - Implementation details:
    - Preserve frontmatter detection and inline code span behavior.
    - Ensure fenced blocks and inline spans are captured in one pass.
  - Docs:
    - Add `docs/phase-3-segmentation-perf-spec.md` (single-pass markdown segmentation contract).
  - Tests:
    - Add a regression fixture for frontmatter + fenced code + inline spans.
    - Verify `segment-pipeline` outputs are unchanged for Markdown.

#### E.3 Tooling providers I/O duplication (P2)

- [x] Avoid duplicate file reads by passing file content into providers when already loaded.
  - Primary touchpoints:
    - `src/index/tooling/clangd-provider.js`
    - `src/index/tooling/pyright-provider.js`
    - `src/index/tooling/sourcekit-provider.js`
    - `src/index/type-inference-crossfile/tooling.js`
  - Implementation details:
    - Extend provider request shape to accept `text` where available.
    - Fall back to disk reads only when `text` is absent.
  - Docs:
    - Add `docs/phase-3-tooling-io-spec.md` (provider text reuse contract and fallback behavior).
  - Tests:
    - Add a provider unit/integration test that asserts no extra reads when `text` is supplied (stub `fs.readFile`).

---

### F) Refactoring goals (maintainability / policy centralization)

- [x] Consolidate analysis feature toggles into a single `analysisPolicy` object that is passed to:
  - metadata v2 builder
  - risk analysis
  - git analysis
  - type inference (local + cross-file + tooling)
- [x] Centralize schema versioning and validation:
  - one metadata v2 schema
  - one risk rule bundle schema
  - one place that validates both as part of artifact validation
- [x] Docs: add `docs/phase-3-analysis-policy-spec.md` (analysisPolicy shape, defaults, propagation, and gating).
  - Primary touchpoints:
    - `src/index/build/runtime/runtime.js`
    - `src/index/metadata-v2.js`
    - `src/index/risk.js`
    - `src/index/git.js`
    - `src/index/type-inference-crossfile/tooling.js`
    - `src/index/validate.js`
  - Tests:
    - [x] Add a policy-gating test that disables each section and asserts no output is emitted.
    - [x] Add a schema validation test that rejects invalid policy values.

---

### P2 appendix (quality, maintainability, test depth)

- [x] Improve signature parsing robustness for complex types (C-like, Python, Swift).
  - Primary touchpoints:
    - `src/index/tooling/signature-parse/clike.js`
    - `src/index/tooling/signature-parse/python.js`
    - `src/index/tooling/signature-parse/swift.js`
  - Tests:
    - Add fixtures for templates, function pointers, and Python `*args/**kwargs`.
- [x] Clarify and standardize naming conventions (chunk naming vs provider symbol naming, `generatedBy`, `embedded` semantics).
  - Primary touchpoints:
    - `src/index/metadata-v2.js`
    - `docs/metadata-schema-v2.md`
    - `src/index/type-inference-crossfile/tooling.js`
  - Tests:
    - Add a class-method mapping fixture to ensure tooling names attach to chunks.
- [x] Expand tests to cover surrogate pairs (emoji), CRLF offsets, and risk rules/config edge cases.
  - Primary touchpoints:
    - `src/integrations/tooling/lsp/positions.js`
    - `tests/metadata-v2.js`
    - `docs/risk-rules.md`
  - Tests:
    - Add emoji + CRLF offset tests for LSP mapping.
    - Add risk rules edge-case tests (invalid patterns, caps, requires/excludes).

---
