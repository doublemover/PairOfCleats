# Codebase Static Review Findings — Pass 6 (Shared utilities + CLI display)

**Scope:** Static review of selected `src/shared/*` utilities (artifact schema validation, auto-policy selection, caching primitives) and the shared CLI display/progress event system.

**Files reviewed (only):**

- `src/shared/artifact-schemas.js`
- `src/shared/auto-policy.js`
- `src/shared/bench-progress.js`
- `src/shared/bundle-io.js`
- `src/shared/cache.js`
- `src/shared/capabilities.js`
- `src/shared/cli-options.js`
- `src/shared/cli.js`
- `src/shared/cli/display.js`
- `src/shared/cli/display/bar.js`
- `src/shared/cli/display/colors.js`
- `src/shared/cli/display/terminal.js`
- `src/shared/cli/display/text.js`
- `src/shared/cli/progress-events.js`

---

## Executive summary

This slice of the codebase is foundational: it defines (1) how indexes are validated (`artifact-schemas`), (2) how “auto” behavior chooses performance profiles (`auto-policy` + `capabilities`), and (3) the primary human+machine progress/logging surface (display + JSONL progress events). The key risks are not “logic is absent,” but rather **invariant drift** and **silent mis-reporting**:

- The progress-event envelope can be **overridden by payload fields**, weakening machine-readability guarantees in JSONL mode.
- Capability detection currently treats “ESM-only dependency” as “available,” which can **over-report** optional backend availability unless all call-sites are consistently using dynamic import.
- The display’s log deduplication logic appears to have an **index bookkeeping bug** when the ring buffer evicts old lines, causing repeated messages to stop collapsing.
- `cli-options` schemas drift from the actual option sets; depending on how `validateConfig` is configured, this can become either a **false sense of validation** or a **hard failure** for legitimate flags.
- `auto-policy`’s repo scan is simple and usable, but it has a **directory-handle lifecycle hazard** and could be materially faster/safer with small refactors.

---

## Severity rubric

- **Critical:** Breaks machine contracts, can corrupt output/invariants, or can crash common flows.
- **High:** Likely to cause incorrect behavior in realistic usage, or makes key features unreliable.
- **Medium:** Edge-case correctness/perf risk; likely to matter in large repos or long-running sessions.
- **Low:** Quality-of-life, observability, or minor drift that can accumulate into larger issues.

---

## Cross-cutting themes (what keeps repeating)

1. **Envelope invariants need to be enforced, not implied.**
   - JSONL/progress events are an interface; fields like `event`, `ts`, and `taskId` should not be overrideable by ad-hoc `extra` payload merges.

2. **“Capability detected” must imply “callable.”**
   - A `true` capability should mean the project can actually use the dependency *in the current module system*, not just that it exists on disk.

3. **Schema coverage should be measurable and strictness should be intentional.**
   - Artifact schemas are helpful, but currently permissive in places where they should be tight (or vice-versa).

---

## Findings

### F-01 — Progress event envelope fields can be overwritten by payload
**Severity:** Critical  
**Files:** `src/shared/cli/progress-events.js`, `src/shared/cli/display.js`

**What’s wrong**
- `formatProgressEvent()` returns `{ ...base, ...payload }`. If `payload` contains `event` or `ts`, it will overwrite the canonical event name and timestamp.  
- In `display.js`, `emitTaskEvent()` spreads `...extra` at the top level of the progress payload. If `extra` ever includes keys like `taskId`, `name`, `status`, or `event`, those can override canonical fields.

**Why it matters**
- JSONL progress events are intended for machine consumption (CI logs, dashboards, bench harnesses). Allowing the payload to override envelope fields makes the stream ambiguous and brittle.
- Even if the current callers *intend* not to override, the architecture makes it easy for accidental collisions (especially as more “extra” metadata is attached).

**Suggested fix**
- Make envelope fields authoritative:
  - build final object as `{ ...payload, event, ts }` (so payload can’t override), or
  - strip/ignore `event`/`ts` keys from payload, or
  - keep `extra` nested under `extra` rather than spreading it.

**Suggested tests**
- Unit test: `formatProgressEvent('log', { event:'evil', ts:'1999-01-01' })` must preserve original `event` and generate a new `ts`.
- Integration test: in JSONL mode, ensure `task:start`, `task:progress`, `task:end`, `log` events always have those exact `event` values and a valid ISO `ts`.

---

### F-02 — Capability detection may over-report “available” for ESM-only dependencies
**Severity:** High  
**File:** `src/shared/capabilities.js`

**What’s wrong**
- `check()` returns `true` when `tryRequire()` fails with `reason === 'unsupported'` and `allowEsm` is enabled (notably for `@lancedb/lancedb`).
- This encodes “module exists but cannot be `require()`’d in CJS” as “available.”

