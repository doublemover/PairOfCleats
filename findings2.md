## Files evaluated

- `src/config/validate.js`

---

## Key findings (technical / tricky)

### 1) Validator recompiles schema on every call (can be slow + can leak memory via Ajv schema cache)
**Severity:** Medium → High (depends on call frequency)  
**Where:** `validateConfig()` lines **72–79**

- `validateConfig()` does:
  - `structuredClone(schema)` (line 73)
  - `ajv.compile(normalizedSchema)` (line 75) **every call**
- If `validateConfig()` is called repeatedly (e.g., in a long-running server process, or per-request), this is unnecessary work and can become a latency hotspot.
- Depending on Ajv internals and `$id` usage, repeatedly compiling “equivalent” schemas can also grow internal caches over time (more likely if schemas differ or are dynamically generated).

**Recommendation**
- Cache compiled validators keyed by schema identity or stable hash:
  - simplest: `WeakMap<object, ValidateFunction>`
  - stronger: compute a stable signature for schema content (only if schema objects are not referentially stable).
- For the canonical config schema (`docs/config/schema.json`), compile once at startup and reuse.

---

### 2) `ensureRequiredProperties()` silently “fixes” unsatisfiable schemas by injecting `{}` property schemas (can hide schema bugs and weaken validation)
**Severity:** Medium  
**Where:** `ensureRequiredProperties()` lines **17–31**

When `additionalProperties === false` and `required` contains keys missing from `properties`, the schema is unsatisfiable in vanilla JSON Schema. The code “repairs” that by creating `schema.properties[key] = {}`.

That makes the schema satisfiable, but it also means:
- the missing property gets an **“always true”** schema (`{}`) → it accepts any value type/shape
- typos or omissions in the schema (e.g., forgetting to specify `port: {type:"number"}`) are no longer caught early; they become permissive instead of failing fast.

**Recommendation**
- Consider tightening the behavior:
  1. Add a **warning** path (dev log) when you have to inject `{}` due to an underspecified schema.
  2. Prefer injecting a **conservative schema** if possible, or require schema authors to define the property explicitly (and remove this workaround once schemas are cleaned up).
  3. At minimum, guard with an opt-in flag for “lenient schema repair”.

---

### 3) Prototype pollution / object-shape corruption risk via required keys like `__proto__`
**Severity:** Low in current usage, but **High** if schema becomes user-controlled  
**Where:** `ensureRequiredProperties()` lines **27–30**

If `schema.required` contains strings such as `__proto__`, `constructor`, or `prototype`, this line:

```js
schema.properties[key] = {};
```

can mutate the prototype of `schema.properties` (because `__proto__` is a special setter on plain objects), leading to hard-to-debug behavior and possible security issues.

Even if your current schemas are trusted, this is the kind of “lurking” issue that bites later when schemas become extensible (plugins/extensions/custom schemas).

**Recommendation**
- When copying required keys into `properties`, explicitly block or sanitize:
  - `__proto__`, `prototype`, `constructor`
- Safer approach: build `properties` as an object with a null prototype:
  - `schema.properties = Object.create(null)`
  - (and similarly for other maps if you want a consistent hardening posture)

---

### 4) No cycle detection in schema traversal (possible infinite recursion on cyclic schema graphs)
**Severity:** Low (most JSON schemas are acyclic), but tricky if schemas are programmatically composed  
**Where:** `ensureRequiredProperties()` recursive traversal (lines **11–56**)

`ensureRequiredProperties()` assumes the schema is a tree. If the schema object graph contains cycles (possible in JS-built schemas), recursion can become infinite.

**Recommendation**
- Add a `WeakSet` of visited nodes:
  - early return when already visited.

---

### 5) Validation strictness is intentionally lowered (`strict:false`) and formats aren’t registered
**Severity:** Medium (validation strength / correctness)  
**Where:** Ajv initialization lines **3–7**

