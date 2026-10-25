# Generated-artifact ownership

Current coverage: map caches, registered core metadata and object caches, 2026-10-25.

Generated content is not automatically disposable or unsearchable. Authored
configuration, triage records, documentation and useful reports retain their input
semantics. A marker classifies one owned file; it grants no execution, deletion or
trust authority and cannot nominate other paths for exclusion.

## Map caches

`report map` stores its default reusable cache under the repository cache root,
outside the source repository unless the user explicitly configures that root.
`--cache-dir` remains supported, including directories inside the source tree.

New cache files use `poc-code-map-cache-v1-<sha256>.json`. The digest is derived from
the cache key and contains no platform-invalid filename punctuation. Their valid
JSON envelope begins with `__poc_generated`, followed by `data` containing the map.
The reserved header has exactly `format`, `kind`, `flags` and `key`: respectively
`poc.generated@1`, `code-map-cache`, `1`, and the filename digest. Bit 1 means omit;
bit 2 is reserved for a future warn-and-retain policy. Unsupported combinations,
unknown fields/versions/bits and duplicate header keys fail open.

Discovery and watch first check candidate paths. A matching modern filename uses
one contained prefix read of at most 8192 bytes. Ordinary filenames incur no
marker reads. The header must occupy the first JSON field with the following
`data` object; a document or source string quoting the marker is not recognized.
Only the current file is omitted, with structured skip metadata naming its kind,
format, flags and action. This is an ownership convention, not authentication.

An additional check runs on the source buffer already read by the file processor,
before decoding, parsing or chunking. It recognizes a renamed or copied marked
map cache only when the exact supported declaration and recognizable map-model
header are present in the first 8 KiB. This adds no filesystem read. Ordinary
buffers get a small first-field check; quoted examples and marker-shaped authored
JSON without the map structure remain searchable. The signature starts in the
first 512 bytes, as emitted by the producer. Explicit records keep their searchable
semantic role. Unmarked legacy caches still require the exact historical path.

Discovery policy `poc.generated-discovery@7` participates in both the build content
hash and a dedicated `sourceAdmission` dependency. A policy migration qualifies
current physical prefix bytes before cached chunks or semantic relocation can be
returned. A warm text-cache buffer alone cannot supply that witness. Ordinary
sources retain compatible parse/lexical products and publish a new immutable
bundle with current admission identity; prior snapshots remain untouched. Record
mode bypasses this omission policy. Discovery selection producer is version 5.

One observation carries bounded bytes and source extent from the same contained
descriptor. EOF exactly at 8 KiB is complete and must contain valid JSON. Larger
sources are explicitly capped; all visible JSON must be valid or extendable,
including unique visible keys and a depth allowance of 256. Modern, renamed and
legacy maps share this validation with core/object caches. A capped observation
does not certify an unseen suffix. No extra byte probe or whole-file read is
introduced. Existing full source buffers preserve their original extent before
slicing; unknown custom-reader extents cannot authorize omission. The byte owner
also distinguishes an unfinished UTF-8 scalar from invalid visible encoding.

For old defaults, only
`.pairofcleats/maps/cache/code-map:lk1:<40 hexadecimal digits>.json` is considered.
Its bounded prefix must contain the recognizable map header, including the exact
repository root and supported version. Authored siblings, malformed candidates,
unknown markers and old unmarked caches at other custom locations remain inputs.
No directory is excluded merely because it contains one owned artifact.

## Core metadata

The [core metadata contract](generated-core-artifact-metadata.md) registers pieces
manifests, index state, build pointers, sharded metadata and audited alternate
metadata writers. Discovery/watch omit matching marked metadata files themselves;
the existing-content guard also recognizes renamed marked metadata. Referenced
JSONL/array/native members remain outside this metadata-only exclusion policy.
Authored siblings and unmarked lookalikes are preserved, including when a manifest
contains their paths. Generic JSON writers remain policy-neutral.

## Object caches

The [registered object-cache contract](generated-object-cache-metadata.md) covers
audited fixed-root object producers. Named and renamed recognition use the same
visible grammar and source-extent observation. Generic maps, arrays, JSONL,
configuration and unregistered cache-like files retain their input semantics.

## Remaining formats

Do not stamp the shared JSON or atomic-write primitives. They also produce user
configuration, records intended for search, arrays and third-party formats.
Register and migrate producers by semantic family:

1. Reuse existing schema extension slots where available. Strict schemas without
   such slots need a deliberate schema migration or companion metadata.
2. Preserve JSONL rows, array roots, sharding, offsets and journal replay. A new
   header row is a breaking change.
3. Preserve binary/native headers, SQLite/LMDB databases, compressed/CAS payloads,
   PEM, archives and package artifacts. Use compatible manifests or receipts.
4. Add provenance at the original producer boundary before dependent checksums;
   do not rewrite frozen snapshot hardlinks or golden files after production.
5. Keep useful exports/reports/editor output searchable. A future warn action
   must remain distinct from omission and must not flood repeated discovery.

The active follow-on sequence and acceptance limits live in the canonical
[roadmap](../roadmap.md). Recognizing all owned producer families does not imply
injecting bytes into every format or trusting third-party output.
