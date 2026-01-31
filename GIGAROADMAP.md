# PairOfCleats GigaRoadmap

    ## Status legend
    
    Checkboxes represent the state of the work, update them to reflect the state of work as its being done:
    - [x] Implemented and appears complete/correct based on code inspection and existing test coverage
    - [@] In Progress, this work has been started
    - [.] Work has been completed but has Not been tested
    - [?] There is a correctness gap **or** there is missing/insufficient test proving behavior
    - [ ] Not complete
    
    Completed Phases: `COMPLETED_PHASES.md`

## Roadmap List
### Foundational
- Phase 6 Audit checklist
  - Phase 6.1 VFS hardening: stable virtual paths + manifest roundtrip
    - 6.1.1 VFS Virtual Path specification (source of truth)
    - 6.1.2 Virtual path stability test
    - 6.1.3 VFS manifest roundtrip test (unsharded + sharded)
    - 6.1.4 Add a minimal VFS disk-path safety test (recommended)
- Phase 6.2 CI coverage: schema validation + clearer CI OS lanes
    - 6.2.1 Ensure schema & index validation always run in PR CI
    - 6.2.2 Refine GitHub Actions CI job naming and OS coverage
- Phase 6.3 Determinism + metaV2 correctness after post-processing
    - 6.3.1 call_sites determinism test
    - 6.3.2 Ensure metaV2 is finalized after cross-file inference mutations
- Phase 6.4 Heuristic noise reduction: reserved words + code dictionaries + token classification
    - 6.4.1 Promote per-language reserved word sets to “complete” keyword lists
    - 6.4.2 Per-language “code dictionaries” for identifier segmentation
    - 6.4.3 Token classification (keyword vs identifier vs operator) + weighting
- Phase 6.5 CI-Long lane: isolate long-running tests
    - 6.5.1 Create a “CI-Long” lane that runs only tests tagged `long`

---


## Phase 6 -- Finalization

> **Important:** A meaningful portion of this phase may already be implemented in this repo.  
> Before writing new code, **audit the referenced files/tests** and only add/modify what’s missing or incorrect.

### Goals

1. **Determinism & portability:** VFS virtual paths and “call_sites” output must be stable across runs/OSes.
2. **Artifact correctness:** VFS manifest and metaV2 must be correct, schema-valid, and consistent with post-processing.
3. **Noise reduction:** Improve call/usage heuristics and tokenization so keyword noise is controlled without losing queryability.
4. **CI completeness:** CI lanes must always run schema/validator coverage; long tests must be runnable in a dedicated lane.

---

## 6.0 Audit checklist (do this first)

- [ ] Confirm these Phase 6 tests already exist and are green:
  - `tests/vfs/virtual-path-stability.test.js`
  - `tests/vfs/vfs-manifest-roundtrip.test.js`
  - `tests/indexer/call-sites-determinism.test.js`
  - `tests/indexer/metav2-recompute-equivalence.test.js`
- [ ] Confirm VFS manifest is actually produced during an index build:
  - Collection: `src/index/build/file-processor/process-chunks.js` → `buildVfsManifestRowsForFile()`
  - State aggregation: `src/index/build/indexer/steps/process-files.js` → `state.vfsManifestRows`
  - Emission: `src/index/build/artifacts/writers/vfs-manifest.js` → `enqueueVfsManifestArtifacts()`
  - Manifest wiring: `src/index/build/artifacts.js` adds piece `vfs_manifest`
- [ ] Confirm metaV2 finalization happens *after* any mutation steps:
  - Cross-file inference: `src/index/build/indexer/steps/relations.js` → `runCrossFileInference()` mutates `chunk.docmeta` / `chunk.codeRelations`
  - Finalization: `src/index/build/indexer/steps/write.js` → `finalizeMetaV2({ chunks })` **before** writing artifacts
- [ ] Confirm GitHub Actions PR CI runs `ci-lite` (and thus includes contracts + validate coverage):
  - Workflow: `.github/workflows/ci.yml`
  - Test command: `npm run test:ci-lite`
  - Source of truth list: `tests/ci-lite/ci-lite.order.txt`