- `strict:false` means Ajv will not enforce many schema correctness checks and may ignore unknown keywords; schema typos can slip through.
- No format plugin (`ajv-formats`) is registered. If schemas use `"format"` in the future, behavior may be “unknown format ignored” under non-strict modes.

**Recommendation**
- Prefer `strict: true` in dev/test (or at least CI) so schema mistakes are caught early.
- If you ever introduce `format` usage, explicitly register formats via `ajv-formats`.

---

## Small cleanup / maintainability nits

### 6) Redundant `schema.items` traversal
**Severity:** Low  
**Where:** lines **47–48**

Line 47 already handles arrays (`ensureRequiredProperties()` handles arrays at the top), so line 48 is redundant.

---

## Suggested “hard to find” regression tests

1. **Ajv compile caching**: call `validateConfig(sameSchema, config)` in a tight loop and ensure compile count doesn’t grow once caching is added.
2. **Schema repair warning**: schema with `additionalProperties:false` + `required:["port"]` but missing `properties.port` should emit a warning (or fail, depending on desired policy).
3. **Prototype pollution hardening**: schema with `required:["__proto__"]` should not mutate prototypes or crash; validate should behave deterministically.
4. **Cycle detection**: construct a cyclic schema object in JS and ensure `validateConfig()` doesn’t hang.

---

## Proposed patch sketch (non-binding)

- Add:

```js
const validatorCache = new WeakMap();
```

- In `validateConfig()`:

```js
let validate = validatorCache.get(schema);
if (!validate) {
  const normalizedSchema = structuredClone(schema);
  ensureRequiredProperties(normalizedSchema);
  validate = ajv.compile(normalizedSchema);
  validatorCache.set(schema, validate);
}
```

- In `ensureRequiredProperties()`:
  - add `visited` (`WeakSet`)
  - sanitize required keys and/or use `Object.create(null)` for maps

---


## Findings (prioritized)

### I1) LSP client shutdown timer can kill a *new* LSP process (cross-generation kill)
- **Severity:** High (correctness, intermittent)
- **File:** `src/integrations/tooling/lsp/client.js` — `shutdownAndExit()` (~L292–303)
- **What’s happening:** `shutdownAndExit()` schedules `setTimeout(() => { if (proc) kill(); }, 2500)`.  
  If the client is reused and `start()` creates a new LSP process before the timeout fires, the timeout will call `kill()` on the **new** process (because it reads the current `proc` variable at firing time).
- **Why it’s hard to find:** Only manifests when callers reuse a client after shutdown or when teardown overlaps with reconnection/backoff flows.
- **Fix:** Capture the current process or generation when scheduling:
  - `const current = proc; setTimeout(() => { if (proc === current) kill(); }, 2500)`
  - or capture `childGen` and check it’s unchanged.

### I2) LSP stderr handler ignores generation checks (noise + potential confusion during restarts)
- **Severity:** Low–Medium
- **File:** `src/integrations/tooling/lsp/client.js` — stderr handler (~L213–216)
- **What’s happening:** Unlike stdout handlers, stderr logging has no `(proc !== child || childGen !== generation)` guard. After restarts, logs from an old process can appear “current”.
- **Fix:** Add the same guard used elsewhere.

### I3) LSP VFS write path can escape the VFS root if `virtualPath` is absolute
- **Severity:** High (security / correctness hardening)
- **File:** `src/integrations/tooling/providers/lsp.js` — `ensureVirtualFile()` (~L87–91)
- **What’s happening:** `ensureVirtualFile()` writes to disk using `resolveVfsDiskPath({ baseDir, virtualPath })`.  
  If a caller supplies a document with `virtualPath` that begins with `/` (POSIX absolute), the derived “relative” path can become absolute and `path.join(baseDir, absolute)` will ignore `baseDir` → writing outside the intended sandbox.
