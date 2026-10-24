# Chunk identity and sizing contract

## Identity
- `chunk.metaV2.chunkId` is a deterministic, range-specific identifier (file + segmentId + start/end).
  - If multiple chunks share the same span, a deterministic `spanIndex` is assigned and included to disambiguate.
  - It is **not** stable across line-shift edits that move offsets.
- `chunk.id` is an index-local numeric id and is not stable across builds.

## Shape
- Each chunk includes `file`, `ext`, and positional metadata where available.
- Token-derived fields (`tokens`, `ngrams`, `chargrams`, `minhashSig`) align with postings.
- `start`/`end` offsets are **UTF-16 code unit indices** into the decoded file text; consumers should use `text.slice(start, end)` to recover the chunk span.
- `startLine`/`endLine` are 1-based line numbers derived from the same decoded text.

## Sizing
- Chunk boundaries follow segmentation rules per language/format.
- Size guards prevent pathological chunks; oversized files/segments are split or skipped with a recorded reason.
- Per-chunk limits can be enforced via `indexing.chunking.maxBytes` / `indexing.chunking.maxLines`.
- Partial language/role overrides merge field by field with their defaults.
  Explicit `null`, `0` or `false` disables that role cap; an independent global
  cap still applies. Omitting one field does not remove the other default cap.
- Byte splitting preserves Unicode scalars. A scalar larger than the byte cap
  remains intact and is marked `meta.byteLimitOversizeScalar: true`.
- Heading, schema and template chunkers retain text before the first structural
  heading as a `preamble` section. Declaration/AST ranges retain their original
  offsets. `.markdown` routes and chunks with the same prose rules as `.md`.

## Preprocessing evidence

Shared discovery rejects a file under mode-specific caps only when every
requested mode rejects it. Per-mode preprocessing and file processing use the
same byte/line precedence. `.txt` may route to records when an allowed strong
content signal is observed; ordinary Markdown retains prose precedence.
Bounded shebang/content probes retry positive short reads through cap or EOF.

Line counting carries the build cancellation signal into the shared queue and
each stream. Cancellation stops queued reads and waits for owned stream close.
An empty source has a known count of zero; an IO failure is classified failure,
never reusable zero-line evidence.

## Type and relation identity

Type identity preserves identifier case, quoted/template literal contents and
original spelling. Only insignificant syntax spacing and supported aliases are
normalized. Python `Optional` and `Union` rewrites respect balanced nesting;
nullable elements remain distinct from nullable containers. Unproven malformed
expressions retain their source spelling.

Relation diffs retain structured references and tuple call targets instead of
coercing them to display strings. Omitted relation-inference budgets preserve
evidence, while explicit numeric zero remains a drop-all limit. Tree-sitter token
classification charges its successful classification allowance after a parser
actually returns usable evidence, so unsupported segments leave it available.

## References
- `docs/specs/metadata-schema-v2.md`
- `docs/language/parser-backbone.md`
- `docs/language/ast-feature-list.md`