If any item above is missing, fix it as part of Phase 6 (details below).

---

## 6.1 VFS hardening: stable virtual paths + manifest roundtrip

### 6.1.1 VFS Virtual Path specification (source of truth)

**Primary implementation:** `src/index/tooling/vfs.js`

- `VFS_PREFIX` is `".poc-vfs"`.
- `buildVfsVirtualPath({ containerPath, segmentUid, ext, effectiveExt })` must be:
  - **Pure & deterministic** (same inputs → same output across runs/OS).
  - **Path-safe for LSP/tooling** (no OS separators except `/`).
  - **Stable across host paths**: uses `normalizeRelPath()` and `encodeContainerPath()`:
    - `encodeContainerPath()` base64url-encodes the normalized relative path.
    - `decodeContainerPath()` reverses it.
  - **Segment addressing is explicit**:
    - If `segmentUid` is present: suffix is `"#seg:<segmentUid>"`.
    - Otherwise, no segment suffix.
  - **Extension selection rules**:
    - `effectiveExt` (if non-empty) takes precedence over `ext`.
    - Both are normalized to include a leading dot when present.
    - If neither exists, no extension suffix is added.

**Disk path mapping for tooling (not “virtual path”):**
- `resolveVfsDiskPath({ baseDir, virtualPath })`:
  - Splits the virtual path on `/` into components.
  - Encodes Windows-illegal characters in each component via `encodeURIComponent()` for `[:*?"<>|]`.
  - Joins using `path.sep` and roots at `baseDir`.

The **stable spec** is: *virtual paths are posix-style with `/`, disk paths are OS-safe via escaping.*

---

### 6.1.2 Task: Virtual path stability test

**Test file (must exist and pass):** `tests/vfs/virtual-path-stability.test.js`

