# Phase 3 Segmentation Performance Spec (Draft)

## Goal
Avoid duplicate Markdown parsing by extracting fenced blocks and inline spans in a single micromark traversal while preserving existing segment outputs and ordering.

## Scope
- In: Markdown segmentation only (no changes to JSX/Vue/Svelte/Astro segmentation).
- Out: New segment types or schema changes.

## Behavior
- Frontmatter detection must remain unchanged and still short-circuit where required.
- Fenced blocks and inline code spans are captured in one pass.
- Output segment ordering is deterministic and consistent with current outputs.
- Error handling remains best-effort: parse errors must not crash segmentation and must surface as the existing `parse-error` path.
- Inline code spans are optional and gated by segments config (`inlineCodeSpans: true`).

## Single-pass traversal (contract)
- Use a single micromark event stream to collect:
  - Fenced code blocks (language, start/end offsets, text).
  - Inline code spans (start/end offsets, text).
  - Headings/paragraph boundaries as currently used by `segmentMarkdown`.
- Preserve existing "root chunk" fallback behavior when no segments are produced.
- Maintain the same `segment.meta` shapes for Markdown outputs.
- If micromark parsing fails, return no inline spans or fenced blocks and rely on the existing
  fallback segment behavior (do not throw).

## Inline code span caps (current defaults)
When `inlineCodeSpans=true`, the following caps apply (see `src/index/segments/markdown.js`):
- `inlineCodeMinChars` (default **8** non-whitespace chars).
- `inlineCodeMaxSpans` (default **200** spans per file).
- `inlineCodeMaxBytes` (default **65536** total UTF-8 bytes across spans).

Spans that would exceed `maxSpans` or `maxBytes` are skipped.

## Ordering rules
- Segments are emitted in document order based on start offset.
- When two segments share the same start offset, preserve the current tie-break used by `segmentMarkdown` (documented in code comments).

## Performance expectations
- Parsing should occur once per Markdown file.
- Large files should not cause extra allocations beyond the existing segment list.
- When segmentation artifacts spill or shard, use the shared merge core to preserve deterministic ordering
  and ensure spill cleanup is centralized.

## Touchpoints
- `src/index/segments/markdown.js`
- `src/index/segments/frontmatter.js`
- `src/index/segments.js`

## Tests
- Regression fixture: frontmatter + fenced blocks + inline spans (order-sensitive).
- Equivalence test: `segment-pipeline` outputs are byte-for-byte equivalent for Markdown inputs.
- Determinism test: two runs on the same Markdown input produce identical segment ordering.

## Benchmarks
- `tools/bench/merge/merge-core-throughput.js` (spill/merge throughput reference)
