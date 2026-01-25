# Codebase Static Review Findings — Tools Sweep (Pass 7)

This sweep statically reviews a set of **tooling/utility scripts** (evaluation harnesses, ingest pipelines, MCP server/tool glue, map serving, and release/ops helpers). The emphasis is on **correctness**, **mis-implementations**, **robustness**, **performance hazards**, and **config / behavior drift**.

> Constraints honored: this is a static review only — **no code changes applied**. Each issue includes concrete suggestions and, where applicable, tests that would prevent regression.

## Scope

Reviewed files (only):

- Eval tooling
  - `tools/eval/match.js`
  - `tools/eval/run.js`
- Config/dictionary generation + ops helpers
  - `tools/generate-demo-config.js`
  - `tools/generate-repo-dict.js`
  - `tools/get-last-failure.js`
  - `tools/reset-config.js`
  - `tools/release-check.js`
  - `tools/mergeAppendOnly.js`
  - `tools/path-utils.js`
- SCM / hooks
  - `tools/git-hooks.js`
- Tag / index ingest
  - `tools/gtags-ingest.js`
  - `tools/lsif-ingest.js`
  - `tools/scip-ingest.js`
- Index state validation + service
  - `tools/index-state-utils.js`
  - `tools/index-validate.js`
  - `tools/indexer-service.js`
- Repo map tooling
  - `tools/map-iso-serve.js`
  - `tools/report-code-map.js`
  - `tools/report-artifacts.js`
- MCP server and tools
  - `tools/mcp/repo.js`
  - `tools/mcp/runner.js`
  - `tools/mcp/tools.js`
  - `tools/mcp/transport.js`
  - `tools/mcp-server.js`
- Test gates / parity runner
  - `tools/run-phase22-gates.js`
  - `tools/parity-matrix.js`
- Metrics dashboard
  - `tools/repometrics-dashboard.js`

---

## Executive summary

### Highest priority correctness issues

1. **LSIF ingest appears to misinterpret `item` edges (likely reversed), so it will emit incorrect or empty results**.
   - `tools/lsif-ingest.js` (`handleEdge()` assumes `edge.outV` is a range and `edge.inVs` are results, which is typically inverted in LSIF dumps). See `tools/lsif-ingest.js:114–142`.

2. **GTAGS ingest parses `global -x` output incorrectly, treating the “source snippet” as part of the filename**.
   - `tools/gtags-ingest.js` joins `parts.slice(2)` into `file`, which (for `global -x`) includes `file + code snippet`. This contaminates filenames/extensions and breaks downstream use. See `tools/gtags-ingest.js:54–62`.

3. **MCP `search` tool drops cancellation/timeout signal due to variable shadowing**.
   - `tools/mcp/tools.js` shadows the `context` parameter with a local `const context = ...` (numeric), and later passes `signal: context.signal`, which becomes `undefined`. See `tools/mcp/tools.js:152–160` and `:279`.

4. **`map-iso-serve` path safety check is vulnerable to prefix confusion and can throw on malformed URL encoding**.
   - `safeJoin()` uses `startsWith(baseDir)` (prefix, not boundary-aware), and `decodeURIComponent()` is unguarded. See `tools/map-iso-serve.js:80–86` and `:108–111`.

### Important robustness/perf issues (worth fixing before scaling usage)

- **Multiple ingest tools end their output stream but do not wait for the write buffer to flush** (`writeStream.end()` without awaiting `'finish'`). This can produce truncated output on fast exit / large streams.
  - `tools/gtags-ingest.js:119`
  - `tools/lsif-ingest.js:172`
  - `tools/scip-ingest.js:223`

- **`eval-run` metrics can exceed 1.0 and/or overcount** because it counts *hits* that match *any* expected item rather than matching expected items uniquely.
  - `tools/eval/run.js:134–146`.

- **`eval-run` likely disables ANN by default** due to `yargs` boolean default behavior (`argv.ann` becomes `false` unless explicitly set), causing `--no-ann` to be passed unintentionally.
  - `tools/eval/run.js:48` + `:95–96`.

---

## Findings

### 1) Critical — LSIF ingest likely inverts `item` edge semantics

**Where**
- `tools/lsif-ingest.js` — `handleEdge()`

