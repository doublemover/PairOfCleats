# Semantic source excerpt boundaries

Status: UNVALIDATED source and authored controls, 2026-10-22.

The artifact store checks both endpoints of a retained UTF-16 source excerpt
after verifying and decoding its existing pinned UTF-8 snapshot. An endpoint
between a valid surrogate pair fails with `ERR_SEMANTIC_INTEGRITY`, including an
empty range at that position. It cannot expose a lone surrogate or measure its
replacement encoding as an ordinary source excerpt. This matches the existing
streamed `verifySource` scalar requirement.

Empty ranges at complete scalar boundaries and EOF remain valid. Response bytes
still count exact UTF-8 excerpt bytes under the original allowance, independently
of decoded-source retention. This adds no file read, cache, budget, default or
working-tree fallback. Wire-shape record hydration remains separate from source
excerpt admission; the raw record range is preserved for diagnosis.

The authored actual partition/store fixture persists shape-valid nodes with
valid and split astral endpoints, checks exact retained text after working-tree
mutation, zero-byte empty ranges, existing byte-limit errors, mixed-request
failure and later valid requests. It has not run. Source-reference header-only
navigation, other backends/providers, native/runtime and performance qualification
remain open. No producer, format or schema meaning changes.