- **Why it’s tricky:** In normal flows, virtual paths are generated internally and are safe; this appears only if documents are accepted from external callers.
- **Fix (in integrations):** Validate `doc.virtualPath` before writing:
  - reject if `path.isAbsolute(doc.virtualPath)` or it starts with `/` / `\\`
  - optionally also reject `..` segments even if later-encoded.

### I4) LSP position conversion doesn’t clamp negative values
- **Severity:** Low–Medium (hardening)
- **File:** `src/integrations/tooling/lsp/positions.js` — `positionToOffset()` (~L9–16)
- **What’s happening:** `col = Number(position.character) || 0` preserves negative values (because `-1 || 0` yields `-1`).
- **Impact:** If a server ever emits a negative `character`/`line` (buggy server / malformed diagnostics), offsets can go negative and break range matching.
- **Fix:** Clamp: `Math.max(0, Number(position.character) || 0)` and `Math.max(0, Number(position.line) || 0)`.

---

### I5) MCP error formatting mislabels non-numeric `error.code` as an “exitCode”
- **Severity:** Medium (client compatibility)
- **File:** `src/integrations/mcp/protocol.js` — `formatToolError()` (~L102–116), especially (~L108–110)
- **What’s happening:** If `error.code` exists but is not a known MCP error code, it is emitted as `payload.exitCode = error.code`.  
  For many Node/system errors, `error.code` is a **string** like `"ENOENT"` or `"EACCES"`, not a numeric exit code.
- **Impact:** Clients expecting `exitCode:number` may mis-handle failures.
- **Fix:** Emit separate fields:
  - `nativeCode` for string codes (`ENOENT`, etc.)
  - `exitCode` only when it’s a finite integer.

### I6) MCP remediation hint builder can do large lowercasing/joins of stdout+stderr
- **Severity:** Medium (performance/memory)
- **File:** `src/integrations/mcp/protocol.js` — `getRemediationHint()` (~L60–92)
- **What’s happening:** Concatenates `message`, `stderr`, and `stdout`, then lowercases the entire result. If stdout/stderr are large, this is expensive and memory-hungry.
- **Fix:** Truncate inputs before joining/lowercasing (e.g., first 8–32KB of each), or scan in a streaming/capped way.

---

### I7) `updateEnrichmentState()` is non-atomic, racy, and swallows all IO errors
- **Severity:** Medium (reliability)
- **File:** `src/integrations/core/enrichment-state.js` (~L6–21)
- **What’s happening:**
  - read/parse errors are ignored → state silently resets to `{}`.
  - updates are read-modify-write without a lock → concurrent writers lose fields.
  - writes are not atomic → partial/corrupted JSON possible on crash/interruption.
  - write errors are swallowed → callers assume state updated when it may not be.
- **Fix:** Use an atomic write (temp + rename) and a lock (or a single-writer discipline). At least log errors.

### I8) Records indexing uses `startsWith()` for directory containment checks (prefix bug)
- **Severity:** Medium (correctness hardening)
- **File:** `src/integrations/triage/index-records.js` (~L85–88)
- **What’s happening:** `absPath.startsWith(recordsDir)` is used to decide whether a record is under the triage directory.
- **Why it’s tricky:** String prefixes can misclassify paths (e.g., `/repo/triage` vs `/repo/triage-old`).
- **Fix:** Use `path.relative(recordsDir, absPath)` and validate it doesn’t start with `..` and isn’t absolute (pattern used elsewhere in the codebase).

### I9) Triage `ensureRecordId()` fallback can be huge and can throw
- **Severity:** Medium (robustness)
- **File:** `src/integrations/triage/normalize/helpers.js` (~L98–107), especially (~L101–104)
- **What’s happening:** If no stable key exists, it uses `JSON.stringify(raw)` as the “key” input.
- **Impact:**
  - Very large payloads → large allocations and slow hashing.
  - Cyclic structures → `JSON.stringify` throws.
- **Fix:** Use a capped stable stringify/hashing approach:
  - stable stringify with key ordering + size cap, or
  - hash a selected stable subset of fields, or
  - compute a content hash of the input file/record id.

