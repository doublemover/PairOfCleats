# Search Pipeline

This document summarizes the query pipeline and the fast prefilter stages used before exact matches.

## Manifest strictness

Search uses manifest-first artifact discovery in strict mode (default). If a legacy index is missing
`pieces/manifest.json`, strict search fails closed. Use `--non-strict` to allow legacy filename
guessing; non-strict mode should emit a warning because it bypasses the manifest contract.

## Startup checkpoints

When `--stats` or `--explain` is enabled, search emits timing + memory checkpoints in
`stats.pipeline`. Startup stages are prefixed with `startup.` to distinguish them from the core
query pipeline:

- `startup.backend` (backend resolution + sqlite/lmdb checks)
- `startup.dictionary` (dictionary load)
- `startup.query-plan` (query parsing + plan assembly)
- `startup.indexes` (index + artifact load)
- `startup.search` (end-to-end search session)

Core pipeline stages still include `parse`, `filter`, `candidates`, `ann`, `fusion`, `rank`, and
`output`. Each entry includes elapsed time and memory deltas so cold-start regressions can be
triaged quickly.

## Tokenization

- Code search keeps punctuation tokens (examples: `&&`, `=>`, `::`).
- Prose search applies stop-word removal and stemming; code search does not.
- Query parsing preserves punctuation tokens so symbol-only queries can match code.

## Free text and explicit query constraints

- Sparse-only results keep implicit AND semantics for adjacent terms.
- For candidates returned by a vector provider, unquoted positive free-text terms
  describe semantic intent rather than requiring every word to occur literally.
  The lexical MinHash fallback retains lexical constraints.
  For example, `cache refresh unnecessary` can retain a relevant ANN result
  containing `cache refresh`.
- Explicit `AND`, `OR`, or parentheses request Boolean matching for the complete
  query, including its implicit conjunctions. Use `cache AND refresh` to require
  both terms for sparse and ANN results alike.
- `alpha OR NOT gamma` also admits rows without `alpha` when they lack `gamma`;
  `NOT gamma` searches the selected mode's complement. Sparse ranking retains
  those eligible rows with zero lexical score after positive matches. Independent
  file/language/metadata filters still apply to every result.
- Quoted phrases, `NOT`/`-` exclusions, and structured file/language/metadata filters
  remain hard constraints for ANN results. Free text never bypasses those filters.
- With `--stats` or `--explain`, the `rank` entry in `stats.pipeline` includes
  `queryGate` counts: `evaluated`, `annEvaluated`, `rejected`, and `annRejected`.
  These distinguish an empty provider result from post-retrieval query rejection.

Query-result cache keys are versioned for these semantics; old cached zero-result
responses are not reused after the change.

SQLite FTS applies Boolean exclusions and exact literal-phrase eligibility before
its bounded candidate limit, so ineligible high-ranking matches cannot crowd out
eligible results later in the same list. Missing literal phrase evidence remains
ineligible; a healthy FTS result does not require a sparse-backend fallback.

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

When enabled, the search pipeline can append related chunks (calls/imports/usages) after primary hits. Context hits are labeled with a `context` object (`sourceId`, `reason`) and have `scoreType: "context"`. Use `retrieval.contextExpansion.*` to control limits and relation types, and `respectFilters` to keep expansions inside the active filters.

## Structural filters

When structural matches are ingested (see `docs/guides/structural-search.md`), you can filter results by:
- `--struct-pack <id>`
- `--struct-rule <id>`
- `--struct-tag <tag>`

## Output formats

- Default output is human-readable sections for code/prose/records.
- Shortened human excerpts preserve complete Unicode characters and emoji
  sequences; JSON retains the full stored headline.
- `--json` emits a JSON payload with `backend`, `code`, `prose`, `extractedProse`, and `records`.
- `--compact` trims JSON hits to a stable subset of fields (use `--json --compact`).
- `--stats` adds a `stats` object to JSON output; `--explain` implies stats and adds score breakdowns.

Notes:
- JSON output strips `tokens` fields from hits (and nested context/contextHits) to keep payloads smaller.
- Historical roadmap drafts mentioned `symbol-first` and `context-only` modes. The current supported output controls are the default human view, `--json`, `--compact`, `--stats`, and `--explain`; context expansion is controlled by `retrieval.contextExpansion.*`.

Configuration:
- `search.rrf.enabled` (default: true)
- `search.rrf.k` (default: 60)
- `search.fieldWeights` (defaults favor name/signature over body)
- `search.sqliteFtsWeights` (file/name/signature/kind/headline/doc/tokens column weights)
- `retrieval.contextExpansion` (limits and relation toggles)
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

## Enumerate classes, return types, and relations

No placeholder query is needed for indexed metadata searches:

```bash
pairofcleats search --repo . --mode code --return-type boolean --top 20 --json
pairofcleats search --repo . --mode code --return-type '{ ok: boolean; value: string }' --json
pairofcleats search --repo . --mode code --type ClassDeclaration --extends Base --json
pairofcleats search --repo . --mode code --calls fetch --json
```

