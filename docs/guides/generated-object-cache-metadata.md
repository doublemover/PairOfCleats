# Generated object-cache and runtime metadata

This batch covers fixed-root, PoC-owned JSON cache/state objects whose readers
were audited to tolerate optional root metadata. It does not change generic JSON
writers or wrap arrays, JSONL records, native payloads, or dynamic root dictionaries.

The first root field is a static declaration:

```json
{"__poc_generated":{"format":"poc.generated@1","kind":"object-cache","flags":1,"artifact":"lsp-requests"},"version":1,"entries":[]}
```

No timestamps, cache keys, paths, PIDs, credentials, or build identities are copied
into the declaration. It describes only the containing file. Its payload fields
cannot authorize omission of source paths, other files, or directories.

## Audited producer and reader boundaries

- Tree-sitter persistent chunks: `schemaVersion`, `cacheKey`, and `chunks` remain
  unchanged. The cache-key/config signature and clone-isolation behavior remain
  unchanged; both marked and legacy unmarked entries load.
- Cross-file inference: fingerprints, stats, admission details, and rows retain
  their existing meanings. Marker bytes enter row admission estimates, and a final
  serialized-byte check includes admission diagnostics before any write. It counts
  encoder output without retaining it, then combines the small metadata envelope,
  previously measured row sizes, and exact JSON framing. The complete selected-row
  payload is never materialized just to enforce this cap. A cache
  that exceeds its configured cap is skipped without replacing an existing file.
- Import resolution and its persistence-failure marker: normalization still reads
  the version, nested file/lookup maps, and diagnostics. Warning throttling and
  failure-marker cleanup keep their existing behavior.
- SCM file-meta snapshots: the declaration sits outside the nested `files` map.
  Head/config-signature freshness and per-file reuse still use their existing keys.
- LSP requests: positive, negative, and expired entries stay in the existing entry
  array. Request-key policy, schema version, normalization, TTL, and caps are intact.
- Command probes: the command fingerprint, provider, arguments, attempt list, and
  expiry checks remain the cache identity; no command execution is introduced.
- Workspace preflight: fingerprint/state-age checks read the same operational
  marker fields. Persistence-only metadata is removed from full-payload API results
  so disk loads and in-memory cache hits have the same shape.
- Pyright planner/runtime health: existing fixed-field readers preserve planning,
  cooldown, fingerprint, recovery, and degraded-state decisions.
- Learned-auto, scheduler-autotune, tree-sitter adaptive, and embeddings-autotune
  profiles: metadata remains outside `profiles`, `entriesByGrammarKey`, and
  `byIdentity`. Their normalizers, schema versions, limits, and write cadence are
  unchanged. A skipped write does not retrofit an old file just to add provenance.
- Enrichment state: markers are issued only when serializing, and recognized
  persistence metadata is removed when reading the complete operational object.
  Existing lock handling, unknown application fields, and extension data survive.

## Classifier and integration API

`src/shared/generated-artifact-cache.js` exports:

- `withGeneratedCacheMetadata(fields, artifact)` for the 15 registered producer
  families. Unknown families, arrays, and non-object payloads are unchanged.
- `withoutGeneratedCacheMetadata(fields)` for APIs returning full cache objects.
  Only a valid registered declaration is removed.
- `isGeneratedCacheMetadata(header)` for exact marker validation.
- `isGeneratedArtifactCacheCandidatePath(relativePath)` for a cheap filename/layout
  gate using audited fixed names and narrowly registered hash/name patterns.
- `classifyGeneratedArtifactCachePrefix({ relativePath = null, prefix })` for a
  bounded 8 KiB read. A supplied path must match the declared family. Omitting the
  path supports already-read renamed content without additional filesystem reads.

The prefix classifier rejects malformed declarations, unsupported flags/versions,
unknown families/fields, and duplicate keys visible in the prefix. Short complete
files must parse as JSON; parse failures including excessive nesting fail open.
An unseen suffix of a large file cannot be validated from its prefix. Filesystem
containment and index-admission wiring remain the caller's responsibilities.

## Deliberately remaining work

These unimplemented producer families require a separate compatibility pass:

- CAS metadata and immutable content-addressed objects; embedding binary caches,
  native stores, manifests with raw offsets, and native dependency sidecars.
- Tooling provider-result caches, clangd tracked-header caches, sourcekit's distinct
  package-resolution marker, VFS cold-start metadata and source mirrors.
- Document-extraction/yield caches, modality profiles, SQLite worker/zero-state
  profiles, and other runtime producers not listed above.
- Build-state/checkpoint objects, snapshots/diffs, locks, append-only journals,
  spill files, incremental bundles, root-map query caches, and metrics/history.
- Exported reports, diagnostics, generated reference/source/configuration files,
  editor outputs and packaging artifacts. These need their own searchable/warn
  classification; cache policy must not spread through shared write helpers.

Headerless members and native directory descendants are not excluded by this
batch. Legacy unmarked objects remain readable and unclassified; filenames alone
do not establish ownership. No frozen snapshots are retroactively rewritten.