**Evidence**
- The implementation treats `edge.outV` as a *range id* and `edge.inVs` as *result ids*:

```js
if (label === 'item' && edge.outV != null && Array.isArray(edge.inVs)) {
  const doc = rangeToDoc.get(edge.outV) || null;
  // ...
  const range = rangeById.get(edge.outV);
  for (const inV of edge.inVs) {
    const inVertex = vertexById.get(inV);
    const inLabel = inVertex?.label || inVertex?.type || null;
    const role = inLabel === 'definitionResult' ? 'definition' : ...
    // recordEntry(...)
  }
}
```

Line reference: `tools/lsif-ingest.js:114–142`.

**Why this is likely wrong**
- In standard LSIF dumps, `item` edges usually point from a *result node* (definitionResult/referenceResult) to a set of *ranges* (`inVs`) with an associated `document`. In other words, `outV` is commonly the **result**, not the **range**.
- With the current assumptions, `rangeToDoc.get(edge.outV)` will frequently be `null` (since `outV` is a result id, not a range id), and the ingest path will silently emit nothing.

**Impact**
- Definitions/references extracted from LSIF will be missing or severely incorrect.
- Any roadmap work that depends on LSIF artifacts (definition graphs, cross-file call graphs, type links, etc.) will start from corrupted inputs.

**Suggestions to fix (no code changes applied here)**
- Validate against a real LSIF fixture (small) and update parsing logic to match LSIF schema:
  - Support both `inV` and `inVs` forms.
  - Prefer `edge.document` when present; do not infer document by “range contained in doc” if the LSIF already specifies it.
  - Treat `outV` as the result node and `inVs` as ranges (or vice versa only when producer evidence confirms it).
- Add a compatibility adapter: detect directionality by sampling a few edges and checking whether `outV` refers to a vertex with label `definitionResult`/`referenceResult` vs `range`.

**Tests to add**
- Fixture-based test with a known LSIF snippet:
  - One document, two ranges, one definitionResult item edge.
  - Assert emitted JSONL includes correct `file`, `startLine`, and `role`.
- A “non-empty ingestion” test: given a known LSIF input, assert `stats.definitions + stats.references > 0`.

---

### 2) Critical — GTAGS ingest corrupts file paths for `global -x`

**Where**
- `tools/gtags-ingest.js` — `parseGlobalLine()`

**Evidence**

```js
const parts = trimmed.split(/\s+/);
// ...
const file = parts.slice(2).join(' ');
```

Line reference: `tools/gtags-ingest.js:54–62`.

**Why this is a real bug**
- `global -x` output typically has the form:
  - `<symbol> <line> <path> <source_snippet...>`
- The current parser treats everything from the third token onward as part of the “file”, which includes the source snippet, corrupting:
  - `payload.file`
  - `payload.ext` (computed from corrupted file path)
  - downstream join/normalize logic

**Impact**
- Tag ingest output becomes unusable as a definition index.

**Suggestions to fix**
- Parse exactly three primary columns (name, line, path) and ignore/optionally store the trailing snippet in a separate field (e.g., `preview`).
- If you need to support spaces in file paths (rare), use `global` options that print machine-readable output, or parse with positional indexes from the right with a heuristic.

**Tests to add**
- Unit test with representative `global -x` line containing a code snippet:
  - Assert `file` equals the third column only.
  - Assert `ext` equals `.c` (or expected).

---

### 3) High — MCP `search` tool loses abort signal due to `context` shadowing

**Where**
- `tools/mcp/tools.js` — `runSearch()`

**Evidence**

```js
export async function runSearch(args = {}, context = {}) {
  if (context.signal?.aborted) {
    const error = new Error('Search cancelled.');
    error.code = ERROR_CODES.CANCELLED;
    throw error;
  }

  // ... later ...
  const context = Number.isFinite(Number(args.context)) ? Math.max(0, Number(args.context)) : null;

  const payload = await coreSearch(repoPath, {
    // ...
    signal: context.signal
  });
}
```

Line references:
- Shadowing declaration: `tools/mcp/tools.js:152–160`
- Signal pass-through: `tools/mcp/tools.js:279`

**Why this is a real bug**
- The `context` parameter is meant to carry `{ signal, progress, toolCallId }` from `tools/mcp/transport.js`.
- By redeclaring `const context = ...` as a number, the function can no longer access `context.signal` when calling `coreSearch`.

