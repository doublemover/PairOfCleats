# PairOfCleats GigaRoadmap

## Status legend

Checkboxes represent the state of the work, update them to reflect the state of work as its being done:

- [x] Implemented and appears complete/correct based on code inspection and existing test coverage
- [@] In Progress, this work has been started
- [.] Work has been completed but has Not been tested
- [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
- [ ] Not complete 

Completed Phases: `COMPLETED_PHASES.md`

## Roadmap order (stability/performance frontloaded)

1.  Phase 14 — Documentation and Configuration Hardening
2.  Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)
3.  Phase 20 — Threadpool-aware I/O scheduling guardrails
5.  Phase 23 — Index analysis features (metadata/risk/git/type-inference)
6.  Phase 24 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)
7.  Phase 25 — Massive functionality boost: PDF + DOCX ingestion (prose mode)
8.  Phase 28 — Distribution Readiness (Package Control + Cross-Platform)
9.  Phase 29 — Optional: Service-Mode Integration for Sublime (API-backed Workflows)

---

## Phase 14 — Documentation and Configuration Hardening

1. **Document security posture and safe defaults**
   * [ ] Document:
     * API server host binding risks (`--host 0.0.0.0`)
     * CORS policy and how to configure allowed origins
     * Auth token configuration (if implemented)
     * RepoPath allowlist behavior
   * [ ] Add a prominent note: indexing untrusted repos and symlinks policy.

2. **Add configuration schema coverage for new settings**
   * [ ] If adding config keys (CORS/auth/cache TTL), ensure they are:
     * Reflected in whatever config docs you maintain
     * Validated consistently (even if validation is lightweight)

---

