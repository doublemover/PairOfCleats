# Search CLI contract

## Inputs
- Requires a query; missing query returns non-zero with usage/help.
- Mode selection via `--mode` (code/prose/extracted-prose/records).
- Filters include file/path, extension, language, type, author, import, calls/uses, and risk tags.
- `--explain` / `--why` toggle human-readable score breakdowns.
- `--top` applies after ranking within each mode; it may return fewer results when filters or candidate sets are too small.

## Outputs
- JSON output includes `code`, `prose`, `extractedProse`, `records`, and `stats`.
- Compact JSON omits heavy fields (tokens/lines) unless explicitly requested.
- Stats include backend selection, ANN state, models, cache info, and timing.
- Full JSON hits include `metaV2.chunkId`, the stable chunk identifier across rebuilds (top-level `id` is index-local).

## References
- `docs/search-contract.md`
- `docs/search.md`
