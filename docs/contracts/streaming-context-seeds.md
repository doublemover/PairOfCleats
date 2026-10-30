# Streaming context-pack seed reads

`assembleCompositeContextPackStreaming` uses the selected generation's compact
`chunk_uid_map` for chunk/file seeds. A successfully read index with no matching
seed remains a usable miss with `CHUNK_UID_MAP_MISS`. Ordinary hits retain compact
streaming reads and do not load full metadata. Symbol-only seeds use their existing
full-metadata owner without requiring an unrelated compact map.

Strict reads propagate original typed artifact failures. Missing declared parts,
invalid content, ambiguous strict sources and late stream failures cannot become
semantic misses or partial successful indexes. Tolerant reads permit only an
undeclared optional map in an available pieces manifest, before any row was
indexed, after the original resource owner confirms settlement. That state is
`optional-absent`, with `CHUNK_UID_MAP_UNAVAILABLE`, artifact `chunk_uid_map` and
reason `optional-undeclared`. Declared-but-unreadable data still rejects.

Seed-resolution statistics distinguish `ready`, `optional-absent` and
`not-requested` reads alongside lookup hits and row counts. The synchronous path
continues to consume its supplied metadata; the edit-safe and symbol fallbacks
retain their strict selected-generation readers. No public request relaxation,
unverified generation fallback or new full-metadata load is introduced.