**Impact**
- MCP cancellations/timeouts do not propagate into core search.
- Long-running searches keep executing after the client cancels.

**Suggestions to fix**
- Rename the local numeric “context size” variable (e.g., `contextTokens` / `contextLimit`) and keep the parameter named `context`.
- Add a regression test that:
  - Provides a pre-aborted signal and asserts the tool throws `CANCELLED`.
  - Uses a short timeout and asserts the search observes abort quickly (requires core search to honor abort).

---

### 4) High — `map-iso-serve` path safety check is not boundary-safe + unguarded URI decode

**Where**
- `tools/map-iso-serve.js`

**Evidence**

```js
const safeJoin = (baseDir, relativePath) => {
  const safePath = path.resolve(baseDir, relativePath);
  if (!safePath.startsWith(baseDir)) {
    return null;
  }
  return safePath;
};

const pathname = decodeURIComponent(url.pathname);
```

Line references:
- `safeJoin`: `tools/map-iso-serve.js:80–86`
- `decodeURIComponent`: `tools/map-iso-serve.js:108–111`

**Why this is a real bug**
- Prefix checks are not equivalent to “inside directory” checks:
  - `baseDir=/a/b` and `safePath=/a/bad/file` passes `startsWith('/a/b')`.
- `decodeURIComponent()` throws on malformed percent-encoding; one bad request can crash the server.

**Impact**
- This is a local-only server (`127.0.0.1`), but the failure mode is still undesirable:
  - Potential path disclosure/serving from unintended directories.
  - Crash-on-request bugs.

**Suggestions to fix**
- Use `path.relative(baseDir, safePath)` and ensure it does not start with `'..'` and is not absolute.
- Wrap decode in try/catch and return a 400.

**Tests to add**
- Unit test for `safeJoin()`:
  - Ensure `/a/bad/file` is rejected when base is `/a/b`.
- Integration test that requests `/%E0%A4%A` (malformed encoding) and asserts a 400 instead of process crash.

---

### 5) High — `eval-run` metrics can overcount and exceed 1.0; ANN default likely forced off

**Where**
- `tools/eval/run.js`

**Evidence (overcount)**

```js
hits.forEach((hit, index) => {
  const rank = index + 1;
  if (silver.some((exp) => isMatch(hit, exp))) ranks.push(rank);
});

const computeRecallAtK = (ranks, totalRelevant, k) => {
  const found = ranks.filter((rank) => rank <= k).length;
  return found / totalRelevant;
};
```

Line references:
- Rank accumulation: `tools/eval/run.js:134–140`
- Recall formula: `tools/eval/run.js:67–71`

**Why this is a real bug**
- This measures “number of matching hits” rather than “number of unique relevant items retrieved”.
- A single relevant item can be matched multiple times, producing:
  - `recall@k > 1.0`
  - `ndcg@k > 1.0`

**Evidence (ANN default)**

```js
ann: { type: 'boolean' },
// ...
const annFlag = typeof argv.ann === 'boolean' ? argv.ann : null;
// ...
if (annFlag === false) args.push('--no-ann');
```

Line references: `tools/eval/run.js:17`, `:48`, `:95–96`.

**Why ANN likely gets disabled unintentionally**
- With `yargs`, boolean options often default to `false` when not explicitly provided.
- That makes `annFlag=false` even when the user did not choose it, which then forces `--no-ann`.

**Suggestions to fix**
- Make relevance matching **one-to-one**:
  - For each expected item, find the best (minimum) rank of any hit that matches it.
  - Compute recall@k based on how many expected items have bestRank <= k.
  - Compute NDCG using one gain per expected item (avoid double-counting duplicates).
- Make ANN tri-state explicit:
  - Use a string flag (e.g., `--ann=auto|on|off`), or
  - Detect explicit presence of the flag rather than relying on boolean default.

**Tests to add**
- A synthetic dataset where the same expected entry matches two hits:
  - Assert recall@k is capped at 1.0.
- A CLI parse test proving “no `--ann`” does not force `--no-ann`.

---

### 6) Medium — Tool ingest scripts don’t wait for stream flush before writing meta/exiting