### I10) Generic triage normalizer can undo routing meta and produce non-ISO timestamps
- **Severity:** Medium (data integrity)
- **File:** `src/integrations/triage/normalize/generic.js` (~L17–83), especially `Object.assign(record, raw)` (~L33)
- **What’s happening:**
  - `buildBaseRecord()` applies meta routing and default timestamps, then `Object.assign(record, raw)` allows the incoming payload to overwrite `service/env/team/owner/repo`, timestamps, `source`, etc.
  - `createdAt` / `updatedAt` are accepted as-is (not normalized to ISO), which can fail downstream schema expectations.
- **Fix:** Merge in the opposite direction (raw into a sanitized scaffold) or whitelist the fields that raw is allowed to override. Normalize timestamps via `toIso()`.

---

### I11) Tooling CLIs frequently compute `buildIndexSignature()` (can be very slow on large sharded indexes)
- **Severity:** Medium–High (performance)
- **Files:** `src/integrations/tooling/*` (api-contracts, architecture-check, context-pack, graph-context, impact, suggest-tests)
- **What’s happening:** These commands call `buildIndexSignature(indexDir)` even though they also read `compatibilityKey`.  
  In this repo, signature building is implemented as lots of synchronous directory listing + `stat` calls across shard files (see earlier findings).
- **Impact:** “Tooling” commands can become unexpectedly slow on large repos/indexes.
- **Fix:** Prefer the compatibility key/build id for provenance, or cache signatures, or avoid sharded-per-file stats.

### I12) Some `run*Cli()` functions call `process.exit()` internally
- **Severity:** Low–Medium (reusability/testing)
- **Files:** `context-pack.js`, `graph-context.js`, `impact.js`, `suggest-tests.js` (and to a lesser extent the others)
- **What’s happening:** Errors inside the exported `run*Cli()` functions terminate the process directly.
- **Impact:** Harder to import and test these as library functions.
- **Fix:** Return `{ok:false,...}` or throw and let the “bin” wrapper decide the exit code.

### I13) `status()` size computation is purely recursive and sequential
- **Severity:** Medium (performance on large caches)
- **File:** `src/integrations/core/status.js` — `sizeOfPath()` (~L17–33)
- **Impact:** Large cache roots → very slow status calls; also recursion depth could become a problem on pathological trees.
- **Fix:** Use iterative traversal (stack/queue) and/or bounded concurrency; consider sampling or skipping known-large trees unless requested.

### I14) Embeddings line parsing uses string concatenation on Buffer chunks (UTF-8 boundary edge case)
- **Severity:** Low–Medium (edge correctness)
- **File:** `src/integrations/core/embeddings.js` — `createLineEmitter.handleChunk()` (~L11–16)
- **What’s happening:** `buffer += chunk` coerces Buffers to strings; if multibyte UTF-8 characters are split across chunks, you can get replacement characters or corrupted lines.
- **Fix:** Use `StringDecoder('utf8')` from `node:string_decoder` to decode chunk boundaries safely.

### I15) Compatibility computation copies the entire runtime object per mode
- **Severity:** Low (perf/clarity)
- **File:** `src/integrations/core/build-index/compatibility.js` (~L6–18)
- **What’s happening:** `const runtimeSnapshot = { ...runtime, dictConfig: adaptedDictConfig }` for each mode.  
  If runtime carries large structures, this is extra overhead and can make debugging confusing.
- **Fix:** Pass only the minimal config subset needed by `buildTokenizationKey()`.

---

## Notes
- A number of integration modules depend on shared utilities (`subprocess`, `json-stream`, `index-cache`) that have separate findings in earlier reports; where that dependency materially affects integrations behavior, I’ve called it out (e.g., signature cost, atomic write behavior).

---


---

## Findings (bugs, reliability hazards, performance traps)