## Phase 19 — LibUV threadpool utilization (explicit control + docs + tests)

  **Objective:** Make libuv threadpool sizing an explicit, validated, and observable runtime control so PairOfCleats I/O concurrency scales predictably across platforms and workloads.

  ### 19.1 Audit: identify libuv-threadpool-bound hot paths and mismatch points

  * [ ] Audit all high-volume async filesystem call sites (these ultimately depend on libuv threadpool behavior):
    * [ ] `src/index/build/file-processor.js` (notably `runIo(() => fs.stat(...))`, `runIo(() => fs.readFile(...))`)
    * [ ] `src/index/build/file-scan.js` (`fs.open`, `handle.read`)
    * [ ] `src/index/build/preprocess.js` (file sampling + `countLinesForEntries`)
    * [ ] `src/shared/file-stats.js` (stream-based reads for line counting)
  * [ ] Audit concurrency derivation points where PairOfCleats may exceed practical libuv parallelism:
    * [ ] `src/shared/threads.js` (`ioConcurrency = ioBase * 4`, cap 32/64)
    * [ ] `src/index/build/runtime/workers.js` (`createRuntimeQueues` pending limits)
  * [ ] Decide and record the intended precedence rules for threadpool sizing:
    * [ ] Whether PairOfCleats should **respect an already-set `UV_THREADPOOL_SIZE`** (recommended, matching existing `NODE_OPTIONS` behavior where flags aren’t overridden if already present).

  ### 19.2 Add a first-class runtime setting + env override

  * [ ] Add config key (new):
    * [ ] `runtime.uvThreadpoolSize` (number; if unset/invalid => no override)
  * [ ] Add env override (new):
    * [ ] `PAIROFCLEATS_UV_THREADPOOL_SIZE` (number; same parsing rules as other numeric env overrides)
  * [ ] Implement parsing + precedence:
    * [ ] Update `src/shared/env.js`
      * [ ] Add `uvThreadpoolSize: parseNumber(env.PAIROFCLEATS_UV_THREADPOOL_SIZE)`
    * [ ] Update `tools/dict-utils.js`
      * [ ] Extend `getRuntimeConfig(repoRoot, userConfig)` to resolve `uvThreadpoolSize` with precedence:
        * `userConfig.runtime.uvThreadpoolSize` → else `envConfig.uvThreadpoolSize` → else `null`
      * [ ] Clamp/normalize: floor to integer; require `> 0`; else `null`
      * [ ] Update the function’s return shape and JSDoc:
        * from `{ maxOldSpaceMb, nodeOptions }`
        * to `{ maxOldSpaceMb, nodeOptions, uvThreadpoolSize }`

  ### 19.3 Propagate `UV_THREADPOOL_SIZE` early enough (launcher + spawned scripts)

  * [ ] Update `bin/pairofcleats.js` (critical path)
    * [ ] In `runScript()`:
      * [ ] Resolve `runtimeConfig` as today.
      * [ ] Build child env as an object (don’t pass `process.env` by reference when you need to conditionally add keys).
      * [ ] If `runtimeConfig.uvThreadpoolSize` is set and `process.env.UV_THREADPOOL_SIZE` is not set, add:
        * [ ] `UV_THREADPOOL_SIZE = String(runtimeConfig.uvThreadpoolSize)`
      * [ ] (Optional) If `--verbose` or `PAIROFCLEATS_VERBOSE`, log a one-liner showing the chosen `UV_THREADPOOL_SIZE` for the child process.
  * [ ] Update other scripts that spawn Node subcommands and already apply runtime Node options, so they also carry the threadpool sizing consistently:
    * [ ] `tools/setup.js` (`buildRuntimeEnv()`)
    * [ ] `tools/bootstrap.js` (`baseEnv`)
    * [ ] `tools/ci-build-artifacts.js` (`baseEnv`)
    * [ ] `tools/bench-language-repos.js` (repo child env)
    * [ ] `tests/bench.js` (bench child env when spawning search/build steps)
    * [ ] `tools/triage/context-pack.js`, `tools/triage/ingest.js` (where `resolveNodeOptions` is used)
    * Implementation pattern: wherever you currently do `{ ...process.env, NODE_OPTIONS: resolvedNodeOptions }`, also conditionally set `UV_THREADPOOL_SIZE` from `runtimeConfig.uvThreadpoolSize` if not already present.

  > (Optional refactor, if you want to reduce repetition): add a helper in `tools/dict-utils.js` like `resolveRuntimeEnv(runtimeConfig, baseEnv)` and migrate the call sites above to use it.

  ### 19.4 Observability: surface “configured vs effective” values

  * [ ] Update `tools/config-dump.js`
    * [ ] Include in `payload.derived.runtime`:
      * [ ] `uvThreadpoolSize` (configured value from `getRuntimeConfig`)
      * [ ] `effectiveUvThreadpoolSize` (from `process.env.UV_THREADPOOL_SIZE` or null/undefined if absent)
  * [ ] Add runtime warnings in indexing startup when mismatch is likely:
    * [ ] Update `src/index/build/runtime/workers.js` (in `resolveThreadLimitsConfig`, verbose mode is already supported)
      * [ ] Compute `effectiveUv = Number(process.env.UV_THREADPOOL_SIZE) || null`
      * [ ] If `effectiveUv` is set and `ioConcurrency` is materially larger, emit a single warning suggesting alignment.
      * [ ] If `effectiveUv` is not set, consider a *non-fatal* hint when `ioConcurrency` is high (e.g., `>= 16`) and `--verbose` is enabled.
  * [ ] (Services) Emit one-time startup info in long-running modes:
    * [ ] `tools/api-server.js`
    * [ ] `tools/indexer-service.js`
    * [ ] `tools/mcp-server.js`
    * Log: effective `UV_THREADPOOL_SIZE`, and whether it was set by PairOfCleats runtime config or inherited from the environment.

  ### 19.5 Documentation updates

  * [ ] Update env overrides doc:
    * [ ] `docs/env-overrides.md`
      * [ ] Add `PAIROFCLEATS_UV_THREADPOOL_SIZE`
      * [ ] Explicitly note: libuv threadpool size must be set **before the Node process starts**; PairOfCleats applies it by setting `UV_THREADPOOL_SIZE` in spawned child processes (via `bin/pairofcleats.js` and other tool launchers).
  * [ ] Update config docs:
    * [ ] `docs/config-schema.json` add `runtime.uvThreadpoolSize`
    * [ ] `docs/config-inventory.md` add `runtime.uvThreadpoolSize (number)`
    * [ ] `docs/config-inventory.json` add entry for `runtime.uvThreadpoolSize`
  * [ ] Update setup documentation:
    * [ ] `docs/setup.md` add a short “Performance tuning” note:
      * [ ] When indexing large repos or using higher `--threads`, consider setting `runtime.uvThreadpoolSize` (or `PAIROFCLEATS_UV_THREADPOOL_SIZE`) to avoid libuv threadpool becoming the limiting factor.
  * [ ] (Optional) Add a benchmark note:
    * [ ] `docs/benchmarks.md` mention that benchmarking runs should control `UV_THREADPOOL_SIZE` for reproducibility.

  ### 19.6 Tests: schema validation + env propagation

  * [ ] Update config validation tests:
    * [ ] `tests/config-validate.js` ensure `runtime.uvThreadpoolSize` is accepted by schema validation.
  * [ ] Add a focused propagation test:
    * [ ] New: `tests/uv-threadpool-env.js`
      * [ ] Create a temp repo dir with a `.pairofcleats.json` that sets `runtime.uvThreadpoolSize`.
      * [ ] Run: `node bin/pairofcleats.js config dump --json --repo <temp>`
      * [ ] Assert:
        * `payload.derived.runtime.uvThreadpoolSize` matches the config
        * `payload.derived.runtime.effectiveUvThreadpoolSize` matches the propagated env (or check `process.env.UV_THREADPOOL_SIZE` if you expose it directly in the dump)
  * [ ] Add a non-override semantics test (if that’s the decided rule):
    * [ ] New: `tests/uv-threadpool-no-override.js`
      * [ ] Set parent env `UV_THREADPOOL_SIZE=…`
      * [ ] Also set config `runtime.uvThreadpoolSize` to a different value
      * [ ] Assert child sees the parent value (i.e., wrapper respects existing env)

  **Exit criteria**

  * [ ] `runtime.uvThreadpoolSize` is in schema + inventory and validated by `tools/validate-config.js`.
  * [ ] `pairofcleats …` launches propagate `UV_THREADPOOL_SIZE` to child processes when configured.
  * [ ] Users can confirm configured/effective behavior via `pairofcleats config dump --json`.
  * [ ] Docs clearly explain when and how the setting applies.

