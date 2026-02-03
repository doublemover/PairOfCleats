# Phase 3 Tooling Provider I/O Spec (Draft)

## Goal
Eliminate duplicate file reads by reusing already-loaded file content when invoking tooling providers.

## Scope
- In: Provider inputs and adapter plumbing to pass `text` when available.
- Out: Provider protocol changes (no new RPC methods).

## Behavior
- Providers accept a shared `fileTextByFile` cache (repo-relative path -> UTF-8 text).
- When text is present in the cache, providers must not read the file from disk.
- When text is absent, providers fall back to current disk-based behavior and update the cache.
- Content must be treated as UTF-8 text as already used by indexing (no new encoding logic).

## API shape (contract)
- Extend provider request context to include:
  - `fileTextByFile` (optional map of repo-relative file paths -> text)
- If text exists in the map, skip `fs.readFile` in providers.
- If text is missing or not a string, use existing disk read behavior and then populate the map.

## Propagation plan
- Carry `fileTextByFile` from cross-file inference into tooling adapters.
- Avoid new caching layers; reuse in-memory file content and fill as files are read.

## Failure handling
- If cached text is missing or not a string, fall back to disk read.
- If provider fails with cached text provided, do not change retry behavior.

## Touchpoints
- `src/index/tooling/clangd-provider.js`
- `src/index/tooling/pyright-provider.js`
- `src/index/tooling/sourcekit-provider.js`
- `src/index/type-inference-crossfile/tooling.js`
- `src/index/build/file-processor.js` (or adapter that has file text)

## Tests
- Add a unit/integration test stubbing `fs.readFile` to ensure no read occurs when `text` is provided.
- Verify provider outputs remain unchanged when using `text` vs disk reads.
- Add a fallback test where `text` is missing and disk read path is used.