### 1) **Non-zero exit codes are treated as “OK” whenever `stdout` is non-empty** (can silently accept corrupted / partial output)
**Severity:** High (silent correctness failures)  
**File:** `src/experimental/structural/runner.js`  
**Where:** lines **22–25**, **40–43**, **67–70**

Pattern:

```js
if (result.status !== 0 && !result.stdout) throw ...
return parseX(result.stdout || '', ...)
```

**Why this is tricky**
- Many tools write *something* to stdout even on partial failure (or write “best effort” output and then exit non-zero).
- The current logic treats **any** non-empty `stdout` as a green light, even if the exit code indicates an error.
- Result: you can ingest incomplete data, miss matches, or misreport findings while losing the real error signal.

**Recommendation**
- Treat exit codes explicitly per engine:
  - **semgrep**: exit code 1 often means “findings found”; codes ≥2 are typically errors (exact semantics depend on semgrep version).
  - **ast-grep / comby**: decide what exit codes mean “findings vs error”; do not assume non-empty stdout implies success.
- At minimum: if `status !== 0`, still surface stderr (and optionally attach parsed results as “partial”).

---

### 2) **Windows `shell: true` for `.cmd/.bat` can introduce quoting / parsing edge cases** (esp. paths with spaces, special characters)
**Severity:** Medium (platform-specific correctness, hard to reproduce)  
**File:** `src/experimental/structural/binaries.js`  
**Where:** lines **8–13**, esp. **11–12**

```js
const useShell = isWindows && /\.(cmd|bat)$/i.test(command);
spawnSync(command, args, { shell: useShell })
```

**What can go wrong**
- When `shell:true`, Node routes execution through `cmd.exe` and must stringify/quote the command+args.
- Edge cases can appear with:
  - paths containing `&`, `^`, `|`, parentheses, `!` (delayed expansion),
  - odd quoting when args include JSON or regex-like strings,
  - command path resolution differences vs non-shell execution.

**Recommendation**
- Prefer executing `.cmd/.bat` via `cmd.exe /d /s /c` with carefully controlled quoting *or* avoid shell execution by resolving to an `.exe` where possible.
- If you keep `shell:true`, add regression tests for:
  - rule paths with spaces,
  - repo roots with parentheses,
  - patterns containing `&` or `|`.

---

### 3) **Resolver cache can become stale if PATH changes** (surprising behavior in long-running sessions)
**Severity:** Low–Medium  
**File:** `src/experimental/structural/binaries.js`  
**Where:** line **6** (global `binaryCache`), usage at **59**

- `resolveBinary(engine)` memoizes the resolution forever for the process lifetime.
- If a user installs `semgrep`/`sg` after the process starts (or PATH is modified), the resolver can remain stuck pointing to “missing” or an old path.

**Recommendation**
- Either:
  - include `process.env.PATH` (or a hash of it) in the cache key, or
  - allow an explicit “refresh” option.

---

### 4) **JSON-lines parsing silently drops bad lines and can drop valid falsy JSON values**
**Severity:** Medium (silent data loss)  
**File:** `src/experimental/structural/parsers.js`  
**Where:** `parseJsonLines()` lines **4–15**

Issues:
- Parse errors return `null` and are then filtered out with `.filter(Boolean)` → parse failures are *silent*.
- `.filter(Boolean)` also drops valid JSON values like `0`, `false`, and `""` (less likely here, but it’s a lurking footgun).

**Why this is tricky**
- If tool output changes format, includes prelude logs, or prints a single malformed line, you can end up with “empty results” and no error.

**Recommendation**
- Track parse failures:
  - return `{items, parseErrors}` and decide policy (warn/fail-fast).
- Use a filter that only removes `null/undefined` rather than Boolean coercion:
  - e.g., `.filter((x) => x != null)`.

---

### 5) **`parseAstGrep()` format assumptions are brittle** (likely to misparse some valid output shapes)
**Severity:** Medium (silent missed matches)  
**File:** `src/experimental/structural/parsers.js`  
**Where:** `parseAstGrep()` lines **61–97**

