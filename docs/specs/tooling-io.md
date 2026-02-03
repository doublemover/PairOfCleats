# Tooling I/O (current)

## Goal
Standardize how tooling providers receive file content, without redundant disk reads.

## Current behavior
- The cross-file inference pipeline builds a VFS view of chunks via `buildToolingVirtualDocuments`.
- Optional `fileTextByPath` (repo-relative -> text) is used to seed the VFS when already loaded.
- Tooling providers operate on the VFS `documents`/`targets` produced by the orchestrator.

## Contract
- Provider inputs are VFS documents; providers should not read files directly unless explicitly required.
- If `fileTextByPath` is present, its entries are trusted as UTF-8 text.
- If `fileTextByPath` is missing or incomplete, the VFS builder falls back to disk reads via
  existing encoding helpers.

## Failure handling
- Missing or invalid cached text falls back to disk reads.
- Provider retry behavior is unchanged.

## Touchpoints
- `src/index/type-inference-crossfile/tooling.js` (passes `fileTextByPath`)
- `src/index/tooling/vfs.js` (`buildToolingVirtualDocuments`)
- `src/index/tooling/orchestrator.js` (provider execution)

## Tests
- `tests/tooling/vfs/vfs-routing-by-effective-language.test.js`
- `tests/tooling/vfs/vfs-virtualpath-deterministic.test.js`