**Where**
- `tools/gtags-ingest.js:119`
- `tools/lsif-ingest.js:172`
- `tools/scip-ingest.js:223`

**Why this matters**
- `writeStream.end()` is asynchronous; without waiting for `'finish'`, a fast process exit can cut the last buffered writes.
- This risk increases with larger repos and/or slower disks.

**Suggestions to fix**
- Await the `'finish'` event before writing meta (or before process exit).
- If you want maximum robustness, also handle `'error'` on the write stream and propagate into `stats.errors` and non-zero exit codes.

**Tests to add**
- Integration test that writes many lines and ensures the output JSONL line count matches expected.

---

### 7) Medium — `index-validate` accepts arbitrary modes and can crash on unknown mode keys

**Where**
- `tools/index-validate.js`

**Evidence**

```js
const modes = parseModes(argv.mode, root, userConfig);
// ...
for (const mode of modes) {
  const entry = report.modes[mode];
  const status = entry.ok ? 'ok' : 'missing';
}
```

Line references: `tools/index-validate.js:52–66`.

**Why this is a real bug**
- `parseModes()` returns `Array.from(modeSet)` without validating against supported modes.
- If a user passes `--mode bananas`, `report.modes[bananas]` is likely `undefined` and the script will throw on `entry.ok`.

**Suggestions to fix**
- Validate the tokens against a known enum.
- If unknown modes are provided, fail with an explicit message listing valid modes.

**Tests to add**
- `--mode invalid` should exit non-zero and print valid modes.

---

### 8) Medium — `indexer-service` queue naming ignores `--reason` for `--queue auto`

**Where**
- `tools/indexer-service.js`

**Evidence**

```js
const resolvedQueueName = resolveQueueName(queueName, {
  reason: queueName === 'embeddings' ? 'embeddings' : null,
  stage: argv.stage || null,
  mode: argv.mode || null
});
```

Line references: `tools/indexer-service.js:39–43`.

**Why this is a problem**
- The queue library supports `--queue auto` and uses `job.reason` to choose between `index-*` vs `embeddings-*` queues.
- The service resolves the queue name at startup without considering `argv.reason`, so:
  - Enqueued jobs may end up in `embeddings-<stage>-<mode>` (if `--reason embeddings` is used)
  - Worker may poll `index-<stage>-<mode>` (because it hardcodes `reason:null` when `queueName !== 'embeddings'`)

**Impact**
- “Auto” queue mode becomes unreliable and can silently strand jobs.

**Suggestions to fix**
- If you keep `queue=auto`, incorporate `argv.reason` into the `resolveQueueName()` call.
- Alternatively, explicitly deprecate `queue=auto` and require `--queue index|embeddings`.

**Tests to add**
- Enqueue a job with `--queue auto --reason embeddings` and assert the worker sees it.

---

### 9) Medium — `tools/mcp/repo.js` path canonicalization and build-pointer parse failure can yield stale caches

**Where**
- `tools/mcp/repo.js`

**Issues**

1) **`resolveRepoPath()` does not always resolve to repo root**
- It returns `base` when `inputPath` is provided (subdir allowed), but returns repo root only when no inputPath.
- Evidence: `tools/mcp/repo.js:128–134`.

**Impact**
- Cache keys and artifact paths can be incorrect if MCP clients pass a subdirectory.
- This directly impacts multi-repo/federation correctness (wrong repo id, wrong index cache, wrong sqlite path).

2) **Build pointer parse errors keep stale build id/caches**
- If `builds/current.json` exists but contains invalid JSON, the catch only resets `buildPointerMtimeMs` and does not clear caches or `buildId`.
- Evidence: `tools/mcp/repo.js:80–95`.

**Suggestions**
- Always normalize to repo root for cache keys.
- Treat build-pointer parse errors as “pointer invalid” and clear build id + caches to avoid serving stale indexes.

---

### 10) Medium — MCP timeout infrastructure does not reliably terminate underlying work

**Where**
- `tools/mcp/transport.js` uses `AbortController` and `withTimeout()`.
- `tools/mcp/runner.js` provides `withTimeout()`.

**Observed behavior**
- Timeout aborts the controller, but:
  - Many invoked operations are spawned node scripts (`runNodeAsync`), which are not automatically killed.
  - `withTimeout()` has an `onTimeout` hook, but `runNodeAsync` does not expose a handle to terminate the child.

