
## Executive summary

Key themes found in these remaining subsystems:

1. **Graph traversal has an avoidable O(n²) hotspot** (`Array.shift()` in BFS). This will show up on larger neighborhoods/graphs as steep slowdowns.
2. **Graph edge identity can become unstable** for unresolved symbol references (edge de-dup + ordering depend on candidate ordering that is not normalized). This can cause non-deterministic outputs and edge duplication/missing edges.
3. **Path normalization inconsistencies** (especially around file paths used as graph node IDs) can silently break cross-graph joins (import graph expansion + map import edges).
4. **Code-map symbol identity and merge precedence** can produce subtle map inaccuracies (collisions for same-name symbols; low-quality metadata can “win” forever).
5. **Viewer/export surfaces have a couple of security footguns** (raw SVG injection into HTML; optional URI template allows raw placeholder insertion; dynamic `import()` from configurable URLs).

## Findings

### [HIGH] G-1 — BFS uses `Array.shift()` causing O(n²) traversal cost on large neighborhoods

**Location:** `src/graph/neighborhood.js:457`

The neighborhood builder performs a breadth-first exploration using an array as a queue.
It dequeues via `queue.shift()` (line 457), which is O(n) per pop because it must reindex the entire array.
For graphs/neighborhoods with many enqueued nodes, this turns the traversal into O(n²) behavior and can dominate runtime.

This is particularly tricky because everything else in the algorithm looks linear-ish, so performance regressions only show up on larger repos or higher `depth` values.

**Recommendation:**

Replace `shift()` with a queue index pointer (the project already uses this pattern elsewhere, e.g. `src/graph/suggest-tests.js` uses `queueIndex`).
Example pattern:
- Keep `let qi = 0;`
- Use `const current = queue[qi++];`
- Stop when `qi >= queue.length`.

This change is mechanically safe and typically yields large speedups for big traversals.

### [HIGH] G-2 — Unresolved symbol-reference candidate ordering can make edge de-duplication and ordering non-deterministic

**Location:** `src/graph/neighborhood.js:109-158`, `src/graph/ordering.js:53-64`

Edges are de-duplicated using an `edgeKey()` that ultimately depends on `edgeEndpointKey()`.
For symbol-edge endpoints that are *reference envelopes* (unresolved/ambiguous), `referenceEnvelopeKey()` uses:

- `envelope.resolved` if present, else
- the **first** element of `envelope.candidates` (ordering.js:53-64).

However, when building normalized symbol envelopes, `normalizeSymbolRef()` copies candidates but **does not sort or canonicalize them** (neighborhood.js:109-158).

If upstream generation of candidates is not strictly deterministic (or changes between versions), the “first candidate” can vary even when the underlying set is the same.
That makes edge keys (and therefore edge de-duplication, ordering, and even path/witness outputs) **unstable across runs**.

Symptoms you may see:
- duplicate edges appearing/disappearing across builds
- unstable ordering of edges/nodes for the same inputs
- confusing diffs in generated reports/artifacts

**Recommendation:**

Canonicalize unresolved envelopes before they participate in edge keys:
- Sort `candidates` deterministically (e.g., by a stable key such as `symbolId|chunkUid|path`).
- Or, when unresolved, have `referenceEnvelopeKey()` hash **all** candidate keys (stable sorted) rather than using only the first.

If you want to preserve ranking semantics, you can keep the original candidate order for UX, but compute a separate canonical key used only for identity/dedup.

### [MEDIUM] G-3 — Import-graph expansion can silently fail due to inconsistent file-path normalization

**Location:** `src/graph/neighborhood.js:67-75`, `src/graph/neighborhood.js:447-452`

The import graph is indexed by raw `node.id` strings (`buildGraphIndex`, neighborhood.js:67-75).
When the traversal is currently on a chunk node, it attempts to join into the import graph via:

- `resolveImportSourceId(ref)` → `chunkInfo.get(ref.chunkUid)?.file` (neighborhood.js:447-452).

