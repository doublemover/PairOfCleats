# Metadata Schema v2

This document defines the v2 per-chunk metadata contract. It is the canonical schema for rich metadata and provenance across indexing stages.

## Versioning

- **Schema version:** 2.0.0
- **Container:** Stored inside `chunk_meta` entries as `metaV2` (future field).
- **Compatibility:** Readers must tolerate missing v2 metadata until migration completes.

## Core fields (stable)

These fields identify the chunk and its location.

- `chunkId` (string): Stable chunk identifier (derived from file + segment + range + content hash rules).
- `file` (string): Repo-relative file path.
- `segment` (object):
  - `segmentId` (string)
  - `type` (code|prose|config|comment|embedded)
  - `languageId` (string)
  - `parentSegmentId` (string|null)
- `range` (object):
  - `start` (number)
  - `end` (number)
  - `startLine` (number)
  - `endLine` (number)
- `lang` (string): Canonical language id.
- `ext` (string|null): File extension.
- `kind` (string|null): Symbol kind (function/class/etc).
- `name` (string|null): Symbol name.

## Provenance

Each derived signal includes explicit provenance.

- `generatedBy` (string): Indexer version or build ID.
- `tooling` (object):
  - `tool` (string)
  - `version` (string)
  - `configHash` (string)
- `parser` (object):
  - `name` (string)
  - `version` (string|null)
- `confidence` (number|null): 0–1 confidence for derived metadata (when applicable).

## Doc metadata

- `signature` (string|null)
- `doc` (string|null): Summary/docstring.
- `annotations` (string[]): Decorators/attributes.
- `modifiers` (object): `visibility`, `static`, `abstract`, `async`, `generator`, `readonly`.
- `params` (string[]): Parameter names.
- `returns` (string|null): Declared return type/name.
- `docComments` (object):
  - `summary` (string|null)
  - `tags` (array)

## Control-flow summary

- `controlFlow` (object):
  - `branches` (number)
  - `loops` (number)
  - `breaks` (number)
  - `continues` (number)
  - `returns` (number)
  - `throws` (number)
  - `awaits` (number)
  - `yields` (number)
  - `async` (boolean)
  - `generator` (boolean)

## Dataflow summary

- `dataflow` (object):
  - `reads` (string[])
  - `writes` (string[])
  - `mutations` (string[])
  - `aliases` (string[])

## Dependencies

- `dependencies` (object):
  - `imports` (string[])
  - `requires` (string[])
  - `includes` (string[])
  - `references` (string[])

## Risk metadata

- `risk` (object):
  - `sources` (array of `{ id, label, confidence }`)
  - `sinks` (array of `{ id, label, confidence }`)
  - `sanitizers` (array of `{ id, label, confidence }`)
  - `flows` (array of `{ from, to, confidence }`)

## Type metadata

- `types` (object):
  - `declared` (object)
  - `inferred` (object)
  - `tooling` (object)
  - Each entry includes `{ type, source, confidence }`

## Embedded metadata

- `embedded` (object):
  - `parentSegmentId` (string|null)
  - `languageId` (string|null)
  - `context` (string|null)

## Mapping from current `docmeta`

Current `docmeta` fields map to v2 as follows:

- `docmeta.signature` -> `metaV2.signature`
- `docmeta.doc` -> `metaV2.doc`
- `docmeta.decorators` -> `metaV2.annotations`
- `docmeta.modifiers` -> `metaV2.modifiers`
- `docmeta.params` -> `metaV2.params`
- `docmeta.paramTypes` -> `metaV2.types.declared.params`
- `docmeta.paramDefaults` -> `metaV2.types.declared.defaults`
- `docmeta.returnType` -> `metaV2.types.declared.returns`
- `docmeta.returnsValue` -> `metaV2.controlFlow.returns`
- `docmeta.throws` -> `metaV2.controlFlow.throws`
- `docmeta.awaits` -> `metaV2.controlFlow.awaits`
- `docmeta.yields` -> `metaV2.controlFlow.yields`
- `docmeta.controlFlow.*` -> `metaV2.controlFlow.*`
- `docmeta.dataflow.*` -> `metaV2.dataflow.*`
- `docmeta.risk.*` -> `metaV2.risk.*`
- `docmeta.inferredTypes.*` -> `metaV2.types.inferred.*`
- `docmeta.record` -> `metaV2.record` (legacy passthrough until record schema v2)

## Deprecation schedule

- **Phase 2:** Publish schema v2 and begin emitting `metaV2` alongside legacy `docmeta`.
- **Phase 3:** Readers accept both `metaV2` and `docmeta`.
- **Phase 4:** Writers deprecate legacy-only fields and emit v2 as canonical.
- **Phase 5:** Readers treat `docmeta` as legacy and prefer v2 fields by default.

No removal occurs before Phase 5 gates are met and migration coverage is verified.