**Impact**
- After a timeout/cancel, a heavy operation may continue consuming CPU/disk.

**Suggestions**
- Thread cancellation through the entire call chain:
  - `coreSearch` should honor `signal`.
  - child-process tools should accept an AbortSignal and kill the child on abort.
- Add tests that verify cancellation stops work within a bounded time.

---

### 11) Low — `git-hooks` does not support worktrees and overwrites existing hooks

**Where**
- `tools/git-hooks.js`

**Issues**
- Assumes `.git` is a directory and places hooks at `.git/hooks`.
  - Git worktrees often have `.git` as a file pointing at the real gitdir.
  - Evidence: `tools/git-hooks.js:21–28`.
- Overwrites hook files unconditionally; does not preserve user hooks.
  - Evidence: `tools/git-hooks.js:48–55`.

**Suggestions**
- Resolve git dir using `git rev-parse --git-path hooks` or parse `.git` file.
- Install hooks via a wrapper that chains to existing hooks rather than replacing.

---

### 12) Low — `generate-demo-config` can emit misleading defaults for object types

**Where**
- `tools/generate-demo-config.js`

**Issue**
- For object schema nodes without defaults, `resolveDefault()` returns `null`, which can mislead users/config tooling.
- Suggestion: emit `{}` for object defaults or omit the key from demo config unless required.

---

### 13) Low — `generate-repo-dict` reads whole files into memory and underuses dict config

**Where**
- `tools/generate-repo-dict.js`

**Issues**
- Manual fallback walker reads entire file content (`fs.readFile(filePath, 'utf8')`). For large/minified files, this is costly.
- It loads dict config for `output`, but does not use other possible dict settings (extensions, ignore patterns, size caps).

**Suggestions**
- Add a max file size cap (configurable).
- Consider streaming tokenization for large files.
- Integrate config’s ignore/include patterns to match index behavior.

---

### 14) Notes — Other reviewed tools look reasonable, with minor hardening opportunities

These files appear structurally sound for their intended purpose, with only minor polish items:

- `tools/index-state-utils.js`
  - Safe and narrow; uses atomic JSON write. Consider not treating `bytes=0` as “missing” (`:30`) purely for correctness.
- `tools/report-code-map.js` / `tools/report-artifacts.js`
  - Generally robust; dot/Graphviz missing is handled via warnings.
- `tools/parity-matrix.js`
  - Works as a harness; minor input validation (parse errors) would improve UX.
- `tools/repometrics-dashboard.js`
  - Reads whole JSONL into memory; consider streaming if file sizes grow.
- `tools/reset-config.js`
  - Sensible; but consider a “dry run” option and/or a structured confirmation prompt.
- `tools/run-phase22-gates.js`
  - Clear and guarded.

---

## Cross-cutting recommendations

1. **Standardize child-process execution and error handling**
   - Several tools spawn external binaries (`global`, `scip`, `dot`) but don’t attach an `'error'` handler. If the binary is missing, Node emits an `'error'` event and can crash.
   - A shared helper should:
     - attach `child.on('error', ...)` and convert to actionable messages
     - surface exit codes clearly
     - optionally support AbortSignals to kill children

2. **Unify “repo root resolution” across tool surfaces**
   - Some tools treat passed `--repo` as root; others allow subdirs. MCP caching correctness depends on a single canonical root.

3. **Add fixture-based ingest tests (LSIF/SCIP/GTAGS)**
   - These are high-impact primitives, and small changes can silently break them.

4. **Adopt consistent output contracts for tool scripts**
   - When scripts output JSONL + `.meta.json`, ensure:
     - `.meta.json` is written only after output is fully flushed
     - failures produce non-zero exit codes and include a reason in meta

---

## Suggested next actions (practical ordering)

1. Fix LSIF ingest semantics + add fixtures.
2. Fix GTAGS ingest parsing + add a unit test for `global -x` line parsing.
3. Fix MCP `runSearch` context shadowing (this is a one-line class of bug) + add cancellation test.
4. Harden `map-iso-serve` path safety + decode error handling.
5. Fix `eval-run` tri-state flags + metric correctness.
6. Add stream-flush awaits in all ingest tools.