---

## Phase 20 — Threadpool-aware I/O scheduling guardrails

  **Objective:** Reduce misconfiguration risk by aligning PairOfCleats internal I/O scheduling with the effective libuv threadpool size and preventing runaway pending I/O buildup.

  ### 20.1 Add a “threadpool-aware” cap option for I/O queue sizing

  * [ ] Add config (optional, but recommended if you want safer defaults):
    * [ ] `indexing.ioConcurrencyCap` (number) **or** `runtime.ioConcurrencyCap` (number)
    * Choose the namespace based on your ownership map (`docs/config-inventory-notes.md` suggests runtime is `tools/dict-utils.js`, indexing is build runtime).
  * [ ] Implement in:
    * [ ] `src/shared/threads.js` (preferred, because it’s the canonical concurrency resolver)
      * [ ] After computing `ioConcurrency`, apply:
        * `ioConcurrency = min(ioConcurrency, ioConcurrencyCap)` when configured
        * (Optional) `ioConcurrency = min(ioConcurrency, effectiveUvThreadpoolSize)` when a new boolean is enabled, e.g. `runtime.threadpoolAwareIo === true`
    * [ ] `src/index/build/runtime/workers.js`
      * [ ] Adjust `maxIoPending` to scale from the *final* `ioConcurrency`, not the pre-cap value.

  ### 20.2 Split “filesystem I/O” from “process I/O” (optional, higher impact)

  If profiling shows git/tool subprocess work is being unnecessarily throttled by a threadpool-aware cap:

  * [ ] Update `src/shared/concurrency.js` to support two queues:
    * [ ] `fs` queue (bounded by threadpool sizing)
    * [ ] `proc` queue (bounded separately)
  * [ ] Update call sites:
    * [ ] `src/index/build/file-processor.js`
      * [ ] Use `fsQueue` for `fs.stat`, `fs.readFile`, `fs.open`
      * [ ] Use `procQueue` for `getGitMetaForFile` (and any other spawn-heavy steps)
    * [ ] `src/index/build/runtime/workers.js` and `src/index/build/indexer/steps/process-files.js`
      * [ ] Wire new queues into runtime and shard runtime creation.

  ### 20.3 Tests + benchmarks

  * [ ] Add tests that validate:
    * [ ] Caps are applied deterministically
    * [ ] Pending limits remain bounded
    * [ ] No deadlocks when both queues exist
  * [ ] Update or add a micro-benchmark to show:
    * [ ] Throughput difference when `UV_THREADPOOL_SIZE` and internal `ioConcurrency` are aligned vs misaligned.

  **Exit criteria**

  * [ ] Internal I/O concurrency cannot silently exceed intended caps.
  * [ ] No regression in incremental/watch mode stability.
  * [ ] Benchmarks show either improved throughput or reduced memory/queue pressure (ideally both).

---

## Phase 23 — Index analysis features (metadata/risk/git/type-inference) — Review findings & remediation checklist

  #### P0 — Must fix (correctness / crash / schema integrity)

  - [ ] **Risk rules regex compilation is currently mis-wired.** `src/index/risk-rules.js` calls `createSafeRegex()` with an incorrect argument signature, so rule regex configuration (flags, limits) is not applied, and invalid patterns can throw and abort normalization.  
    - Fix in: `src/index/risk-rules.js` 
  - [ ] **Risk analysis can crash indexing on long lines.** `src/index/risk.js` calls SafeRegex `test()` / `exec()` without guarding against SafeRegex input-length exceptions. One long line can throw and fail the whole analysis pass.  
    - Fix in: `src/index/risk.js` 
  - [ ] **Metadata v2 drops inferred/tooling parameter types (schema data loss).** `src/index/metadata-v2.js` normalizes type maps assuming values are arrays; nested maps (e.g., `inferredTypes.params.<name>[]`) are silently discarded.  
    - Fix in: `src/index/metadata-v2.js` + tests + schema/docs

  #### P1 — Should fix (determinism, performance, docs, validation gaps)

  - [ ] **`metaV2` validation is far too shallow and does not reflect the actual schema shape.** `src/index/validate.js` only validates a tiny subset of fields and does not traverse nested type maps.  
  - [ ] **Docs drift:** `docs/metadata-schema-v2.md` and `docs/risk-rules.md` do not fully match current code (field names, structures, and configuration).  
  - [ ] **Performance risks:** risk scanning does redundant passes and does not short-circuit meaningfully when capped; markdown parsing is duplicated (inline + fenced); tooling providers re-read files rather than reusing already-loaded text.

  #### P2 — Nice to have (quality, maintainability, test depth)

  - [ ] Improve signature parsing robustness for complex types (C-like, Python, Swift).
  - [ ] Clarify and standardize naming conventions (chunk naming vs provider symbol naming, “generatedBy”, “embedded” semantics).
  - [ ] Expand tests to cover surrogate pairs (emoji), CRLF offsets, and risk rules/config edge cases.