**Must validate:**
- [ ] Determinism: multiple invocations with identical inputs are string-equal.
- [ ] Segment switching: changing `segmentUid` changes output only in the `#seg:` suffix.
- [ ] Effective extension: `effectiveExt` overrides `ext`.
- [ ] Cross-platform invariants:
  - The returned string always starts with `".poc-vfs/"`.
  - It never contains `\` (backslash), even on Windows.
  - It does not include raw absolute paths.

**Key implementation references:**
- `src/index/tooling/vfs.js`:
  - `buildVfsVirtualPath()`
  - `encodeContainerPath()`, `decodeContainerPath()`
  - `normalizeRelPath()` (imported from `../../shared/paths.js`)

If the existing test doesn’t cover the invariants above, extend it.

---

### 6.1.3 Task: VFS manifest roundtrip test (unsharded + sharded)

**Test file (must exist and pass):** `tests/vfs/vfs-manifest-roundtrip.test.js`

**Manifest schema reference (authoritative):**
- `src/contracts/schemas/artifacts.js` → `vfsManifestRow` schema
- Manifest writer uses:
  - `src/index/build/artifacts/writers/vfs-manifest.js`
  - `VFS_MANIFEST_SCHEMA_VERSION` from `src/index/tooling/vfs.js`

**Roundtrip requirements:**
- [ ] **Unsharded mode**: writing `vfs_manifest.jsonl` and reading it back returns identical rows.
- [ ] **Sharded mode**: forcing shard split via `maxJsonBytes` writes:
  - `vfs_manifest.meta.json`
  - `vfs_manifest.parts/…`
  - reading back yields the same rows.
- [ ] Ordering:
  - Writer sorts rows with `sortVfsManifestRows()` so output is deterministic.
- [ ] Row trimming:
  - Writer enforces `MAX_ROW_BYTES` (32 KB). Oversized rows must be trimmed in a deterministic way (`maybeTrimRow()`).

**Key implementation references:**
- Writer: `src/index/build/artifacts/writers/vfs-manifest.js`
  - `createVfsManifestRows()`
  - `sortVfsManifestRows()`
  - `buildManifestRow()` / `maybeTrimRow()`
  - `enqueueVfsManifestArtifacts()`
- Reader: `src/index/tooling/vfs.js`
  - `readVfsManifestRowsFromDisk()`
  - `readVfsManifestFromIndexRoot()`

---

### 6.1.4 Task: Add a minimal VFS disk-path safety test (recommended)

**Why:** `resolveVfsDiskPath()` is used on Windows, macOS, Linux. It must not create illegal filename components.

**New test (add):**
- `tests/vfs/vfs-disk-path-safety.test.js`

**Test cases:**
- [ ] A virtual path containing illegal Windows characters in a component (e.g. `":"`, `"*"`, `"?"`, `"|"`) is converted to a disk path where those characters are percent-encoded.
- [ ] Returned disk path is under `baseDir` (no traversal).
- [ ] `virtualPath` containing `..` as a segment is treated as a literal component (still joined under baseDir), not as traversal.
  - If you consider `..` unsafe, then explicitly encode it or reject it; document the decision and test accordingly.

**Key implementation reference:** `src/index/tooling/vfs.js` → `resolveVfsDiskPath()`.

---

## 6.2 CI coverage: schema validation + clearer CI OS lanes

### 6.2.1 Task: Ensure schema & index validation always run in PR CI

**Goal:** If artifact schemas or validators break, PR CI must fail.

**What must be covered by the PR CI lane (`ci-lite`):**
- [ ] **Contract/schema tests** (minimum):
  - `tests/contracts/schema-registry-single-source.test.js`
  - `tests/contracts/public-artifact-surface-doc.test.js`
  - `tests/contracts/artifact-surface-version.test.js`
- [ ] **Index validator tests** (minimum):
  - `tests/validate/index-validate-strict.test.js`
  - `tests/validate/index-validate-load-manifest.test.js`
  - `tests/validate/index-validate-missing-pieces.test.js`
  - `tests/validate/index-validate-unknown-piece.test.js`

**Source of truth for what runs in `ci-lite`:**
- `tests/ci-lite/ci-lite.order.txt`  
  CI-lite is special-cased in `tests/run.js` and uses this order file verbatim.

**Acceptance criteria:**
- The list above is present in `ci-lite.order.txt`.
- `npm run test:ci-lite` fails when you intentionally break a schema or validator check.

**Implementation references:**
- Workflow: `.github/workflows/ci.yml`
- Test runner: `tests/run.js` (ci-lite order-file logic)

---

### 6.2.2 Task: Refine GitHub Actions CI job naming and OS coverage

**Workflow file:** `.github/workflows/ci.yml`

**Problems to address:**
- Job name `test` is ambiguous (it is really **Ubuntu**).
- Windows job is named `test-windows` but uses different OS runner (`windows-2022`) than nightly (`windows-latest`).
- macOS is covered in nightly, but not PR CI.

**Required changes:**
- [ ] Rename job ids + display names:
  - `test` → `ubuntu`
  - `test-windows` → `windows`
- [ ] Add a `macos` job running `npm run test:ci-lite`:
  - Runner: `macos-latest`
  - Keep it blocking if it’s fast enough; otherwise make it non-blocking but visible.
- [ ] Align Windows runner choice with nightly unless you have a reason:
  - Prefer `windows-latest` unless a specific toolchain requires `windows-2022`.

**Acceptance criteria:**
- PR CI UI clearly shows `ubuntu`, `windows`, and `macos`.
- All jobs run the same Node version and `npm run test:ci-lite`.

**Related workflow:** `.github/workflows/nightly.yml` (already includes macOS).

---

## 6.3 Determinism + metaV2 correctness after post-processing

### 6.3.1 Task: call_sites determinism test

**Test file (must exist and pass):** `tests/indexer/call-sites-determinism.test.js`

**What the test must guarantee:**
- [ ] Two consecutive builds of the same fixture repository produce `call_sites.jsonl` output that is **line-identical**.
- [ ] The fixture repo must be stable and self-contained (no network).
- [ ] The test must not depend on wall-clock timestamps:
  - Compare content files, not meta `generatedAt` timestamps.

**Key implementation references:**
- Writer: `src/index/build/artifacts/writers/call-sites.js`
  - Determinism is primarily controlled by `sortCallSites(rows)`.
- Call detail production:
  - Call details are stored on `chunk.codeRelations.callDetails`.
  - Cross-file inference may add `targetChunkUid`/`targetDocId`/`targetCandidates`.

If determinism fails on Windows, inspect any path normalization differences and ensure ordering sort keys use normalized file paths (posix style `src/...`) rather than OS paths.

---

### 6.3.2 Task: Ensure metaV2 is finalized after cross-file inference mutations

**Why:** `metaV2` is a “flattened” structure derived from `chunk` + `chunk.docmeta` + `chunk.codeRelations`.  
Cross-file inference **mutates** those, so stale metaV2 would be a correctness bug.

**How it currently must work:**
- First metaV2 build (per-chunk) happens during assembly:
  - `src/index/build/file-processor/assemble.js` → `buildMetaV2(chunk)`
- Mutations happen later:
  - `src/index/build/indexer/steps/relations.js` → `runCrossFileInference()` (calls `applyCrossFileInference()`)
- Final metaV2 rebuild must happen at the end:
  - `src/index/build/indexer/steps/write.js` → `finalizeMetaV2({ chunks })`

**Acceptance criteria:**
- `finalizeMetaV2()` is invoked for every write mode (`code`, `prose`) **after** all mutation steps.
- Any artifact that includes `chunk.metaV2` is written after this finalization.

**Add/extend an integration assertion (recommended):**
- Update `tests/indexing/type-inference/crossfile-output.integration.test.js` to also assert:
  - `buildWidget.metaV2.docmeta.inferredTypes.returns` includes `{ type: "Widget", source: "flow" }`
  - `buildWidget.metaV2.codeRelations.callLinks` includes the link to `createWidget`
  - `buildWidget.metaV2.codeRelations.usageLinks` includes the link to `Widget`
- This specifically catches stale metaV2 after inference.

---

## 6.4 Heuristic noise reduction: reserved words + code dictionaries + token classification

This subsection affects:
- Call/usage extraction in heuristic parsers (C-like, Go, Java, Kotlin, C#, Lua, Perl, PHP, Ruby, Shell, TypeScript).
- Tokenization quality (identifier splitting / keyword noise).

### 6.4.1 Task: Promote per-language reserved word sets to “complete” keyword lists

**Current problem:** the existing `*_CALL_KEYWORDS` and `*_USAGE_SKIP` sets are partial.  
This causes false-positive calls/usages for keywords and builtin type names.

**Primary implementation locations to update:**
- C-like:
  - `src/index/constants.js` → `CLIKE_CALL_KEYWORDS`, `CLIKE_USAGE_SKIP`
- TypeScript:
  - `src/lang/typescript/constants.js` → `TS_CALL_KEYWORDS`, `TS_USAGE_SKIP`, `TS_FLOW_SKIP`
- Others (inline in file):
  - `src/lang/csharp.js` → `CSHARP_CALL_KEYWORDS`, `CSHARP_USAGE_SKIP`
  - `src/lang/go.js` → `GO_CALL_KEYWORDS`, `GO_USAGE_SKIP`
  - `src/lang/java.js` → `JAVA_CALL_KEYWORDS`, `JAVA_USAGE_SKIP`
  - `src/lang/kotlin.js` → `KOTLIN_CALL_KEYWORDS`, `KOTLIN_USAGE_SKIP`
  - `src/lang/lua.js` → `LUA_CALL_KEYWORDS`, `LUA_USAGE_SKIP`
  - `src/lang/perl.js` → `PERL_CALL_KEYWORDS`, `PERL_USAGE_SKIP`
  - `src/lang/php.js` → `PHP_CALL_KEYWORDS`, `PHP_USAGE_SKIP`
  - `src/lang/ruby.js` → `RUBY_CALL_KEYWORDS`, `RUBY_USAGE_SKIP`
  - `src/lang/shell.js` → `SHELL_CALL_KEYWORDS`, `SHELL_USAGE_SKIP`
  - Rust (flow/dataflow only):
    - `src/lang/rust.js` → `RUST_USAGE_SKIP`

**Required refactor (recommended for maintainability):**
- [ ] For each language module above, introduce a single exported `*_RESERVED_WORDS` (or `*_KEYWORDS`) set that is the **superset**.
- [ ] Define:
  - `*_CALL_KEYWORDS = RESERVED_WORDS ∩ {things that can appear before “(” in syntax but are not calls}`
  - `*_USAGE_SKIP = RESERVED_WORDS ∪ {primitive types, literals, ultra-common words}`  
    (keep it *strictly* a superset to reduce false positives)
- [ ] Ensure all sets are:
  - lowercased where language is case-sensitive (except where language semantics require case, e.g., Rust `Self`)
  - sorted in source for readability (alphabetical)
  - have no duplicates

**Acceptance criteria:**
- Fewer false positives in `calls`/`usages` for the targeted languages.
- No existing tests regress.

**Add regression tests (must add):**
- `tests/relations/keyword-skip-heuristics.test.js` (new)

Design:
- For each language that uses regex `\bNAME\s*\(` call extraction, feed a snippet that contains:
  - control structures that look like calls: `if(...)`, `for(...)`, `while(...)`, etc
  - real calls: `foo(...)`, `obj.foo(...)`
- Assert that:
  - control structure keywords are **not** included in `calls`
  - `foo`/`obj.foo` **are** included

Implementation hint:
- Use the existing relation entrypoints:
  - C-like: `src/lang/clike.js` exports `buildCLikeRelations` (or equivalent; see file exports)
  - Go: `buildGoRelations(...)` or the module export that returns `{ calls, usages }`
  - etc.

If you don’t have a clean exported function, test the internal `collect*CallsAndUsages()` functions directly.

---

### 6.4.2 Task: Per-language “code dictionaries” for identifier segmentation

**Goal:** Improve identifier splitting (e.g., `HTTPRequest` → `http` + `request`, `userID` → `user` + `id`)  
**without changing core scoring/ranking logic** (only segmentation quality).

**Current segmentation engine:** `src/shared/tokenize.js`
- `splitWordsWithDict(token, dictWords, config)` is already used by:
  - index-time tokenization: `src/index/build/tokenization.js`
  - query-time tokenization: `src/retrieval/query.js`

**Proposed design:**
- [ ] Add a second dictionary source: **code dictionaries**, separate from natural-language dictionaries.
- [ ] Code dictionaries are loaded, and applied only when tokenizing code (index mode `code`).
- [ ] Provide:
  - `common-code.txt` (shared abbreviations): `http`, `url`, `uuid`, `json`, `yaml`, `html`, `css`, `sql`, `api`, `cli`, `ui`, `db`, `rpc`, `grpc`, `tls`, `ssl`, `jwt`, `oauth`, etc.
  - Per-language additions: `go.txt`, `java.txt`, `typescript.txt`, etc.

**Where to implement:**
- Dictionary path discovery:
  - Extend `tools/dict-utils/paths/dictionaries.js` (or add sibling `code-dictionaries.js`)
  - Add config shape to `tools/dict-utils/config/schema` (if present) or document it in roadmap.
- Runtime load:
  - `src/index/build/runtime/runtime.js` → `loadDictionaryWords(...)` currently loads `dictWords`
  - Add `codeDictWords` and/or `codeDictWordsByLanguage`
- Tokenization:
  - `src/index/build/tokenization.js`:
    - When `mode === "code"`, pass a dictionary set that unions:
      - natural dict words (`dictWords`)
      - common code dict
      - effective-language-specific code dict (if any)
  - Ensure worker tokenization has access too:
    - `src/index/build/workers/indexer-worker.js` uses `createTokenizationContext()`

**Acceptance criteria:**
- Turning on code dictionaries improves segmentation for representative identifiers.
- Prose segmentation is unaffected unless explicitly configured.

**Add tests (must add):**
- `tests/tokenize-code-dictionaries.test.js` (new)
  - Verify that with a code dictionary containing `http` and `request`, `HTTPRequest` splits to include `http` and `request`.
  - Verify that with code dictionaries disabled, splitting falls back to existing behavior.

---

### 6.4.3 Task: Token classification (keyword vs identifier vs operator) + weighting

**Goal:** Keep keywords/operators searchable but reduce their ranking impact (keyword-noise control).

**Core requirements:**
- [ ] Add classification for code tokens into at least:
  - `identifier`
  - `keyword`
  - `operator`
  - `literal` (numbers/strings)
- [ ] Use Tree-sitter token/node types when available, **fallback** to keyword lists only when necessary.
  - Tree-sitter config: `src/lang/tree-sitter/config.js` lists supported `TREE_SITTER_LANGUAGE_IDS`.
- [ ] Keep keywords indexable but **down-weight** them relative to identifiers.

#### Proposed implementation strategy (fits current architecture)

**A) Extend tokenization output to carry typed token buckets**
- Modify `src/index/build/tokenization.js`:
  - Currently returns `{ tokens, frequencies, positions, totalTokens }`
  - Extend to also return:
    - `identifierTokens` (array)
    - `keywordTokens` (array)
    - `operatorTokens` (array)
  - `tokens` should continue to exist for backward compatibility (initially keep it as the union).

**B) Feed typed buckets into `fieldTokens`**
- Modify `src/index/build/file-processor/assemble.js` `buildChunkPayload()`:
  - Currently sets `fieldTokens = { name, signature, doc, comment, body }`
  - Add new fields:
    - `fieldTokens.keyword = keywordTokens`
    - `fieldTokens.operator = operatorTokens`
  - Decide what `body` should contain:
    - **Recommended final shape:** `body = identifierTokens` only
    - But do this behind a config flag for compatibility (see below).

**C) Build field postings for new token fields**
- Modify `src/index/build/state.js`:
  - `fieldPostings` currently has `name`, `signature`, `doc`, `comment`, `body`.
  - Add `keyword` and `operator` maps (or make this dynamic by iterating keys from `chunk.fieldTokens`).
- Ensure `src/index/build/postings.js` writes `field_postings.json` with the additional fields.

**D) Retrieval: add default weights for new fields**
- Modify `src/retrieval/query-intent.js`:
  - Extend `DEFAULT_FIELD_WEIGHTS` to include:
    - `keyword`: small weight (e.g., 0.15–0.35)
    - `operator`: tiny weight (e.g., 0.05) or 0 (indexable but not scoring)
- Ensure `src/retrieval/pipeline.js` still operates if these fields are missing (older index).

**E) Compatibility plan**
- Add config flag (suggested):
  - `indexing.postings.tokenClassification.enabled` (default: `false` initially)
- When disabled:
  - Keep current behavior: `body = tokens` (union), no new fields required.
- When enabled:
  - `body = identifierTokens`
  - `keyword`/`operator` fields populated and weighted.

**Acceptance criteria:**
- Queries with only identifiers behave the same or better.
- Queries that are mostly keywords (e.g., `async await`) still return results, but keyword-only matches don’t dominate ranking.

**New tests (must add):**
1. `tests/tokenization/token-classification-tree-sitter.test.js`
   - Feed a small snippet in a Tree-sitter-supported language (e.g., JS or Go).
   - Assert that tokens are classified as expected:
     - identifiers go to `identifierTokens`
     - `if`, `for`, `return` go to `keywordTokens`
     - `=>`, `.`, `::`, `(`, `)` go to `operatorTokens` (depending on which operators you choose to index)
2. `tests/retrieval/keyword-downweighting.test.js`
   - Build a tiny synthetic index with two chunks:
     - Chunk A: many keyword tokens, few identifiers
     - Chunk B: fewer keywords, matching identifiers
   - Query for identifiers + keyword; assert chunk B ranks above A when classification is enabled.

---

## 6.5 CI-Long lane: isolate long-running tests

### 6.5.1 Task: Create a “CI-Long” lane that runs only tests tagged `long`

**Why:** Long tests slow PR feedback; they belong in scheduled/nightly lanes.

**Source of truth for “long”:**
- Tag rules in `tests/run.rules.jsonc` under `"tagRules"` include tag `"long"`.

**Required changes (recommended design: lane alias)**
- [ ] Update `tests/run.rules.jsonc`:
  - Add `"ci-long"` to `"knownLanes"`.
- [ ] Update `tests/run-discovery.js` `resolveLanes()`:
  - Treat `ci-long` the same as `ci` (expand to `unit`, `integration`, `services`).
- [ ] Update `tests/run.js`:
  - When lane `ci-long` is requested, automatically add `--tag long` (as if user passed it).
  - Ensure `--exclude-tag` still works as expected.
- [ ] Add npm script in `package.json`:
  - `"test:ci-long": "node tests/run.js --lane ci-long"`
- [ ] Add a GitHub Actions workflow lane/job (choose one):
  - **Option A:** Add to `.github/workflows/nightly.yml` (best): run `npm run test:ci-long` on all OSes.
  - **Option B:** Add a separate scheduled workflow `.github/workflows/ci-long.yml`.

**Acceptance criteria:**
- `npm run test:ci-long` runs **only** tests tagged `long`.
- PR CI remains fast (ci-lite).
- Nightly (or scheduled) runs include ci-long.

**Implementation references:**
- Tags/lane system:
  - `tests/run.rules.jsonc`
  - `tests/run-discovery.js`
  - `tests/run.js`

---

## Appendix: Suggested “complete” reserved word lists (copy/paste seeds)

> These are intended as **seed lists** to prevent having to web-search during implementation.  
> Prefer Tree-sitter classification where possible, but keep these sets for heuristic parsers.

### JavaScript / TypeScript (seed keywords)
```
await break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let
as implements interface package private protected public static
any boolean bigint number object string symbol unknown never
keyof readonly infer satisfies asserts is require namespace module type from of get set constructor declare abstract override
```

### C / C++ (seed keywords)
```
auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while
_Alignas _Alignof _Atomic _Bool _Complex _Generic _Imaginary _Noreturn _Static_assert _Thread_local
alignas alignof and and_eq asm bitand bitor bool catch char8_t char16_t char32_t class compl concept const_cast consteval constexpr constinit co_await co_return co_yield decltype delete dynamic_cast explicit export false friend import module mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public reinterpret_cast requires static_assert static_cast template this thread_local throw true try typeid typename using virtual wchar_t xor xor_eq final override
```

### Go (seed keywords + predeclared)
```
break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var
nil true false iota
append cap close complex copy delete imag len make new panic print println real recover
bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any
```

### Java (seed)
```
abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while
true false null
var record yield sealed permits non-sealed
module open requires exports opens to uses provides with transitive
```

### Kotlin (seed)
```
as as? break class continue do else false for fun if in !in interface is !is null object package return super this throw true try typealias val var when while
by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where
actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg value
```

### C# (seed)
```
abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while
add alias ascending async await by descending dynamic equals from get global group into join let nameof on orderby partial remove select set value var when where yield record init with
```

### Lua (seed)
```
and break do else elseif end false for function goto if in local nil not or repeat return then true until while
```

### PHP (seed)
```
__halt_compiler abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield yield from
true false null
```

### Ruby (seed)
```
BEGIN END alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield
__FILE__ __LINE__ __ENCODING__
```

### Shell (bash/sh seed)
```
if then else elif fi for while until do done case esac in select function time coproc
break continue return exit shift eval exec trap wait local declare typeset readonly export set unset source
true false
```

### Perl (seed)
```
my our use sub package if elsif else unless while until for foreach continue do given when default
next last redo goto return
BEGIN END INIT CHECK UNITCHECK
die warn print say
```

---
