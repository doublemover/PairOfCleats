# Public Artifact Surface (0.0.1)

This document is the **canonical** contract for PairOfCleats public artifacts. It supersedes `docs/contracts/artifact-contract.md` for all contract decisions.

## Contract version

- `artifactSurfaceVersion`: **0.0.1** (SemVer, hard-breaks only).
- **No transition paths**: if `artifactSurfaceVersion` or required schema versions do not match the accepted ranges, readers **must fail closed**.

## Manifest-first discovery (required)

- `pieces/manifest.json` is the **single source of truth** for artifact discovery.
- Readers must resolve artifacts **only** via the manifest in strict mode (default).
- Tools must not guess filenames or silently scan directories.

## Required public artifacts

These artifacts define the public surface and must be present when referenced:

- `pieces/manifest.json`
- `index_state.json`
- `builds/current.json` (when a build is promoted)
- Sharded JSONL sidecars: `*.meta.json` for all `*.jsonl.parts/` artifacts

## Optional public artifacts (when enabled)

- `call_sites` (jsonl or sharded jsonl) when relations are enabled.
- `lexicon_relation_filter_report` (json) when lexicon relation filtering is enabled for code builds.
- Embeddings and ANN artifacts (when embeddings are enabled):
  - `dense_vectors`, `dense_vectors_doc`, `dense_vectors_code`
  - `dense_vectors_hnsw` + `dense_vectors_hnsw_meta`
  - `dense_vectors_doc_hnsw` + `dense_vectors_doc_hnsw_meta`
  - `dense_vectors_code_hnsw` + `dense_vectors_code_hnsw_meta`
  - `dense_vectors_lancedb` + `dense_vectors_lancedb_meta`
  - `dense_vectors_doc_lancedb` + `dense_vectors_doc_lancedb_meta`
  - `dense_vectors_code_lancedb` + `dense_vectors_code_lancedb_meta`
  - `dense_vectors_sqlite_vec_meta` (optional sqlite-vec marker)

## Artifact format notes

- `chunk_meta` may be emitted as `chunk_meta.json`, `chunk_meta.jsonl`, sharded `chunk_meta.parts/` + `chunk_meta.meta.json`, or `chunk_meta.columnar.json`.
- `symbol_occurrences` and `symbol_edges` may be emitted as JSONL/sharded JSONL or as `*.columnar.json` when `indexing.artifacts.symbolArtifactsFormat=columnar`.
- `pieces/manifest.json` may include `format: "columnar"` for columnar artifacts; readers must treat columnar as equivalent to JSON/JSONL rows after inflation.

## Reserved / invariant fields

The following fields are reserved and must not change meaning across versions:

- `artifactSurfaceVersion`
- `schemaVersion`
- `repoId`
- `buildId`
- `compatibilityKey`
- `generatedAt`

Per-record invariants:

- `file` fields are repo-relative, normalized (posix separators), and must not contain `..`.

## Extension policy

- Many artifact schemas allow `additionalProperties`; extra fields may appear outside `extensions` unless a schema sets `additionalProperties: false`.
- Extensions remain the recommended place for namespaced vendor data (e.g., `extensions.vendorName.*`).

## Schema versioning

- All schemas use SemVer strings.
- `schemaVersion` is required for sharded JSONL meta files.
- For major `0`, readers support the current major only. For major `1+`, readers support **N-1 major**; unknown majors are **hard errors**.

## Sharded JSONL meta schema (required)

All `*.meta.json` files for `*.jsonl.parts/` artifacts must include:

- `schemaVersion` (SemVer)
- `artifact` (base name, e.g., `chunk_meta`)
- `format`: `jsonl-sharded`
- `generatedAt` (ISO-8601)
- `compression`: `none | gzip | zstd`
- `totalRecords`, `totalBytes`
- `maxPartRecords`, `maxPartBytes`, `targetMaxBytes`
- `parts`: list of `{ path, records, bytes }`

## Reference envelope (contract-first)

Reference fields must use the canonical shape:

- `ref.target`: string (stable identifier)
- `ref.kind`: string (enum per artifact)
- `ref.display`: string (human-readable)

## Truncation envelope (contract-first)

Artifacts that truncate content must include:

- `truncation.kind`: string
- `truncation.reason`: string
- `truncation.bytes`: integer (original bytes)
- `truncation.retainedBytes`: integer

## Path safety

- All manifest paths must be **relative**, **normalized**, and must not contain `..`.
- Absolute paths are invalid.

## Compatibility key

`compatibilityKey` must be computed from:

- `artifactSurfaceVersion` **major**
- schema registry hash
- `tokenizationKey`
- embeddings identity (when enabled)
- language/segment policy identity
- chunk id algorithm version
- enabled mode set

Readers must hard-fail if compatibility keys differ.

