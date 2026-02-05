# Phase 3 Import Resolution Spec (Draft)

## Goal
Replace co-import adjacency with a true dependency graph and make resolution deterministic.

## Import Resolution Graph (IRG)
- Nodes:
  - Internal file: `file:<relPosixPath>`
  - External module: `ext:<rawSpecifier>` (never participates in file-to-file edges)
- Edges: importer -> resolved target
  - `rawSpecifier`
  - `kind: import | require | dynamic_import | reexport`
  - `resolvedType: relative | ts-path | external | unresolved`
  - `resolvedPath` (internal only; repo-relative posix)
  - `packageName` (external only; best-effort)
  - `tsconfigPath`, `tsPathPattern` (ts-path only)

## Resolution rules (contract)
- Relative specifiers (`./`, `../`): resolve against importer directory, apply extension and `index.*` resolution, normalize to posix, ensure within repo root.
- TS path aliases: use nearest applicable `tsconfig.json` (`extends` honored) and resolve `baseUrl` + `paths` with deterministic tie-break:
  1) fewest wildcard expansions
  2) shortest resolved path
  3) lexicographic on normalized path
- External specifiers: do not map into file nodes; retain as `externalImports` only.
- Unresolved: emit no `importLinks` edge; record a bounded warning.

## Outputs
- `fileRelations.imports`: raw specifiers (sorted unique)
- `fileRelations.importLinks`: resolved internal targets (sorted unique, importer -> target)
- `fileRelations.externalImports`: raw external specifiers (sorted unique)

## Debug artifact (default on)
- Path: `artifacts/import_resolution_graph.json` (or `.jsonl`, capped/sampled).
- Default: enabled.
- No public config key (internal-only).
- Test-only override: `PAIROFCLEATS_IMPORT_GRAPH=0` to disable during tests.

## Import scan I/O reuse (optional)
- When enabled, pre-scan import reads populate a bounded in-memory cache keyed by `relPosixPath`.
- Processing reuses cached text/buffers if the file size/mtime match, avoiding a second read.
- Cache size/TTL follow `cache.runtime.fileText` (default 64MB, TTL 0).

## Size caps and warnings
- Warnings must be bounded (e.g., max 200 entries) with a summary count of suppressed warnings.
- Debug artifact size should be capped or sampled to avoid large repos producing multi-GB outputs.
  - Suggested policy: cap nodes/edges to N (configurable) and emit a `stats.truncated` flag.

## tsconfig caching
- Cache tsconfig resolution results by path + mtime + size.
- If the tsconfig changes, invalidate cached alias resolution and recompute deterministically.

## Import resolution cache (incremental builds)
- Persistent cache key uses the unified cache-key schema (`import-resolution-cache-v2`).
- Cache is invalidated when the file set fingerprint changes or `package.json` changes.
- Both resolved and unresolved entries are re-resolved after a file-set change.

## Path normalization
- Normalize all resolved paths to repo-relative POSIX paths.
- Ensure Windows/drive-letter paths never leak into IRG outputs.

## Tests
- Add a Windows path normalization test (POSIX output even when input paths are Windows-style).
- Add a case-sensitivity test for imports (normalize resolution but keep original specifier in metadata).

## Docs impact
- Update `docs/language/import-links.md` to reflect true dependency edges and the IRG model.

