# Public Artifact Surface (0.0.1)

This document is the **canonical** contract for PairOfCleats public artifacts. It supersedes `docs/artifact-contract.md` for all contract decisions.

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

- Additional fields are **only** allowed under an `extensions` object.
- Extensions must be namespaced by key (e.g., `extensions.vendorName.*`).
- Unknown top-level fields are **errors** unless explicitly listed in schema.

## Schema versioning

- All schemas use SemVer strings.
- `schemaVersion` is required for sharded JSONL meta files.
- Readers must support **N-1 major** for schema versions and artifact surface version; unknown majors are **hard errors**.

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
- enabled mode set

Readers must hard-fail if compatibility keys differ.