- It assumes entries look like `{ matches: [...] }`.
- If `sg scan --json` emits JSON Lines of *match objects* (or a different schema version), the loop will see `entry.matches` as undefined and produce no results (silently).

**Recommendation**
- Detect and normalize multiple possible output shapes:
  - array of `{matches:[...]}`,
  - JSONL of `{range, text, ...}` matches,
  - single object with `{matches:[...]}`.
- Fail loudly if output parses but doesn’t match expected schema (optional strict mode).

---

### 6) **`readCombyRule()` has no validation and uses permissive defaults** (can lead to “do nothing” searches)
**Severity:** Low–Medium (correctness)  
**File:** `src/experimental/structural/parsers.js`  
**Where:** lines **129–137**

- Missing / invalid rule fields are defaulted:
  - `language: '.'`, `pattern: ''`
- That can yield confusing behavior:
  - empty pattern, broad matcher, or tool errors depending on comby semantics.

**Recommendation**
- Validate required fields:
  - require `pattern` non-empty,
  - require `language` to be a known matcher,
  - surface a clear error pointing to the rule file.

---

### 7) **`writeJsonl()` builds a full in-memory string and writes synchronously** (scales poorly on large outputs)
**Severity:** Low–Medium (performance/memory)  
**File:** `src/experimental/structural/io.js`  
**Where:** lines **4–11**

- `items.map(JSON.stringify).join('\n')` builds one big string.
- `fs.writeFileSync()` blocks the event loop.
- For large result sets, this can be a noticeable memory spike.

**Recommendation**
- Stream JSONL output:
  - write line-by-line to a write stream
  - handle backpressure
- If remaining synchronous, at least document that it’s intended for small result sets.

---

### 8) Minor CLI-arg edge cases in model comparison helper
**Severity:** Low  
**File:** `src/experimental/compare/config.js`  
**Where:** lines **23–28**, **52–56**

- `resolveCompareModels()` dedupes but does not `trim()` config-provided entries (only CLI list gets trim) → `["gpt-4", " gpt-4"]` can survive as distinct until later.
- `resolveAnnSetting()` only detects `--ann` / `--no-ann` *as exact tokens* (raw string match). Variants like `--ann=false` or `--no-ann=true` could be misclassified depending on the arg parser used upstream.

**Recommendation**
- Normalize config model IDs with `.trim()`.
- Detect arg presence in a parser-aware way, or expand detection to include `--ann=` patterns if needed.

---

## “Hard-to-find” regression tests worth adding (if this graduates from experimental)

1. **Non-zero exit + stdout**: simulate a tool that prints partial JSON then exits 2; ensure you don’t silently accept results without reporting error.
2. **Windows quoting**: run with repo root containing parentheses + rules path containing spaces; ensure the invoked command sees correct argv.
3. **ast-grep schema variants**: feed JSONL match objects and array-of-results formats; ensure parser returns expected normalized results.
4. **JSONL parse error visibility**: include one malformed JSONL line; ensure you surface the parse error count and/or fail-fast in strict mode.
5. **Large output streaming**: 100k results JSONL should not allocate a single huge string or block for long.

---

## Patch sketches (non-binding)

- Make exit-code handling explicit per engine in `runner.js`, e.g.:

```js
const assertOk = ({ engine, status, stdout, stderr }) => {
  if (engine === 'semgrep') {
    if (status === 0 || status === 1) return; // (example semantics)
    throw new Error(stderr || `semgrep failed (status ${status})`);
  }
  if (status !== 0) throw new Error(stderr || `${engine} failed (status ${status})`);
};
```

- Improve `parseJsonLines()`:

```js
const parseJsonLines = (text) => {
  const items = [];
  const errors = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    try { items.push(JSON.parse(line)); }
    catch (e) { errors.push({ line: i + 1, error: String(e) }); }
  }
  return { items, errors };
};
```

- Switch `writeJsonl()` to streaming for large result sets.

---
