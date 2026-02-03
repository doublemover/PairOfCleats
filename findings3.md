
---

## Findings

### 1) **Prototype pollution / global object corruption** via plain-object “maps” keyed by code identifiers

**Severity:** Critical  
**Location:** `src/lang/javascript/relations.js` (around L240–L320)

This file uses plain objects as dictionaries keyed by *identifier names from parsed code*:

- `const functionMeta = {};`
- `const classMeta = {};`
- later: `const existing = functionMeta[name]; if (!existing) ... else ...`

This is extremely dangerous in JavaScript because names like `__proto__`, `constructor`, `toString`, etc. have special meaning on objects with `Object.prototype` in their prototype chain.

#### Why this is a real exploit path (not theoretical)

If a repo being indexed contains a function named `__proto__` (valid identifier):

```js
function __proto__() {}
```

Then:

- `functionMeta["__proto__"]` **does not return** a stored entry.
- It returns `Object.prototype` (because `__proto__` is an accessor).
- `existing` becomes `Object.prototype`, which is truthy.
- The `else` branch mutates `existing.*` → **mutates `Object.prototype` globally**.

That means a single adversarial identifier can:
- corrupt global prototypes (`Object.prototype.params`, etc.),
- create unpredictable behavior across the entire process,
- potentially become a security primitive depending on downstream assumptions.

This is a classic “hard-to-find” bug because normal repos rarely define `__proto__`-named functions/classes.

**Suggestion (strong)**
- Replace these dictionaries with `Map`, **or** with `Object.create(null)` and strict own-property checks.
- In particular: never use `if (!existing)` on dictionary lookups; always use an own-key check.

**Example patch shape**
- `const functionMeta = new Map();`
- `if (!functionMeta.has(name)) functionMeta.set(name, {...}); else { merge... }`

Or:

- `const functionMeta = Object.create(null);`
- `if (!Object.prototype.hasOwnProperty.call(functionMeta, name)) { ... }`

---

### 2) Generic AST traversal walks `tokens` (and other heavy fields) → big avoidable CPU cost

**Severity:** Medium (perf)  
**Locations:**
- `src/lang/javascript/imports.js` (around L45–L99)
- `src/lang/javascript/relations.js` (around L660–L820)
- `src/lang/typescript/relations.js` (generic AST walk)

These modules implement a generic recursive walker that iterates `Object.keys(node)` / `Object.values(node)` and recurses into every object/array field, only skipping `loc`, `start`, `end`.

When Babel parsing is configured to include tokens, the AST includes a large `tokens` array. The generic walkers will recursively traverse **every token object** even though token objects are irrelevant for import/call extraction.

