# Search Pipeline

This document summarizes the query pipeline and the fast prefilter stages used before exact matches.

## Manifest strictness

Search uses manifest-first artifact discovery in strict mode (default). If a legacy index is missing
`pieces/manifest.json`, strict search fails closed. Use `--non-strict` to allow legacy filename
guessing; non-strict mode should emit a warning because it bypasses the manifest contract.

## Tokenization

- Code search keeps punctuation tokens (examples: `&&`, `=>`, `::`).
- Prose search applies stop-word removal and stemming; code search does not.
- Query parsing preserves punctuation tokens so symbol-only queries can match code.

## File Filter Prefilter (Substring/Regex)

When `--file` or `--path` filters are used, the filter index builds file-name chargrams. The filter stage:

1. Extracts a literal substring from substring filters or the longest literal run from regex filters.
2. Builds chargrams for that literal and intersects candidate file IDs using the chargram index.
3. Applies the original substring or regex on each candidate file path to verify exact matches.

This prefilter is advisory only: it narrows candidates but never skips the final exact match. Regex filters with no stable literal segment skip the prefilter and run exact matching on all candidates.

## Limits

- Chargram prefilter is case-insensitive; case-sensitive file filters are still enforced during the final exact match step.
- Very short substrings (shorter than the configured chargram size) do not benefit from the prefilter.

## Filter index footprint

The filter index is loaded into memory for fast path/file/metadata filters. Its memory footprint is
roughly proportional to the on-disk `filter_index.json` size. Index metrics report
`artifacts.filterIndex` (counts + `jsonBytes`) in `metrics/index-<mode>.json` so large repos can
track growth. Index builds emit a soft warning when the filter index approaches the JSON size limit.

## Scoring and Fusion

PairOfCleats treats BM25 as the primary sparse ranker. When SQLite FTS5 is enabled it provides an alternate sparse list, but BM25 remains the reference for defaults and tuning.

Fielded BM25 is enabled when field postings are available. It scores query terms against `name`, `signature`, `doc`, and `body` streams, combining them with configurable weights.

When both sparse and dense lists are available, results are fused using Reciprocal Rank Fusion (RRF). RRF relies on rank positions rather than raw score scales, which makes sparse and dense lists comparable without normalization.

## Query intent

Queries are classified as `code`, `prose`, `path`, or `mixed` based on lightweight heuristics (symbols, camel/snake case, paths, and word count). Intent is used when `search.denseVectorMode=auto` to choose doc vs code vectors, and to select default field weights. Use `--explain` to see the intent decision in the JSON payload.

`denseVectorMode` is configured via `search.denseVectorMode` or `--dense-vector-mode` (`merged | code | doc | auto`). CLI flags override user config, which overrides defaults (CLI > user config > defaults). When a CLI value overrides a configured value, search logs a warning indicating the config was ignored.

SQLite ANN (`sqlite-vec`) currently indexes merged vectors only. When `denseVectorMode` resolves to `code`, `doc`, or `auto`, sqlite-vec ANN is disabled for that run and the pipeline falls back to other ANN backends.

## Context expansion

When enabled, the search pipeline can append related chunks (calls/imports/usages) after primary hits. Context hits are labeled with a `context` object (`sourceId`, `reason`) and have `scoreType: "context"`. Use `search.contextExpansion.*` to control limits and relation types, and `respectFilters` to keep expansions inside the active filters.

## Structural filters

When structural matches are ingested (see `docs/guides/structural-search.md`), you can filter results by:
- `--struct-pack <id>`
- `--struct-rule <id>`
- `--struct-tag <tag>`

## Output formats

- Default output is human-readable sections for code/prose/records.
- `--json` emits a JSON payload with `backend`, `code`, `prose`, `extractedProse`, and `records`.
- `--compact` trims JSON hits to a stable subset of fields (use `--json --compact`).
- `--stats` adds a `stats` object to JSON output; `--explain` implies stats and adds score breakdowns.

Notes:
- JSON output strips `tokens` fields from hits (and nested context/contextHits) to keep payloads smaller.
- Planned output modes like `symbol-first` / `context-only` are not implemented yet.

Configuration:
- `search.rrf.enabled` (default: true)
- `search.rrf.k` (default: 60)
- `search.fieldWeights` (defaults favor name/signature over body)
- `search.sqliteFtsWeights` (file/name/signature/kind/headline/doc/tokens column weights)
- `search.contextExpansion` (limits and relation toggles)
- `search.scoreBlend` can override RRF when enabled (normalized blend weights).
- `search.denseVectorMode` or `--dense-vector-mode` (vector target selection; CLI overrides config).
- `search.annDefault` (default: true; used when `--ann/--no-ann` is not provided).
- `search.maxCandidates` (cap candidate-set size; disables candidate prefilter when exceeded).

### Explain output

Pass `--explain` to include `scoreBreakdown` in JSON responses. This includes:
- `sparse` details (BM25 or FTS5, k1/b, normalization)
- `ann` details (dense source)
- `rrf` contributions (ranks and fused score), when used
- `blend` details when normalized blending is enabled
- `symbol` boost metadata for definitions/exports
- `phrase` metadata when phrase/chargram boosts are active
- `selected` final score type + value

