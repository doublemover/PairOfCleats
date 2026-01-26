# Phase 8 -- TypeScript Provider: JavaScript Parity + VFS Support (Refined)

> **Purpose:** Upgrade the existing TypeScript tooling provider so it can analyze **JS/JSX** (and TS/TSX) with parity, and operate on **segment-aware virtual documents** (VFS), producing outputs keyed by `chunkUid` with optional `SymbolRef`.

This refinement focuses on:
- explicit identity (`chunkUid` first)
- deterministic node matching by virtual ranges
- "no silent wrong joins" behavior

---

## 0. Current baseline (grounded)

Current implementation: `src/index/tooling/typescript-provider.js`

Observed constraints:
- Filters files by extension (`.ts/.tsx/...`) and effectively ignores `.js/.jsx` for typing results.
- Reads files from disk by path; no virtual documents.
- Maps types by `${target.file}::${target.name}` in higher layers (legacy collision-prone).
- Type extraction is name-based and not range-based; can collide on repeated names.

---

## 1. Goals

1. **JS parity:** Support `.js/.jsx/.mjs/.cjs` using `allowJs` + `checkJs` and proper `ScriptKind`.
2. **Segment-aware VFS:** Accept virtual documents (from the VFS builder) and compile them via a custom `CompilerHost`.
3. **Collision-safe output:** Key outputs by `chunkUid` and include `ChunkRef` in each record.
4. **Deterministic node binding:** Resolve a `ToolingTarget` to a TS AST node primarily via its `virtualRange`.

---

## 2. Non-goals

- Perfect type resolution for all JS without type defs (we still accept `any` / `unknown`).
- Full project-wide incremental builds (basic caching is enough for Phase 8).

---

## 3. Provider interface

Implement the provider as a registry-compatible `ToolingProvider` (see provider registry spec).

```ts
export type TypeScriptProviderConfig = {
  tsconfigPath?: string | null;   // optional; if absent, use safe defaults
  allowJs: boolean;               // default true
  checkJs: boolean;               // default true
  includeJsx: boolean;            // default true
  maxFiles?: number;              // safety cap
};
```

---

## 4. Inputs (must support VFS)

Provider input is `ToolingRunInputs` containing:

- `documents: ToolingVirtualDocument[]`
- `targets: ToolingTarget[]`

Provider MUST NOT read source files from disk by path except for:
- reading `tsconfig.json` (optional), and
- reading `node_modules` / lib typings via module resolution (CompilerHost will still use disk for those).

---

## 5. Building a TS `Program` from virtual documents

### 5.1 Custom CompilerHost (mandatory)

Create `src/index/tooling/typescript/host.js`:

- Start with `ts.createCompilerHost(compilerOptions, true)`
- Override these methods to support VFS docs:

Required overrides:
- `fileExists(fileName)`
  - returns true if `fileName` exists in VFS map OR base host says true
- `readFile(fileName)`
  - returns VFS text if present, else base host
- `getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)`
  - create SourceFile from VFS text when VFS hit
- `writeFile` can be no-op (we are not emitting)
- `getCurrentDirectory`, `getDirectories`, `realpath` as needed

**Canonical file names**
- Use POSIX-like names for VFS docs; normalize consistently.
- `getCanonicalFileName` should normalize case only if underlying FS requires it; keep deterministic.

### 5.2 CompilerOptions (baseline)

If `tsconfigPath` exists, parse it via `ts.readConfigFile` + `ts.parseJsonConfigFileContent`.

Else use safe defaults:

```js
{
  allowJs: true,
  checkJs: true,
  jsx: ts.JsxEmit.Preserve,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  skipLibCheck: true,
  noEmit: true,
  strict: false
}
```

### 5.3 Root files list

Root files MUST include **all virtual documents** whose `effectiveExt` is one of:

- `.ts .tsx .mts .cts`
- `.js .jsx .mjs .cjs`

(Subject to safety cap `maxFiles`.)

Root files should be deterministic:
- sort by `virtualPath` lexicographically

---

## 6. Deterministic node matching (chunk → TS node)

### 6.1 Target kinds

We only request types for "symbol-like" chunks:
- functions
- methods
- classes
- interfaces
- type aliases (where possible)

### 6.2 Matching strategy (mandatory)

Given a `ToolingTarget`:

- Locate the SourceFile for `target.virtualPath`
- Find the best AST node matching `target.virtualRange`

**Algorithm**
1. Walk nodes in SourceFile and consider candidates where:
   - node has `pos/end` (use `node.getStart(sourceFile)` for start)
   - overlap with `virtualRange` is non-zero
2. Score candidate by:
   - highest overlap ratio
   - prefer nodes whose `kind` matches target kind (function/class/method)
   - prefer nodes whose identifier text matches `target.name` (if provided)
   - prefer smallest enclosing node (more specific)
