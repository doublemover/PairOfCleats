# Generated core artifact metadata

Core metadata producers place a reserved declaration first in the existing
`extensions` object, and serialize `extensions` before the payload:

```json
{"extensions":{"__poc_generated":{"format":"poc.generated@1","kind":"index-state","flags":1}}}
```

The declaration describes this file's provenance and indexing policy. It does not
authenticate content, authorize deletion, establish a trusted directory, or grant
omission of any file named by a manifest, pointer, offset table, or other field.

## Covered producers

- Pieces manifests, including embedding rewrites, state checksum refreshes, and
  compaction replacements.
- Index state and its reuse metadata. The state marker is inserted before both
  stable hashes and determinism reports are calculated. SQLite, embedding/replay,
  and LMDB state patches retain and reissue the marker.
- Current-build pointers, after existing publication-readiness and containment
  checks, preserving other root extensions.
- The 17 registered JSONL-sharded metadata families, through the common helper
  and the separate generic-array, graph, and repository-map writers.
- Sharded token-postings metadata, alternate JSON/columnar file metadata, and
  sharded dense-vector metadata for the three registered uint8 vector families.

The helper is explicit at metadata producers. Generic JSON writers remain
policy-neutral. JSON arrays, JSONL rows, offset tables, raw vector bytes, native
stores, and strict external formats do not gain prepended bytes or header rows.
Binary-columnar/by-file metadata and native backend sidecars require separate
format-specific review and are not registered by this batch.

## Declaration and classifier contract

`src/shared/generated-artifact-core.js` exports:

- `withGeneratedArtifactMetadata(fields, kind, artifact = null)`: returns a
  metadata-first copy, preserving non-reserved extensions. Unknown producer
  families are returned unchanged.
- `isGeneratedArtifactMetadata(header, kind, artifact = null)`: exact declaration
  validation, including version, keys, flags, kind, and optional artifact family.
- `isGeneratedArtifactCoreCandidatePath(relativePath)`: cheap registered filename
  gate. Pieces manifests must be under `pieces`; build pointers under `builds`.
- `classifyGeneratedArtifactCorePrefix({ relativePath = null, prefix })`: examines
  at most 8 KiB. With a path, the declaration must match its registered metadata
  filename. Without a path, the caller may inspect already-read renamed content
  without issuing a new filesystem read.

Declarations must be the first extension field in the first root field. Unknown
versions, flags, kinds, extra declaration fields, malformed declarations, and
duplicate keys visible in the prefix fail open. Short complete inputs must also
be valid JSON. A capped prefix cannot validate an unseen suffix of a large file.
The classifier does not follow payload paths, decompress data, hash members, or
make filesystem access decisions. Its caller remains responsible for contained
reads and for deciding how the returned policy applies to source discovery.

## Rewrite and compatibility rules

Markers have no timestamps, build IDs, absolute paths, or other volatile data.
They participate in stable state hashes, so an unmarked state migrates once and
subsequent volatile-only updates can skip the state write again. Compressed state
uses the same marked payload as plain state. The existing schema registry does
not change: declarations use its extension slots.

Embedding and state rewrites preserve unrelated root and piece extensions.
Compaction preserves root extensions, metadata semantics, and caller extensions
on matching replacement piece identities. It removes owned offset, ordering-
bucket, and serialization/preallocation layout hints that no longer describe the
new shards. Stale chunk-offset manifest entries are removed. Token vocabulary IDs
are carried with their rows; inconsistent ID cardinality fails before replacing
the token shards. Replacement metadata and members receive fresh bytes/checksums.

This batch does not retrofit frozen snapshots or unchanged legacy cached files.
It does not omit headerless members or native directory descendants. Exact-member
omission needs a separate bounded, allowlisted candidate grammar and verified
content linkage; arbitrary manifest paths must never become exclusion rules.