If `chunkInfo.file` is in a different format than `importGraph.node.id` (e.g., Windows `\` vs POSIX `/`, absolute vs relative, or different casing), `resolveGraphNeighbors()` will return no neighbors and the import expansion just… stops (no warning).

This is a classic “looks fine, but some repos have mysteriously empty import neighborhoods” type of bug.

**Recommendation:**

Normalize file paths consistently before indexing and before lookup:
- Apply a shared normalization function (at minimum: `toPosix()`, trim leading `./`).
- Ideally allow `buildGraphNeighborhood()` to accept `repoRoot` and normalize to repo-relative paths (like other parts of the codebase do).
- Consider emitting a warning if an importGraph lookup is attempted and the resolved ID is not found in the importGraph index.

### [MEDIUM] G-4 — `GraphStore.loadOnce()` caches rejected promises, preventing retries after transient failures

**Location:** `src/graph/store.js:35-41`

`loadOnce()` memoizes the promise returned by the loader and stores it in `artifactCache`.
If the loader rejects (e.g., transient read error, partial file, momentary FS hiccup), the rejected promise stays cached and every subsequent call returns the same rejection.

This is subtle because it only matters when failures are transient or recoverable (e.g., CI artifact restore races).

**Recommendation:**

Evict cache entries on rejection to allow retry:

```js
const promise = Promise.resolve().then(loader).catch(err => {
  artifactCache.delete(name);
  throw err;
});
```

If you *do* want sticky failures, consider recording the error explicitly and surfacing it via `getArtifactsUsed()` or a diagnostic API.

### [MEDIUM] M-1 — `scope=dir` filter uses `startsWith()` without a directory boundary check

**Location:** `src/map/build-map/filters.js:104-115`

Directory scoping uses:

- `node.path.startsWith(normalizedFocus)` (filters.js:106).

If the user passes `focus="src"` (no trailing slash), this will also match paths like `src-old/...` or `src2/...`.
That yields confusing “why did this file show up?” results and makes scoped maps unreliable in monorepos with similarly-prefixed directories.

**Recommendation:**

Use a boundary-aware check:
- `node.path === normalizedFocus || node.path.startsWith(normalizedFocus + '/')`

You can also normalize `focus` by stripping any trailing slashes and then applying the boundary check above.

### [MEDIUM] M-2 — Potential symbol ID collisions for same-name symbols in the same file, plus “first metadata wins” merge semantics

**Location:** `src/map/build-map/symbols.js:6-18`, `src/map/build-map/symbols.js:54-69`

When `symbolId` and `chunkUid` are absent, `buildSymbolId()` falls back to `${file}::${name}` (symbols.js:6-18).
If multiple symbols share the same name in the same file (common with overloads, re-exports, or certain languages), this can collide.

Additionally, `upsertMember()` only overwrites fields when the existing member is missing that field (symbols.js:54-69).
If a low-fidelity source (e.g., legacy repo_map) creates a member first, then a higher-fidelity source (e.g., chunk_meta v2) arrives later, the better metadata may be ignored forever.

These are ‘soft correctness’ problems that are hard to notice unless you compare the map output against ground truth.

**Recommendation:**

Collision mitigation options:
- Incorporate range (startLine/endLine) into the fallback ID when available.
- Or incorporate `kind` + startLine even when `name` is present (if uniqueness is more important than readability).

Merge precedence options:
- Track a `source` / `confidence` field and allow later higher-priority sources to overwrite.
- Or add a `prefer` flag when calling `upsertMember` from chunk_meta vs repo_map.

### [MEDIUM] M-3 — `buildImportEdges()` does not normalize paths, risking missing/misaligned import edges on Windows or mixed formats

**Location:** `src/map/build-map/edges.js:190-209`

`buildImportEdges()` uses `entry.file` and `target` verbatim when creating edges (edges.js:193-206).
Elsewhere in map building, file paths are normalized (POSIX slashes) via `normalizePath()`.

If `file_relations` ever contains Windows-style separators or absolute paths, the import edges may not match the normalized file nodes and will be filtered out later (or render as dangling).

**Recommendation:**

Normalize both endpoints:
- `const from = normalizePath(entry.file);`
- `const to = normalizePath(target);`

Also normalize before applying `fileSet` checks, otherwise the filter will behave inconsistently.

### [MEDIUM] M-4 — HTML export injects raw SVG without sanitization (XSS risk if SVG is untrusted)

**Location:** `src/map/html-writer.js:42`

`renderSvgHtml()` inserts `${svg || ''}` directly into the HTML output (html-writer.js:42).
If the SVG content is ever derived from untrusted input (or if a malicious repo can influence the SVG), this can allow script execution when the HTML file is opened.

This is easy to miss because other strings are escaped via `escapeHtml()`.

**Recommendation:**

If the SVG is always generated locally and never from untrusted sources, document that assumption clearly.
Otherwise consider:
- Sanitizing SVG (remove `<script>`, event handlers, foreignObject, etc.).
- Or embedding the SVG as an `<img src="data:image/svg+xml;base64,...">` so it isn’t executed as DOM (still has caveats).
- Or serving it in a sandboxed iframe.

### [MEDIUM] M-5 — Isometric viewer can navigate to arbitrary URIs via template; includes an unencoded `{fileRaw}` placeholder

**Location:** `src/map/isometric/client/selection.js:567-597`

`buildOpenUri()` builds a URL from `state.config.openUriTemplate` and then navigates via `window.location.href` (selection.js:592-597).
It provides both an encoded `{file}` and an unencoded `{fileRaw}` replacement (selection.js:580-588).

If the template uses `{fileRaw}` and the underlying file path contains unexpected characters, it can produce malformed URIs or enable injection-like behavior depending on the consumer.

This may be acceptable for a trusted, local-only viewer, but it’s a sharp edge if the viewer is ever hosted/shared.

**Recommendation:**

Prefer an all-encoded template surface:
- Deprecate or remove `{fileRaw}` (or encode it as well).
- Consider whitelisting allowed URI schemes (e.g., `vscode://`, `file://`) before navigation.
- Alternatively, open in a new tab with `noopener` to reduce risk when navigating off-site.

### [LOW] G-5 — `createWorkBudget().consume()` accepts negative/float units, allowing limit bypass if misused

**Location:** `src/graph/work-budget.js:33-37`

`consume()` uses `Number.isFinite(units) ? units : 1` and then adds it to `used` (work-budget.js:35-37).
If any caller ever passes a negative value, `used` decreases and caps can be bypassed.

Today, callers appear to pass `1`, so this is mainly a future-proofing correctness guard.

**Recommendation:**

Clamp `units` to a positive integer:
- `const increment = Math.max(1, Math.floor(Number(units) || 1));`
Or if you really want fractional work units, at least enforce `increment > 0`.

### [LOW] G-6 — Edge case: path normalization can retain absolute paths when `path.relative()` returns an empty string

**Location:** `src/graph/architecture.js:12-25`

In `normalizePath()`, the code checks `if (rel && !rel.startsWith('..') ...)` (architecture.js:18).
If `raw === repoRoot`, `path.relative(repoRoot, raw)` returns `''` (empty string), which is falsy, so the absolute path is retained.

This is a niche edge case (likely only triggered if a rule/event incorrectly provides the repo root itself as a “file path”), but it can cause absolute-path leakage into reports.

**Recommendation:**

Treat `rel === ''` as `'.'` or explicitly handle this case:
- `const rel = path.relative(repoRoot, raw) || '.';`
Then strip `./` as you already do.

### [LOW] G-7 — Test discovery uses synchronous FS traversal without per-directory error handling

**Location:** `src/graph/suggest-tests.js:99-133`

`discoverCandidateTests()` walks the repo using `fs.readdirSync()` (line 109).
Two implications:

- **Robustness:** if it encounters a directory it cannot read (permissions, transient IO errors), it will throw and abort the entire suggestion run.
- **Performance:** synchronous recursive walks can be slow on huge repos or networked filesystems, and this is done before the rest of the test-suggestion logic.

**Recommendation:**

Wrap the `readdirSync()` call in a try/catch and skip unreadable directories.
Optionally add an async version or allow callers to provide a precomputed file list.

### [LOW] M-6 — Viewer loads modules via dynamic `import()` from configurable URLs (supply-chain / XSS footgun if config is untrusted)

**Location:** `src/map/isometric/client/three-loader.js:58-89`

`loadThreeModules(threeUrl)` does `await import(threeUrl)` (three-loader.js:58-60).
`loadRgbeLoader(url)` similarly imports from `url` if provided (three-loader.js:77-85).

If these URLs can be influenced by an untrusted party, this is equivalent to arbitrary script execution in the viewer context.
In a local developer tool this may be fine; in a hosted scenario, it’s dangerous.

**Recommendation:**

If the viewer is meant to be local-only, document that clearly.
If it can be hosted, restrict imports to a safe allowlist (or bundle dependencies rather than importing arbitrary URLs).

### [LOW] M-7 — Isometric layout ordering is O(n²) and may stall for very large file counts

**Location:** `src/map/isometric/client/layout-utils.js:149-190`

`orderByAdjacency()` selects the next item by scoring every remaining item against all already-placed items.
That is inherently O(n²) (and can approach O(n³) if adjacency scoring is dense).

This is acceptable for small/medium maps, but for maps near the default max files (200) it can become noticeable in the browser.

**Recommendation:**

If large interactive maps are a goal:
- Add a fast-path: skip adjacency ordering past a threshold.
- Or use a heuristic that doesn’t rescore against all placed items (e.g., greedy from the last placed, or a limited-window scoring).