**Why it matters**
- Unless every consumer of that capability uses a dynamic import path, the system can report that a backend is available, then fail at runtime when actually used.
- This impacts auto-policy (e.g., enabling ANN) and can mislead users and higher-level planners.

**Suggested fix**
- Report capabilities with richer semantics:
  - `available: true/false`
  - `loadMode: 'cjs' | 'esm' | 'unavailable'`
  - `reason: ...`
- Or: treat `allowEsm` as “available only if caller uses ESM loader” and ensure the consuming code explicitly branches on this.

**Suggested tests**
- If a dependency is ESM-only, `getCapabilities()` should reflect that (e.g., `externalBackends.lancedb = { available:true, loadMode:'esm' }`), and any loader should have a test that it actually loads.

---

### F-03 — `normalizeProgressMode()` does not implement the modes implied by CLI help text
**Severity:** Medium  
**Files:** `src/shared/cli-options.js`, `src/shared/cli/display/terminal.js`

**What’s wrong**
- CLI help text advertises progress: `auto|tty|json|jsonl|off`.
- `normalizeProgressMode()` only maps:
  - `false|off|none` → `off`
  - `json|jsonl` → `jsonl`
  - everything else → `auto`
- The documented `tty` mode is not recognized.

**Why it matters**
- Users (and scripts) may set `--progress tty` expecting it to force interactive rendering; instead it behaves like `auto`.
- This is a configuration/UX contract drift that will surface as “flag exists but doesn’t do anything.”

**Suggested fix**
- Decide what `tty` should mean:
  - option A: “force TTY-style rendering when possible, even when stdout/stderr aren’t marked TTY” (may not be safe).
  - option B: “force TTY rendering when TTY is available; otherwise fall back to plain logs,” but distinct from `auto`.
- Implement it explicitly and update help text accordingly.

**Suggested tests**
- Snapshot test of mode normalization:
  - `tty` should map to `tty` (not `auto`)
  - `json` should either map to `json` (single JSON) or `jsonl` (explicitly), but document which.

---

### F-04 — Display log deduplication breaks when the log window evicts old lines
**Severity:** Medium  
**File:** `src/shared/cli/display.js`

**What’s wrong**
- `appendLog()` tries to collapse repeated identical log lines by updating the last log entry in the rolling window (`state.logLines`) using `state.lastLogIndex`.
- When the window is full, `pushLogLine()` shifts (`.shift()`) before pushing. However, in the “new key” branch the code sets `state.lastLogIndex = state.logLines.length` *before* pushing. When eviction happens, that index no longer points at the inserted line and becomes out-of-range.
- Result: the next repeated line fails `upsertLogLine()`, and repeated identical logs start appending new lines instead of updating the `(xN)` counter.

**Why it matters**
- In non-interactive mode (or when render throttles), logs can get noisy fast. The whole purpose of the deduper is to keep output usable; this bug degrades output quality precisely when log volume is high.

**Suggested fix**
- Have `pushLogLine()` return the inserted index (after shift), and store that as `lastLogIndex`.
- Alternatively, set `lastLogIndex = state.logLines.length - 1` after pushing, and account for shift behavior.

**Suggested tests**
- Unit test the ring-buffer behavior:
  - set `logWindowSize = 3`
  - write 5 unique lines
  - repeat the last line twice
  - assert the last visible entry becomes `"line (x3)"` rather than accumulating duplicates.

---

### F-05 — Render throttling can drop “final state” updates without a deferred render
**Severity:** Low  
**File:** `src/shared/cli/display.js`

**What’s wrong**
- `scheduleRender()` returns early if called too soon (based on `renderMinIntervalMs`) and does not schedule a deferred render.
- If a burst of updates ends just after a throttled call, the UI can remain stale until the next update (or an explicit `flush()`).

**Why it matters**
- Mostly a UX sharp edge. It can make the UI appear “stuck” briefly, and it can hide the final “done” state in short runs.

**Suggested fix**
- Replace “drop” throttling with “debounce” throttling:
  - if called too soon, set a timeout to render at the next allowed time.
- Ensure `close()` or end-of-command always calls `flush()` once.

**Suggested tests**
- Simulate rapid calls to `task.tick()` and assert a final `done()` results in a render (or at least the lastProgressLog line) without requiring another update.

---

### F-06 — `resetTasks()` clears palette/rate maps but leaves `hueShiftByTask` unbounded
**Severity:** Low  
**File:** `src/shared/cli/display.js`

**What’s wrong**
- `resetTasks()` clears `paletteSlots`, `paletteOrder`, and `rateMaxByTask`, but does **not** clear `hueShiftByTask`.
- `hueShiftByTask` keys include mode/stage/name/type hints; in long-running sessions with many unique task keys, it can grow without bound.