---

  ### A) Metadata v2: correctness, determinism, and validation

  #### Dependency guidance (best choices)
  - `ajv` — encode **metadata-schema-v2** as JSON Schema and validate `metaV2` as a hard gate in `tools/index-validate` (or equivalent).  
  - `semver` — version `metaV2.schemaVersion` independently and gate readers/writers.

  #### A.1 `metaV2.types` loses nested inferred/tooling param types (P0)

  ##### Findings
  - [ ] **Data loss bug:** `normalizeTypeMap()` assumes `raw[key]` is an array of entries. If `raw[key]` is an object map (e.g., `raw.params` where `raw.params.<paramName>` is an array), it is treated as non-array and dropped.  
    - Evidence: `normalizeTypeMap()` (lines ~78–91) only normalizes `Array.isArray(entries)` shapes.
  - [ ] **Downstream effect:** `splitToolingTypes()` is applied to `docmeta.inferredTypes`; because nested shapes are not handled, **tooling-derived param types will not appear in `metaV2.types.tooling.params`**, and inferred param types will be absent from `metaV2.types.inferred.params`.

  ##### Required remediation
  - [ ] Update `normalizeTypeMap()` to support nested “param maps” (and any similar nested structures) rather than dropping them. A pragmatic approach:
    - [ ] If `entries` is an array → normalize as today.
    - [ ] If `entries` is an object → treat it as a nested map and normalize each subkey:
      - preserve the nested object shape in output (preferred), or
      - flatten with a predictable prefix strategy (only if schema explicitly adopts that).
  - [ ] Update `splitToolingTypes()` so it correctly separates tooling vs non-tooling entries **inside nested maps** (e.g., `params.<name>[]`, `locals.<name>[]`).
  - [ ] Update `tests/metadata-v2.js` to assert:
    - [ ] inferred param types survive into `metaV2.types.inferred.params.<paramName>[]`
    - [ ] tooling param types survive into `metaV2.types.tooling.params.<paramName>[]`
    - [ ] non-tooling inferred types do not leak into tooling bucket (and vice versa)

  #### A.2 Declared types coverage is incomplete (P1)

  ##### Findings
  - [ ] `buildDeclaredTypes()` currently only materializes:
    - param annotations via `docmeta.paramTypes`
    - return annotation via `docmeta.returnType`  
    It does **not** cover:
    - [ ] parameter defaults (`docmeta.paramDefaults`)
    - [ ] local types (`docmeta.localTypes`)
    - [ ] any other declared type sources the codebase may already emit

  ##### Required remediation
  - [ ] Decide which “declared” facets are part of Metadata v2 contract and implement them consistently (and document them):
    - [ ] `declared.defaults` (if desired)
    - [ ] `declared.locals` (if desired)
  - [ ] Update `docs/metadata-schema-v2.md` accordingly.
  - [ ] Add tests in `tests/metadata-v2.js` for any newly included declared facets.

  #### A.3 Determinism and stable ordering in `metaV2` (P1)

  ##### Findings
  - [ ] Several arrays are produced via Set insertion order (e.g., `annotations`, `params`, `risk.tags`, `risk.categories`). While *often* stable, they can drift if upstream traversal order changes.
  - [ ] `metaV2` mixes optional `null` vs empty collections inconsistently across fields (some fields null, others empty arrays). This matters for artifact diffs and schema validation.

  ##### Required remediation
  - [ ] Standardize ordering rules for arrays that are semantically sets:
    - [ ] Sort `annotations` (lexicographic) before emitting.
    - [ ] Sort `params` (lexicographic) before emitting.
    - [ ] Sort risk `tags`/`categories` (lexicographic) before emitting.
  - [ ] Establish a consistent “empty means null” vs “empty means []” policy for v2 and enforce it in `buildMetaV2()` and schema/docs.

  #### A.4 `generatedBy` and `embedded` semantics are unclear (P2)

  ##### Findings
  - [ ] `generatedBy` currently uses `toolInfo?.version` only; if `tooling` already contains `tool` and `version`, this can be redundant and underspecified.
  - [ ] `embedded` is emitted whenever `chunk.segment` exists, even when the segment is not embedded (parentSegmentId may be null). This makes the field name misleading.

  ##### Required remediation
  - [ ] Decide and document the intended meaning:
    - [ ] Option A: `generatedBy = "<tool>@<version>"` and keep `tooling` for structured detail.
    - [ ] Option B: remove `generatedBy` and rely solely on `tooling`.
  - [ ] Restrict `embedded` field to truly-embedded segments only **or** rename the field to something like `segmentContext` / `embedding`.

  #### A.5 Validation gaps for Metadata v2 (P1)

  ##### Findings (in `src/index/validate.js`)
  - [ ] `validateMetaV2()` (lines ~162–206) validates only:
    - `chunkId` presence
    - `file` presence
    - `risk.flows` has `source` and `sink`
    - type entries have `.type` for a shallow, array-only traversal  
    It does **not** validate:
    - [ ] `segment` object shape
    - [ ] range/start/end types and ordering invariants
    - [ ] `lang`, `ext`, `kind`, `name` constraints
    - [ ] nested types map shapes (params/locals)
    - [ ] `generatedBy`/`tooling` shape and required fields
    - [ ] cross-field invariants (e.g., range within segment, embedded context consistency)

  ##### Required remediation
  - [ ] Establish **one canonical validator** for `metaV2` (preferably schema-based):
    - [ ] Add an explicit JSON Schema for v2 (in docs or tooling directory).
    - [ ] Validate `metaV2` against the schema in `validateIndexArtifacts()`.
  - [ ] If schema-based validation is not yet possible, expand `validateMetaV2()` to:
    - [ ] traverse nested `params`/`locals` maps for type entries
    - [ ] validate `range` numbers, monotonicity, and non-negativity
    - [ ] validate the presence/type of stable core fields as defined in `docs/metadata-schema-v2.md`
  - [ ] Add tests (or fixtures) that exercise validation failures for each major failure class.

  #### A.6 Docs drift: `docs/metadata-schema-v2.md` vs implementation (P1)

  ##### Findings
  - [ ] The schema doc should be reviewed line-by-line against current `buildMetaV2()` output:
    - field names
    - optionality
    - nesting of `types.*`
    - risk shapes and analysisStatus shape
    - relations link formats

  ##### Required remediation
  - [ ] Update `docs/metadata-schema-v2.md` to reflect the actual emitted shape **or** update `buildMetaV2()` to match the doc (pick one, do not leave them divergent).
  - [ ] Add a “schema change log” section so future modifications don’t silently drift.

