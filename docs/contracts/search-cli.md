# Search CLI contract

## Inputs
- Requires a query; missing query returns non-zero with usage/help.
- Mode selection via `--mode` (code/prose/extracted-prose/records). Defaults to code + prose + extracted-prose.
- Filters include file/path, extension, language, type, author, import, calls/uses, and risk tags.
- ANN backend selection via `--ann-backend` (auto/lancedb/sqlite-vector/hnsw/js).
- `--explain` / `--why` toggle human-readable score breakdowns.
- Comment excerpts for code results are enabled by default; disable with `--no-comments`.
- `--top` applies after ranking within each mode; it may return fewer results when filters or candidate sets are too small.

## Language filters
- `--lang` accepts **language ids** (effective language), not file extensions.
  - Examples: `--lang typescript`, `--lang javascript`, `--lang python`.
  - Common aliases: `ts` → `typescript`, `tsx` → `typescript`, `js` → `javascript`, `py` → `python`, `c#` → `csharp`, `c++` → `clike`.
  - Effective language is derived from segment metadata, so embedded TS/TSX in `.md`/`.vue` can be matched.
- `--ext` continues to filter by **container extension** (e.g., `.md`), independent of `--lang`.
- If the filter index lacks `byLang` (older artifacts), rebuild the index before using `--lang`.

## Outputs
- JSON output includes `code`, `prose`, `extractedProse`, `records`, and `stats`.
- Compact JSON omits heavy fields (tokens/lines) unless explicitly requested.
- Stats include backend selection, ANN state, models, cache info, and timing.
- Full JSON hits include `metaV2.chunkId`, the stable chunk identifier across rebuilds (top-level `id` is index-local).

## References
- `docs/search-contract.md`
- `docs/search.md`