Use the exact recorded type expression. A `boolean` filter does not also match a promise, array, union, alias, or a type merely containing that word. Inter-token whitespace is ignored; identifier case and literal contents remain significant. This is not an assignability or structural-equivalence query.

`--top` sets a page size per selected mode. Repeat the same filters with `--cursor <nextCursor>` from the `pagination` object until `hasMore` is false. Matching is exhaustive over the indexed metadata and does not invoke vectors or models. The cursor is tied to that generation; if indexing changes, restart or select the original `--as-of` generation. Recorded compiler returns take precedence; declared returns remain eligible when compiler returns are unavailable. Unknown/unrecorded facts are not inferred. Relation-name filters retain their provider's coverage limits. For `--workspace`, pages traverse eligible repository/mode pairs in stable order. Follow `pagination.nextCursor` even after an empty page if `hasMore` is true. Changes to membership, filters, or indexed generations require restarting. Check `meta.completeness.unavailable` for excluded or missing modes.

HTTP GET/POST, MCP `search` and the evidence workspace accept the same queryless
filter request and continuation. For example, send `{ "returnType": "boolean",
"mode": "code", "top": 20 }`, then include its `cursor` with the same filters.
MCP also accepts `asOf`, `snapshot` and `snapshotId`; conflicting selectors fail.
Search context lines are removed. Zero is accepted only as a deprecated no-op;
use source excerpts or a context pack for context.

Enumeration yields to the event loop at bounded row/time checkpoints and records
scan, hydration and cache counters in `pagination.cost`. A compiled matching-ID
representation admits at most 16 MiB per entry and 64 MiB across 32 entries;
building an entry uses at most 32 MiB of bounded ID buffers. The existing retrieval
cache directory also retains at most 64 MiB across 32 continuation entries.
Admission charges both the old target and its atomic temporary replacement against
that representation-file allowance; fixed key/lock metadata is separate. Cache
members consume the shared contained-file owner and reject namespace symlinks.
Authenticated headers bind each entry to the generation, filters, time anchor and
mode; cold pages verify and seek only the needed ID blocks. Serialization adds
at most 32 MiB of temporary buffers, independently of the number of matches.
Oversized, missing, corrupt or busy entries fall back to a yielding scan that retains
only the page. `matchingRepresentation` identifies the path, and `continuationReadBytes`
reports its verified reads. `startupWork` reports actual metadata loads separately.
SQLite continuations hydrate matching IDs with indexed seeks. File artifacts and the
existing LMDB metadata blob still materialize metadata in each cold process; their
load counters explicitly retain that cost. Long-lived index caches amortize those
loads. Native and cold-process fixture receipts remain separate from warm predicate
receipts, and filter-only loaders omit token, field, phrase and chargram postings.

### Strict fact and scalar occurrence discovery

Use build-pinned `semantic_find` for source and role selection, rather than
changing the compatible fuzzy `inferredType` filter:

The current strict producer records both lexical declarations and checker facts in
the binding analysis partition. Declaration facts have a lexical span and a null
compiler context key; checker failure can retain the declaration and emits an
incomplete-coverage frontier. A missing or disabled binding producer does not imply
that declaration facts were indexed. Inspect the returned coverage before treating
an empty result as absence.

```json
{"selector":{"typeExpression":{"expression":"boolean","match":"exact-expression","sources":["compiler"],"roles":["return"]}}}
```

Add the normal `repoRoot` and immutable `generation` envelope. Select `declared`
explicitly for recorded declaration facts, and select `local`, `parameter`,
`field` or `return` roles. Results cite the matching fact, owner, compiler context
and retained source identity. This compares tokenized expression identity, without
assignability or alias expansion. Compiler formatting truncation and work/byte
admission produce partial coverage rather than invented complete facts.

`{"selector":{"literal":{"type":"boolean","representation":"true"}}}`
finds parser-established scalar literal occurrences. String representations are
JSON strings, and bigint representations are decimal strings. These are source
occurrences; symbolic finite-string membership/classification remains a separate
denotation query, and saved runtime type tags are separately observed evidence.
Neither type display strings nor runtime tags become actual scalar values.
Missing providers and unsupported domains retain coverage/frontiers; no universal
runtime-value enumeration is asserted.

Readable output includes bounded source excerpts with line numbers and lightweight syntax colors. Use `--plain` for plain text. `NO_COLOR`, non-TTY output and `TERM=dumb` also disable styling. Excerpts show the current working-tree source, which may differ from the indexed generation.

### Empty-result guidance

Empty results include `retrieval.emptyResults` diagnostics in JSON and actionable guidance in human output. Guidance distinguishes query/filter combinations, metadata enumeration, and recorded backend fallback. It never infers a stale index from an empty result. Use `pairofcleats index report` for recorded coverage, skipped-file reasons, revision comparison, and saved watcher backlog. A dirty working tree remains unverified; matching clean revisions do not prove current filesystem contents were indexed.