---

  ### B) Risk rules and risk analysis

  #### Dependency guidance (best choices)
  - `re2`/RE2-based engine (already present via `re2js`) — keep for ReDoS safety, but ensure wrapper behavior cannot crash indexing.
  - `ajv` — validate rule bundle format (ids, patterns, severities, categories, etc.) before compiling.

  #### B.1 Risk regex compilation is broken (P0)

  ##### Affected file
  - `src/index/risk-rules.js`

  ##### Findings
  - [ ] **Incorrect call signature:** `compilePattern()` calls `createSafeRegex(pattern, flags, regexConfig)` but `createSafeRegex()` accepts `(pattern, config)` (per `src/shared/safe-regex.js`).  
    Consequences:
    - `regexConfig` is ignored entirely
    - the intended default flags (`i`) are not applied
    - any user-configured safe-regex limits are not applied
  - [ ] **No error shielding:** `compilePattern()` does not catch regex compilation errors. An invalid pattern can throw and abort normalization.

  ##### Required remediation
  - [ ] Fix `compilePattern()` to call `createSafeRegex(pattern, safeRegexConfig)` (or a merged config object).
  - [ ] Wrap compilation in `try/catch` and return `null` on failure (or record a validation error) so rule bundles cannot crash indexing.
  - [ ] Add tests that verify:
    - [ ] configured flags (e.g., `i`) actually take effect
    - [ ] invalid patterns do not crash normalization and are surfaced as actionable diagnostics
    - [ ] configured `maxInputLength` and other safety controls are honored

  #### B.2 Risk analysis can crash on long inputs (P0)

  ##### Affected file
  - `src/index/risk.js`

  ##### Findings
  - [ ] `matchRuleOnLine()` calls SafeRegex `test()` and `exec()` without guarding against exceptions thrown by SafeRegex input validation (e.g., when line length exceeds `maxInputLength`).  
    - This is a hard failure mode: one long line can abort analysis for the entire file (or build, depending on call site error handling).

  ##### Required remediation
  - [ ] Ensure **risk analysis never throws** due to regex evaluation. Options:
    - [ ] Add `try/catch` around `rule.requires.test(...)`, `rule.excludes.test(...)`, and `pattern.exec(...)` to treat failures as “no match”.
    - [ ] Alternatively (or additionally), change the SafeRegex wrapper to return `false/null` instead of throwing for overlong input.
    - [ ] Add a deterministic “line too long” cap behavior:
      - skip risk evaluation for that line
      - optionally record `analysisStatus.exceeded` includes `maxLineLength` (or similar)

  #### B.3 `scope` and cap semantics need tightening (P1)

  ##### Findings
  - [ ] `scope === 'file'` currently evaluates only `lineIdx === 0` (first line). This is likely not the intended meaning of “file scope”.
  - [ ] `maxMatchesPerFile` currently caps **number of matching lines**, not number of matches (variable name implies match-count cap).

  ##### Required remediation
  - [ ] Define (in docs + code) what `scope: "file"` means:
    - [ ] “pattern evaluated against entire file text” (recommended), or
    - [ ] “pattern evaluated once per file via a representative subset”
  - [ ] Implement `maxMatchesPerFile` as an actual match-count cap (or rename it to `maxMatchingLines`).
  - [ ] Add tests for both behaviors.

  #### B.4 Performance: redundant scanning and weak short-circuiting (P1)

  ##### Findings
  - [ ] Risk analysis scans the same text repeatedly (sources, sinks, sanitizers are scanned in separate loops).
  - [ ] When caps are exceeded (bytes/lines), flows are skipped, but line scanning for matches still proceeds across the entire file, which defeats the purpose of caps for large/minified files.

  ##### Required remediation
  - [ ] Add an early-exit path when `maxBytes`/`maxLines` caps are exceeded:
    - either skip all analysis and return `analysisStatus: capped`
    - or scan only a bounded prefix/suffix and clearly mark that results are partial
  - [ ] Consider a single-pass scanner per line that evaluates all rule categories in one traversal.
  - [ ] Add a prefilter stage for candidate files/lines (cheap substring checks) before SafeRegex evaluation.

  #### B.5 Actionability and determinism of outputs (P1)

  ##### Findings
  - [ ] `dedupeMatches()` collapses evidence to one match per rule id (may not be sufficient for remediation).
  - [ ] Time-based caps (`maxMs`) can introduce nondeterminism across machines/runs (what gets included depends on wall clock).

  ##### Required remediation
  - [ ] Preserve up to N distinct match locations per rule (configurable) rather than only first hit.
  - [ ] Prefer deterministic caps (maxBytes/maxLines/maxNodes/maxEdges) over time caps; if `maxMs` remains, ensure it cannot cause nondeterministic partial outputs without clearly indicating partiality.
  - [ ] Sort emitted matches/flows deterministically (by line/col, rule id) before output.

  #### B.6 Docs drift: `docs/risk-rules.md` vs implementation (P1)

  ##### Findings
  - [ ] `docs/risk-rules.md` should be updated to reflect:
    - actual rule bundle fields supported (`requires`, `excludes`, `scope`, `maxMatchesPerLine`, `maxMatchesPerFile`, etc.)
    - actual emitted `risk.analysisStatus` shape (object vs string)
    - actual matching semantics (line-based vs file-based)

  ##### Required remediation
  - [ ] Update the doc to match current behavior (or update code to match doc), then add tests that lock it in.