This can become a large runtime tax:
- O(#tokens) additional traversal work per file
- extra allocations and GC pressure
- duplicates work in `relations.js`, which separately processes tokens later

**Suggestion**
- Explicitly skip well-known non-AST fields: `tokens`, `comments`, `leadingComments`, `trailingComments`, `extra`, etc.
- Or use a structured AST walker that only follows known AST child fields.
- Consider an iterative stack to avoid recursion overhead (see next finding).

---

### 3) Recursive AST walking risks call stack overflow on adversarially deep syntax

**Severity:** Medium (stability)  
**Locations:** same as Finding #2

The walkers are recursive. A deeply nested AST (intentional or accidental) can exceed the JS call stack and crash the indexing run.

This is rare in normal code, but it’s common in “fuzzer / adversarial repo” scenarios and can happen with:
- very deeply nested expressions / arrays / chained calls
- huge generated code blobs

**Suggestion**
- Rewrite walkers to iterative form (explicit stack).
- Or use a traversal library that is iterative.

---

### 4) TypeScript signature param parsing is regex-based and breaks on nested parentheses (function types, defaults)

**Severity:** Medium (correctness)  
**Location:** `src/lang/typescript/signature.js` (around L13–L16 and L33–L37)

These helpers extract params using:

- `signature.match(/\(([^)]*)\)/)`
- and split on commas

This fails when parameter types contain parentheses, e.g.:

```ts
foo(cb: (x: number) => string, y: string)
```

The regex stops at the first `)` (end of `(x: number)`), producing truncated parameter lists and wrong type extraction.

**Suggestion**
- Reuse the more robust delimiter-aware scanning approach used elsewhere (you already have complex parsing logic in `src/integrations/tooling/api-contracts.js`).
- Or implement a simple parenthesis-depth scanner here as well.

---

### 5) Tree-sitter async chunking treats “no chunks” as a worker failure → double parsing

**Severity:** Low–Medium (perf)  
**Location:** `src/lang/tree-sitter/chunking.js` (around L501–L513)

In `buildTreeSitterChunksAsync()`:

- If the worker returns an empty array (valid “no chunks” result), the code treats it as failure and falls back to main-thread parsing.

This can cause redundant work (parse twice) on files that legitimately have no chunkable declarations.

**Suggestion**
- Distinguish “failure” from “valid empty result”:
  - Worker returns `null` on failure, `[]` on success/no-chunks.
  - Accept `[]` as a valid result.
- Or return a `{ok:boolean, chunks:Array}` envelope.

---

### 6) Python executable discovery has no timeout → potential indefinite hang

**Severity:** Low–Medium (stability)  
**Location:** `src/lang/python/executable.js` (around L25–L73)

`checkPythonCandidate()` spawns a candidate python with `-c` and waits for it to exit, but does not enforce a timeout.

In most environments this is fine, but it becomes a risk if:
- a “python” candidate is actually a wrapper that blocks,
- environment hooks cause the process to hang.

**Suggestion**
- Add a timeout (e.g., 2–5 seconds) and kill the process if it doesn’t exit.

---

### 7) Python AST pool size guard can be bypassed by using `path` instead of inline `text`

**Severity:** Medium (perf/stability)  
**Location:** `src/lang/python/pool.js` (around L330–L356)

When `text` exceeds `maxTextBytes` **and** `path` is provided, the pool sets `text = null` and sends only `path` to the worker:

- This avoids transferring large text over stdin (good),
- but it means the *file size* is no longer bounded by `maxTextBytes`.
- A huge file at `path` can still be read and parsed by the worker, potentially crashing it or triggering repeated pool backoff.

**Suggestion**
- If `path` is used, add a file-size check (`fs.stat`) and enforce a maximum file size too.
- Optionally validate that `path` is inside the repo root / expected sandbox.

---


---

## Findings

### 1) Potential arbitrary file read / path traversal via `chunk.file`

**Severity:** High  
**Location:** `src/context-pack/assemble.js` (around L157–L160)

`buildPrimaryExcerpt()` constructs a filesystem path as:

- `filePath = path.resolve(repoRoot, chunk.file)`

There is **no explicit check** that `chunk.file` is:
- a safe repo-relative path, and
- still inside `repoRoot` after resolution.

If `chunkMeta` (or anything upstream producing `chunk.file`) is tampered with, a crafted value like `../../../../etc/passwd` (or an absolute path) will resolve outside the repo and the code will attempt to read it.

Even if your current pipeline “should never” produce such values, this is the kind of bug that appears later when:
- context-pack assembly is used with external indexes/caches,
- indexes are copied between machines,
- multi-tenant environments share caches.

**Suggestion**
- Enforce a containment check before reading:
  - Resolve the path
  - Ensure `path.relative(repoRoot, filePath)` does not start with `..` and is not absolute.
- Consider rejecting absolute `chunk.file` entirely.

---

### 2) Synchronous full-file reads even when only a bounded excerpt is needed

**Severity:** Medium (perf / memory)  
**Location:** `src/context-pack/assemble.js` (around L152–L173)

`buildPrimaryExcerpt()` does:

- `fs.readFileSync(filePath, 'utf8')`
- then conditionally truncates with `sliceExcerpt(excerpt, maxBytes, ...)`

For large files, this forces a **full read into memory** even if the final excerpt is capped to (say) 10–50KB.

**Suggestion**
- When `maxBytes` is set, consider:
  - reading only the needed region (range reads), or
  - reading a bounded prefix (streaming) and truncating early.

---

### 3) Byte truncation can cut a multibyte UTF-8 codepoint

**Severity:** Low (correctness)  
**Location:** `src/context-pack/assemble.js` (around L18–L33)

`sliceExcerpt()` truncates by bytes using:

- `Buffer.from(excerpt, 'utf8').subarray(0, maxBytes).toString('utf8')`

This can split a multi-byte character, producing the replacement character (�) at boundaries.

**Suggestion**
- If the output is user-visible or diffed, consider truncating on codepoint boundaries (or accept the replacement char as acceptable tradeoff).

---

### 4) Avoidable memory duplication when `maxBytes` is enabled

**Severity:** Low (perf)  
**Location:** `src/context-pack/assemble.js` (around L18–L33)

`Buffer.from(excerpt, 'utf8')` duplicates memory proportional to excerpt size.

In typical use this is fine, but in worst-case scenarios (many large chunks; high parallelism) it can increase peak RSS.

**Suggestion**
- Prefer early truncation strategies (see Finding #2), which naturally reduce or eliminate this duplication.

---

## Suggested hardening patch (shape)

- Validate `chunk.file` stays inside repoRoot before reading.
- If `maxBytes` is set, read only what you need.
- Treat chunkMeta/index artifacts as semi-trustworthy inputs (because caches can drift/tamper).