**Why it matters**
- This is a low-grade memory growth risk in long-running processes (watch/index sessions).

**Suggested fix**
- Clear `hueShiftByTask` in `resetTasks()`, or cap it (LRU-like) to a small maximum size.

**Suggested tests**
- Stress test `updateTask(..., extra.languageId=unique)` in a loop and assert the map is capped or reset.

---

### F-07 — `scanRepoStats()` does not explicitly close directory handles (FD lifecycle risk)
**Severity:** Medium  
**File:** `src/shared/auto-policy.js`

**What’s wrong**
- `scanRepoStats()` uses `fs.opendir()` and iterates `for await (const entry of dir)`.
- On early termination (`break`) due to scan limits, the directory handle is not explicitly closed.
- Node’s `Dir` objects are usually closed via `dir.close()`; relying on GC is not deterministic.

**Why it matters**
- On very large repos (precisely when truncation is most likely), leaking directory handles can hit OS FD limits and cause unrelated I/O to fail.

**Suggested fix**
- Wrap the directory iteration in `try/finally` and call `await dir.close()` in the finally block.
- Optionally, when truncation occurs, proactively close the handle before breaking.

**Suggested tests**
- In a test harness that mocks `fs.opendir`, assert `close()` is called even when the scan exits early.

---

### F-08 — Auto-policy ignores are incomplete and not configurable (risk: expensive scans and misclassification)
**Severity:** Medium  
**File:** `src/shared/auto-policy.js`

**What’s wrong**
- `IGNORE_DIRS` includes common JS build dirs, but misses many high-volume directories for other ecosystems (examples: `.venv`, `.tox`, `target`, `vendor`, `.gradle`, `.idea`, `.pytest_cache`, `.mypy_cache`, `bazel-*`, etc.).
- The ignore list is not configurable and does not appear to reuse the project’s main ignore logic (which typically exists elsewhere in indexing).

**Why it matters**
- Auto-policy chooses concurrency/quality. If the scan accidentally includes huge irrelevant trees, the repo can be misclassified as “huge,” downgrading quality unnecessarily and wasting time up front.

**Suggested fix**
- Allow a configurable ignore list (config key or env).
- Consider reusing the same ignore resolution used by the indexer (to keep behavior consistent).
- If the scan is only advisory, consider sampling rather than full traversal (e.g., limit to N directories/files per depth).

**Suggested tests**
- Fixture repo with `.venv/` containing many files: scan should ignore it by default (or via config), and `repo.huge` should not flip solely due to that directory.

---

### F-09 — `writeBundleFile()` / `readBundleFile()` enforce a “chunks bundle” shape only on read
**Severity:** Medium  
**File:** `src/shared/bundle-io.js`

**What’s wrong**
- `writeBundleFile()` will serialize any `bundle` payload (JSON or msgpack).
- `readBundleFile()` rejects payloads unless `payload.chunks` is an array (for both msgpack and json).
- This means the functions are not truly symmetric/general-purpose: they are “chunks bundle” I/O, but the writer does not validate that invariant.

**Why it matters**
- If bundle I/O is reused for other bundle shapes (now or later), it will silently write but then fail to read.
- This is easy to trip when introducing new cached bundles, “virtual file” bundles, or future streaming/sharding features.

**Suggested fix**
- Either:
  - rename the module/functions to reflect they are specifically for chunk bundles, and validate on write, or
  - make the read validation injectable (e.g., `validate(bundle)`) and default to permissive parsing + optional validation.

**Suggested tests**
- Round-trip test:
  - writing and reading a non-chunks payload should either be rejected at write-time (if that is intended), or succeed (if generalized).

---

### F-10 — `normalizeBundlePayload()` is recursive without depth caps (stack risk on deep payloads)
**Severity:** Medium  
**File:** `src/shared/bundle-io.js`

**What’s wrong**
- `normalizeBundlePayload()` recursively walks arrays and plain objects without a depth limit.
- If any future “bundle” payload contains deep nested data, this can trigger stack overflows or extreme CPU.

**Why it matters**
- Bundle normalization is used for checksumming. When it fails, it can break cache correctness and/or cause read failures.

**Suggested fix**
- Add an explicit depth budget (similar to `estimateJsonBytes`) and/or rewrite the walk iteratively.
- Make cycle handling explicit regardless of object constructor.

**Suggested tests**
- Deeply nested object (depth 1000) should not crash; checksum should either be skipped or computed safely.

---

### F-11 — Cache miss semantics treat stored `undefined` as “not present”
**Severity:** Low  
**File:** `src/shared/cache.js`

**What’s wrong**
- `createLruCache().get()` treats `value === undefined` as a miss and returns `null`.
- This makes it impossible to cache a computed `undefined` value distinctly from “not cached.”

**Why it matters**
- Minor, but it can lead to repeated recomputation if any cache intentionally stores `undefined` (or if a loader naturally returns undefined).