---

  ### C) Git signals (metadata + blame-derived authorship)

  #### Dependency guidance (best choices)
  - `simple-git` (already used) — ensure it’s called in a way that scales: batching where feasible, caching aggressively, and defaulting expensive paths off unless explicitly enabled.

  #### C.1 Default blame behavior and cost control (P1)

  ##### Affected file
  - `src/index/git.js`

  ##### Findings
  - [ ] `blameEnabled` defaults to **true** (`options.blame !== false`). If a caller forgets to pass `blame:false`, indexing will run `git blame` per file (very expensive).
  - [ ] `git log` + `git log --numstat` are executed per file; caching helps within a run but does not avoid the O(files) subprocess cost.

  ##### Required remediation
  - [ ] Make blame opt-in by default:
    - [ ] change default to `options.blame === true`, **or**
    - [ ] ensure all call sites pass `blame:false` unless explicitly requested via config
  - [ ] Consider adding a global “gitSignalsPolicy” (or reuse existing policy object) that centrally controls:
    - blame on/off
    - churn computation on/off
    - commit log depth
  - [ ] Performance optimization options (choose based on ROI):
    - [ ] batch `git log` queries when indexing many files (e.g., per repo, not per file)
    - [ ] compute churn only when needed for ranking/filtering
    - [ ] support “recent churn only” explicitly in docs (currently it’s “last 10 commits”)

  #### C.2 Minor correctness and maintainability issues (P2)

  ##### Findings
  - [ ] Misleading JSDoc: `parseLineAuthors()` is documented as “Compute churn from git numstat output” (it parses blame authors, not churn). This can mislead future maintenance.

  ##### Required remediation
  - [ ] Fix the JSDoc to match the function purpose and parameter type.

  #### C.3 Tests improvements (P1)

  ##### Affected tests
  - `tests/git-blame-range.js`
  - `tests/git-meta.js`
  - `tests/churn-filter.js`
  - `tests/git-hooks.js`

  ##### Findings
  - [ ] No tests assert “blame is off by default” (or the intended default policy).
  - [ ] No tests cover rename-following semantics (`--follow`) or untracked files.
  - [ ] Caching behavior is not validated (e.g., “git blame called once per file even if many chunks”).

  ##### Required remediation
  - [ ] Add tests that explicitly validate the intended default blame policy.
  - [ ] Add a caching-focused test that ensures repeated `getGitMeta()` calls for the same file do not spawn repeated git commands (can be validated via mocking or by instrumenting wrapper counts).
  - [ ] Decide whether rename-following is required and add tests if so.