3. Pick the top-scoring node.

**Fail-safe**
- If no candidate found:
  - strict mode: emit a diagnostic and skip the target (do not guess)
  - non-strict: attempt a name-only fallback within the file, but record `confidence: low`

### 6.3 Avoiding wrong joins

If name-only fallback finds multiple candidates:
- return `resolution.status = "ambiguous"` and do not pick a winner
- do not emit an inferred type for that chunkUid unless unambiguous

---

## 7. Extracting types

### 7.1 Return type

For a function-like node:
- Get signature via `checker.getSignatureFromDeclaration(node)` (or from symbol)
- Extract return type via `checker.getReturnTypeOfSignature(sig)`
- Convert to string via `checker.typeToString(type, node, flags)`

Normalize the resulting type string:
- trim
- collapse whitespace
- drop trailing semicolons

### 7.2 Param types

For each parameter:
- get its type via `checker.getTypeAtLocation(param.name ?? param)`
- stringify and normalize

Record with confidence:
- `high` if explicit annotation exists
- `medium` if inferred from analysis
- `low` if `any`/`unknown` or JS heuristic

---

## 8. Symbol identity integration (canonical IDs deferred to Phase 9)

In Phase 8, the TypeScript provider's primary responsibility is **type inference keyed by `chunkUid`**.

Canonical symbol identity (`SymbolRef`, `symbolKey`, `scopedId`, `symbolId`) is defined by:
- `docs/specs/symbol-identity-and-symbolref.md`

and should be implemented as a shared utility in Phase 9 (so all languages/providers converge on one contract).

Phase 8 requirements:
- The TS provider **MUST NOT** mint ad-hoc "permanent" symbol IDs (avoid divergent prefixes like `sk:*` / `sid:*`).
- The TS provider **MAY** emit **symbol hints** for debugging and future resolution, for example:
  - `qualifiedName` (e.g., `checker.getFullyQualifiedName(symbol)`)
  - `kind` / kindGroup
  - `signatureText` (normalized)
- Once Phase 9 symbol identity utilities exist, the TS provider **SHOULD** call the shared builder to emit canonical `SymbolRef` objects.

---

## 9. Output contract

Provider outputs MUST conform to:

- `ToolingProviderOutput.byChunkUid[chunkUid]`

Each entry MUST include:
- `chunk: ChunkRef`
- `payload: { returnType?, paramTypes? }`
- `provenance` with `provider/version`

---

## 10. Caching

### 10.1 Cache key

Use the shared scheme from VFS spec:

- provider id/version
- provider config hash
- sorted list of `virtualPath:docHash`

### 10.2 Cache payload

Persist:
- provider metadata
- `byChunkUid` only (already normalized)

Never cache legacy `file::name` keys.

---

## 11. Implementation plan (step-by-step)

1. **Introduce VFS-friendly host**
   - `src/index/tooling/typescript/host.js`
2. **Refactor provider**
   - Update `src/index/tooling/typescript-provider.js` to:
     - accept `documents` as in-memory sources
     - build Program from virtual paths
3. **Add JS/JSX support**
   - include `.js/.jsx/.mjs/.cjs` in root files
   - set `allowJs/checkJs`
   - map `.jsx` to `ts.ScriptKind.JSX`
4. **Implement range-based node matching**
5. **Emit results keyed by chunkUid**
6. **(Optional) Emit SymbolRef**
7. **Update orchestrator and callers**
   - Replace any remaining `${file}::${name}` maps in `src/index/type-inference-crossfile/*`

---

## 12. Acceptance criteria

- [ ] Provider returns results for `.js` and `.jsx` files when `checkJs` enabled.
- [ ] Embedded `<script lang="ts">` in `.vue` is analyzed via the segment virtual doc.
- [ ] All results are keyed by `chunkUid` and include `ChunkRef`.
- [ ] Ambiguous node matches are represented explicitly; no silent wrong assignment.

---

## 13. Tests (exact)

1. `tests/tooling/typescript-js-parity-basic.test.js`
   - Fixture: `.js` file with JSDoc types.
   - Assert provider returns non-empty returnType for a target.

2. `tests/tooling/typescript-vfs-segment-vue.test.js`
   - Fixture: `.vue` with `<script lang="ts">`.
   - Assert provider runs on the virtual doc and returns types for chunks inside script.

3. `tests/tooling/typescript-node-matching-range.test.js`
   - Provide two same-named functions; ensure range-based match picks correct one.

4. `tests/tooling/typescript-ambiguous-fallback-does-not-guess.test.js`
   - Remove reliable range mapping and create two candidates; ensure provider marks ambiguous.