**Suggested fix**
- Store a sentinel wrapper `{ value }` and allow `undefined` as a valid cached value.
- Or: return `{ hit:boolean, value:any }` from `get()`.

**Suggested tests**
- Cache `undefined`, then `get()` should return `undefined` with a hit count increment (if that behavior is desired).

---

### F-12 — CLI option schemas drift from option sets (validation may be ineffective or too strict)
**Severity:** High  
**File:** `src/shared/cli-options.js`

**What’s wrong**
- `INDEX_BUILD_OPTIONS` and `BENCH_OPTIONS` include flags that are not represented in `INDEX_BUILD_SCHEMA` / `BENCH_SCHEMA` (examples include: `stub-embeddings`, `watch-poll`, `watch-debounce`, `queries`, `out`, `repo`, `json`, `write-report`, etc.).
- Whether this is a bug depends on how `validateConfig()` handles unknown properties. If strict, legitimate args could be rejected. If permissive, the schema provides a false sense of coverage.

**Why it matters**
- CLI validation is meant to prevent invalid combinations and catch typos early. Drift undermines this and can create inconsistent behavior.

**Suggested fix**
- Generate schemas from the option definitions to prevent drift (single source of truth).
- Decide whether unknown CLI flags should be allowed and enforce that consistently.

**Suggested tests**
- A test that enumerates keys in `INDEX_BUILD_OPTIONS` and asserts they are all present in `INDEX_BUILD_SCHEMA.properties` (and same for bench).
- A test that runs `validateBuildArgs()` on a representative argv that includes the “real world” flags you expect to support.

---

### F-13 — Artifact schema validation is permissive and silently succeeds for unknown artifacts
**Severity:** Medium  
**File:** `src/shared/artifact-schemas.js`

**What’s wrong**
- `validateArtifact(name, data)` returns `{ ok: true }` when `name` has no validator.
- Most validators use `additionalProperties: true`, reducing the schema’s ability to detect accidental shape drift.
- Validators are compiled eagerly at module import time with Ajv `strict: true`. A schema mistake can throw during import, potentially crashing any command that imports the module.

**Why it matters**
- Artifact validation is a correctness gate. Silent success on unknown names weakens that gate.
- Eager strict compilation increases blast radius for schema edits.

**Suggested fix**
- Introduce strict/permissive modes for unknown names.
- Tighten schemas for stable artifacts (`additionalProperties: false`) and use explicit allow-lists where extensions are expected.
- Consider lazy compilation (compile on first use) or isolate schema compilation to validation flows.

**Suggested tests**
- Unknown artifact name should fail in strict mode.
- Golden artifact samples should pass; unexpected keys should fail when schema is intended to be strict.

---


## File-by-file notes (items below the “finding” threshold)

These are observations worth tracking, but they did not rise to the level of the numbered findings above.

- `src/shared/bench-progress.js`: `entry.fileIndex` vs `entry.count` can lead to off-by-one display depending on whether upstream counts are 0- or 1-based. Consider normalizing to a consistent convention at the event source.
- `src/shared/cli.js`: the CLI parser is explicitly `strict(false)`, which is reasonable for composability, but it reduces typo protection. If you rely on schema validation to catch typos, ensure schema validation is comprehensive (see F-12).
- `src/shared/cli/display/bar.js` / `colors.js` / `text.js`: these modules are generally well-structured. The main risks are Unicode width/grapheme handling (ANSI-stripping and `.length`-based padding) which can misalign for wide glyphs/emojis; if alignment becomes important, consider a wcwidth-aware width calculator.


## Recommendations (prioritized)

1. **Lock down progress-event invariants (F-01).** Treat JSONL progress as a public interface; make it unambiguous and non-overridable.
2. **Fix capability reporting semantics (F-02).** “Available” should mean “loadable in this runtime,” not “installed but ESM-only.”
3. **Fix the display log ring-buffer deduper (F-04).** Small change, high UX payoff under load.
4. **Address `auto-policy` FD handling and scan ergonomics (F-07, F-08).** Close handles on early exits; align ignore semantics.
5. **De-drift CLI schemas (F-12) and progress mode normalization (F-03).** Consolidate sources of truth and make behavior match docs.

---

## Appendix: acceptance checklist for the next patch set

- [ ] Progress events: `event` and `ts` cannot be overridden by payload fields.
- [ ] Display: repeated identical log lines collapse correctly even when the log window is full.
- [ ] Capabilities: optional backends report both availability and load mode; consuming code respects it.
- [ ] Auto-policy: directory handles are explicitly closed on early exit.
- [ ] CLI: option schemas cover the actual option sets (or are explicitly permissive) and are enforced by tests.
- [ ] Progress modes: documented modes are recognized (or docs are corrected).