---

  ### D) Type inference (local + cross-file + tooling providers)

  #### Dependency guidance (best choices)
  - LSP-based providers (clangd/sourcekit/pyright) — keep optional and guarded; correctness should degrade gracefully.
  - TypeScript compiler API — keep optional and isolated; add caching/incremental compilation for large repos.

  #### D.1 Provider lifecycle and resilience (P1)

  ##### Findings
  - [ ] `createLspClient().request()` can leave pending requests forever if a caller forgets to supply `timeoutMs` (pending map leak). Current provider code *usually* supplies a timeout, but this is not enforced.
  - [ ] Diagnostics timing: providers request symbols immediately after `didOpen` and then `didClose` quickly; some servers publish diagnostics asynchronously and may not emit before close, leading to inconsistent diagnostic capture.

  ##### Required remediation
  - [ ] Enforce a default request timeout in `createLspClient.request()` if none is provided.
  - [ ] For diagnostics collection, consider:
    - [ ] waiting a bounded time for initial diagnostics after `didOpen`, or
    - [ ] explicitly requesting diagnostics if server supports it (varies), or
    - [ ] documenting that diagnostics are “best effort” and may be incomplete

  #### D.2 Unicode/offset correctness: add stronger guarantees (P1)

  ##### Findings
  - [ ] `positions.js` JSDoc claims “1-based line/column”; column is actually treated as 0-based (correct for LSP), but the doc comment is misleading.
  - [ ] Test coverage does not explicitly include surrogate pairs (emoji), which are the common failure mode when mixing code-point vs UTF-16 offsets.

  ##### Required remediation
  - [ ] Fix the JSDoc to reflect actual behavior (LSP: 0-based character offsets; line converted to 1-based for internal helpers).
  - [ ] Add tests with:
    - [ ] emoji in identifiers and/or strings before symbol definitions
    - [ ] CRLF line endings fixtures (if Windows compatibility is required)

  #### D.3 Generic LSP provider chunk matching is weaker than clangd provider (P2)

  ##### Findings
  - [ ] `findChunkForOffsets()` requires strict containment (symbol range must be within chunk range). clangd-provider uses overlap scoring, which is more robust.

  ##### Required remediation
  - [ ] Update generic provider to use overlap scoring like clangd-provider to reduce missed matches.

  #### D.4 TypeScript provider issues (P2/P1 depending on usage)

  ##### Findings
  - [ ] `loadTypeScript()` resolve order includes keys that are not implemented (`global`) and duplicates (`cache` vs `tooling`).
  - [ ] Parameter name extraction uses `getText()` which can produce non-identifiers for destructuring params (bad keys for `params` map).
  - [ ] Naming convention risk: provider writes keys like `Class.method` which may not match chunk naming conventions; if mismatched, types will not attach.

  ##### Required remediation
  - [ ] Fix the resolution order logic and document each lookup path purpose.
  - [ ] Only record parameter names for identifiers; skip or normalize destructuring params.
  - [ ] Validate chunk naming alignment (structural chunk naming vs provider symbol naming) and add a test for a class method mapping end-to-end.

  #### D.5 Cross-file inference merge determinism and evidence (P2)

  ##### Findings
  - [ ] `mergeTypeList()` dedupes by `type|source` but drops evidence differences; confidence merging strategy is simplistic.
  - [ ] Output ordering is not explicitly sorted after merges.

  ##### Required remediation
  - [ ] Decide how to treat evidence in merges (keep first, merge arrays, keep highest confidence).
  - [ ] Sort merged type lists deterministically (confidence desc, type asc, source asc).

  #### D.6 Signature parsing robustness (P2)

  ##### Findings
  - [ ] Parsers are intentionally lightweight, but they will fail on common real-world signatures:
    - C++ templates, function pointers, references
    - Python `*args/**kwargs`, keyword-only params, nested generics
    - Swift closures and attributes

  ##### Required remediation
  - [ ] Add test fixtures covering at least one “hard” signature per language.
  - [ ] Consider using tooling hover text more consistently (already used as fallback in clangd-provider) or integrate a minimal parser that handles nested generics and defaults.

---

  ### E) Performance improvements to prioritize (cross-cutting)

  #### E.1 Risk analysis hot path (P1)
  - [ ] Single-pass line scan for sources/sinks/sanitizers.
  - [ ] Early return on caps (maxBytes/maxLines) rather than scanning the whole file anyway.
  - [ ] Cheap prefilter before SafeRegex evaluation.
  - [ ] Avoid per-line SafeRegex exceptions.

  #### E.2 Markdown segmentation duplication (P2)
  - [ ] `segments.js` parses markdown twice (inline code spans + fenced blocks). Consider extracting both from one micromark event stream.

  #### E.3 Tooling providers I/O duplication (P2)
  - [ ] Providers re-read file text from disk; if indexing already has the content in memory, pass it through (where feasible) to reduce I/O.

---

  ### F) Refactoring goals (maintainability / policy centralization)

  - [ ] Consolidate analysis feature toggles into a single `analysisPolicy` object that is passed to:
    - metadata v2 builder
    - risk analysis
    - git analysis
    - type inference (local + cross-file + tooling)
  - [ ] Centralize schema versioning and validation:
    - one metadata v2 schema
    - one risk rule bundle schema
    - one place that validates both as part of artifact validation

---

  ### G) Tests: required additions and upgrades

  #### Required test upgrades (P1/P0 where noted)
  - [ ] **P0:** Add tests for metadata v2 nested inferred/tooling param types.
  - [ ] **P0:** Add tests for risk rule compilation config correctness (flags honored, invalid patterns handled).
  - [ ] **P0:** Add risk analysis “long line” test to ensure no crashes.
  - [ ] **P1:** Add unicode offset tests that include surrogate pairs (emoji) for:
    - LSP position mapping
    - chunk start offsets around unicode
  - [ ] **P1:** Add git caching/policy tests (default blame policy + no repeated subprocess calls where caching is intended).

---

## Phase 24 — MCP server: migrate from custom JSON-RPC plumbing to official MCP SDK (reduce maintenance)

  ### 24.1 Add MCP SDK and plan transport layering

  * [ ] Add `@modelcontextprotocol/sdk` dependency
  * [ ] Decide migration strategy:
    * [ ] **Option A (recommended):** keep `tools/mcp-server.js` as the entrypoint, but implement server via SDK and keep legacy behind a flag
    * [ ] Option B: replace legacy entirely (higher risk)

  ### 24.2 Implement SDK-based server

  * [ ] Add `src/integrations/mcp/sdk-server.js` (or similar):
    * [ ] Register tools from `src/integrations/mcp/defs.js`
    * [ ] Dispatch calls to existing handlers in `tools/mcp/tools.js` (or migrate handlers into `src/` cleanly)
    * [ ] Preserve progress notifications semantics expected by `tests/mcp-server.js`:
      * [ ] `notifications/progress`
      * [ ] Include `{ tool: 'build_index', phase, message }` fields (match current tests)
  * [ ] Update `tools/mcp-server.js`:
    * [ ] If `mcp.transport=legacy` or env forces legacy → use current transport
    * [ ] Else → use SDK transport

  ### 24.3 Remove or isolate legacy transport surface area

  * [ ] Keep `tools/mcp/transport.js` for now, but:
    * [ ] Move to `tools/mcp/legacy/transport.js`
    * [ ] Update imports accordingly
    * [ ] Reduce churn risk while you validate parity

  ### 24.4 Tests

  * [ ] Ensure these existing tests continue to pass without rewriting expectations unless protocol mandates it:
    * [ ] `tests/mcp-server.js`
    * [ ] `tests/mcp-robustness.js`
    * [ ] `tests/mcp-schema.js`
  * [ ] Add `tests/mcp-transport-selector.js`:
    * [ ] Force `PAIROFCLEATS_MCP_TRANSPORT=legacy` and assert legacy path still works
    * [ ] Force `...=sdk` and assert SDK path works
  * [ ] Add script-coverage action(s)

---

  ## Phase 32 — Embeddings native load failures (ERR_DLOPEN_FAILED)

  * [ ] Investigate `ERR_DLOPEN_FAILED` from `build-embeddings` during build-index (Node v24); inspect crash log at `C:\Users\sneak\AppData\Local\PairOfCleats\repos\pairofcleats-codex-8c76cec86f7d\logs\index-crash.log`.
  * [ ] Determine which native module fails to load (onnxruntime/onnxruntime-node/etc.) and verify binary compatibility with current Node/OS; capture a minimal repro and fix path.
  * [x] Add a clear error message with module name + remediation hint (reinstall provider, switch provider alias, or disable embeddings) before exiting.
  * [x] If load failure persists, implement a safe fallback behavior (skip embeddings with explicit warning) so build-index completes.
